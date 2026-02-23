/**
 * REST API routes — Stats, Games, Leaderboard, History, Config
 */
const express = require('express');

module.exports = function(webServer) {
  const router = express.Router();
  const gm = webServer.gameManager;
  const db = webServer.db;
  const client = webServer.client; // Discord client for guild fetching

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

  // ==================== MODERATION ====================

  /** GET /api/mod/status — Debug: check mod API connectivity + auth state (no auth required) */
  router.get('/mod/status', (req, res) => {
    const isAuth = req.isAuthenticated && req.isAuthenticated();
    const activeGames = [...gm.games.keys()];
    const user = isAuth ? { id: req.user.id, username: req.user.username, guilds: (req.user.guilds || []).length } : null;
    const clientReady = !!(client && client.isReady && client.isReady());
    console.log('[MOD] Status check — auth:', isAuth, 'games:', activeGames.length, 'client:', clientReady);
    res.json({
      success: true,
      authenticated: isAuth,
      user,
      clientReady,
      activeGames: activeGames.length,
      gameIds: activeGames,
      timestamp: new Date().toISOString()
    });
  });

  // Helper: reliably get Discord guild object
  async function fetchGuild(guildId) {
    if (!client) return null;
    try {
      // Try cache first, then fetch from API
      return client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId);
    } catch { return null; }
  }

  // Helper: send a message to the game's village or main channel
  async function sendToGameChannel(guild, game, content) {
    if (!guild) { console.log('[MOD] No guild — cannot send message'); return; }
    try {
      const channelId = game.villageChannelId || game.mainChannelId;
      console.log('[MOD] Sending to channel:', channelId);
      const channel = await guild.channels.fetch(channelId);
      if (channel) await channel.send(content);
      else console.log('[MOD] Channel not found:', channelId);
    } catch (e) { console.error('[MOD] sendToGameChannel error:', e.message); }
  }

  /** POST /api/mod/force-end/:gameId — Force end a game */
  router.post('/mod/force-end/:gameId', requireAuth, async (req, res) => {
    try {
      console.log('[MOD] force-end requested for:', req.params.gameId, 'by:', req.user?.username);
      const game = gm.games.get(req.params.gameId);
      if (!game) {
        console.log('[MOD] Game not found. Active games:', [...gm.games.keys()]);
        return res.status(404).json({ success: false, error: 'Partie introuvable' });
      }
      if (!webServer.isGuildAdmin(req.user, game.guildId)) {
        return res.status(403).json({ success: false, error: 'Permission admin requise' });
      }
      const guild = await fetchGuild(game.guildId);
      // Clear all timers
      gm.clearGameTimers(game);
      game.phase = 'ENDED';
      game.endedAt = Date.now();
      gm.logAction(game, `[ADMIN] Partie forcée à terminer via interface web par ${req.user.username}`);
      // Announce in Discord
      await sendToGameChannel(guild, game, `⚠️ **Partie terminée de force** par un administrateur via le dashboard web.`);
      // Try to clean up Discord channels
      try { if (guild) await gm.cleanupChannels(guild, game); } catch {}
      // Save history & remove
      try { db.saveGameHistory(game, 'Force ended (admin)'); } catch {}
      gm.games.delete(req.params.gameId);
      try { db.deleteGame(req.params.gameId); } catch {}
      gm.emit('gameEvent', { event: 'gameEnded', gameId: req.params.gameId, guildId: game.guildId, victor: 'Force ended (admin)' });
      res.json({ success: true, message: 'Partie terminée de force' });
    } catch (e) {
      console.error('[MOD] force-end error:', e);
      res.status(500).json({ success: false, error: e.message });
    }
  });

  /** POST /api/mod/skip-phase/:gameId — Force skip to next phase */
  router.post('/mod/skip-phase/:gameId', requireAuth, async (req, res) => {
    try {
      console.log('[MOD] skip-phase requested for:', req.params.gameId, 'by:', req.user?.username);
      const game = gm.games.get(req.params.gameId);
      if (!game) {
        console.log('[MOD] Game not found. Active games:', [...gm.games.keys()]);
        return res.status(404).json({ success: false, error: 'Partie introuvable' });
      }
      if (!webServer.isGuildAdmin(req.user, game.guildId)) {
        return res.status(403).json({ success: false, error: 'Permission admin requise' });
      }
      if (game.phase === 'ENDED') {
        return res.status(400).json({ success: false, error: 'Partie déjà terminée' });
      }
      // Get Discord guild for channel announcements
      const guild = await fetchGuild(game.guildId);
      if (!guild) {
        return res.status(500).json({ success: false, error: 'Impossible de récupérer le serveur Discord — le bot est-il connecté ?' });
      }
      const previousPhase = `${game.phase}/${game.subPhase || '-'}`;
      gm.logAction(game, `[ADMIN] Phase sautée via interface web par ${req.user.username} (${previousPhase})`);
      // Announce skip in Discord
      await sendToGameChannel(guild, game, `⏭️ **Phase sautée** par un administrateur (${previousPhase}).`);
      // Clear any AFK timeout before advancing
      if (typeof gm.clearNightAfkTimeout === 'function') gm.clearNightAfkTimeout(game);
      if (typeof gm.clearCaptainVoteTimeout === 'function') gm.clearCaptainVoteTimeout(game);
      if (game.subPhase && typeof gm.advanceSubPhase === 'function') {
        await gm.advanceSubPhase(guild, game);
      } else if (typeof gm.nextPhase === 'function') {
        await gm.nextPhase(guild, game);
      }
      res.json({ success: true, message: `Phase sautée (${previousPhase} → ${game.phase}/${game.subPhase || '-'})`, phase: game.phase, subPhase: game.subPhase });
    } catch (e) {
      console.error('[MOD] skip-phase error:', e);
      res.status(500).json({ success: false, error: e.message });
    }
  });

  /** POST /api/mod/kill-player/:gameId/:playerId — Force kill a player */
  router.post('/mod/kill-player/:gameId/:playerId', requireAuth, async (req, res) => {
    try {
      console.log('[MOD] kill-player requested for:', req.params.gameId, 'player:', req.params.playerId, 'by:', req.user?.username);
      const game = gm.games.get(req.params.gameId);
      if (!game) {
        console.log('[MOD] Game not found. Active games:', [...gm.games.keys()]);
        return res.status(404).json({ success: false, error: 'Partie introuvable' });
      }
      if (!webServer.isGuildAdmin(req.user, game.guildId)) {
        return res.status(403).json({ success: false, error: 'Permission admin requise' });
      }
      const player = game.players.find(p => p.id === req.params.playerId);
      if (!player) return res.status(404).json({ success: false, error: 'Joueur introuvable' });
      if (!player.alive) return res.status(400).json({ success: false, error: 'Joueur déjà éliminé' });

      const guild = await fetchGuild(game.guildId);
      gm.logAction(game, `[ADMIN] ${player.username} éliminé par le modérateur (${req.user.username})`);
      // Use the proper kill method (handles lovers, DB sync, events, lockouts)
      const collateralDeaths = gm.kill(game.mainChannelId, req.params.playerId);
      // Apply Discord permission lockouts
      try { if (guild) await gm.applyDeadPlayerLockouts(guild); } catch {}

      const deadNames = [player.username, ...collateralDeaths.map(d => d.username)];
      // Announce kill in Discord
      const killMsg = collateralDeaths.length > 0
        ? `⚠️ **${player.username}** a été éliminé par un administrateur. 💔 ${collateralDeaths.map(d => `**${d.username}**`).join(', ')} meurt aussi d'amour.`
        : `⚠️ **${player.username}** a été éliminé par un administrateur.`;
      await sendToGameChannel(guild, game, killMsg);
      // Announce role reveal via Discord embed
      try {
        const channelId = game.villageChannelId || game.mainChannelId;
        if (guild) {
          const channel = await guild.channels.fetch(channelId);
          if (channel) {
            await gm.announceDeathReveal(channel, player, 'admin');
            for (const dead of collateralDeaths) {
              await gm.announceDeathReveal(channel, dead, 'love');
            }
          }
        }
      } catch {}

      // Check victory after kill
      const victory = gm.checkWinner(game);
      if (victory) {
        try { if (guild) await gm.announceVictoryIfAny(guild, game); } catch {}
      }

      res.json({ success: true, message: `${deadNames.join(', ')} éliminé(s)`, collateral: collateralDeaths.map(d => d.username) });
    } catch (e) {
      console.error('[MOD] kill-player error:', e);
      res.status(500).json({ success: false, error: e.message });
    }
  });

  /** POST /api/mod/reveal-role/:gameId/:playerId — Reveal a player's role */
  router.post('/mod/reveal-role/:gameId/:playerId', requireAuth, (req, res) => {
    try {
      const game = gm.games.get(req.params.gameId);
      if (!game) return res.status(404).json({ success: false, error: 'Game not found' });
      if (!webServer.isGuildAdmin(req.user, game.guildId)) {
        return res.status(403).json({ success: false, error: 'Admin permission required' });
      }
      const player = game.players.find(p => p.id === req.params.playerId);
      if (!player) return res.status(404).json({ success: false, error: 'Player not found' });
      res.json({ success: true, data: { id: player.id, username: player.username, role: player.role, alive: player.alive } });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  /** GET /api/mod/games — All active games for moderation (requires auth) */
  router.get('/mod/games', requireAuth, (req, res) => {
    try {
      const userGuilds = (req.user.guilds || []).filter(g => (parseInt(g.permissions) & 0x28) !== 0).map(g => g.id);
      const games = gm.getAllGames()
        .filter(g => userGuilds.includes(g.guildId))
        .map(g => {
          const snap = gm.getGameSnapshot(g);
          // Include roles for moderation
          snap.players = (g.players || []).map(p => ({
            id: p.id, username: p.username, role: p.role, alive: p.alive,
            inLove: p.inLove || false, isCaptain: p.id === g.captainId
          }));
          return snap;
        });
      res.json({ success: true, data: games });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // ==================== MONITORING ====================

  /** GET /api/monitoring — Full monitoring metrics (public, read-only) */
  router.get('/monitoring', (req, res) => {
    try {
      let metrics, health, history, uptime;
      try {
        const MetricsCollector = require('../../monitoring/metrics');
        const mc = MetricsCollector.getInstance();
        mc.collect(); // refresh before returning
        metrics = mc.getMetrics();
        health = mc.getHealthStatus();
        history = mc.getHistory();
        uptime = mc.getFormattedUptime();
      } catch {
        // MetricsCollector not initialized — return basic info
        const mem = process.memoryUsage();
        metrics = {
          system: {
            memory: {
              rss: Math.round(mem.rss / 1024 / 1024),
              heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
              heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
              external: Math.round((mem.external || 0) / 1024 / 1024),
              systemTotal: Math.round(require('os').totalmem() / 1024 / 1024),
              systemFree: Math.round(require('os').freemem() / 1024 / 1024),
              percentage: 0
            },
            cpu: { usage: 0 },
            uptime: Math.floor(process.uptime())
          },
          discord: { guilds: client ? client.guilds.cache.size : 0, users: 0, channels: 0, latency: client ? client.ws.ping : 0, wsStatus: client ? client.ws.status : -1 },
          game: { activeGames: gm.getAllGames().length, totalPlayers: gm.getAllGames().reduce((s, g) => s + g.players.length, 0), gamesCreated24h: 0, gamesCompleted24h: 0 },
          commands: { total: 0, errors: 0, rateLimited: 0, avgResponseTime: 0 },
          errors: { total: 0, critical: 0, warnings: 0, last24h: 0 }
        };
        health = { status: 'HEALTHY', issues: [] };
        history = { timestamps: [], memory: [], cpu: [], latency: [], activeGames: [], errors: [] };
        const secs = Math.floor(process.uptime());
        const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = secs % 60;
        uptime = h > 0 ? `${h}h ${m}m ${s}s` : `${m}m ${s}s`;
      }

      res.json({ success: true, data: { metrics, health, history, uptime } });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  return router;
};

// ==================== HELPERS ====================

function requireAuth(req, res, next) {
  const isAuth = req.isAuthenticated && req.isAuthenticated();
  console.log('[AUTH]', req.method, req.path, '— authenticated:', isAuth, '— user:', isAuth ? req.user?.username : 'none');
  if (isAuth) return next();
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
