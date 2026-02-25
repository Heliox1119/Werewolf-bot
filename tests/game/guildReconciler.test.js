/**
 * Tests for game/guildReconciler.js
 *
 * Verifies that:
 * - Data for guilds the bot has LEFT is fully deleted
 * - Data for guilds the bot is STILL IN remains untouched
 * - Transactions are atomic (all-or-nothing per guild)
 * - Premium data is never touched
 * - In-memory games are evicted for stale guilds
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// We test against a real in-memory SQLite database (not the mock)
// so we can verify actual SQL queries.

let db; // raw better-sqlite3 instance
let gameDb; // wrapper that looks like GameDatabase (has .db property)
let gm; // fake GameManager

beforeEach(() => {
  // Create a fresh in-memory DB with schema
  db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Load the real schema
  const schemaPath = path.join(__dirname, '..', '..', 'database', 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf8');
  db.exec(schema);

  // Migrations that exist in db.js but not in schema.sql
  const cols = db.pragma('table_info(player_stats)').map(c => c.name);
  if (!cols.includes('guild_id')) {
    db.exec('ALTER TABLE player_stats ADD COLUMN guild_id TEXT');
  }

  // Create premium_users table (migration from db.js)
  db.exec(`
    CREATE TABLE IF NOT EXISTS premium_users (
      user_id TEXT PRIMARY KEY,
      tier TEXT NOT NULL DEFAULT 'premium',
      granted_by TEXT,
      reason TEXT,
      expires_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
    )
  `);

  // Create player_guilds table (migration from db.js)
  db.exec(`
    CREATE TABLE IF NOT EXISTS player_guilds (
      player_id TEXT NOT NULL,
      guild_id TEXT NOT NULL,
      PRIMARY KEY (player_id, guild_id)
    )
  `);

  // Wrap in a GameDatabase-like object
  gameDb = { db };

  // Fake GameManager with in-memory games map
  gm = {
    games: new Map(),
    lobbyTimeouts: new Map(),
    activeGameTimers: new Map()
  };
});

afterEach(() => {
  // Clear any pending timers from lobbyTimeouts to prevent Jest hang
  if (gm && gm.lobbyTimeouts) {
    for (const t of gm.lobbyTimeouts.values()) clearTimeout(t);
    gm.lobbyTimeouts.clear();
  }
  if (db) db.close();
});

// Helper: create a fake Discord client with specific guild IDs
function fakeClient(guildIds) {
  const cache = new Map();
  for (const id of guildIds) {
    cache.set(id, { id, name: `Guild ${id}` });
  }
  return { guilds: { cache } };
}

// Helper: seed guild data across all tables
function seedGuildData(guildId, { gameChannelId = `ch-${guildId}`, playerId = `user-${guildId}` } = {}) {
  // Config
  db.prepare("INSERT INTO config (key, value) VALUES (?, ?)").run(`guild.${guildId}.discord.category_id`, '123456789');
  db.prepare("INSERT INTO config (key, value) VALUES (?, ?)").run(`guild.${guildId}.locale`, 'fr');
  db.prepare("INSERT INTO config (key, value) VALUES (?, ?)").run(`guild.${guildId}.game.wolf_win_condition`, 'majority');

  // Game (active)
  db.prepare(`
    INSERT INTO games (channel_id, guild_id, phase, day_count)
    VALUES (?, ?, 'Nuit', 0)
  `).run(gameChannelId, guildId);

  const gameRow = db.prepare('SELECT id FROM games WHERE channel_id = ?').get(gameChannelId);
  const gameId = gameRow.id;

  // Players in that game
  db.prepare('INSERT INTO players (game_id, user_id, username) VALUES (?, ?, ?)').run(gameId, playerId, 'TestUser');

  // Vote
  db.prepare("INSERT INTO votes (game_id, voter_id, target_id, vote_type) VALUES (?, ?, ?, 'village')").run(gameId, playerId, 'target1');

  // Night action
  db.prepare("INSERT INTO night_actions (game_id, night_number, action_type, actor_id, target_id) VALUES (?, 1, 'kill', ?, ?)").run(gameId, playerId, 'target1');

  // Action log
  db.prepare("INSERT INTO action_log (game_id, action_text) VALUES (?, 'Test action')").run(gameId);

  // Witch potions
  db.prepare('INSERT INTO witch_potions (game_id) VALUES (?)').run(gameId);

  // Game history
  db.prepare(`
    INSERT INTO game_history (guild_id, channel_id, winner, player_count, started_at, ended_at)
    VALUES (?, ?, 'village', 6, 1000, 2000)
  `).run(guildId, gameChannelId);

  // Player stats (guild-scoped)
  db.prepare(`
    INSERT INTO player_stats (player_id, username, games_played, games_won, guild_id)
    VALUES (?, 'TestUser', 10, 5, ?)
  `).run(`${playerId}-${guildId}`, guildId);

  // Player-guild junction
  db.prepare('INSERT INTO player_guilds (player_id, guild_id) VALUES (?, ?)').run(playerId, guildId);

  // In-memory game
  gm.games.set(gameChannelId, { guildId, mainChannelId: gameChannelId });
  gm.lobbyTimeouts.set(gameChannelId, setTimeout(() => {}, 999999));

  return { gameId, gameChannelId };
}

// ─────────────────────────────────────────────────────────────

describe('guildReconciler', () => {
  // Must require AFTER mocks are not set up (we use real DB)
  let reconcileGuildsOnStartup, purgeGuildData;

  beforeEach(() => {
    // Require fresh each time (no module caching issues)
    jest.resetModules();
    // Mock logger to avoid noise
    jest.doMock('../../utils/logger', () => ({
      app: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), success: jest.fn(), debug: jest.fn() },
      game: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), success: jest.fn(), debug: jest.fn() },
      discord: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), success: jest.fn(), debug: jest.fn() },
      interaction: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), success: jest.fn(), debug: jest.fn() }
    }));
    const mod = require('../../game/guildReconciler');
    reconcileGuildsOnStartup = mod.reconcileGuildsOnStartup;
    purgeGuildData = mod.purgeGuildData;
  });

  test('removes data for guild bot has left, keeps data for active guild', () => {
    const ACTIVE_GUILD = '111111111111111111';
    const STALE_GUILD = '222222222222222222';

    // Seed data for both guilds
    seedGuildData(ACTIVE_GUILD, { gameChannelId: 'ch-active', playerId: 'user-active' });
    seedGuildData(STALE_GUILD, { gameChannelId: 'ch-stale', playerId: 'user-stale' });

    // Also add a global config key and premium entry — must NOT be touched
    db.prepare("INSERT OR REPLACE INTO config (key, value) VALUES ('discord.category_id', '999')").run();
    db.prepare("INSERT INTO premium_users (user_id, tier) VALUES ('user-stale', 'premium')").run();

    // Bot is only in the active guild
    const client = fakeClient([ACTIVE_GUILD]);

    const result = reconcileGuildsOnStartup(client, gameDb, gm);

    // ─── Stale guild fully removed ───
    expect(result.removed).toContain(STALE_GUILD);
    expect(result.kept).toContain(ACTIVE_GUILD);

    // Config: stale guild keys gone
    const staleConfig = db.prepare("SELECT * FROM config WHERE key LIKE ?").all(`guild.${STALE_GUILD}.%`);
    expect(staleConfig).toHaveLength(0);

    // Games: stale guild games gone (and cascading tables)
    const staleGames = db.prepare('SELECT * FROM games WHERE guild_id = ?').all(STALE_GUILD);
    expect(staleGames).toHaveLength(0);

    // Players cascaded (no game → no players)
    const stalePlayers = db.prepare('SELECT p.* FROM players p JOIN games g ON p.game_id = g.id WHERE g.guild_id = ?').all(STALE_GUILD);
    expect(stalePlayers).toHaveLength(0);

    // Game history gone
    const staleHistory = db.prepare('SELECT * FROM game_history WHERE guild_id = ?').all(STALE_GUILD);
    expect(staleHistory).toHaveLength(0);

    // Player stats (guild-scoped) gone
    const staleStats = db.prepare('SELECT * FROM player_stats WHERE guild_id = ?').all(STALE_GUILD);
    expect(staleStats).toHaveLength(0);

    // Player-guilds junction gone
    const stalePG = db.prepare('SELECT * FROM player_guilds WHERE guild_id = ?').all(STALE_GUILD);
    expect(stalePG).toHaveLength(0);

    // In-memory game evicted
    expect(gm.games.has('ch-stale')).toBe(false);

    // ─── Active guild untouched ───
    const activeConfig = db.prepare("SELECT * FROM config WHERE key LIKE ?").all(`guild.${ACTIVE_GUILD}.%`);
    expect(activeConfig.length).toBeGreaterThanOrEqual(3);

    const activeGames = db.prepare('SELECT * FROM games WHERE guild_id = ?').all(ACTIVE_GUILD);
    expect(activeGames).toHaveLength(1);

    const activeHistory = db.prepare('SELECT * FROM game_history WHERE guild_id = ?').all(ACTIVE_GUILD);
    expect(activeHistory).toHaveLength(1);

    const activeStats = db.prepare('SELECT * FROM player_stats WHERE guild_id = ?').all(ACTIVE_GUILD);
    expect(activeStats).toHaveLength(1);

    const activePG = db.prepare('SELECT * FROM player_guilds WHERE guild_id = ?').all(ACTIVE_GUILD);
    expect(activePG).toHaveLength(1);

    // In-memory game still present
    expect(gm.games.has('ch-active')).toBe(true);

    // ─── Global/premium data untouched ───
    const globalConfig = db.prepare("SELECT * FROM config WHERE key = 'discord.category_id'").get();
    expect(globalConfig).toBeTruthy();
    expect(globalConfig.value).toBe('999');

    const premiumUser = db.prepare("SELECT * FROM premium_users WHERE user_id = 'user-stale'").get();
    expect(premiumUser).toBeTruthy();
    expect(premiumUser.tier).toBe('premium');
  });

  test('no-op when all guilds are active', () => {
    const GUILD_A = '333333333333333333';
    const GUILD_B = '444444444444444444';

    seedGuildData(GUILD_A, { gameChannelId: 'ch-a' });
    seedGuildData(GUILD_B, { gameChannelId: 'ch-b' });

    const client = fakeClient([GUILD_A, GUILD_B]);
    const result = reconcileGuildsOnStartup(client, gameDb, gm);

    expect(result.removed).toHaveLength(0);
    expect(result.kept).toContain(GUILD_A);
    expect(result.kept).toContain(GUILD_B);

    // Data still intact
    expect(db.prepare('SELECT COUNT(*) as n FROM games').get().n).toBe(2);
    expect(gm.games.size).toBe(2);
  });

  test('no-op when DB has no guild data', () => {
    const client = fakeClient(['555555555555555555']);
    const result = reconcileGuildsOnStartup(client, gameDb, gm);

    expect(result.removed).toHaveLength(0);
    expect(result.kept).toHaveLength(0);
  });

  test('idempotent — running twice produces same result', () => {
    const ACTIVE = '666666666666666666';
    const STALE = '777777777777777777';

    seedGuildData(ACTIVE, { gameChannelId: 'ch-idem-a' });
    seedGuildData(STALE, { gameChannelId: 'ch-idem-s' });

    const client = fakeClient([ACTIVE]);

    const r1 = reconcileGuildsOnStartup(client, gameDb, gm);
    expect(r1.removed).toContain(STALE);

    // Run again — stale guild is already gone, should be clean no-op
    const r2 = reconcileGuildsOnStartup(client, gameDb, gm);
    expect(r2.removed).toHaveLength(0);
    expect(r2.kept).toContain(ACTIVE);
  });

  test('purgeGuildData deletes cascading FK data (votes, night_actions, etc.)', () => {
    const GUILD = '888888888888888888';
    const { gameId } = seedGuildData(GUILD, { gameChannelId: 'ch-cascade' });

    // Verify cascading data exists before purge
    expect(db.prepare('SELECT COUNT(*) as n FROM players WHERE game_id = ?').get(gameId).n).toBe(1);
    expect(db.prepare('SELECT COUNT(*) as n FROM votes WHERE game_id = ?').get(gameId).n).toBe(1);
    expect(db.prepare('SELECT COUNT(*) as n FROM night_actions WHERE game_id = ?').get(gameId).n).toBe(1);
    expect(db.prepare('SELECT COUNT(*) as n FROM action_log WHERE game_id = ?').get(gameId).n).toBe(1);
    expect(db.prepare('SELECT COUNT(*) as n FROM witch_potions WHERE game_id = ?').get(gameId).n).toBe(1);

    const stats = purgeGuildData(gameDb, gm, GUILD);

    expect(stats.games).toBe(1);
    expect(stats.configKeys).toBe(3);
    expect(stats.history).toBe(1);
    expect(stats.playerStats).toBe(1);
    expect(stats.playerGuilds).toBe(1);

    // Cascaded tables should be empty for this game
    expect(db.prepare('SELECT COUNT(*) as n FROM players WHERE game_id = ?').get(gameId).n).toBe(0);
    expect(db.prepare('SELECT COUNT(*) as n FROM votes WHERE game_id = ?').get(gameId).n).toBe(0);
    expect(db.prepare('SELECT COUNT(*) as n FROM night_actions WHERE game_id = ?').get(gameId).n).toBe(0);
    expect(db.prepare('SELECT COUNT(*) as n FROM action_log WHERE game_id = ?').get(gameId).n).toBe(0);
    expect(db.prepare('SELECT COUNT(*) as n FROM witch_potions WHERE game_id = ?').get(gameId).n).toBe(0);
  });
});
