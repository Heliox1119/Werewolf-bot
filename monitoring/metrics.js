const logger = require('../utils/logger');
const os = require('os');

/**
 * Collecteur de métriques pour le monitoring du bot
 * Collecte les métriques système, Discord, et jeu
 */
class MetricsCollector {
  constructor(client) {
    this.client = client;
    this.startTime = Date.now();
    this.metrics = {
      // Métriques système
      system: {
        memory: { used: 0, total: 0, percentage: 0 },
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
        gamesCompleted24h: 0
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
    
    logger.info('MetricsCollector initialized');
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
    logger.info('Metrics collection stopped');
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
   */
  collectSystemMetrics() {
    const used = process.memoryUsage();
    const total = os.totalmem();
    
    this.metrics.system = {
      memory: {
        used: Math.round(used.heapUsed / 1024 / 1024), // MB
        total: Math.round(total / 1024 / 1024), // MB
        percentage: Math.round((used.heapUsed / used.heapTotal) * 100)
      },
      cpu: {
        usage: Math.round(process.cpuUsage().user / 1000000) // Approximation
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
   */
  collectGameMetrics() {
    try {
      const gameManager = require('../game/gameManager');
      const games = gameManager.getAllGames();
      
      let totalPlayers = 0;
      games.forEach(game => {
        totalPlayers += game.players.length;
      });
      
      this.metrics.game = {
        activeGames: games.length,
        totalPlayers,
        gamesCreated24h: this.metrics.game.gamesCreated24h || 0,
        gamesCompleted24h: this.metrics.game.gamesCompleted24h || 0
      };
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
    }
    
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
    logger.debug('Rate limit recorded', { userId, commandName });
  }

  /**
   * Enregistre une erreur
   */
  recordError(level = 'error') {
    this.errorCounts.total++;
    this.metrics.errors.total++;
    this.metrics.errors.last24h++;
    
    if (level === 'error' || level === 'critical') {
      this.errorCounts.critical++;
      this.metrics.errors.critical++;
    } else if (level === 'warn') {
      this.errorCounts.warnings++;
      this.metrics.errors.warnings++;
    }
    
    logger.debug('Error recorded', { level, total: this.metrics.errors.total });
  }

  /**
   * Enregistre la création d'une partie
   */
  recordGameCreated() {
    this.metrics.game.gamesCreated24h++;
    logger.debug('Game creation recorded');
  }

  /**
   * Enregistre la fin d'une partie
   */
  recordGameCompleted() {
    this.metrics.game.gamesCompleted24h++;
    logger.debug('Game completion recorded');
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
    
    // Reset compteur 24h
    this.metrics.errors.last24h = 0;
    this.metrics.game.gamesCreated24h = 0;
    this.metrics.game.gamesCompleted24h = 0;
    
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
    return {
      status: this.getHealthStatus(),
      uptime: this.getFormattedUptime(),
      memory: `${this.metrics.system.memory.used}MB / ${this.metrics.system.memory.total}MB (${this.metrics.system.memory.percentage}%)`,
      latency: `${this.metrics.discord.latency}ms`,
      guilds: this.metrics.discord.guilds,
      activeGames: this.metrics.game.activeGames,
      commands: `${this.metrics.commands.total} (${this.metrics.commands.errors} errors)`,
      errors: `${this.metrics.errors.total} total (${this.metrics.errors.critical} critical)`
    };
  }

  /**
   * Détermine le statut de santé général
   */
  getHealthStatus() {
    const issues = [];
    
    // Vérifier la mémoire
    if (this.metrics.system.memory.percentage > 90) {
      issues.push('HIGH_MEMORY');
    }
    
    // Vérifier la latence Discord
    if (this.metrics.discord.latency > 500) {
      issues.push('HIGH_LATENCY');
    }
    
    // Vérifier le taux d'erreur
    const errorRate = this.metrics.commands.total > 0 
      ? (this.metrics.commands.errors / this.metrics.commands.total) * 100 
      : 0;
    if (errorRate > 10) {
      issues.push('HIGH_ERROR_RATE');
    }
    
    // Vérifier le statut WebSocket
    if (this.metrics.discord.wsStatus !== 0 && this.metrics.discord.wsStatus !== 'READY') {
      issues.push('WS_NOT_READY');
    }
    
    if (issues.length === 0) {
      return { status: 'HEALTHY', issues: [] };
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
