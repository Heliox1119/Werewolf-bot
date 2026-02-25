/**
 * Guild Reconciler — Cleans up stale guild data on startup.
 *
 * After the Discord client is ready, compares guilds the bot is actually in
 * (client.guilds.cache) with guild IDs stored in the database.
 * For each guild that is no longer present, all guild-scoped data is removed
 * atomically (config, games, history, per-guild stats, player_guilds).
 *
 * This does NOT touch:
 * - User-based premium data (premium_users)
 * - Global stats not scoped to a guild
 * - Metric history
 */

const { app: logger } = require('../utils/logger');

/**
 * Reconcile DB guild data with the bot's actual guild membership.
 *
 * @param {import('discord.js').Client} client   – Ready Discord client
 * @param {import('../database/db')}    db       – GameDatabase instance
 * @param {import('./gameManager')}     gm       – GameManager (to evict in-memory games)
 * @returns {{ removed: string[], kept: string[] }}
 */
function reconcileGuildsOnStartup(client, db, gm) {
  // 1. Build the set of guilds the bot is currently in
  const activeGuildIds = new Set(client.guilds.cache.keys());

  // 2. Collect every guild ID referenced in the DB
  const storedGuildIds = new Set();

  // 2a. Config table: keys like "guild.<id>.<rest>"
  try {
    const configRows = db.db.prepare(
      "SELECT DISTINCT substr(key, 7, instr(substr(key, 7), '.') - 1) AS gid FROM config WHERE key LIKE 'guild.%'"
    ).all();
    for (const r of configRows) {
      if (r.gid) storedGuildIds.add(r.gid);
    }
  } catch (e) {
    logger.error('[RECONCILE] Failed to read config guild IDs', { error: e.message });
  }

  // 2b. Games table
  try {
    const gameRows = db.db.prepare(
      'SELECT DISTINCT guild_id FROM games WHERE guild_id IS NOT NULL'
    ).all();
    for (const r of gameRows) storedGuildIds.add(r.guild_id);
  } catch (e) {
    logger.error('[RECONCILE] Failed to read games guild IDs', { error: e.message });
  }

  // 2c. Game history table
  try {
    const histRows = db.db.prepare(
      'SELECT DISTINCT guild_id FROM game_history WHERE guild_id IS NOT NULL'
    ).all();
    for (const r of histRows) storedGuildIds.add(r.guild_id);
  } catch (e) {
    logger.error('[RECONCILE] Failed to read game_history guild IDs', { error: e.message });
  }

  // 2d. Player stats (guild-scoped rows)
  try {
    const statRows = db.db.prepare(
      'SELECT DISTINCT guild_id FROM player_stats WHERE guild_id IS NOT NULL'
    ).all();
    for (const r of statRows) storedGuildIds.add(r.guild_id);
  } catch (e) {
    logger.error('[RECONCILE] Failed to read player_stats guild IDs', { error: e.message });
  }

  // 2e. Player-guild junction
  try {
    const pgRows = db.db.prepare(
      'SELECT DISTINCT guild_id FROM player_guilds'
    ).all();
    for (const r of pgRows) storedGuildIds.add(r.guild_id);
  } catch (e) {
    logger.error('[RECONCILE] Failed to read player_guilds guild IDs', { error: e.message });
  }

  // 3. Diff
  const staleGuildIds = [...storedGuildIds].filter(gid => !activeGuildIds.has(gid));
  const keptGuildIds = [...storedGuildIds].filter(gid => activeGuildIds.has(gid));

  if (staleGuildIds.length === 0) {
    logger.info('[RECONCILE] All stored guilds are active — nothing to clean', {
      activeGuilds: activeGuildIds.size,
      storedGuilds: storedGuildIds.size
    });
    return { removed: [], kept: keptGuildIds };
  }

  logger.info('[RECONCILE] Found stale guilds to clean', {
    stale: staleGuildIds.length,
    active: activeGuildIds.size,
    stored: storedGuildIds.size
  });

  // 4. Remove data for each stale guild — atomic per-guild via transaction
  const removed = [];

  for (const guildId of staleGuildIds) {
    try {
      const stats = purgeGuildData(db, gm, guildId);
      removed.push(guildId);
      logger.info('[RECONCILE] Removing stale guild data', {
        guildId,
        ...stats
      });
    } catch (e) {
      logger.error('[RECONCILE] Failed to purge guild data', {
        guildId,
        error: e.message
      });
    }
  }

  logger.success('[RECONCILE] Cleanup complete', {
    removedGuilds: removed.length,
    keptGuilds: keptGuildIds.length
  });

  return { removed, kept: keptGuildIds };
}

/**
 * Atomically delete all guild-scoped data for one guild.
 *
 * @param {import('../database/db')} db
 * @param {import('./gameManager')}  gm
 * @param {string}                   guildId
 * @returns {object} Counts of deleted rows per table
 */
function purgeGuildData(db, gm, guildId) {
  const stats = {
    configKeys: 0,
    games: 0,
    history: 0,
    playerStats: 0,
    playerGuilds: 0
  };

  // Run everything inside a single SQLite transaction (atomic)
  const tx = db.db.transaction(() => {
    // Config entries: guild.<guildId>.*
    const cfgResult = db.db.prepare("DELETE FROM config WHERE key LIKE ?").run(`guild.${guildId}.%`);
    stats.configKeys = cfgResult.changes;

    // Active/ended games (players, votes, night_actions, action_log, witch_potions cascade via FK)
    const gamesResult = db.db.prepare('DELETE FROM games WHERE guild_id = ?').run(guildId);
    stats.games = gamesResult.changes;

    // Game history
    const histResult = db.db.prepare('DELETE FROM game_history WHERE guild_id = ?').run(guildId);
    stats.history = histResult.changes;

    // Guild-scoped player stats (NOT global rows where guild_id IS NULL)
    const psResult = db.db.prepare('DELETE FROM player_stats WHERE guild_id = ?').run(guildId);
    stats.playerStats = psResult.changes;

    // Player-guild junction
    const pgResult = db.db.prepare('DELETE FROM player_guilds WHERE guild_id = ?').run(guildId);
    stats.playerGuilds = pgResult.changes;
  });

  tx(); // Execute the transaction

  // Evict in-memory games belonging to this guild
  if (gm && gm.games) {
    for (const [channelId, game] of gm.games.entries()) {
      if (game.guildId === guildId) {
        gm.games.delete(channelId);
        // Clean up timers if any
        if (gm.lobbyTimeouts && gm.lobbyTimeouts.has(channelId)) {
          clearTimeout(gm.lobbyTimeouts.get(channelId));
          gm.lobbyTimeouts.delete(channelId);
        }
        if (gm.activeGameTimers && gm.activeGameTimers.has(channelId)) {
          gm.activeGameTimers.delete(channelId);
        }
      }
    }
  }

  return stats;
}

module.exports = { reconcileGuildsOnStartup, purgeGuildData };
