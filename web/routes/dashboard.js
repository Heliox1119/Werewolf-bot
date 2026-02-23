/**
 * Dashboard page routes — Renders EJS templates
 */
const express = require('express');

module.exports = function(webServer) {
  const router = express.Router();
  const gm = webServer.gameManager;
  const db = webServer.db;

  /** GET / — Main dashboard */
  router.get('/', (req, res) => {
    try {
      const games = gm.getAllGames().map(g => gm.getGameSnapshot(g));
      const stats = db.getGlobalStats ? db.getGlobalStats() : {};
      
      res.render('dashboard', {
        title: 'Dashboard',
        games,
        stats,
        activeGames: games.length,
        activePlayers: games.reduce((sum, g) => sum + (g.players ? g.players.filter(p => p.alive).length : 0), 0),
        guilds: webServer.client ? webServer.client.guilds.cache.size : 0
      });
    } catch (e) {
      res.render('error', { title: 'Error', message: e.message });
    }
  });

  /** GET /game/:id — Live spectator page */
  router.get('/game/:id', (req, res) => {
    try {
      const game = gm.games.get(req.params.id);
      if (!game) return res.render('error', { title: 'Not Found', message: 'Game not found or has ended.' });
      
      const snapshot = gm.getGameSnapshot(game);
      res.render('spectator', {
        title: `Game — ${snapshot.guildName || snapshot.guildId}`,
        game: snapshot,
        gameId: req.params.id
      });
    } catch (e) {
      res.render('error', { title: 'Error', message: e.message });
    }
  });

  /** GET /guild/:id — Guild dashboard */
  router.get('/guild/:id', (req, res) => {
    try {
      const client = webServer.client;
      const guild = client ? client.guilds.cache.get(req.params.id) : null;
      const games = gm.getAllGames().filter(g => g.guildId === req.params.id).map(g => gm.getGameSnapshot(g));
      
      let leaderboard = [];
      if (gm.achievements) {
        const { AchievementEngine } = require('../../game/achievements');
        leaderboard = gm.achievements.getLeaderboard(10, req.params.id).map((p, i) => ({
          rank: i + 1,
          ...p,
          tier: AchievementEngine.getEloTier(p.elo_rating || 1000)
        }));
      }

      let history = [];
      try { history = db.getGuildHistory(req.params.id, 10); } catch {}

      res.render('guild', {
        title: guild ? guild.name : `Guild ${req.params.id}`,
        guild: guild ? { id: guild.id, name: guild.name, icon: guild.iconURL({ size: 128 }), memberCount: guild.memberCount } : null,
        guildId: req.params.id,
        games,
        leaderboard,
        history
      });
    } catch (e) {
      res.render('error', { title: 'Error', message: e.message });
    }
  });

  /** GET /player/:id — Player profile */
  router.get('/player/:id', (req, res) => {
    try {
      const stats = db.getPlayerStats(req.params.id);
      if (!stats) return res.render('error', { title: 'Not Found', message: 'Player not found.' });

      let ext = {}, achievements = [], tier = null, rank = null;
      
      if (gm.achievements) {
        const { AchievementEngine, ACHIEVEMENTS } = require('../../game/achievements');
        ext = gm.achievements.getExtendedStats(req.params.id);
        rank = gm.achievements.getPlayerRank(req.params.id);
        tier = AchievementEngine.getEloTier(ext.elo_rating || 1000);
        achievements = gm.achievements.getPlayerAchievements(req.params.id).map(a => ({
          ...a,
          ...(ACHIEVEMENTS[a.achievement_id] || {})
        }));
      }

      res.render('player', {
        title: stats.username || `Player ${req.params.id}`,
        player: { ...stats, ...ext, tier, rank, achievements },
        playerId: req.params.id
      });
    } catch (e) {
      res.render('error', { title: 'Error', message: e.message });
    }
  });

  /** GET /login — Login page */
  router.get('/login', (req, res) => {
    if (req.isAuthenticated && req.isAuthenticated()) return res.redirect('/');
    res.render('login', { title: 'Login' });
  });

  /** GET /roles — Custom roles editor page (Admin) */
  router.get('/roles', (req, res) => {
    try {
      const ROLES = require('../../game/roles');
      const builtIn = Object.entries(ROLES).map(([key, value]) => ({ id: key, name: value, type: 'builtin' }));
      
      let customRoles = [];
      try {
        db.db.exec(`CREATE TABLE IF NOT EXISTS custom_roles (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          guild_id TEXT NOT NULL, name TEXT NOT NULL, emoji TEXT DEFAULT '❓',
          camp TEXT NOT NULL DEFAULT 'village', power TEXT DEFAULT 'none',
          description TEXT DEFAULT '', created_by TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);
        customRoles = db.db.prepare('SELECT * FROM custom_roles ORDER BY created_at DESC').all();
      } catch {}

      res.render('roles', {
        title: 'Roles Editor',
        builtIn,
        customRoles,
        isAdmin: req.isAuthenticated && req.isAuthenticated()
      });
    } catch (e) {
      res.render('error', { title: 'Error', message: e.message });
    }
  });

  return router;
};
