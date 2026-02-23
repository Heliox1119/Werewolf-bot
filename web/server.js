/**
 * Werewolf Bot — Web Dashboard Server v3.0.0
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
    this.io = new SocketIO(this.server, {
      cors: { origin: '*', methods: ['GET', 'POST'] }
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
          styleSrc: ["'self'", "'unsafe-inline'", "fonts.googleapis.com", "cdn.jsdelivr.net"],
          fontSrc: ["'self'", "fonts.gstatic.com", "cdn.jsdelivr.net"],
          imgSrc: ["'self'", "cdn.discordapp.com", "i.ibb.co", "data:"],
          connectSrc: ["'self'", "ws:", "wss:"]
        }
      }
    }));
    this.app.use(cors());
    this.app.use(cookieParser());
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));

    // Session
    this.app.use(session({
      secret: process.env.SESSION_SECRET || 'werewolf-dashboard-secret-' + Date.now(),
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

  _setupSocketIO() {
    this.io.on('connection', (socket) => {
      // Join a game spectator room
      socket.on('spectate', (gameId) => {
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
        socket.emit('gameState', this.gameManager.getGameSnapshot(game));
        
        // Notify spectator count
        this.io.to(`game:${gameId}`).emit('spectatorCount', { gameId, count: this.spectatorRooms.get(gameId).size });
      });

      // Leave spectator room
      socket.on('leaveSpectate', (gameId) => {
        socket.leave(`game:${gameId}`);
        if (this.spectatorRooms.has(gameId)) {
          this.spectatorRooms.get(gameId).delete(socket.id);
          this.io.to(`game:${gameId}`).emit('spectatorCount', { gameId, count: this.spectatorRooms.get(gameId).size });
        }
      });

      // Request all active games (for dashboard)
      socket.on('requestGames', () => {
        const games = this.gameManager.getAllGames().map(g => this.gameManager.getGameSnapshot(g));
        socket.emit('activeGames', games);
      });

      socket.on('disconnect', () => {
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

      // Broadcast to guild dashboard
      this.io.to(`guild:${guildId}`).emit('gameEvent', data);

      // Broadcast to global dashboard
      this.io.emit('globalEvent', data);

      // On full state events, send updated snapshot
      if (['gameStarted', 'phaseChanged', 'playerKilled', 'gameEnded'].includes(event)) {
        const game = this.gameManager.games.get(gameId);
        if (game) {
          this.io.to(`game:${gameId}`).emit('gameState', this.gameManager.getGameSnapshot(game));
        }
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
   * Check if a user has admin access to a guild.
   */
  isGuildAdmin(user, guildId) {
    if (!user || !user.guilds) return false;
    const guild = user.guilds.find(g => g.id === guildId);
    if (!guild) return false;
    // Check for Administrator permission (0x8) or Manage Server (0x20)
    return (parseInt(guild.permissions) & 0x28) !== 0;
  }
}

module.exports = WebServer;
