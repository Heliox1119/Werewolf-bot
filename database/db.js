const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const { game: logger } = require('../utils/logger');

class GameDatabase {
  constructor(dbPath = null) {
    const defaultPath = path.join(__dirname, '..', 'data', 'werewolf.db');
    this.dbPath = dbPath || defaultPath;
    
    // Créer le dossier data si nécessaire
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Ouvrir la connexion
    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL'); // Write-Ahead Logging pour meilleures perfs
    this.db.pragma('foreign_keys = ON'); // Activer les contraintes FK
    
    // Initialiser le schéma
    this.initSchema();
    
    logger.info('Database initialized', { path: this.dbPath });
  }

  initSchema() {
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');
    
    // Exécuter le schéma
    this.db.exec(schema);
    
    const version = this.getConfig('schema_version');
    logger.info('Database schema loaded', { version });
    
    // Migration: ajouter les colonnes nightVictim/witchKillTarget/witchSave si absentes
    this.migrateSchema();

    // Ensure bot owner always has lifetime premium
    this.ensureOwnerPremium();
  }

  migrateSchema() {
    try {
      const columns = this.db.pragma('table_info(games)').map(c => c.name);
      if (!columns.includes('night_victim_id')) {
        this.db.exec('ALTER TABLE games ADD COLUMN night_victim_id TEXT');
        logger.info('Migration: added night_victim_id column');
      }
      if (!columns.includes('witch_kill_target_id')) {
        this.db.exec('ALTER TABLE games ADD COLUMN witch_kill_target_id TEXT');
        logger.info('Migration: added witch_kill_target_id column');
      }
      if (!columns.includes('witch_save')) {
        this.db.exec('ALTER TABLE games ADD COLUMN witch_save BOOLEAN DEFAULT 0');
        logger.info('Migration: added witch_save column');
      }
      if (!columns.includes('guild_id')) {
        this.db.exec('ALTER TABLE games ADD COLUMN guild_id TEXT');
        logger.info('Migration: added guild_id column (multi-guild support)');
      }
      if (!columns.includes('salvateur_channel_id')) {
        this.db.exec('ALTER TABLE games ADD COLUMN salvateur_channel_id TEXT');
        logger.info('Migration: added salvateur_channel_id column');
      }
      if (!columns.includes('spectator_channel_id')) {
        this.db.exec('ALTER TABLE games ADD COLUMN spectator_channel_id TEXT');
        logger.info('Migration: added spectator_channel_id column');
      }
      // v3.2 migrations — persist previously missing state fields
      if (!columns.includes('thief_channel_id')) {
        this.db.exec('ALTER TABLE games ADD COLUMN thief_channel_id TEXT');
        logger.info('Migration: added thief_channel_id column');
      }
      if (!columns.includes('white_wolf_channel_id')) {
        this.db.exec('ALTER TABLE games ADD COLUMN white_wolf_channel_id TEXT');
        logger.info('Migration: added white_wolf_channel_id column');
      }
      if (!columns.includes('white_wolf_kill_target_id')) {
        this.db.exec('ALTER TABLE games ADD COLUMN white_wolf_kill_target_id TEXT');
        logger.info('Migration: added white_wolf_kill_target_id column');
      }
      if (!columns.includes('protected_player_id')) {
        this.db.exec('ALTER TABLE games ADD COLUMN protected_player_id TEXT');
        logger.info('Migration: added protected_player_id column');
      }
      if (!columns.includes('last_protected_player_id')) {
        this.db.exec('ALTER TABLE games ADD COLUMN last_protected_player_id TEXT');
        logger.info('Migration: added last_protected_player_id column');
      }
      if (!columns.includes('village_roles_powerless')) {
        this.db.exec('ALTER TABLE games ADD COLUMN village_roles_powerless BOOLEAN DEFAULT 0');
        logger.info('Migration: added village_roles_powerless column');
      }
      if (!columns.includes('listen_hints_given')) {
        this.db.exec("ALTER TABLE games ADD COLUMN listen_hints_given TEXT DEFAULT '[]'");
        logger.info('Migration: added listen_hints_given column');
      }
      if (!columns.includes('thief_extra_roles')) {
        this.db.exec("ALTER TABLE games ADD COLUMN thief_extra_roles TEXT DEFAULT '[]'");
        logger.info('Migration: added thief_extra_roles column');
      }
      const playerColumns = this.db.pragma('table_info(players)').map(c => c.name);
      if (!playerColumns.includes('has_shot')) {
        this.db.exec('ALTER TABLE players ADD COLUMN has_shot BOOLEAN DEFAULT 0');
        logger.info('Migration: added has_shot column to players');
      }
      if (!playerColumns.includes('idiot_revealed')) {
        this.db.exec('ALTER TABLE players ADD COLUMN idiot_revealed BOOLEAN DEFAULT 0');
        logger.info('Migration: added idiot_revealed column to players');
      }

      // Ensure idempotent uniqueness for actor/night/action logs
      this.db.exec(`
        DELETE FROM night_actions
        WHERE id NOT IN (
          SELECT MIN(id)
          FROM night_actions
          GROUP BY game_id, night_number, action_type, actor_id
        )
      `);
      this.db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_actions_idempotent_actor ON night_actions(game_id, night_number, action_type, actor_id)');
      // Add guild_id to player_stats for per-guild leaderboards
      const statsColumns = this.db.pragma('table_info(player_stats)').map(c => c.name);
      if (!statsColumns.includes('guild_id')) {
        this.db.exec('ALTER TABLE player_stats ADD COLUMN guild_id TEXT');
        this.db.exec('CREATE INDEX IF NOT EXISTS idx_player_stats_guild ON player_stats(guild_id)');
        logger.info('Migration: added guild_id to player_stats');
      }

      // Migration: create game_history table if it doesn't exist
      const tables = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='game_history'").get();
      if (!tables) {
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS game_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guild_id TEXT,
            channel_id TEXT NOT NULL,
            winner TEXT,
            player_count INTEGER DEFAULT 0,
            duration_seconds INTEGER DEFAULT 0,
            day_count INTEGER DEFAULT 0,
            players_json TEXT,
            started_at INTEGER,
            ended_at INTEGER,
            created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
          )
        `);
        this.db.exec('CREATE INDEX IF NOT EXISTS idx_history_guild ON game_history(guild_id)');
        this.db.exec('CREATE INDEX IF NOT EXISTS idx_history_ended ON game_history(ended_at)');
        logger.info('Migration: created game_history table');
      }

      // Migration: create premium_users table
      const premiumTable = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='premium_users'").get();
      if (!premiumTable) {
        this.db.exec(`
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
        this.db.exec('CREATE INDEX IF NOT EXISTS idx_premium_tier ON premium_users(tier)');
        this.db.exec('CREATE INDEX IF NOT EXISTS idx_premium_expires ON premium_users(expires_at)');
        logger.info('Migration: created premium_users table');
      }

      // Migration: create player_guilds junction table (permanent player↔guild mapping)
      const pgTable = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='player_guilds'").get();
      if (!pgTable) {
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS player_guilds (
            player_id TEXT NOT NULL,
            guild_id TEXT NOT NULL,
            PRIMARY KEY (player_id, guild_id)
          )
        `);
        this.db.exec('CREATE INDEX IF NOT EXISTS idx_player_guilds_guild ON player_guilds(guild_id)');
        logger.info('Migration: created player_guilds table');

        // Back-fill from game_history
        try {
          const rows = this.db.prepare('SELECT guild_id, players_json FROM game_history WHERE guild_id IS NOT NULL AND players_json IS NOT NULL').all();
          const insert = this.db.prepare('INSERT OR IGNORE INTO player_guilds (player_id, guild_id) VALUES (?, ?)');
          const tx = this.db.transaction(() => {
            for (const row of rows) {
              try {
                const players = JSON.parse(row.players_json);
                for (const p of players) {
                  if (p.id) insert.run(p.id, row.guild_id);
                }
              } catch {}
            }
          });
          tx();
          logger.info('Migration: back-filled player_guilds from game_history');
        } catch (e) {
          logger.warn('Migration: failed to back-fill player_guilds', { error: e.message });
        }
      }

      // Migration: add missing indexes for performance
      this.db.exec('CREATE INDEX IF NOT EXISTS idx_games_guild ON games(guild_id)');
      this.db.exec('CREATE INDEX IF NOT EXISTS idx_games_guild_ended ON games(guild_id, ended_at)');
      this.db.exec('CREATE INDEX IF NOT EXISTS idx_games_guild_phase ON games(guild_id, phase)');
      this.db.exec('CREATE INDEX IF NOT EXISTS idx_player_stats_username ON player_stats(username)');

      // ─── v3.5 — Ability Engine migrations ─────────────────────────────────

      // v3.5.1 — Persist hunter shoot flag across reboots
      if (!columns.includes('hunter_must_shoot_id')) {
        this.db.exec('ALTER TABLE games ADD COLUMN hunter_must_shoot_id TEXT');
        logger.info('Migration: added hunter_must_shoot_id column to games');
      }

      // v3.5.1 — Persist captain tiebreak state across reboots
      if (!columns.includes('captain_tiebreak_ids')) {
        this.db.exec('ALTER TABLE games ADD COLUMN captain_tiebreak_ids TEXT');
        logger.info('Migration: added captain_tiebreak_ids column to games');
      }

      // v3.5.1 — Persist AFK no-kill cycle counter across reboots
      if (!columns.includes('no_kill_cycles')) {
        this.db.exec('ALTER TABLE games ADD COLUMN no_kill_cycles INTEGER DEFAULT 0');
        logger.info('Migration: added no_kill_cycles column to games');
      }

      // Add ability_state_json to games table for persisting ability runtime state
      if (!columns.includes('ability_state_json')) {
        this.db.exec("ALTER TABLE games ADD COLUMN ability_state_json TEXT DEFAULT '{}'");
        logger.info('Migration: added ability_state_json column to games');
      }

      // Upgrade custom_roles table: add abilities_json and win_condition columns
      const crTable = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='custom_roles'").get();
      if (crTable) {
        const crColumns = this.db.pragma('table_info(custom_roles)').map(c => c.name);
        if (!crColumns.includes('abilities_json')) {
          this.db.exec("ALTER TABLE custom_roles ADD COLUMN abilities_json TEXT DEFAULT '[]'");
          logger.info('Migration: added abilities_json column to custom_roles');
        }
        if (!crColumns.includes('win_condition')) {
          this.db.exec("ALTER TABLE custom_roles ADD COLUMN win_condition TEXT DEFAULT 'village_wins'");
          logger.info('Migration: added win_condition column to custom_roles');
        }
      } else {
        // Create the full custom_roles table with ability support
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS custom_roles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guild_id TEXT NOT NULL,
            name TEXT NOT NULL,
            emoji TEXT DEFAULT '❓',
            camp TEXT NOT NULL DEFAULT 'village',
            power TEXT DEFAULT 'none',
            description TEXT DEFAULT '',
            abilities_json TEXT DEFAULT '[]',
            win_condition TEXT DEFAULT 'village_wins',
            created_by TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `);
        this.db.exec('CREATE INDEX IF NOT EXISTS idx_custom_roles_guild ON custom_roles(guild_id)');
        logger.info('Migration: created custom_roles table with ability support');
      }

      // Migration: create mod_audit_log table for persistent moderation history
      const modAuditTable = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='mod_audit_log'").get();
      if (!modAuditTable) {
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS mod_audit_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            guild_id TEXT NOT NULL,
            moderator_id TEXT NOT NULL,
            moderator_name TEXT NOT NULL,
            action TEXT NOT NULL,
            details TEXT,
            created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
          )
        `);
        this.db.exec('CREATE INDEX IF NOT EXISTS idx_mod_audit_guild ON mod_audit_log(guild_id, created_at)');
        logger.info('Migration: created mod_audit_log table');
      }

      // Cleanup: remove fake debug players from stats
      this.db.exec("DELETE FROM player_stats WHERE player_id LIKE 'fake_%'");
      this.db.exec("DELETE FROM player_extended_stats WHERE player_id LIKE 'fake_%'");
      this.db.exec("DELETE FROM player_guilds WHERE player_id LIKE 'fake_%'");
    } catch (err) {
      logger.error('Schema migration error', { error: err.message });
    }
  }

  // ===== CONFIG =====
  
  getConfig(key) {
    const stmt = this.db.prepare('SELECT value FROM config WHERE key = ?');
    const row = stmt.get(key);
    return row ? row.value : null;
  }

  setConfig(key, value) {
    const stmt = this.db.prepare(`
      INSERT INTO config (key, value, updated_at) 
      VALUES (?, ?, strftime('%s', 'now'))
      ON CONFLICT(key) DO UPDATE SET 
        value = excluded.value,
        updated_at = excluded.updated_at
    `);
    stmt.run(key, String(value));
  }

  // ===== GAMES =====

  createGame(channelId, options = {}) {
    try {
      const stmt = this.db.prepare(`
        INSERT INTO games (
          channel_id, guild_id, lobby_host_id, min_players, max_players,
          phase, day_count, disable_voice_mute
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      
      const result = stmt.run(
        channelId,
        options.guildId || null,
        options.lobbyHostId || null,
        options.minPlayers || 5,
        options.maxPlayers || 10,
        'Nuit',
        0,
        options.disableVoiceMute || 0
      );
      
      logger.info('Game created in DB', { gameId: result.lastInsertRowid, channelId });
      return result.lastInsertRowid;
    } catch (err) {
      if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        logger.warn('Game already exists', { channelId });
        return null;
      }
      throw err;
    }
  }

  getGame(channelId) {
    const stmt = this.db.prepare('SELECT * FROM games WHERE channel_id = ?');
    return stmt.get(channelId);
  }

  getGameById(gameId) {
    const stmt = this.db.prepare('SELECT * FROM games WHERE id = ?');
    return stmt.get(gameId);
  }

  updateGame(channelId, updates) {
    const fields = [];
    const values = [];
    
    const mapping = {
      lobbyMessageId: 'lobby_message_id',
      lobbyHostId: 'lobby_host_id',
      voiceChannelId: 'voice_channel_id',
      villageChannelId: 'village_channel_id',
      wolvesChannelId: 'wolves_channel_id',
      seerChannelId: 'seer_channel_id',
      witchChannelId: 'witch_channel_id',
      cupidChannelId: 'cupid_channel_id',
      salvateurChannelId: 'salvateur_channel_id',
      whiteWolfChannelId: 'white_wolf_channel_id',
      spectatorChannelId: 'spectator_channel_id',
      thiefChannelId: 'thief_channel_id',
      phase: 'phase',
      subPhase: 'sub_phase',
      dayCount: 'day_count',
      captainId: 'captain_id',
      startedAt: 'started_at',
      endedAt: 'ended_at',
      nightVictim: 'night_victim_id',
      witchKillTarget: 'witch_kill_target_id',
      witchSave: 'witch_save',
      // v3.2 — previously missing state fields
      whiteWolfKillTarget: 'white_wolf_kill_target_id',
      protectedPlayerId: 'protected_player_id',
      lastProtectedPlayerId: 'last_protected_player_id',
      villageRolesPowerless: 'village_roles_powerless',
      listenHintsGiven: 'listen_hints_given',
      thiefExtraRoles: 'thief_extra_roles',
      // v3.5.1 — hunter shoot persistence
      hunterMustShootId: 'hunter_must_shoot_id',
      // v3.5.1 — captain tiebreak persistence
      captainTiebreakIds: 'captain_tiebreak_ids',
      // v3.5.1 — AFK no-kill cycles persistence
      noKillCycles: 'no_kill_cycles',
      // v3.5 — ability engine state
      abilityStateJson: 'ability_state_json'
    };

    for (const [jsKey, dbKey] of Object.entries(mapping)) {
      if (updates[jsKey] !== undefined) {
        fields.push(`${dbKey} = ?`);
        values.push(updates[jsKey]);
      }
    }

    if (fields.length === 0) return;

    values.push(channelId);
    const stmt = this.db.prepare(`UPDATE games SET ${fields.join(', ')} WHERE channel_id = ?`);
    stmt.run(...values);
  }

  deleteGame(channelId) {
    const stmt = this.db.prepare('DELETE FROM games WHERE channel_id = ?');
    const result = stmt.run(channelId);
    return result.changes > 0;
  }

  getAllGames() {
    const stmt = this.db.prepare('SELECT * FROM games WHERE ended_at IS NULL');
    return stmt.all();
  }

  // ===== PLAYERS =====

  addPlayer(channelId, userId, username) {
    const game = this.getGame(channelId);
    if (!game) return false;

    try {
      const stmt = this.db.prepare(`
        INSERT INTO players (game_id, user_id, username, alive, in_love)
        VALUES (?, ?, ?, 1, 0)
      `);
      stmt.run(game.id, userId, username);
      return true;
    } catch (err) {
      if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        return false; // Déjà dans la partie
      }
      throw err;
    }
  }

  removePlayer(channelId, userId) {
    const game = this.getGame(channelId);
    if (!game) return false;

    const stmt = this.db.prepare('DELETE FROM players WHERE game_id = ? AND user_id = ?');
    const result = stmt.run(game.id, userId);
    return result.changes > 0;
  }

  getPlayers(channelId) {
    const game = this.getGame(channelId);
    if (!game) return [];

    const stmt = this.db.prepare(`
      SELECT user_id as id, username, role, alive, in_love as inLove, has_shot as hasShot, idiot_revealed as idiotRevealed
      FROM players WHERE game_id = ?
      ORDER BY joined_at
    `);
    return stmt.all(game.id);
  }

  updatePlayer(channelId, userId, updates) {
    const game = this.getGame(channelId);
    if (!game) return false;

    const fields = [];
    const values = [];

    if (updates.role !== undefined) {
      fields.push('role = ?');
      values.push(updates.role);
    }
    if (updates.alive !== undefined) {
      fields.push('alive = ?');
      values.push(updates.alive ? 1 : 0);
    }
    if (updates.inLove !== undefined) {
      fields.push('in_love = ?');
      values.push(updates.inLove ? 1 : 0);
    }
    if (updates.hasShot !== undefined) {
      fields.push('has_shot = ?');
      values.push(updates.hasShot ? 1 : 0);
    }
    if (updates.idiotRevealed !== undefined) {
      fields.push('idiot_revealed = ?');
      values.push(updates.idiotRevealed ? 1 : 0);
    }

    if (fields.length === 0) return false;

    values.push(game.id, userId);
    const stmt = this.db.prepare(`
      UPDATE players SET ${fields.join(', ')}
      WHERE game_id = ? AND user_id = ?
    `);
    const result = stmt.run(...values);
    return result.changes > 0;
  }

  // ===== VOTES =====

  addVote(channelId, voterId, targetId, voteType = 'village', round = 0) {
    const result = this.addVoteIfChanged(channelId, voterId, targetId, voteType, round);
    return result.ok;
  }

  addVoteIfChanged(channelId, voterId, targetId, voteType = 'village', round = 0) {
    const game = this.getGame(channelId);
    if (!game) return { ok: false, affectedRows: 0, alreadyExecuted: false };

    try {
      const tx = this.db.transaction(() => {
        const updated = this.db.prepare(`
          UPDATE votes
          SET target_id = ?
          WHERE game_id = ?
            AND voter_id = ?
            AND vote_type = ?
            AND round = ?
            AND target_id IS NOT ?
        `).run(targetId, game.id, voterId, voteType, round, targetId);

        if (updated.changes > 0) {
          return { ok: true, affectedRows: 1, alreadyExecuted: false };
        }

        const inserted = this.db.prepare(`
          INSERT OR IGNORE INTO votes (game_id, voter_id, target_id, vote_type, round)
          VALUES (?, ?, ?, ?, ?)
        `).run(game.id, voterId, targetId, voteType, round);

        if (inserted.changes === 0) {
          return { ok: true, affectedRows: 0, alreadyExecuted: true };
        }

        return { ok: true, affectedRows: 1, alreadyExecuted: false };
      });

      const result = tx();
      return {
        ok: result.ok,
        affectedRows: result.affectedRows,
        alreadyExecuted: result.alreadyExecuted
      };
    } catch (err) {
      logger.error('Failed to add vote', err);
      return { ok: false, affectedRows: 0, alreadyExecuted: false };
    }
  }

  getVotes(channelId, voteType = 'village', round = 0) {
    const game = this.getGame(channelId);
    if (!game) return new Map();

    const stmt = this.db.prepare(`
      SELECT voter_id, target_id
      FROM votes
      WHERE game_id = ? AND vote_type = ? AND round = ?
    `);
    const rows = stmt.all(game.id, voteType, round);
    
    const voteMap = new Map();
    rows.forEach(row => {
      voteMap.set(row.voter_id, row.target_id);
    });
    return voteMap;
  }

  clearVotes(channelId, voteType = 'village', round = 0) {
    const game = this.getGame(channelId);
    if (!game) return;

    const stmt = this.db.prepare(`
      DELETE FROM votes 
      WHERE game_id = ? AND vote_type = ? AND round = ?
    `);
    stmt.run(game.id, voteType, round);
  }

  // ===== NIGHT ACTIONS =====

  addNightAction(channelId, nightNumber, actionType, actorId, targetId = null) {
    const result = this.addNightActionOnce(channelId, nightNumber, actionType, actorId, targetId);
    return result.ok;
  }

  addNightActionOnce(channelId, nightNumber, actionType, actorId, targetId = null) {
    const game = this.getGame(channelId);
    if (!game) return { ok: false, affectedRows: 0, alreadyExecuted: false };

    try {
      const tx = this.db.transaction(() => {
        const claimed = this.db.prepare(`
          UPDATE games
          SET updated_at = updated_at
          WHERE id = ?
            AND NOT EXISTS (
              SELECT 1
              FROM night_actions
              WHERE game_id = ?
                AND night_number = ?
                AND action_type = ?
                AND actor_id = ?
            )
        `).run(game.id, game.id, nightNumber, actionType, actorId);

        if (claimed.changes === 0) {
          return { ok: true, affectedRows: 0, alreadyExecuted: true };
        }

        const inserted = this.db.prepare(`
          INSERT OR IGNORE INTO night_actions (game_id, night_number, action_type, actor_id, target_id)
          VALUES (?, ?, ?, ?, ?)
        `).run(game.id, nightNumber, actionType, actorId, targetId);

        if (inserted.changes === 0) {
          return { ok: true, affectedRows: 0, alreadyExecuted: true };
        }

        return { ok: true, affectedRows: 1, alreadyExecuted: false };
      });

      const result = tx();
      return {
        ok: result.ok,
        affectedRows: result.affectedRows,
        alreadyExecuted: result.alreadyExecuted
      };
    } catch (err) {
      logger.error('Failed to add night action', err);
      return { ok: false, affectedRows: 0, alreadyExecuted: false };
    }
  }

  getNightActions(channelId, nightNumber) {
    const game = this.getGame(channelId);
    if (!game) return [];

    const stmt = this.db.prepare(`
      SELECT action_type, actor_id, target_id, created_at
      FROM night_actions
      WHERE game_id = ? AND night_number = ?
      ORDER BY created_at
    `);
    return stmt.all(game.id, nightNumber);
  }

  // ===== WITCH POTIONS =====

  initWitchPotions(channelId) {
    const game = this.getGame(channelId);
    if (!game) return;

    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO witch_potions (game_id, life_potion_used, death_potion_used)
      VALUES (?, 0, 0)
    `);
    stmt.run(game.id);
  }

  getWitchPotions(channelId) {
    const game = this.getGame(channelId);
    if (!game) return { life: true, death: true };

    const stmt = this.db.prepare(`
      SELECT life_potion_used, death_potion_used
      FROM witch_potions WHERE game_id = ?
    `);
    const row = stmt.get(game.id);
    
    if (!row) return { life: true, death: true };
    
    return {
      life: !row.life_potion_used,
      death: !row.death_potion_used
    };
  }

  useWitchPotionIfAvailable(channelId, potionType) {
    const game = this.getGame(channelId);
    if (!game) return { ok: false, affectedRows: 0, alreadyExecuted: false };

    const field = potionType === 'life' ? 'life_potion_used' : 'death_potion_used';

    try {
      const tx = this.db.transaction(() => {
        this.db.prepare(`
          INSERT OR IGNORE INTO witch_potions (game_id, life_potion_used, death_potion_used)
          VALUES (?, 0, 0)
        `).run(game.id);

        const updated = this.db.prepare(`
          UPDATE witch_potions
          SET ${field} = 1
          WHERE game_id = ? AND ${field} = 0
        `).run(game.id);

        if (updated.changes === 0) {
          return { ok: true, affectedRows: 0, alreadyExecuted: true };
        }

        return { ok: true, affectedRows: 1, alreadyExecuted: false };
      });

      return tx();
    } catch (err) {
      logger.error('Failed to use witch potion', err);
      return { ok: false, affectedRows: 0, alreadyExecuted: false };
    }
  }

  useWitchPotion(channelId, potionType) {
    const result = this.useWitchPotionIfAvailable(channelId, potionType);
    return result.ok && result.affectedRows > 0;
  }

  markHunterShotIfFirst(channelId, hunterId) {
    const game = this.getGame(channelId);
    if (!game) return { ok: false, affectedRows: 0, alreadyExecuted: false };

    try {
      const stmt = this.db.prepare(`
        UPDATE players
        SET has_shot = 1
        WHERE game_id = ? AND user_id = ? AND has_shot = 0
      `);
      const result = stmt.run(game.id, hunterId);
      return {
        ok: true,
        affectedRows: result.changes,
        alreadyExecuted: result.changes === 0
      };
    } catch (err) {
      logger.error('Failed to mark hunter shot', err);
      return { ok: false, affectedRows: 0, alreadyExecuted: false };
    }
  }

  // ===== ACTION LOG =====

  addLog(channelId, text) {
    const game = this.getGame(channelId);
    if (!game) return;

    const stmt = this.db.prepare(`
      INSERT INTO action_log (game_id, action_text)
      VALUES (?, ?)
    `);
    stmt.run(game.id, text);
  }

  getLogs(channelId, limit = 100) {
    const game = this.getGame(channelId);
    if (!game) return [];

    const stmt = this.db.prepare(`
      SELECT action_text as text, timestamp as ts
      FROM action_log
      WHERE game_id = ?
      ORDER BY timestamp DESC
      LIMIT ?
    `);
    return stmt.all(game.id, limit).reverse();
  }

  // ===== MODERATION AUDIT LOG =====

  addModAuditLog(guildId, moderatorId, moderatorName, action, details = null) {
    try {
      this.db.prepare(`
        INSERT INTO mod_audit_log (guild_id, moderator_id, moderator_name, action, details)
        VALUES (?, ?, ?, ?, ?)
      `).run(guildId, moderatorId, moderatorName, action, details ? JSON.stringify(details) : null);
      return true;
    } catch (err) {
      logger.error('Failed to add mod audit log', { error: err.message });
      return false;
    }
  }

  getModAuditLog(guildId, limit = 30) {
    try {
      const rows = this.db.prepare(
        'SELECT * FROM mod_audit_log WHERE guild_id = ? ORDER BY created_at DESC LIMIT ?'
      ).all(guildId, limit);
      return rows.map(r => {
        try { r.details = r.details ? JSON.parse(r.details) : {}; } catch { r.details = {}; }
        return r;
      });
    } catch (err) {
      logger.error('Failed to get mod audit log', { error: err.message });
      return [];
    }
  }

  // ===== LOVERS =====

  setLovers(channelId, lover1Id, lover2Id) {
    const stmt = this.db.prepare(`
      UPDATE games SET lover1_id = ?, lover2_id = ?
      WHERE channel_id = ?
    `);
    stmt.run(lover1Id, lover2Id, channelId);
    
    // Mettre à jour les joueurs
    this.updatePlayer(channelId, lover1Id, { inLove: true });
    this.updatePlayer(channelId, lover2Id, { inLove: true });
  }

  getLovers(channelId) {
    const game = this.getGame(channelId);
    if (!game || !game.lover1_id) return [];
    
    return [game.lover1_id, game.lover2_id];
  }

  // ===== UTILITY =====

  // ===== PLAYER STATS =====

  updatePlayerStats(playerId, username, updates, guildId = null) {
    try {
      // Skip fake/debug players
      if (playerId && playerId.startsWith('fake_')) return true;

      // Upsert: insérer ou mettre à jour
      const existing = this.db.prepare('SELECT * FROM player_stats WHERE player_id = ?').get(playerId);
      if (!existing) {
        this.db.prepare(`
          INSERT INTO player_stats (player_id, username, games_played, games_won, times_killed, times_survived, favorite_role, guild_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          playerId, username,
          updates.games_played || 0, updates.games_won || 0,
          updates.times_killed || 0, updates.times_survived || 0,
          updates.favorite_role || null,
          guildId
        );
      } else {
        // Also update guild_id if not set and now available
        this.db.prepare(`
          UPDATE player_stats SET
            username = ?,
            games_played = games_played + ?,
            games_won = games_won + ?,
            times_killed = times_killed + ?,
            times_survived = times_survived + ?,
            guild_id = COALESCE(guild_id, ?),
            updated_at = strftime('%s', 'now')
          WHERE player_id = ?
        `).run(
          username,
          updates.games_played || 0, updates.games_won || 0,
          updates.times_killed || 0, updates.times_survived || 0,
          guildId,
          playerId
        );
      }
      // Record player↔guild association permanently
      if (guildId) {
        try {
          this.db.prepare('INSERT OR IGNORE INTO player_guilds (player_id, guild_id) VALUES (?, ?)').run(playerId, guildId);
        } catch {}
      }

      return true;
    } catch (err) {
      logger.error('Failed to update player stats', { error: err.message });
      return false;
    }
  }

  getPlayerStats(playerId) {
    try {
      return this.db.prepare('SELECT * FROM player_stats WHERE player_id = ?').get(playerId) || null;
    } catch (err) {
      return null;
    }
  }

  // ===== GAME HISTORY =====

  saveGameHistory(game, winner) {
    try {
      const durationSec = game.startedAt && game.endedAt
        ? Math.floor((game.endedAt - game.startedAt) / 1000)
        : 0;

      const playersJson = JSON.stringify(
        (game.players || []).map(p => ({
          id: p.id,
          username: p.username,
          role: p.role,
          alive: p.alive
        }))
      );

      this.db.prepare(`
        INSERT INTO game_history (guild_id, channel_id, winner, player_count, duration_seconds, day_count, players_json, started_at, ended_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        game.guildId || null,
        game.mainChannelId,
        winner || null,
        (game.players || []).length,
        durationSec,
        game.dayCount || 0,
        playersJson,
        game.startedAt || null,
        game.endedAt || null
      );

      logger.info('Game history saved', { channel: game.mainChannelId, winner });
      return true;
    } catch (err) {
      logger.error('Failed to save game history', { error: err.message });
      return false;
    }
  }

  getGuildHistory(guildId, limit = 10, offset = 0) {
    try {
      if (guildId) {
        return this.db.prepare(
          'SELECT * FROM game_history WHERE guild_id = ? ORDER BY ended_at DESC LIMIT ? OFFSET ?'
        ).all(guildId, limit, offset);
      }
      return this.db.prepare(
        'SELECT * FROM game_history ORDER BY ended_at DESC LIMIT ? OFFSET ?'
      ).all(limit, offset);
    } catch (err) {
      return [];
    }
  }

  deleteGameHistory(id) {
    try {
      const result = this.db.prepare('DELETE FROM game_history WHERE id = ?').run(id);
      return result.changes > 0;
    } catch (err) {
      logger.error('Failed to delete game history entry', { error: err.message, id });
      return false;
    }
  }

  getGlobalStats() {
    try {
      return this.db.prepare(`
        SELECT 
          COUNT(*) as total_games,
          SUM(CASE WHEN winner = 'village' THEN 1 ELSE 0 END) as village_wins,
          SUM(CASE WHEN winner = 'wolves' THEN 1 ELSE 0 END) as wolves_wins,
          SUM(CASE WHEN winner = 'lovers' THEN 1 ELSE 0 END) as lovers_wins,
          AVG(duration_seconds) as avg_duration,
          AVG(player_count) as avg_players
        FROM game_history
      `).get();
    } catch (err) {
      return null;
    }
  }

  /**
   * Archive old completed games — remove games from the active `games` table
   * that have been ended for more than `retentionDays` days.
   * They are already saved in `game_history` by saveGameHistory().
   * @param {number} retentionDays - Number of days to keep ended games (default: 7)
   * @returns {number} Number of archived (deleted) games
   */
  archiveOldGames(retentionDays = 7) {
    try {
      const cutoff = Math.floor(Date.now() / 1000) - (retentionDays * 24 * 60 * 60);
      const result = this.db.prepare(
        "DELETE FROM games WHERE ended_at IS NOT NULL AND ended_at < ? AND phase = 'Terminé'"
      ).run(cutoff);
      if (result.changes > 0) {
        logger.info(`Archived ${result.changes} old games (older than ${retentionDays} days)`);
      }
      return result.changes;
    } catch (err) {
      logger.error('Failed to archive old games', { error: err.message });
      return 0;
    }
  }

  // ===== PREMIUM USERS =====

  /**
   * Get premium status for a user
   * Returns the premium row or null
   */
  getPremiumUser(userId) {
    try {
      const row = this.db.prepare('SELECT * FROM premium_users WHERE user_id = ?').get(userId);
      if (!row) return null;
      // Check expiration (null = lifetime)
      if (row.expires_at && row.expires_at < Math.floor(Date.now() / 1000)) {
        return null; // expired
      }
      return row;
    } catch (err) {
      return null;
    }
  }

  /**
   * Check if user has premium (active, not expired)
   */
  isPremiumUser(userId) {
    return this.getPremiumUser(userId) !== null;
  }

  /**
   * Grant premium to a user
   * @param {string} userId - Discord user ID
   * @param {string} tier - 'lifetime' | 'premium' | 'monthly'
   * @param {object} options - { grantedBy, reason, expiresAt }
   */
  grantPremium(userId, tier = 'premium', options = {}) {
    try {
      this.db.prepare(`
        INSERT INTO premium_users (user_id, tier, granted_by, reason, expires_at, updated_at)
        VALUES (?, ?, ?, ?, ?, strftime('%s', 'now'))
        ON CONFLICT(user_id) DO UPDATE SET
          tier = excluded.tier,
          granted_by = excluded.granted_by,
          reason = excluded.reason,
          expires_at = excluded.expires_at,
          updated_at = strftime('%s', 'now')
      `).run(userId, tier, options.grantedBy || null, options.reason || null, options.expiresAt || null);
      logger.info('Premium granted', { userId, tier });
      return true;
    } catch (err) {
      logger.error('Failed to grant premium', { userId, error: err.message });
      return false;
    }
  }

  /**
   * Revoke premium from a user
   */
  revokePremium(userId) {
    try {
      this.db.prepare('DELETE FROM premium_users WHERE user_id = ?').run(userId);
      logger.info('Premium revoked', { userId });
      return true;
    } catch (err) {
      logger.error('Failed to revoke premium', { userId, error: err.message });
      return false;
    }
  }

  /**
   * Get all premium users
   */
  getAllPremiumUsers() {
    try {
      return this.db.prepare('SELECT * FROM premium_users ORDER BY created_at DESC').all();
    } catch (err) {
      return [];
    }
  }

  /**
   * Ensure the bot owner has lifetime premium
   */
  ensureOwnerPremium() {
    const ownerId = process.env.OWNER_ID;
    if (!ownerId) return;
    const existing = this.getPremiumUser(ownerId);
    if (!existing || existing.tier !== 'lifetime') {
      this.grantPremium(ownerId, 'lifetime', {
        reason: 'Bot owner — automatic lifetime premium',
        grantedBy: 'system'
      });
      logger.info('Owner premium ensured', { ownerId });
    }
  }

  // ===== METRICS SNAPSHOTS =====

  /**
   * Incrémente un compteur persistant (upsert)
   */
  incrementCounter(key, amount = 1) {
    try {
      this.db.prepare(`
        INSERT INTO config (key, value, updated_at)
        VALUES (?, ?, strftime('%s', 'now'))
        ON CONFLICT(key) DO UPDATE SET
          value = CAST(CAST(value AS INTEGER) + ? AS TEXT),
          updated_at = strftime('%s', 'now')
      `).run(key, String(amount), amount);
      return true;
    } catch (err) {
      logger.error('Failed to increment counter', { key, error: err.message });
      return false;
    }
  }

  /**
   * Récupère un compteur persistant
   */
  getCounter(key) {
    const val = this.getConfig(key);
    return val ? parseInt(val, 10) || 0 : 0;
  }

  /**
   * Nombre de parties créées dans les dernières N heures (depuis game_history + games actives)
   */
  getGamesCreatedSince(hours = 24) {
    try {
      const cutoff = Math.floor(Date.now() / 1000) - (hours * 3600);
      // Parties terminées
      const finished = this.db.prepare(
        'SELECT COUNT(*) as cnt FROM game_history WHERE started_at >= ?'
      ).get(cutoff);
      // Parties encore actives
      const active = this.db.prepare(
        'SELECT COUNT(*) as cnt FROM games WHERE created_at >= ? AND ended_at IS NULL'
      ).get(cutoff);
      return (finished?.cnt || 0) + (active?.cnt || 0);
    } catch (err) {
      return 0;
    }
  }

  /**
   * Nombre de parties terminées dans les dernières N heures
   */
  getGamesCompletedSince(hours = 24) {
    try {
      const cutoff = Math.floor(Date.now() / 1000) - (hours * 3600);
      const row = this.db.prepare(
        'SELECT COUNT(*) as cnt FROM game_history WHERE ended_at >= ?'
      ).get(cutoff);
      return row?.cnt || 0;
    } catch (err) {
      return 0;
    }
  }

  /**
   * Différence d'erreurs entre maintenant et il y a N heures (depuis metrics snapshots)
   */
  getErrorsSince(hours = 24) {
    try {
      const cutoff = Math.floor(Date.now() / 1000) - (hours * 3600);
      // Snapshot le plus ancien dans la fenêtre
      const oldest = this.db.prepare(
        'SELECT errors_total FROM metrics WHERE collected_at >= ? ORDER BY collected_at ASC LIMIT 1'
      ).get(cutoff);
      // Snapshot le plus récent
      const newest = this.db.prepare(
        'SELECT errors_total FROM metrics ORDER BY collected_at DESC LIMIT 1'
      ).get();
      if (!oldest || !newest) return 0;
      return Math.max(0, (newest.errors_total || 0) - (oldest.errors_total || 0));
    } catch (err) {
      return 0;
    }
  }

  insertMetricsSnapshot(data) {
    try {
      const stmt = this.db.prepare(`
        INSERT INTO metrics (
          memory_used, memory_total, memory_percentage, cpu_usage, uptime,
          guilds, users, channels, latency, ws_status,
          active_games, total_players, games_created_24h, games_completed_24h,
          commands_total, commands_errors, commands_rate_limited, commands_avg_response_time,
          errors_total, errors_critical, errors_warnings, errors_last_24h,
          health_status, health_issues
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(
        data.memory_used, data.memory_total, data.memory_percentage,
        data.cpu_usage, data.uptime,
        data.guilds, data.users, data.channels,
        data.latency, String(data.ws_status || 0),
        data.active_games, data.total_players,
        data.games_created_24h, data.games_completed_24h,
        data.commands_total, data.commands_errors,
        data.commands_rate_limited, data.commands_avg_response,
        data.errors_total, data.errors_critical,
        data.errors_warnings, data.errors_last_24h,
        data.health_status || 'UNKNOWN', data.health_issues || '[]'
      );
      return true;
    } catch (err) {
      logger.error('Failed to insert metrics snapshot', { error: err.message });
      return false;
    }
  }

  // Nettoyer les vieilles métriques (garder 7 jours)
  cleanupOldMetrics(daysToKeep = 7) {
    try {
      const cutoff = Math.floor(Date.now() / 1000) - (daysToKeep * 86400);
      this.db.prepare('DELETE FROM metrics WHERE collected_at < ?').run(cutoff);
      return true;
    } catch (err) {
      return false;
    }
  }

  close() {
    this.db.close();
    logger.info('Database connection closed');
  }

  backup(backupPath) {
    return this.db.backup(backupPath);
  }

  // Transaction wrapper
  transaction(fn) {
    return this.db.transaction(fn);
  }
}

module.exports = GameDatabase;
