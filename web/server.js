/**
 * Werewolf Bot — Web Dashboard Server v3.5.0
 * 
 * Express + Socket.IO server providing:
 * - Discord OAuth2 authentication
 * - REST API for stats, games, leaderboard
 * - Real-time WebSocket game spectator
 * - Admin dashboard
 */

const express = require('express');
const http = require('http');
const { Server: SocketIO } = require('socket.io');
const session = require('express-session');
const SqliteStore = require('better-sqlite3-session-store')(session);
const Database = require('better-sqlite3');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const cookieParser = require('cookie-parser');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const fs = require('fs');
const { game: logger } = require('../utils/logger');
const roleData = require('../game/roleData');

class WebServer {
  constructor(options = {}) {
    this.port = options.port || process.env.WEB_PORT || 3000;
    this.gameManager = options.gameManager;
    this.db = options.db;
    this.client = options.client; // Discord client
    this.app = null;
    this.server = null;
    this.io = null;
    this.spectatorRooms = new Map(); // gameId -> Set of socket IDs
    this.gameEventBuffers = new Map(); // gameId -> Array of event objects
    this.sessionMiddleware = null;
    this._wsRateLimits = new Map();
    this._guildBroadcastThrottle = new Map();
  }

  /**
   * Initialize and start the web server.
   */
  async start() {
    this.app = express();
    this.server = http.createServer(this.app);
    this.allowedOrigins = process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',') : undefined;
    this.io = new SocketIO(this.server, {
      cors: { origin: this.allowedOrigins || '*', methods: ['GET', 'POST'] }
    });

    this._setupMiddleware();
    this._setupAuth();
    this._setupRoutes();
    this._setupSocketIO();
    this._setupGameBridge();

    return new Promise((resolve) => {
      this.server.listen(this.port, () => {
        logger.info(`🌐 Web dashboard running on http://localhost:${this.port}`);
        resolve();
      });
    });
  }

  /**
   * Stop the web server gracefully.
   */
  async stop() {
    for (const state of this._guildBroadcastThrottle.values()) {
      if (state && state.timer) clearTimeout(state.timer);
    }
    this._guildBroadcastThrottle.clear();
    this._wsRateLimits.clear();
    if (this.io) this.io.close();
    if (this.server) {
      return new Promise((resolve) => {
        this.server.close(() => {
          logger.info('🌐 Web server stopped');
          resolve();
        });
      });
    }
  }

  // ==================== MIDDLEWARE ====================

  _setupMiddleware() {
    // Security
    this.app.use(helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'", "cdn.socket.io", "cdn.jsdelivr.net"],
          scriptSrcAttr: ["'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'", "fonts.googleapis.com", "cdn.jsdelivr.net"],
          fontSrc: ["'self'", "fonts.gstatic.com", "cdn.jsdelivr.net"],
          imgSrc: ["'self'", "cdn.discordapp.com", "i.ibb.co", "data:"],
          connectSrc: ["'self'", "ws:", "wss:"]
        }
      }
    }));
    this.app.use(cors(this.allowedOrigins ? { origin: this.allowedOrigins } : undefined));
    this.app.use(cookieParser());
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));

    // Session — resolve a stable secret that survives restarts
    const dataDir = path.join(__dirname, '..', 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    const sessionSecret = this._resolveSessionSecret(dataDir);

    // Persistent SQLite session store
    const sessionDb = new Database(path.join(dataDir, 'sessions.db'));
    sessionDb.pragma('journal_mode = WAL');

    this.sessionMiddleware = session({
      store: new SqliteStore({
        client: sessionDb,
        expired: { clear: true, intervalMs: 15 * 60 * 1000 } // purge expired every 15 min
      }),
      secret: sessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 } // 7 days
    });
    this.app.use(this.sessionMiddleware);

    this.app.use(passport.initialize());
    this.app.use(passport.session());

    // Static files
    this.app.use('/static', express.static(path.join(__dirname, 'public')));
    // Serve role images from project root img/ folder
    this.app.use('/static/img/roles', express.static(path.join(__dirname, '..', 'img')));

    // View engine
    this.app.set('view engine', 'ejs');
    this.app.set('views', path.join(__dirname, 'views'));

    // Make auth user available to all templates
    this.app.use((req, res, next) => {
      res.locals.user = req.user || null;
      res.locals.botName = this.client?.user?.username || 'Werewolf Bot';
      res.locals.roleData = roleData;
      next();
    });
  }

  // ==================== SESSION SECRET ====================

  /**
   * Resolve a stable session secret:
   * 1. Use SESSION_SECRET env var if set
   * 2. Otherwise read/create data/.session-secret file (auto-generated once)
   */
  _resolveSessionSecret(dataDir) {
    if (process.env.SESSION_SECRET) {
      return process.env.SESSION_SECRET;
    }

    const secretFile = path.join(dataDir, '.session-secret');
    try {
      if (fs.existsSync(secretFile)) {
        const stored = fs.readFileSync(secretFile, 'utf8').trim();
        if (stored.length >= 32) {
          logger.info('🔑 Session secret loaded from data/.session-secret');
          return stored;
        }
      }
    } catch (err) {
      logger.warn('⚠️  Could not read session secret file, generating new one', { error: err.message });
    }

    // Generate and persist a new secret
    const newSecret = require('crypto').randomBytes(48).toString('hex');
    try {
      fs.writeFileSync(secretFile, newSecret, { mode: 0o600 });
      logger.info('🔑 Generated and saved new session secret to data/.session-secret');
    } catch (err) {
      logger.warn('⚠️  Could not save session secret file — sessions will not survive restarts', { error: err.message });
    }
    return newSecret;
  }

  // ==================== DISCORD OAUTH2 ====================

  _setupAuth() {
    const clientId = process.env.CLIENT_ID;
    const clientSecret = process.env.CLIENT_SECRET;
    const callbackURL = process.env.WEB_CALLBACK_URL || `http://localhost:${this.port}/auth/discord/callback`;

    if (clientId && clientSecret) {
      passport.use(new DiscordStrategy({
        clientID: clientId,
        clientSecret: clientSecret,
        callbackURL: callbackURL,
        scope: ['identify', 'guilds']
      }, (accessToken, refreshToken, profile, done) => {
        // Attach guild info and admin check
        profile.accessToken = accessToken;
        return done(null, profile);
      }));

      passport.serializeUser((user, done) => done(null, user));
      passport.deserializeUser((obj, done) => done(null, obj));
    } else {
      logger.warn('🌐 CLIENT_SECRET not set — OAuth2 disabled, dashboard in read-only mode');
    }
  }

  // ==================== ROUTES ====================

  _setupRoutes() {
    const apiRouter = require('./routes/api')(this);
    const authRouter = require('./routes/auth');
    const dashboardRouter = require('./routes/dashboard')(this);

    // Auth routes
    this.app.use('/auth', authRouter);

    // API routes
    this.app.use('/api', apiRouter);

    // Dashboard routes (HTML pages)
    this.app.use('/', dashboardRouter);

    // 404 handler
    this.app.use((req, res) => {
      res.status(404).render('error', { title: '404', message: 'Page not found' });
    });

    // Error handler
    this.app.use((err, req, res, next) => {
      logger.error('Web server error', { error: err.message, stack: err.stack });
      res.status(500).render('error', { title: 'Error', message: 'Internal server error' });
    });
  }

  // ==================== SOCKET.IO ====================

  /**
   * Enrich a game snapshot with avatar URLs and guild name from the Discord client cache.
   */
  _enrichSnapshot(snapshot) {
    if (!snapshot || !this.client) return snapshot;
    // Resolve guild name
    if (!snapshot.guildName && snapshot.guildId) {
      const guild = this.client.guilds.cache.get(snapshot.guildId);
      if (guild) snapshot.guildName = guild.name;
    }
    // Resolve player avatars
    const resolve = (p) => {
      if (!p.avatar && p.id) {
        const user = this.client.users.cache.get(p.id);
        if (user) {
          p.avatar = user.displayAvatarURL({ size: 64, extension: 'png' });
          if (!p.username) p.username = user.username || user.displayName;
        }
      }
    };
    (snapshot.players || []).forEach(resolve);
    (snapshot.dead || []).forEach(resolve);
    return snapshot;
  }

  _setupSocketIO() {
    // Debounce map for gameState emissions: gameId -> timeout
    this._gameStateDebounce = new Map();

    if (this.sessionMiddleware) {
      this.io.use((socket, next) => {
        this.sessionMiddleware(socket.request, {}, next);
      });
    }

    const SOCKET_WINDOW_MS = 10_000;
    const SOCKET_MAX_EVENTS = 30;

    this.io.on('connection', (socket) => {
      // Initialize rate limit for this socket
      this._wsRateLimits.set(socket.id, { count: 0, resetAt: Date.now() + SOCKET_WINDOW_MS });

      // Rate limiter check (30 events per 10 seconds per socket)
      const checkRateLimit = (cost = 1) => {
        const rl = this._wsRateLimits.get(socket.id);
        if (!rl) return false;
        const now = Date.now();
        if (now > rl.resetAt) { rl.count = 0; rl.resetAt = now + SOCKET_WINDOW_MS; }
        rl.count += cost;
        return rl.count > SOCKET_MAX_EVENTS;
      };

      const reject = (message) => socket.emit('error', { message });

      // Join a guild dashboard room (for scoped globalEvent broadcasts)
      socket.on('joinGuild', (guildId) => {
        if (checkRateLimit()) return reject('Rate limited');
        if (typeof guildId !== 'string' || !/^\d{17,19}$/.test(guildId)) {
          return reject('Invalid guild id');
        }
        if (!this._canSocketAccessGuild(socket, guildId)) {
          return reject('Unauthorized guild');
        }
        // Leave any previous guild rooms to prevent cross-guild leaking
        for (const room of socket.rooms) {
          if (room.startsWith('guild:')) socket.leave(room);
        }
        socket.join(`guild:${guildId}`);
        socket.emit('joinedGuild', { guildId });
      });

      // Join a game spectator room
      socket.on('spectate', (gameId) => {
        console.log(`[spectate] Received spectate request: gameId=${gameId} socketId=${socket.id}`);
        if (checkRateLimit()) { console.log('[spectate] REJECTED: rate limited'); return reject('Rate limited'); }
        if (typeof gameId !== 'string' || gameId.length > 30) { console.log('[spectate] REJECTED: invalid game id'); return reject('Invalid game id'); }
        const game = this.gameManager.games.get(gameId);
        if (!game) {
          console.log(`[spectate] REJECTED: game not found (active games: ${[...this.gameManager.games.keys()].join(', ')})`);
          return reject('Game not found');
        }
        if (!this._canSocketAccessGame(socket, game)) {
          console.log(`[spectate] REJECTED: unauthorized (guildId=${game.guildId}, userGuilds=${JSON.stringify(this._getSocketUserGuildIds(socket))})`);
          return reject('Unauthorized game');
        }

        socket.join(`game:${gameId}`);
        if (!this.spectatorRooms.has(gameId)) {
          this.spectatorRooms.set(gameId, new Set());
        }
        this.spectatorRooms.get(gameId).add(socket.id);

        // Send initial state
        socket.emit('gameState', this._enrichSnapshot(this.gameManager.getGameSnapshot(game)));

        // Send buffered event history so late spectators see the full feed
        const eventBuffer = this.gameEventBuffers.get(gameId);
        console.log(`[spectate] gameId=${gameId} bufferExists=${!!eventBuffer} bufferSize=${eventBuffer ? eventBuffer.length : 0}`);
        if (eventBuffer && eventBuffer.length > 0) {
          socket.emit('gameEventHistory', { gameId, events: [...eventBuffer] });
          console.log(`[spectate] Sent ${eventBuffer.length} history events to socket ${socket.id}`);
        }

        // Notify spectator count
        this.io.to(`game:${gameId}`).emit('spectatorCount', { gameId, count: this.spectatorRooms.get(gameId).size });
      });

      // Leave spectator room
      socket.on('leaveSpectate', (gameId) => {
        if (typeof gameId !== 'string' || gameId.length > 30) return;
        socket.leave(`game:${gameId}`);
        if (this.spectatorRooms.has(gameId)) {
          this.spectatorRooms.get(gameId).delete(socket.id);
          this.io.to(`game:${gameId}`).emit('spectatorCount', { gameId, count: this.spectatorRooms.get(gameId).size });
        }
      });

      // Request all active games (for dashboard) — filtered by user's guild membership
      socket.on('requestGames', () => {
        if (checkRateLimit()) return reject('Rate limited');
        const allGames = this.gameManager.getAllGames();
        const userGuildIds = this._getSocketUserGuildIds(socket);
        const filtered = userGuildIds.length > 0
          ? allGames.filter(g => g.guildId && userGuildIds.includes(g.guildId))
          : [];
        const games = filtered.map(g => this._enrichSnapshot(this.gameManager.getGameSnapshot(g)));
        socket.emit('activeGames', games);
      });

      socket.on('disconnect', () => {
        // Clean up rate limits
        this._wsRateLimits.delete(socket.id);
        // Clean up spectator rooms
        for (const [gameId, sockets] of this.spectatorRooms) {
          if (sockets.has(socket.id)) {
            sockets.delete(socket.id);
            this.io.to(`game:${gameId}`).emit('spectatorCount', { gameId, count: sockets.size });
            if (sockets.size === 0) this.spectatorRooms.delete(gameId);
          }
        }
      });
    });
  }

  // ==================== GAME EVENT BRIDGE ====================

  _setupGameBridge() {
    if (!this.gameManager) return;

    this.gameManager.on('gameEvent', (data) => {
      const { event, gameId, guildId } = data;

      // Sanitize event for spectators: strip role information that should be secret
      const spectatorData = this._sanitizeForSpectators(data);

      // Buffer sanitized event for late-joining spectators (max 200 events per game)
      if (!this.gameEventBuffers.has(gameId)) {
        this.gameEventBuffers.set(gameId, []);
      }
      const buffer = this.gameEventBuffers.get(gameId);
      if (spectatorData) {
        buffer.push(spectatorData);
      }
      if (buffer.length > 200) buffer.shift();
      console.log(`[event-buffer] gameId=${gameId} event=${event} bufferSize=${buffer.length}`);

      // Broadcast sanitized event to spectators of this game
      if (spectatorData) {
        this.io.to(`game:${gameId}`).emit('gameEvent', spectatorData);
      }

      // Broadcast to guild dashboard room (strictly scoped + throttled)
      if (guildId) {
        this._emitGuildScopedThrottled(guildId, 'gameEvent', data, 100);
        this._emitGuildScopedThrottled(guildId, 'globalEvent', { event, gameId, guildId, timestamp: data.timestamp }, 250);
      }

      // On full state events, send debounced updated snapshot (200ms)
      if (['gameStarted', 'phaseChanged', 'playerKilled', 'gameEnded'].includes(event)) {
        // Debounce: only emit once per 200ms per game
        if (this._gameStateDebounce.has(gameId)) {
          clearTimeout(this._gameStateDebounce.get(gameId));
        }
        this._gameStateDebounce.set(gameId, setTimeout(() => {
          this._gameStateDebounce.delete(gameId);
          const game = this.gameManager.games.get(gameId);
          if (game) {
            this.io.to(`game:${gameId}`).emit('gameState', this._enrichSnapshot(this.gameManager.getGameSnapshot(game)));
          }
        }, 200));
      }

      // Clean up spectator room and event buffer on game end
      if (event === 'gameEnded') {
        setTimeout(() => {
          this.spectatorRooms.delete(gameId);
          this.gameEventBuffers.delete(gameId);
        }, 60000); // Keep room for 1 minute after end
      }
    });
  }

  /**
   * Sanitize a game event for spectator consumption.
   * - Strips role assignments from actionLog ("username => role")
   * - Removes per-player role data from gameStarted
   * - Returns null if the event should be completely hidden from spectators
   */
  _sanitizeForSpectators(data) {
    const { event } = data;

    // Filter out role-assignment action logs (format: "Username => RoleName")
    if (event === 'actionLog' && data.text) {
      if (/=>/.test(data.text)) return null;
    }

    // Strip roles from gameStarted player list
    if (event === 'gameStarted' && data.players) {
      return {
        ...data,
        players: data.players.map(p => ({ id: p.id, username: p.username }))
      };
    }

    return data;
  }

  /**
   * Extract the user's guild IDs from a Socket.IO socket's session (if authenticated).
   */
  _getSocketUserGuildIds(socket) {
    try {
      const session = socket.request?.session;
      const passport = session?.passport;
      const user = passport?.user;
      if (user && user.guilds) {
        return user.guilds.map(g => g.id);
      }
    } catch {}
    return [];
  }

  _canSocketAccessGuild(socket, guildId) {
    if (!guildId) return false;
    const guildIds = this._getSocketUserGuildIds(socket);
    if (!Array.isArray(guildIds) || guildIds.length === 0) return false;
    if (!guildIds.includes(guildId)) return false;
    if (this.client && this.client.guilds && this.client.guilds.cache && !this.client.guilds.cache.has(guildId)) {
      return false;
    }
    return true;
  }

  _canSocketAccessGame(socket, game) {
    if (!game || !game.guildId) return false;
    return this._canSocketAccessGuild(socket, game.guildId);
  }

  _emitGuildScopedThrottled(guildId, eventName, payload, throttleMs = 250) {
    const key = `${guildId}:${eventName}`;
    const now = Date.now();
    const state = this._guildBroadcastThrottle.get(key) || { lastAt: 0, timer: null, pending: null };
    const elapsed = now - state.lastAt;

    const emitNow = (data) => {
      state.lastAt = Date.now();
      this.io.to(`guild:${guildId}`).emit(eventName, data);
    };

    if (elapsed >= throttleMs) {
      if (state.timer) {
        clearTimeout(state.timer);
        state.timer = null;
      }
      state.pending = null;
      emitNow(payload);
      this._guildBroadcastThrottle.set(key, state);
      return;
    }

    state.pending = payload;
    if (state.timer) {
      clearTimeout(state.timer);
    }
    const waitMs = Math.max(0, throttleMs - elapsed);
    state.timer = setTimeout(() => {
      const pendingPayload = state.pending;
      state.pending = null;
      state.timer = null;
      emitNow(pendingPayload);
      this._guildBroadcastThrottle.set(key, state);
    }, waitMs);
    this._guildBroadcastThrottle.set(key, state);
  }

  /**
   * Check if a user has admin access to a guild.
   */
  isGuildAdmin(user, guildId) {
    if (!user || !user.guilds) return false;
    const guild = user.guilds.find(g => g.id === guildId);
    if (!guild) return false;
    // Check for Administrator permission (0x8) or Manage Server (0x20)
    return (parseInt(guild.permissions) & 0x28) !== 0;
  }

  /**
   * Check if a user is the bot owner (OWNER_ID env var).
   */
  isBotOwner(user) {
    if (!user || !user.id) return false;
    const ownerId = process.env.OWNER_ID;
    return ownerId && user.id === ownerId;
  }

  /**
   * Get the access level for the current request.
   * Returns: 'owner' | 'admin' | 'member' | 'public'
   * - owner: OWNER_ID matches user.id
   * - admin: user has MANAGE_SERVER on at least one guild with bot
   * - member: logged in user
   * - public: not logged in
   */
  getUserAccessLevel(req) {
    if (!req.isAuthenticated || !req.isAuthenticated() || !req.user) return 'public';
    if (this.isBotOwner(req.user)) return 'owner';
    // Check if user is admin on any guild where bot is present
    const botGuildIds = this.client ? [...this.client.guilds.cache.keys()] : [];
    const userGuilds = (req.user.guilds || []).filter(g => botGuildIds.includes(g.id));
    const isAdmin = userGuilds.some(g => (parseInt(g.permissions) & 0x28) !== 0);
    if (isAdmin) return 'admin';
    return 'member';
  }

  /**
   * Get list of guild IDs where user is admin AND bot is present.
   */
  getUserAdminGuildIds(req) {
    if (!req.isAuthenticated || !req.isAuthenticated() || !req.user) return [];
    const botGuildIds = this.client ? [...this.client.guilds.cache.keys()] : [];
    return (req.user.guilds || [])
      .filter(g => botGuildIds.includes(g.id) && (parseInt(g.permissions) & 0x28) !== 0)
      .map(g => g.id);
  }
}

module.exports = WebServer;
