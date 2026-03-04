/**
 * Achievement System — Werewolf Bot v2.9.0
 * 
 * Tracks player accomplishments across games and awards badges.
 * Stored in SQLite `player_achievements` table.
 */

const { t, translateRole } = require('../utils/i18n');
const { game: logger } = require('../utils/logger');
const ROLES = require('./roles');
const {
  shouldSkipElo,
  clampElo,
  getPlacementMultiplier,
  getEloTier: _getEloTier,
  ELO_FLOOR,
} = require('./eloGuards');

// ==================== ACHIEVEMENT DEFINITIONS ====================

const ACHIEVEMENTS = {
  // Victoire
  first_win: {
    id: 'first_win',
    emoji: '🏆',
    threshold: 1,
    stat: 'games_won',
    category: 'victory'
  },
  veteran: {
    id: 'veteran',
    emoji: '⭐',
    threshold: 10,
    stat: 'games_played',
    category: 'general'
  },
  legend: {
    id: 'legend',
    emoji: '👑',
    threshold: 50,
    stat: 'games_played',
    category: 'general'
  },
  winning_streak_3: {
    id: 'winning_streak_3',
    emoji: '🔥',
    threshold: 3,
    stat: 'win_streak',
    category: 'victory'
  },
  winning_streak_5: {
    id: 'winning_streak_5',
    emoji: '💎',
    threshold: 5,
    stat: 'win_streak',
    category: 'victory'
  },

  // Loups
  first_blood: {
    id: 'first_blood',
    emoji: '🩸',
    threshold: 1,
    stat: 'wolf_kills',
    category: 'wolf'
  },
  alpha_wolf: {
    id: 'alpha_wolf',
    emoji: '🐺',
    threshold: 10,
    stat: 'wolf_wins',
    category: 'wolf'
  },
  serial_killer: {
    id: 'serial_killer',
    emoji: '🔪',
    threshold: 25,
    stat: 'wolf_kills',
    category: 'wolf'
  },

  // Village
  village_hero: {
    id: 'village_hero',
    emoji: '🛡️',
    threshold: 5,
    stat: 'village_wins',
    category: 'village'
  },
  sherlock: {
    id: 'sherlock',
    emoji: '🔮',
    threshold: 5,
    stat: 'seer_correct',
    category: 'village'
  },
  guardian_angel: {
    id: 'guardian_angel',
    emoji: '😇',
    threshold: 3,
    stat: 'salvateur_saves',
    category: 'village'
  },
  witch_master: {
    id: 'witch_master',
    emoji: '🧪',
    threshold: 5,
    stat: 'witch_saves',
    category: 'village'
  },
  sharpshooter: {
    id: 'sharpshooter',
    emoji: '🎯',
    threshold: 3,
    stat: 'hunter_wolf_kills',
    category: 'village'
  },

  // Amoureux
  romeo_juliet: {
    id: 'romeo_juliet',
    emoji: '💘',
    threshold: 1,
    stat: 'lovers_wins',
    category: 'special'
  },

  // Survie
  survivor: {
    id: 'survivor',
    emoji: '🍀',
    threshold: 5,
    stat: 'times_survived',
    category: 'general'
  },
  immortal: {
    id: 'immortal',
    emoji: '♾️',
    threshold: 10,
    stat: 'survival_streak',
    category: 'general'
  },
  
  // Social
  popular: {
    id: 'popular',
    emoji: '🌟',
    threshold: 3,
    stat: 'times_captain',
    category: 'social'
  },
  
  // Idiot
  clown_prince: {
    id: 'clown_prince',
    emoji: '🤡',
    threshold: 1,
    stat: 'idiot_survives',
    category: 'special'
  },
  
  // Ancien
  elder_wisdom: {
    id: 'elder_wisdom',
    emoji: '📜',
    threshold: 1,
    stat: 'ancien_extra_life_used',
    category: 'special'
  },
};

class AchievementEngine {
  constructor(db) {
    this.db = db; // better-sqlite3 database object
    this._ensureTable();
  }

  _ensureTable() {
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS player_achievements (
          player_id TEXT NOT NULL,
          achievement_id TEXT NOT NULL,
          unlocked_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
          PRIMARY KEY (player_id, achievement_id)
        )
      `);
      this.db.exec(`CREATE INDEX IF NOT EXISTS idx_achievements_player ON player_achievements(player_id)`);

      // Extended stats table for achievement tracking
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS player_extended_stats (
          player_id TEXT PRIMARY KEY,
          wolf_kills INTEGER DEFAULT 0,
          wolf_wins INTEGER DEFAULT 0,
          village_wins INTEGER DEFAULT 0,
          lovers_wins INTEGER DEFAULT 0,
          seer_correct INTEGER DEFAULT 0,
          salvateur_saves INTEGER DEFAULT 0,
          witch_saves INTEGER DEFAULT 0,
          hunter_wolf_kills INTEGER DEFAULT 0,
          times_captain INTEGER DEFAULT 0,
          idiot_survives INTEGER DEFAULT 0,
          ancien_extra_life_used INTEGER DEFAULT 0,
          win_streak INTEGER DEFAULT 0,
          best_win_streak INTEGER DEFAULT 0,
          survival_streak INTEGER DEFAULT 0,
          best_survival_streak INTEGER DEFAULT 0,
          elo_rating INTEGER DEFAULT 1000,
          elo_peak INTEGER DEFAULT 1000,
          ranked_games_played INTEGER DEFAULT 0,
          updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
        )
      `);
      this.db.exec(`CREATE INDEX IF NOT EXISTS idx_extended_elo ON player_extended_stats(elo_rating)`);
    } catch (err) {
      logger.error('ACHIEVEMENTS_TABLE_CREATE_FAILED', { error: err.message });
    }
  }

  /**
   * Get or create extended stats for a player
   */
  getExtendedStats(playerId) {
    let stats = this.db.prepare('SELECT * FROM player_extended_stats WHERE player_id = ?').get(playerId);
    if (!stats) {
      this.db.prepare('INSERT OR IGNORE INTO player_extended_stats (player_id) VALUES (?)').run(playerId);
      stats = this.db.prepare('SELECT * FROM player_extended_stats WHERE player_id = ?').get(playerId);
    }
    return stats;
  }

  /**
   * Increment a specific extended stat
   */
  incrementStat(playerId, stat, amount = 1) {
    const valid = [
      'wolf_kills', 'wolf_wins', 'village_wins', 'lovers_wins',
      'seer_correct', 'salvateur_saves', 'witch_saves', 'hunter_wolf_kills',
      'times_captain', 'idiot_survives', 'ancien_extra_life_used',
      'win_streak', 'survival_streak', 'ranked_games_played'
    ];
    if (!valid.includes(stat)) return;
    
    // Ensure row exists
    this.db.prepare('INSERT OR IGNORE INTO player_extended_stats (player_id) VALUES (?)').run(playerId);
    
    this.db.prepare(`
      UPDATE player_extended_stats 
      SET ${stat} = ${stat} + ?, updated_at = strftime('%s', 'now')
      WHERE player_id = ?
    `).run(amount, playerId);
  }

  /**
   * Set a stat to a specific value (for streaks that need to be reset)
   */
  setStat(playerId, stat, value) {
    this.db.prepare('INSERT OR IGNORE INTO player_extended_stats (player_id) VALUES (?)').run(playerId);
    this.db.prepare(`
      UPDATE player_extended_stats 
      SET ${stat} = ?, updated_at = strftime('%s', 'now')
      WHERE player_id = ?
    `).run(value, playerId);
  }

  /**
   * Update max streak (best_win_streak, best_survival_streak)
   */
  updateBestStreak(playerId, streakField, bestField) {
    this.db.prepare(`
      UPDATE player_extended_stats 
      SET ${bestField} = MAX(${bestField}, ${streakField})
      WHERE player_id = ?
    `).run(playerId);
  }

  /**
   * Get all achievements for a player
   */
  getPlayerAchievements(playerId) {
    return this.db.prepare(
      'SELECT achievement_id, unlocked_at FROM player_achievements WHERE player_id = ? ORDER BY unlocked_at DESC'
    ).all(playerId);
  }

  /**
   * Check and award new achievements based on current stats
   * Returns array of newly unlocked achievement IDs
   */
  checkAndAward(playerId) {
    const stats = this.getExtendedStats(playerId);
    if (!stats) return [];

    // Also get basic stats
    const basicStats = this.db.prepare('SELECT * FROM player_stats WHERE player_id = ?').get(playerId);
    
    const existing = new Set(
      this.getPlayerAchievements(playerId).map(a => a.achievement_id)
    );

    const newlyUnlocked = [];

    for (const [key, ach] of Object.entries(ACHIEVEMENTS)) {
      if (existing.has(ach.id)) continue;

      let currentValue = 0;
      
      // Check basic stats first
      if (basicStats) {
        if (ach.stat === 'games_won') currentValue = basicStats.games_won || 0;
        else if (ach.stat === 'games_played') currentValue = basicStats.games_played || 0;
        else if (ach.stat === 'times_survived') currentValue = basicStats.times_survived || 0;
      }
      
      // Check extended stats
      if (stats[ach.stat] !== undefined) {
        currentValue = stats[ach.stat];
      }

      if (currentValue >= ach.threshold) {
        try {
          this.db.prepare(
            'INSERT OR IGNORE INTO player_achievements (player_id, achievement_id) VALUES (?, ?)'
          ).run(playerId, ach.id);
          newlyUnlocked.push(ach.id);
        } catch (err) {
          logger.error('ACHIEVEMENT_AWARD_FAILED', { playerId, achievement: ach.id, error: err.message });
        }
      }
    }

    return newlyUnlocked;
  }

  /**
   * Process end-of-game stats for all players
   * Returns Map<playerId, newAchievements[]>
   */
  processGameEnd(game, winner) {
    const newAchievements = new Map();

    for (const player of game.players) {
      try {
        const isWolf = player.role === ROLES.WEREWOLF;
        const isWinner = winner === 'draw' ? false
          : winner === 'lovers' ? (game.lovers?.[0]?.includes(player.id))
          : winner === 'wolves' ? isWolf
          : !isWolf;

        // Update win/loss streak
        if (isWinner) {
          this.incrementStat(player.id, 'win_streak');
          this.updateBestStreak(player.id, 'win_streak', 'best_win_streak');
        } else {
          this.setStat(player.id, 'win_streak', 0);
        }

        // Survival streak
        if (player.alive) {
          this.incrementStat(player.id, 'survival_streak');
          this.updateBestStreak(player.id, 'survival_streak', 'best_survival_streak');
        } else {
          this.setStat(player.id, 'survival_streak', 0);
        }

        // Team-specific wins
        if (isWinner && winner === 'wolves') this.incrementStat(player.id, 'wolf_wins');
        if (isWinner && winner === 'village') this.incrementStat(player.id, 'village_wins');
        if (isWinner && winner === 'lovers') this.incrementStat(player.id, 'lovers_wins');

        // Captain tracking
        if (game.captainId === player.id) {
          this.incrementStat(player.id, 'times_captain');
        }

        // Check & award
        const unlocked = this.checkAndAward(player.id);
        if (unlocked.length > 0) {
          newAchievements.set(player.id, unlocked);
        }
      } catch (err) {
        logger.error('ACHIEVEMENT_PROCESSING_ERROR', { playerId: player.id, error: err.message });
      }
    }

    return newAchievements;
  }

  /**
   * Track in-game events for achievements
   */
  trackEvent(playerId, event, context = {}) {
    try {
      switch (event) {
        case 'wolf_kill':
          this.incrementStat(playerId, 'wolf_kills');
          break;
        case 'seer_found_wolf':
          this.incrementStat(playerId, 'seer_correct');
          break;
        case 'salvateur_save':
          this.incrementStat(playerId, 'salvateur_saves');
          break;
        case 'witch_save':
          this.incrementStat(playerId, 'witch_saves');
          break;
        case 'hunter_killed_wolf':
          this.incrementStat(playerId, 'hunter_wolf_kills');
          break;
        case 'idiot_survives':
          this.incrementStat(playerId, 'idiot_survives');
          break;
        case 'ancien_extra_life':
          this.incrementStat(playerId, 'ancien_extra_life_used');
          break;
      }
    } catch (err) {
      logger.error('ACHIEVEMENT_TRACK_EVENT_ERROR', { playerId, event, error: err.message });
    }
  }

  // ==================== ELO SYSTEM ====================

  /**
   * Calculate ELO changes for all players after a game.
   * K-factor scales with player count (more players = more ELO at stake).
   *
   * Guards (via eloGuards):
   *   - Inactivity draws → skip (return null)
   *   - Cancelled / aborted before Night 1 → skip
   *   - Winner is null → skip
   *
   * Placement phase (first 5 ranked games): K-factor × 1.25
   * Hard ELO floor: 800
   */
  calculateElo(game, winner) {
    // ── Guard: skip ELO entirely for inactivity draws / cancelled games ──
    if (shouldSkipElo(game, winner)) {
      logger.info('ELO_SKIPPED', {
        reason: 'shouldSkipElo',
        channelId: game?.mainChannelId,
        winner,
      });
      return null;
    }

    const players = game.players;
    const playerCount = players.length;
    const baseK = 32;
    const K = baseK * (1 + (playerCount - 5) * 0.1); // Scale K with player count

    const eloChanges = new Map();

    // Get current ELO + ranked games count for all players
    const elos = new Map();
    const rankedCounts = new Map();
    for (const p of players) {
      const stats = this.getExtendedStats(p.id);
      elos.set(p.id, stats.elo_rating);
      rankedCounts.set(p.id, stats.ranked_games_played ?? 0);
    }

    // Average ELO of each team
    const wolves = players.filter(p => p.role === ROLES.WEREWOLF);
    const villagers = players.filter(p => p.role !== ROLES.WEREWOLF);
    
    const avgWolfElo = wolves.length > 0 
      ? wolves.reduce((sum, p) => sum + elos.get(p.id), 0) / wolves.length 
      : 1000;
    const avgVillageElo = villagers.length > 0 
      ? villagers.reduce((sum, p) => sum + elos.get(p.id), 0) / villagers.length 
      : 1000;

    for (const p of players) {
      const isWolf = p.role === ROLES.WEREWOLF;
      const myElo = elos.get(p.id);
      const opponentElo = isWolf ? avgVillageElo : avgWolfElo;
      
      // Expected score (Elo formula)
      const expected = 1 / (1 + Math.pow(10, (opponentElo - myElo) / 400));
      
      // Actual score
      let actual = 0;
      if (winner === 'draw') {
        actual = 0.5;
      } else if (winner === 'lovers') {
        actual = game.lovers?.[0]?.includes(p.id) ? 1 : 0.3; // Lovers win big, others get small consolation
      } else if (winner === 'wolves') {
        actual = isWolf ? 1 : 0;
      } else {
        actual = isWolf ? 0 : 1;
      }

      // Role difficulty bonus (harder roles get slightly more ELO)
      let roleMultiplier = 1.0;
      if (p.role === ROLES.SEER || p.role === ROLES.WITCH) roleMultiplier = 1.1;
      if (p.role === ROLES.SALVATEUR) roleMultiplier = 1.05;
      if (p.role === ROLES.PETITE_FILLE) roleMultiplier = 1.15;
      if (p.role === ROLES.ANCIEN) roleMultiplier = 1.1;

      // Placement multiplier (×1.25 during first 5 ranked games)
      const placementMult = getPlacementMultiplier(rankedCounts.get(p.id));

      // Survival bonus: alive at end gets small boost
      const survivalBonus = p.alive ? 2 : 0;

      const change = Math.round(K * roleMultiplier * placementMult * (actual - expected)) + survivalBonus;
      const newElo = clampElo(myElo + change); // Floor at ELO_FLOOR (800)

      eloChanges.set(p.id, { oldElo: myElo, newElo, change: newElo - myElo, rankedGamesPlayed: (rankedCounts.get(p.id) ?? 0) + 1 });
      
      // Update ELO in DB
      this.setStat(p.id, 'elo_rating', newElo);
      
      // Update peak
      this.db.prepare(`
        UPDATE player_extended_stats 
        SET elo_peak = MAX(elo_peak, ?)
        WHERE player_id = ?
      `).run(newElo, p.id);

      // Increment ranked games played counter
      this.incrementStat(p.id, 'ranked_games_played');
    }

    return eloChanges;
  }

  /**
   * Get the top N players by ELO
   */
  getLeaderboard(limit = 10, guildId = null) {
    try {
      // Join with player_stats for username
      if (guildId) {
        // Guild-specific: only players who played in this guild
        return this.db.prepare(`
          SELECT ps.player_id, ps.username, ps.games_played, ps.games_won,
                 COALESCE(pes.elo_rating, 1000) as elo_rating,
                 COALESCE(pes.elo_peak, 1000) as elo_peak,
                 COALESCE(pes.best_win_streak, 0) as best_win_streak,
                 COALESCE(pes.wolf_wins, 0) as wolf_wins,
                 COALESCE(pes.village_wins, 0) as village_wins,
                 COALESCE(pes.ranked_games_played, 0) as ranked_games_played
          FROM player_stats ps
          LEFT JOIN player_extended_stats pes ON ps.player_id = pes.player_id
          WHERE ps.games_played > 0
            AND ps.player_id NOT LIKE 'fake_%'
            AND ps.player_id GLOB '[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]*'
            AND ps.player_id IN (
              SELECT player_id FROM player_guilds WHERE guild_id = ?
            )
          ORDER BY COALESCE(pes.elo_rating, 1000) DESC
          LIMIT ?
        `).all(guildId, limit);
      }
      return this.db.prepare(`
        SELECT ps.player_id, ps.username, ps.games_played, ps.games_won,
               COALESCE(pes.elo_rating, 1000) as elo_rating,
               COALESCE(pes.elo_peak, 1000) as elo_peak,
               COALESCE(pes.best_win_streak, 0) as best_win_streak,
               COALESCE(pes.wolf_wins, 0) as wolf_wins,
               COALESCE(pes.village_wins, 0) as village_wins,
               COALESCE(pes.ranked_games_played, 0) as ranked_games_played
        FROM player_stats ps
        LEFT JOIN player_extended_stats pes ON ps.player_id = pes.player_id
        WHERE ps.games_played > 0
          AND ps.player_id NOT LIKE 'fake_%'
          AND ps.player_id GLOB '[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]*'
        ORDER BY COALESCE(pes.elo_rating, 1000) DESC
        LIMIT ?
      `).all(limit);
    } catch (err) {
      logger.error('LEADERBOARD_GET_FAILED', { error: err.message });
      return [];
    }
  }

  /**
   * Get player's rank
   */
  getPlayerRank(playerId) {
    try {
      const rank = this.db.prepare(`
        SELECT COUNT(*) + 1 as rank FROM player_extended_stats
        WHERE elo_rating > (SELECT COALESCE(elo_rating, 1000) FROM player_extended_stats WHERE player_id = ?)
      `).get(playerId);
      return rank?.rank || null;
    } catch (err) {
      return null;
    }
  }

  /**
   * Get ELO tier name and emoji based on rating.
   *
   * Delegates to eloGuards.getEloTier() for the actual tier resolution.
   * Accepts an optional rankedGamesPlayed param; when omitted the player
   * is assumed to have completed placement (backward-compat).
   *
   * @param {number} elo
   * @param {number} [rankedGamesPlayed=999]
   * @returns {{ id: string, name: string, nameEn: string, emoji: string }}
   */
  static getEloTier(elo, rankedGamesPlayed) {
    return _getEloTier(elo, rankedGamesPlayed);
  }
}

module.exports = { AchievementEngine, ACHIEVEMENTS };
