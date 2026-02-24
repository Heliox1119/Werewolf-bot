/**
 * Werewolf Bot — Web Dashboard Server v3.2.0
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
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const cookieParser = require('cookie-parser');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const { game: logger } = require('../utils/logger');

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
  }

  /**
   * Initialize and start the web server.
   */
  async start() {
    this.app = express();
    this.server = http.createServer(this.app);
    const allowedOrigins = process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',') : undefined;
    this.io = new SocketIO(this.server, {
      cors: { origin: allowedOrigins || '*', methods: ['GET', 'POST'] }
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
    this.app.use(cors(allowedOrigins ? { origin: allowedOrigins } : undefined));
    this.app.use(cookieParser());
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));

    // Session
    const sessionSecret = process.env.SESSION_SECRET;
    if (!sessionSecret) {
      logger.warn('⚠️  SESSION_SECRET env var not set — using random secret (sessions will not persist across restarts)');
    }
    this.app.use(session({
      secret: sessionSecret || require('crypto').randomBytes(32).toString('hex'),
      resave: false,
      saveUninitialized: false,
      cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 } // 7 days
    }));

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
      next();
    });
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
    // Rate limiting: socketId -> { count, resetAt }
    this._wsRateLimits = new Map();

    this.io.on('connection', (socket) => {
      // Initialize rate limit for this socket
      this._wsRateLimits.set(socket.id, { count: 0, resetAt: Date.now() + 10000 });

      // Rate limiter check (30 events per 10 seconds per socket)
      const checkRateLimit = () => {
        const rl = this._wsRateLimits.get(socket.id);
        if (!rl) return false;
        const now = Date.now();
        if (now > rl.resetAt) { rl.count = 0; rl.resetAt = now + 10000; }
        rl.count++;
        return rl.count > 30;
      };

      // Join a guild dashboard room (for scoped globalEvent broadcasts)
      socket.on('joinGuild', (guildId) => {
        if (checkRateLimit()) return socket.emit('error', { message: 'Rate limited' });
        if (typeof guildId !== 'string' || !/^\d{17,19}$/.test(guildId)) return;
        // Leave any previous guild rooms to prevent cross-guild leaking
        for (const room of socket.rooms) {
          if (room.startsWith('guild:')) socket.leave(room);
        }
        socket.join(`guild:${guildId}`);
      });

      // Join a game spectator room
      socket.on('spectate', (gameId) => {
        if (checkRateLimit()) return socket.emit('error', { message: 'Rate limited' });
        if (typeof gameId !== 'string' || gameId.length > 30) return;
        const game = this.gameManager.games.get(gameId);
        if (!game) {
          socket.emit('error', { message: 'Game not found' });
          return;
        }

        socket.join(`game:${gameId}`);
        if (!this.spectatorRooms.has(gameId)) {
          this.spectatorRooms.set(gameId, new Set());
        }
        this.spectatorRooms.get(gameId).add(socket.id);

        // Send initial state
        socket.emit('gameState', this._enrichSnapshot(this.gameManager.getGameSnapshot(game)));
        
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
        if (checkRateLimit()) return socket.emit('error', { message: 'Rate limited' });
        const allGames = this.gameManager.getAllGames();
        // Get user guild IDs from socket handshake session if available
        const userGuildIds = this._getSocketUserGuildIds(socket);
        const filtered = userGuildIds.length > 0
          ? allGames.filter(g => userGuildIds.includes(g.guildId))
          : allGames; // If no auth info, show all (public dashboard)
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

      // Broadcast to spectators of this game
      this.io.to(`game:${gameId}`).emit('gameEvent', data);

      // Broadcast to guild dashboard room
      if (guildId) {
        this.io.to(`guild:${guildId}`).emit('gameEvent', data);
      }

      // Broadcast globally — scoped to guild room instead of all sockets
      if (guildId) {
        this.io.to(`guild:${guildId}`).emit('globalEvent', { event, gameId, guildId, timestamp: data.timestamp });
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

      // Clean up spectator room on game end
      if (event === 'gameEnded') {
        setTimeout(() => {
          this.spectatorRooms.delete(gameId);
        }, 60000); // Keep room for 1 minute after end
      }
    });
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
