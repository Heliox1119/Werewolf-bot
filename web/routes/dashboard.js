/**
 * Dashboard page routes — Renders EJS templates
 */
const express = require('express');

module.exports = function(webServer) {
  const router = express.Router();
  const gm = webServer.gameManager;
  const db = webServer.db;

  // Middleware: inject userGuilds + accessLevel into all rendered pages
  router.use((req, res, next) => {
    // Access level: owner > admin > member > public
    res.locals.accessLevel = webServer.getUserAccessLevel(req);
    res.locals.adminGuildIds = webServer.getUserAdminGuildIds(req);

    if (req.isAuthenticated && req.isAuthenticated() && req.user) {
      const guilds = (req.user.guilds || []).filter(g => (parseInt(g.permissions) & 0x28) !== 0);
      const botGuildIds = webServer.client ? [...webServer.client.guilds.cache.keys()] : [];
      res.locals.userGuilds = guilds.map(g => ({
        id: g.id,
        name: g.name,
        icon: g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=64` : null,
        botPresent: botGuildIds.includes(g.id)
      }));
    } else {
      res.locals.userGuilds = [];
    }
    next();
  });

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

      // Resolve guild name and player avatars from Discord cache
      const client = webServer.client;
      if (client) {
        const guild = client.guilds.cache.get(snapshot.guildId);
        if (guild) snapshot.guildName = guild.name;

        const resolveAvatar = (p) => {
          if (!p.avatar && p.id) {
            const user = client.users.cache.get(p.id);
            if (user) {
              p.avatar = user.displayAvatarURL({ size: 64, extension: 'png' });
              if (!p.username) p.username = user.username || user.displayName;
            }
          }
        };
        (snapshot.players || []).forEach(resolveAvatar);
        (snapshot.dead || []).forEach(resolveAvatar);
      }

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
      const games = gm.getAllGames().filter(g => g.guildId === req.params.id).map(g => {
        const snap = gm.getGameSnapshot(g);
        snap.players = (g.players || []).map(p => ({
          id: p.id, username: p.username, role: p.role, alive: p.alive,
          inLove: p.inLove || false, isCaptain: p.id === g.captainId
        }));
        return snap;
      });
      
      let leaderboard = [];
      if (gm.achievements) {
        const { AchievementEngine } = require('../../game/achievements');
        leaderboard = gm.achievements.getLeaderboard(5, req.params.id).map((p, i) => ({
          rank: i + 1,
          ...p,
          tier: AchievementEngine.getEloTier(p.elo_rating || 1000)
        }));
      }

      let history = [];
      try { history = db.getGuildHistory(req.params.id, 5); } catch {}

      // Compute guild-specific stats from history
      let allHistory = [];
      try { allHistory = db.getGuildHistory(req.params.id, 1000); } catch {}
      const guildStats = {
        totalGames: allHistory.length,
        villageWins: allHistory.filter(h => h.winner === 'village').length,
        wolfWins: allHistory.filter(h => h.winner === 'wolves').length,
        loversWins: allHistory.filter(h => h.winner === 'lovers').length,
        avgPlayers: allHistory.length > 0 ? Math.round(allHistory.reduce((s, h) => s + (h.player_count || 0), 0) / allHistory.length) : 0,
        avgDuration: allHistory.length > 0 ? Math.round(allHistory.reduce((s, h) => s + (h.duration_seconds || 0), 0) / allHistory.length) : 0,
        activeGames: games.length
      };

      res.render('guild', {
        title: guild ? guild.name : `Guild ${req.params.id}`,
        guild: guild ? { id: guild.id, name: guild.name, icon: guild.iconURL({ size: 128 }), memberCount: guild.memberCount } : null,
        guildId: req.params.id,
        guildPage: 'overview',
        games,
        leaderboard,
        history,
        guildStats
      });
    } catch (e) {
      res.render('error', { title: 'Error', message: e.message });
    }
  });

  /** GET /guild/:id/moderation — Per-guild moderation panel */
  router.get('/guild/:id/moderation', (req, res) => {
    try {
      if (!req.isAuthenticated || !req.isAuthenticated()) {
        return res.redirect('/login');
      }
      const level = webServer.getUserAccessLevel(req);
      if (level !== 'owner' && level !== 'admin') {
        return res.render('error', { title: 'Forbidden', message: 'Admin permissions required.' });
      }
      if (level !== 'owner' && !webServer.isGuildAdmin(req.user, req.params.id)) {
        return res.render('error', { title: 'Forbidden', message: 'You are not admin of this server.' });
      }

      const client = webServer.client;
      const guild = client ? client.guilds.cache.get(req.params.id) : null;
      const games = gm.getAllGames()
        .filter(g => g.guildId === req.params.id)
        .map(g => {
          const snap = gm.getGameSnapshot(g);
          snap.players = (g.players || []).map(p => ({
            id: p.id, username: p.username, role: p.role, alive: p.alive,
            inLove: p.inLove || false, isCaptain: p.id === g.captainId
          }));
          return snap;
        });

      res.render('guild-moderation', {
        title: guild ? guild.name : `Guild ${req.params.id}`,
        guild: guild ? { id: guild.id, name: guild.name, icon: guild.iconURL({ size: 128 }), memberCount: guild.memberCount } : null,
        guildId: req.params.id,
        guildPage: 'moderation',
        games
      });
    } catch (e) {
      res.render('error', { title: 'Error', message: e.message });
    }
  });

  /** GET /guild/:id/rules — Per-guild rules configuration */
  router.get('/guild/:id/rules', (req, res) => {
    try {
      const client = webServer.client;
      const guild = client ? client.guilds.cache.get(req.params.id) : null;
      const ConfigManager = require('../../utils/config');
      const configMgr = ConfigManager.getInstance();
      const ROLES = require('../../game/roles');
      const i18n = require('../../utils/i18n');

      const enabledRoles = configMgr.getEnabledRoles(req.params.id);
      const config = {
        defaultRules: configMgr.getDefaultGameRules(req.params.id),
        wolfWinCondition: configMgr.getWolfWinCondition(req.params.id),
        locale: i18n.getLocaleForGuild ? i18n.getLocaleForGuild(req.params.id) : 'fr',
        categoryId: configMgr.getCategoryId(req.params.id),
        setupComplete: configMgr.isSetupComplete(req.params.id),
        enabledRoles
      };

      const allRoles = Object.values(ROLES);

      // Premium check: is the current user premium?
      let isPremium = false;
      let premiumTier = null;
      if (req.isAuthenticated && req.isAuthenticated() && req.user) {
        const premiumData = db.getPremiumUser(req.user.id);
        if (premiumData) {
          isPremium = true;
          premiumTier = premiumData.tier;
        }
      }

      // Role categories
      const classicRoleNames = ['Loup-Garou', 'Villageois', 'Voyante', 'Sorcière', 'Chasseur'];
      const premiumRoleNames = ['Loup Blanc', 'Petite Fille', 'Cupidon', 'Salvateur', 'Ancien', 'Idiot du Village', 'Voleur'];

      res.render('guild-rules', {
        title: guild ? guild.name : `Guild ${req.params.id}`,
        guild: guild ? { id: guild.id, name: guild.name, icon: guild.iconURL({ size: 128 }), memberCount: guild.memberCount } : null,
        guildId: req.params.id,
        guildPage: 'rules',
        config,
        allRoles,
        isPremium,
        premiumTier,
        classicRoleNames,
        premiumRoleNames
      });
    } catch (e) {
      res.render('error', { title: 'Error', message: e.message });
    }
  });

  /** GET /guild/:id/leaderboard — Per-guild leaderboard */
  router.get('/guild/:id/leaderboard', (req, res) => {
    try {
      const client = webServer.client;
      const guild = client ? client.guilds.cache.get(req.params.id) : null;

      let leaderboard = [];
      if (gm.achievements) {
        const { AchievementEngine } = require('../../game/achievements');
        leaderboard = gm.achievements.getLeaderboard(50, req.params.id).map((p, i) => ({
          rank: i + 1,
          ...p,
          tier: AchievementEngine.getEloTier(p.elo_rating || 1000)
        }));
      }

      res.render('guild-leaderboard', {
        title: guild ? guild.name : `Guild ${req.params.id}`,
        guild: guild ? { id: guild.id, name: guild.name, icon: guild.iconURL({ size: 128 }), memberCount: guild.memberCount } : null,
        guildId: req.params.id,
        guildPage: 'leaderboard',
        leaderboard
      });
    } catch (e) {
      res.render('error', { title: 'Error', message: e.message });
    }
  });

  /** GET /guild/:id/history — Per-guild game history */
  router.get('/guild/:id/history', (req, res) => {
    try {
      const client = webServer.client;
      const guild = client ? client.guilds.cache.get(req.params.id) : null;

      let history = [];
      try { history = db.getGuildHistory(req.params.id, 50); } catch {}

      res.render('guild-history', {
        title: guild ? guild.name : `Guild ${req.params.id}`,
        guild: guild ? { id: guild.id, name: guild.name, icon: guild.iconURL({ size: 128 }), memberCount: guild.memberCount } : null,
        guildId: req.params.id,
        guildPage: 'history',
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

  // Global /moderation removed — per-guild moderation is available at /guild/:id/moderation

  /** GET /monitoring — Monitoring page (access-level filtered) */
  router.get('/monitoring', (req, res) => {
    try {
      res.render('monitoring', {
        title: 'Monitoring'
      });
    } catch (e) {
      res.render('error', { title: 'Error', message: e.message });
    }
  });

  /** GET /status — Status page (alias for monitoring, access-level filtered) */
  router.get('/status', (req, res) => {
    try {
      res.render('monitoring', {
        title: 'Status'
      });
    } catch (e) {
      res.render('error', { title: 'Error', message: e.message });
    }
  });

  /** GET /docs — Documentation wiki page (public) */
  router.get('/docs', (req, res) => {
    try {
      res.render('docs', { title: 'Documentation' });
    } catch (e) {
      res.render('error', { title: 'Error', message: e.message });
    }
  });

  /** GET /premium — Premium page (public) */
  router.get('/premium', (req, res) => {
    try {
      res.render('premium', { title: 'Premium' });
    } catch (e) {
      res.render('error', { title: 'Error', message: e.message });
    }
  });

  /** GET /support — Support page (public) */
  router.get('/support', (req, res) => {
    try {
      res.render('support', { title: 'Support' });
    } catch (e) {
      res.render('error', { title: 'Error', message: e.message });
    }
  });

  /** GET /invite/:id — Invite bot to a guild */
  router.get('/invite/:id', (req, res) => {
    try {
      const guildId = req.params.id;
      const clientId = process.env.CLIENT_ID || '';
      // Permissions: ManageChannels, SendMessages, EmbedLinks, MuteMembers, ManageRoles, ReadMessageHistory, UseApplicationCommands
      const permissions = '278528739328';
      const inviteUrl = `https://discord.com/api/oauth2/authorize?client_id=${clientId}&permissions=${permissions}&scope=bot%20applications.commands&guild_id=${guildId}`;

      // Try to get guild name from user's guilds
      let guildName = `Server ${guildId}`;
      let guildIcon = null;
      if (req.isAuthenticated && req.isAuthenticated() && req.user) {
        const userGuild = (req.user.guilds || []).find(g => g.id === guildId);
        if (userGuild) {
          guildName = userGuild.name;
          guildIcon = userGuild.icon ? `https://cdn.discordapp.com/icons/${guildId}/${userGuild.icon}.png?size=128` : null;
        }
      }

      res.render('invite', {
        title: 'Invite',
        guildId,
        guildName,
        guildIcon,
        inviteUrl
      });
    } catch (e) {
      res.render('error', { title: 'Error', message: e.message });
    }
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
