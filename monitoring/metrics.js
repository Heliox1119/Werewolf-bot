const { app: logger } = require('../utils/logger');
const os = require('os');

/**
 * Collecteur de métriques pour le monitoring du bot
 * Collecte les métriques système, Discord, et jeu
 */
class MetricsCollector {
  constructor(client) {
    this.client = client;
    this.startTime = Date.now();
    
    // Seuils mémoire en MB (basé sur RSS, pas le heap)
    this.memoryThresholds = {
      warn: 200,    // 200MB → DEGRADED
      critical: 500 // 500MB → UNHEALTHY
    };
    
    this.metrics = {
      // Métriques système
      system: {
        memory: {
          rss: 0,           // Mémoire réelle du process (MB)
          heapUsed: 0,      // Heap V8 utilisé (MB)
          heapTotal: 0,     // Heap V8 alloué (MB)
          external: 0,      // Mémoire C++ externe (MB)
          systemTotal: 0,   // RAM système totale (MB)
          systemFree: 0,    // RAM système libre (MB)
          percentage: 0     // RSS / RAM système (%)
        },
        cpu: { usage: 0 },
        uptime: 0
      },
      
      // Métriques Discord
      discord: {
        guilds: 0,
        users: 0,
        channels: 0,
        latency: 0,
        wsStatus: 'UNKNOWN'
      },
      
      // Métriques du jeu
      game: {
        activeGames: 0,
        totalPlayers: 0,
        gamesCreated24h: 0,
        gamesCompleted24h: 0,
        stuck_games_count: 0
      },
      
      // Métriques des commandes
      commands: {
        total: 0,
        errors: 0,
        rateLimited: 0,
        avgResponseTime: 0
      },
      
      // Métriques des erreurs
      errors: {
        total: 0,
        critical: 0,
        warnings: 0,
        last24h: 0
      }
    };
    
    // Compteurs pour les moyennes
    this.commandResponseTimes = [];
    this.errorCounts = { total: 0, critical: 0, warnings: 0 };
    
    // Historique pour graphes (dernières 24h, 1 point par heure)
    this.history = {
      timestamps: [],
      memory: [],
      cpu: [],
      latency: [],
      activeGames: [],
      errors: []
    };
    
    // Charger les compteurs persistants depuis la DB
    this._loadPersistentCounters();
    
    logger.info('MetricsCollector initialized');
  }

  /**
   * Charge les compteurs sauvegardés depuis la DB (survie au restart)
   */
  _loadPersistentCounters() {
    try {
      const gameManager = require('../game/gameManager');
      if (!gameManager || !gameManager.db) return;
      const db = gameManager.db;
      
      this.metrics.commands.total = db.getCounter('metrics.commands.total');
      this.metrics.commands.errors = db.getCounter('metrics.commands.errors');
      this.metrics.commands.rateLimited = db.getCounter('metrics.commands.rateLimited');
      this.metrics.errors.total = db.getCounter('metrics.errors.total');
      this.metrics.errors.critical = db.getCounter('metrics.errors.critical');
      this.metrics.errors.warnings = db.getCounter('metrics.errors.warnings');
      
      logger.info('Persistent counters loaded from DB', {
        commandsTotal: this.metrics.commands.total,
        errorsTotal: this.metrics.errors.total
      });
    } catch (e) {
      logger.debug('Could not load persistent counters (DB not ready yet)', { error: e.message });
    }
  }

  /**
   * Sauvegarde un compteur dans la DB
   */
  _persistCounter(key, value) {
    try {
      const gameManager = require('../game/gameManager');
      if (!gameManager || !gameManager.db) return;
      gameManager.db.setConfig(key, String(value));
    } catch (e) {
      // Silencieux — la DB peut ne pas être prête
    }
  }

  /**
   * Démarre la collecte périodique des métriques
   */
  startCollection(intervalMs = 60000) {
    logger.info('Starting metrics collection', { intervalMs });
    
    // Collecter immédiatement
    this.collect();
    
    // Puis périodiquement
    this.collectionInterval = setInterval(() => {
      this.collect();
    }, intervalMs);
    
    // Nettoyer l'historique toutes les heures
    this.cleanupInterval = setInterval(() => {
      this.cleanupHistory();
    }, 3600000); // 1 heure

    // L6: Sauvegarder les métriques en DB toutes les heures
    this.snapshotInterval = setInterval(() => {
      this.saveSnapshotToDB();
    }, 3600000);
  }

  /**
   * Arrête la collecte des métriques
   */
  stopCollection() {
    if (this.collectionInterval) {
      clearInterval(this.collectionInterval);
      this.collectionInterval = null;
    }
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    if (this.snapshotInterval) {
      clearInterval(this.snapshotInterval);
      this.snapshotInterval = null;
    }
    logger.info('Metrics collection stopped');
  }

  /**
   * L6: Sauvegarde un snapshot des métriques dans la base de données
   */
  saveSnapshotToDB() {
    try {
      const gameManager = require('../game/gameManager');
      if (!gameManager || !gameManager.db) return;
      const db = gameManager.db;
      this.collect(); // rafraîchir avant sauvegarde
      const m = this.metrics;
      const health = this.getHealthStatus();
      db.insertMetricsSnapshot({
        memory_used: m.system.memory.rss,
        memory_total: m.system.memory.systemTotal,
        memory_percentage: m.system.memory.percentage,
        cpu_usage: m.system.cpu.usage,
        uptime: m.system.uptime,
        guilds: m.discord.guilds,
        users: m.discord.users,
        channels: m.discord.channels,
        latency: m.discord.latency,
        ws_status: String(m.discord.wsStatus),
        active_games: m.game.activeGames,
        total_players: m.game.totalPlayers,
        games_created_24h: m.game.gamesCreated24h,
        games_completed_24h: m.game.gamesCompleted24h,
        commands_total: m.commands.total,
        commands_errors: m.commands.errors,
        commands_rate_limited: m.commands.rateLimited,
        commands_avg_response: m.commands.avgResponseTime,
        errors_total: m.errors.total,
        errors_critical: m.errors.critical,
        errors_warnings: m.errors.warnings,
        errors_last_24h: m.errors.last24h,
        health_status: health.status,
        health_issues: JSON.stringify(health.issues)
      });
      db.cleanupOldMetrics(7);
      logger.debug('Metrics snapshot saved to DB');
    } catch (e) {
      logger.warn('Failed to save metrics snapshot', { error: e.message });
    }
  }

  /**
   * Collecte toutes les métriques
   */
  collect() {
    try {
      this.collectSystemMetrics();
      this.collectDiscordMetrics();
      this.collectGameMetrics();
      this.updateHistory();

      // Auto-check alerts after each collection cycle
      try {
        const alertSystem = require('./alerts');
        if (alertSystem && typeof alertSystem.checkMetrics === 'function') {
          alertSystem.checkMetrics(this.metrics);
        }
      } catch { /* alerts module not available */ }
      
      logger.debug('Metrics collected', {
        memory: this.metrics.system.memory.percentage,
        latency: this.metrics.discord.latency,
        games: this.metrics.game.activeGames
      });
    } catch (error) {
      logger.error('Failed to collect metrics', { error: error.message });
    }
  }

  /**
   * Collecte les métriques système (CPU, RAM, uptime)
   * Utilise RSS (Resident Set Size) = mémoire réelle du process
   * au lieu de heapUsed/heapTotal qui est trompeur (V8 remplit le heap par design)
   */
  collectSystemMetrics() {
    const memUsage = process.memoryUsage();
    const systemTotal = os.totalmem();
    const systemFree = os.freemem();
    
    const rssMB = Math.round(memUsage.rss / 1024 / 1024);
    const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
    const heapTotalMB = Math.round(memUsage.heapTotal / 1024 / 1024);
    const externalMB = Math.round((memUsage.external || 0) / 1024 / 1024);
    const systemTotalMB = Math.round(systemTotal / 1024 / 1024);
    const systemFreeMB = Math.round(systemFree / 1024 / 1024);

    // Calcul CPU en pourcentage via delta entre deux mesures
    const now = Date.now();
    const currentCpuUsage = process.cpuUsage();
    let cpuPercent = 0;
    if (this._prevCpu && this._prevCpuTime) {
      const userDelta = currentCpuUsage.user - this._prevCpu.user;
      const systemDelta = currentCpuUsage.system - this._prevCpu.system;
      const timeDelta = (now - this._prevCpuTime) * 1000; // ms → µs
      if (timeDelta > 0) {
        cpuPercent = Math.min(100, Math.round(((userDelta + systemDelta) / timeDelta) * 100));
      }
    }
    this._prevCpu = currentCpuUsage;
    this._prevCpuTime = now;
    
    this.metrics.system = {
      memory: {
        rss: rssMB,
        heapUsed: heapUsedMB,
        heapTotal: heapTotalMB,
        external: externalMB,
        systemTotal: systemTotalMB,
        systemFree: systemFreeMB,
        percentage: systemTotalMB > 0 ? Math.round((rssMB / systemTotalMB) * 100) : 0
      },
      cpu: {
        usage: cpuPercent
      },
      uptime: Math.floor((Date.now() - this.startTime) / 1000) // secondes
    };
  }

  /**
   * Collecte les métriques Discord (guildes, users, latence)
   */
  collectDiscordMetrics() {
    if (!this.client) return;
    
    this.metrics.discord = {
      guilds: this.client.guilds.cache.size,
      users: this.client.users.cache.size,
      channels: this.client.channels.cache.size,
      latency: this.client.ws.ping,
      wsStatus: this.client.ws.status
    };
  }

  /**
   * Collecte les métriques du jeu (parties actives, joueurs)
   * Les stats 24h sont calculées depuis game_history en DB (persistent)
   */
  collectGameMetrics() {
    try {
      const gameManager = require('../game/gameManager');
      const games = gameManager.getAllGames();
      
      let totalPlayers = 0;
      games.forEach(game => {
        totalPlayers += game.players.length;
      });
      const stuckGamesCount = typeof gameManager.getStuckGamesCount === 'function'
        ? gameManager.getStuckGamesCount()
        : 0;
      
      // Stats 24h depuis la DB (persistent, survit aux restarts)
      let gamesCreated24h = 0;
      let gamesCompleted24h = 0;
      let errorsLast24h = 0;
      if (gameManager.db) {
        gamesCreated24h = gameManager.db.getGamesCreatedSince(24);
        gamesCompleted24h = gameManager.db.getGamesCompletedSince(24);
        errorsLast24h = gameManager.db.getErrorsSince(24);
      }
      
      this.metrics.game = {
        activeGames: games.length,
        totalPlayers,
        gamesCreated24h,
        gamesCompleted24h,
        stuck_games_count: stuckGamesCount
      };
      
      this.metrics.errors.last24h = errorsLast24h;
    } catch (error) {
      // gameManager peut ne pas être disponible au démarrage
      logger.debug('Could not collect game metrics', { error: error.message });
    }
  }

  /**
   * Enregistre l'exécution d'une commande
   */
  recordCommand(commandName, responseTime, success = true) {
    this.metrics.commands.total++;
    
    if (!success) {
      this.metrics.commands.errors++;
      this._persistCounter('metrics.commands.errors', this.metrics.commands.errors);
    }
    
    this._persistCounter('metrics.commands.total', this.metrics.commands.total);
    
    // Moyenne glissante sur les 100 dernières commandes
    this.commandResponseTimes.push(responseTime);
    if (this.commandResponseTimes.length > 100) {
      this.commandResponseTimes.shift();
    }
    
    const sum = this.commandResponseTimes.reduce((a, b) => a + b, 0);
    this.metrics.commands.avgResponseTime = Math.round(sum / this.commandResponseTimes.length);
    
    logger.debug('Command recorded', { commandName, responseTime, success });
  }

  /**
   * Enregistre une commande bloquée par rate limiting
   */
  recordRateLimited(userId, commandName) {
    this.metrics.commands.rateLimited++;
    this._persistCounter('metrics.commands.rateLimited', this.metrics.commands.rateLimited);
    logger.debug('Rate limit recorded', { userId, commandName });
  }

  /**
   * Enregistre une erreur
   */
  recordError(level = 'error') {
    this.errorCounts.total++;
    this.metrics.errors.total++;
    
    if (level === 'error' || level === 'critical') {
      this.errorCounts.critical++;
      this.metrics.errors.critical++;
      this._persistCounter('metrics.errors.critical', this.metrics.errors.critical);
    } else if (level === 'warn') {
      this.errorCounts.warnings++;
      this.metrics.errors.warnings++;
      this._persistCounter('metrics.errors.warnings', this.metrics.errors.warnings);
    }
    
    this._persistCounter('metrics.errors.total', this.metrics.errors.total);
    
    logger.debug('Error recorded', { level, total: this.metrics.errors.total });
  }

  /**
   * Enregistre la création d'une partie (legacy - stats 24h viennent de game_history)
   */
  recordGameCreated() {
    logger.debug('Game creation recorded (computed from DB)');
  }

  /**
   * Enregistre la fin d'une partie (legacy - stats 24h viennent de game_history)
   */
  recordGameCompleted() {
    logger.debug('Game completion recorded (computed from DB)');
  }

  /**
   * Met à jour l'historique des métriques
   */
  updateHistory() {
    const now = Date.now();
    
    this.history.timestamps.push(now);
    this.history.memory.push(this.metrics.system.memory.percentage);
    this.history.cpu.push(this.metrics.system.cpu.usage);
    this.history.latency.push(this.metrics.discord.latency);
    this.history.activeGames.push(this.metrics.game.activeGames);
    this.history.errors.push(this.metrics.errors.last24h);
    
    // Garder max 24 points (1 par heure si collection chaque heure)
    if (this.history.timestamps.length > 24) {
      this.history.timestamps.shift();
      this.history.memory.shift();
      this.history.cpu.shift();
      this.history.latency.shift();
      this.history.activeGames.shift();
      this.history.errors.shift();
    }
  }

  /**
   * Nettoie l'historique ancien
   */
  cleanupHistory() {
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    
    while (this.history.timestamps.length > 0 && this.history.timestamps[0] < oneDayAgo) {
      this.history.timestamps.shift();
      this.history.memory.shift();
      this.history.cpu.shift();
      this.history.latency.shift();
      this.history.activeGames.shift();
      this.history.errors.shift();
    }
    
    // Note: les stats 24h (games, erreurs) sont calculées depuis la DB,
    // pas besoin de reset ici
    
    logger.debug('History cleaned up');
  }

  /**
   * Récupère toutes les métriques actuelles
   */
  getMetrics() {
    return {
      ...this.metrics,
      timestamp: Date.now()
    };
  }

  /**
   * Récupère l'historique des métriques
   */
  getHistory() {
    return { ...this.history };
  }

  /**
   * Formate l'uptime en format lisible
   */
  getFormattedUptime() {
    const seconds = this.metrics.system.uptime;
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    if (days > 0) {
      return `${days}j ${hours}h ${minutes}m`;
    } else if (hours > 0) {
      return `${hours}h ${minutes}m ${secs}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${secs}s`;
    } else {
      return `${secs}s`;
    }
  }

  /**
   * Génère un résumé des métriques
   */
  getSummary() {
    const mem = this.metrics.system.memory;
    return {
      status: this.getHealthStatus(),
      uptime: this.getFormattedUptime(),
      memory: `RSS: ${mem.rss}MB | Heap: ${mem.heapUsed}MB/${mem.heapTotal}MB | System: ${mem.systemFree}MB free / ${mem.systemTotal}MB`,
      latency: `${this.metrics.discord.latency}ms`,
      guilds: this.metrics.discord.guilds,
      activeGames: this.metrics.game.activeGames,
      commands: `${this.metrics.commands.total} (${this.metrics.commands.errors} errors)`,
      errors: `${this.metrics.errors.total} total (${this.metrics.errors.critical} critical)`
    };
  }

  /**
   * Détermine le statut de santé général
   * Utilise des seuils en MB sur le RSS (pas des % du heap)
   */
  getHealthStatus() {
    const issues = [];
    const mem = this.metrics.system.memory;
    
    // Vérifier la mémoire (RSS en MB)
    if (mem.rss > this.memoryThresholds.critical) {
      issues.push(`CRITICAL_MEMORY (${mem.rss}MB > ${this.memoryThresholds.critical}MB)`);
    } else if (mem.rss > this.memoryThresholds.warn) {
      issues.push(`HIGH_MEMORY (${mem.rss}MB > ${this.memoryThresholds.warn}MB)`);
    }
    
    // Vérifier la latence Discord
    if (this.metrics.discord.latency > 500) {
      issues.push(`HIGH_LATENCY (${this.metrics.discord.latency}ms)`);
    }
    
    // Vérifier le taux d'erreur
    const errorRate = this.metrics.commands.total > 0 
      ? (this.metrics.commands.errors / this.metrics.commands.total) * 100 
      : 0;
    if (errorRate > 10) {
      issues.push(`HIGH_ERROR_RATE (${errorRate.toFixed(1)}%)`);
    }
    
    // Vérifier le statut WebSocket
    if (this.metrics.discord.wsStatus !== 0 && this.metrics.discord.wsStatus !== 'READY') {
      issues.push('WS_NOT_READY');
    }
    
    if (issues.length === 0) {
      return { status: 'HEALTHY', issues: [] };
    } else if (issues.some(i => i.startsWith('CRITICAL'))) {
      return { status: 'UNHEALTHY', issues };
    } else if (issues.length <= 2) {
      return { status: 'DEGRADED', issues };
    } else {
      return { status: 'UNHEALTHY', issues };
    }
  }
}

// Export singleton (sera initialisé dans index.js)
let instance = null;

module.exports = {
  initialize: (client) => {
    if (!instance) {
      instance = new MetricsCollector(client);
    }
    return instance;
  },
  
  getInstance: () => {
    if (!instance) {
      throw new Error('MetricsCollector not initialized. Call initialize() first.');
    }
    return instance;
  }
};
