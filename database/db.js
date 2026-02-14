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
          channel_id, lobby_host_id, min_players, max_players,
          phase, day_count, disable_voice_mute
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      
      const result = stmt.run(
        channelId,
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
      phase: 'phase',
      subPhase: 'sub_phase',
      dayCount: 'day_count',
      captainId: 'captain_id',
      startedAt: 'started_at',
      endedAt: 'ended_at',
      nightVictim: 'night_victim_id',
      witchKillTarget: 'witch_kill_target_id',
      witchSave: 'witch_save'
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
      SELECT user_id as id, username, role, alive, in_love as inLove
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
    const game = this.getGame(channelId);
    if (!game) return false;

    try {
      const stmt = this.db.prepare(`
        INSERT INTO votes (game_id, voter_id, target_id, vote_type, round)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(game_id, voter_id, vote_type, round) 
        DO UPDATE SET target_id = excluded.target_id
      `);
      stmt.run(game.id, voterId, targetId, voteType, round);
      return true;
    } catch (err) {
      logger.error('Failed to add vote', err);
      return false;
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
    const game = this.getGame(channelId);
    if (!game) return false;

    try {
      const stmt = this.db.prepare(`
        INSERT INTO night_actions (game_id, night_number, action_type, actor_id, target_id)
        VALUES (?, ?, ?, ?, ?)
      `);
      stmt.run(game.id, nightNumber, actionType, actorId, targetId);
      return true;
    } catch (err) {
      logger.error('Failed to add night action', err);
      return false;
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

  useWitchPotion(channelId, potionType) {
    const game = this.getGame(channelId);
    if (!game) return false;

    const field = potionType === 'life' ? 'life_potion_used' : 'death_potion_used';
    const stmt = this.db.prepare(`
      UPDATE witch_potions SET ${field} = 1
      WHERE game_id = ?
    `);
    const result = stmt.run(game.id);
    return result.changes > 0;
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

  updatePlayerStats(playerId, username, updates) {
    try {
      // Upsert: insérer ou mettre à jour
      const existing = this.db.prepare('SELECT * FROM player_stats WHERE player_id = ?').get(playerId);
      if (!existing) {
        this.db.prepare(`
          INSERT INTO player_stats (player_id, username, games_played, games_won, times_killed, times_survived, favorite_role)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          playerId, username,
          updates.games_played || 0, updates.games_won || 0,
          updates.times_killed || 0, updates.times_survived || 0,
          updates.favorite_role || null
        );
      } else {
        this.db.prepare(`
          UPDATE player_stats SET
            username = ?,
            games_played = games_played + ?,
            games_won = games_won + ?,
            times_killed = times_killed + ?,
            times_survived = times_survived + ?,
            updated_at = strftime('%s', 'now')
          WHERE player_id = ?
        `).run(
          username,
          updates.games_played || 0, updates.games_won || 0,
          updates.times_killed || 0, updates.times_survived || 0,
          playerId
        );
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

  // ===== METRICS SNAPSHOTS =====

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
