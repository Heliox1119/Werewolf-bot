/**
 * REST API routes — Stats, Games, Leaderboard, History, Config
 */
const express = require('express');

module.exports = function(webServer) {
  const router = express.Router();
  const gm = webServer.gameManager;
  const db = webServer.db;

  // ==================== GAMES ====================

  /** GET /api/games — All active games */
  router.get('/games', (req, res) => {
    try {
      const games = gm.getAllGames().map(g => gm.getGameSnapshot(g));
      res.json({ success: true, data: games });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  /** GET /api/games/:id — Single game state */
  router.get('/games/:id', (req, res) => {
    try {
      const game = gm.games.get(req.params.id);
      if (!game) return res.status(404).json({ success: false, error: 'Game not found' });
      res.json({ success: true, data: gm.getGameSnapshot(game) });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // ==================== LEADERBOARD ====================

  /** GET /api/leaderboard?limit=10&guild=id — ELO leaderboard */
  router.get('/leaderboard', (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit) || 25, 100);
      const guildId = req.query.guild || null;

      if (gm.achievements) {
        const leaderboard = gm.achievements.getLeaderboard(limit, guildId);
        const { AchievementEngine } = require('../../game/achievements');
        const enriched = leaderboard.map((p, i) => ({
          rank: i + 1,
          ...p,
          winrate: p.games_played > 0 ? Math.round((p.games_won / p.games_played) * 100) : 0,
          tier: AchievementEngine.getEloTier(p.elo_rating || 1000)
        }));
        res.json({ success: true, data: enriched });
      } else {
        // Fallback without achievements
        const rows = db.db.prepare(`
          SELECT player_id, username, games_played, games_won
          FROM player_stats WHERE games_played > 0
          ORDER BY games_won DESC LIMIT ?
        `).all(limit);
        res.json({ success: true, data: rows.map((p, i) => ({ rank: i + 1, ...p })) });
      }
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // ==================== PLAYER STATS ====================

  /** GET /api/players/:id — Player stats + achievements */
  router.get('/players/:id', (req, res) => {
    try {
      const stats = db.getPlayerStats(req.params.id);
      if (!stats) return res.status(404).json({ success: false, error: 'Player not found' });

      const result = { ...stats, winrate: stats.games_played > 0 ? Math.round((stats.games_won / stats.games_played) * 100) : 0 };

      if (gm.achievements) {
        const { AchievementEngine, ACHIEVEMENTS } = require('../../game/achievements');
        const ext = gm.achievements.getExtendedStats(req.params.id);
        const rank = gm.achievements.getPlayerRank(req.params.id);
        const achs = gm.achievements.getPlayerAchievements(req.params.id);
        result.elo = ext.elo_rating;
        result.eloPeak = ext.elo_peak;
        result.tier = AchievementEngine.getEloTier(ext.elo_rating);
        result.rank = rank;
        result.extended = ext;
        result.achievements = achs.map(a => ({
          id: a.achievement_id,
          unlockedAt: a.unlocked_at,
          ...(ACHIEVEMENTS[a.achievement_id] || {})
        }));
      }

      res.json({ success: true, data: result });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // ==================== HISTORY ====================

  /** GET /api/history?guild=id&limit=10 — Game history */
  router.get('/history', (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit) || 20, 100);
      const guildId = req.query.guild || null;
      const history = guildId ? db.getGuildHistory(guildId, limit) : db.getGuildHistory(null, limit);
      res.json({ success: true, data: history });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // ==================== GLOBAL STATS ====================

  /** GET /api/stats — Global stats */
  router.get('/stats', (req, res) => {
    try {
      const global = db.getGlobalStats();
      const activeGames = gm.getAllGames().length;
      const activePlayers = gm.getAllGames().reduce((sum, g) => sum + g.players.filter(p => p.alive).length, 0);

      res.json({
        success: true,
        data: {
          ...global,
          activeGames,
          activePlayers,
          uptime: process.uptime(),
          memoryMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024)
        }
      });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // ==================== GUILDS ====================

  /** GET /api/guilds — Guilds the bot is in */
  router.get('/guilds', (req, res) => {
    try {
      const client = webServer.client;
      if (!client) return res.json({ success: true, data: [] });

      const guilds = client.guilds.cache.map(g => ({
        id: g.id,
        name: g.name,
        icon: g.iconURL({ size: 64 }),
        memberCount: g.memberCount,
        activeGames: gm.getAllGames().filter(game => game.guildId === g.id).length
      }));

      res.json({ success: true, data: guilds });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // ==================== CUSTOM ROLES ====================

  /** GET /api/roles — All available roles (built-in + custom) */
  router.get('/roles', (req, res) => {
    try {
      const ROLES = require('../../game/roles');
      const customRoles = getCustomRoles(db);
      
      const builtIn = Object.entries(ROLES).map(([key, value]) => ({
        id: key,
        name: value,
        type: 'builtin',
        camp: key === 'WEREWOLF' ? 'wolves' : 'village'
      }));

      res.json({ success: true, data: { builtIn, custom: customRoles } });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  /** POST /api/roles — Create a custom role (requires auth + admin) */
  router.post('/roles', requireAuth, (req, res) => {
    try {
      const { name, emoji, camp, power, description, guildId } = req.body;
      if (!name || !camp) return res.status(400).json({ success: false, error: 'name and camp are required' });
      if (!webServer.isGuildAdmin(req.user, guildId)) {
        return res.status(403).json({ success: false, error: 'Admin permission required' });
      }

      ensureCustomRolesTable(db);
      
      db.db.prepare(`
        INSERT INTO custom_roles (guild_id, name, emoji, camp, power, description, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(guildId, name, emoji || '❓', camp, power || 'none', description || '', req.user.id);

      res.json({ success: true, message: 'Role created' });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  /** DELETE /api/roles/:id — Delete a custom role */
  router.delete('/roles/:id', requireAuth, (req, res) => {
    try {
      ensureCustomRolesTable(db);
      const role = db.db.prepare('SELECT * FROM custom_roles WHERE id = ?').get(req.params.id);
      if (!role) return res.status(404).json({ success: false, error: 'Role not found' });
      if (!webServer.isGuildAdmin(req.user, role.guild_id)) {
        return res.status(403).json({ success: false, error: 'Admin permission required' });
      }
      db.db.prepare('DELETE FROM custom_roles WHERE id = ?').run(req.params.id);
      res.json({ success: true, message: 'Role deleted' });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // ==================== CONFIG (Admin only) ====================

  /** GET /api/config/:guildId — Guild config */
  router.get('/config/:guildId', requireAuth, (req, res) => {
    try {
      if (!webServer.isGuildAdmin(req.user, req.params.guildId)) {
        return res.status(403).json({ success: false, error: 'Admin permission required' });
      }
      const config = require('../../utils/config');
      const mgr = config.getInstance();
      const summary = {
        categoryId: mgr.getCategoryId(req.params.guildId),
        wolfWinCondition: mgr.getWolfWinCondition(req.params.guildId),
        defaultRules: mgr.getDefaultGameRules(req.params.guildId),
        locale: require('../../utils/i18n').getLocaleForGuild(req.params.guildId)
      };
      res.json({ success: true, data: summary });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  /** PATCH /api/config/:guildId — Update guild config */
  router.patch('/config/:guildId', requireAuth, (req, res) => {
    try {
      if (!webServer.isGuildAdmin(req.user, req.params.guildId)) {
        return res.status(403).json({ success: false, error: 'Admin permission required' });
      }
      const config = require('../../utils/config');
      const mgr = config.getInstance();
      const updates = req.body;

      if (updates.wolfWinCondition) {
        mgr.setForGuild(req.params.guildId, 'game.wolf_win_condition', updates.wolfWinCondition);
      }
      if (updates.locale) {
        const i18n = require('../../utils/i18n');
        i18n.setLocale(updates.locale, null, req.params.guildId);
      }
      if (updates.minPlayers || updates.maxPlayers) {
        const current = mgr.getDefaultGameRules(req.params.guildId);
        mgr.setForGuild(req.params.guildId, 'game.default_rules', JSON.stringify({
          ...current,
          ...(updates.minPlayers ? { minPlayers: updates.minPlayers } : {}),
          ...(updates.maxPlayers ? { maxPlayers: updates.maxPlayers } : {})
        }));
      }

      res.json({ success: true, message: 'Config updated' });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  return router;
};

// ==================== HELPERS ====================

function requireAuth(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) return next();
  res.status(401).json({ success: false, error: 'Authentication required' });
}

function ensureCustomRolesTable(db) {
  db.db.exec(`
    CREATE TABLE IF NOT EXISTS custom_roles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      name TEXT NOT NULL,
      emoji TEXT DEFAULT '❓',
      camp TEXT NOT NULL DEFAULT 'village',
      power TEXT DEFAULT 'none',
      description TEXT DEFAULT '',
      created_by TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

function getCustomRoles(db) {
  try {
    ensureCustomRolesTable(db);
    return db.db.prepare('SELECT * FROM custom_roles ORDER BY created_at DESC').all();
  } catch {
    return [];
  }
}
