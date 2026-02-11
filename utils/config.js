const logger = require('./logger').app;
const path = require('path');

/**
 * Gestionnaire de configuration centralisée
 * Stocke les paramètres dans SQLite (table config)
 */
class ConfigManager {
  constructor() {
    this.db = null;
    this.cache = new Map();
    this.initialized = false;
  }

  /**
   * Initialise le gestionnaire de configuration
   */
  initialize(database) {
    if (this.initialized) {
      logger.warn('ConfigManager already initialized');
      return;
    }

    this.db = database;
    this.loadAll();
    this.initialized = true;
    logger.success('ConfigManager initialized', { cachedKeys: this.cache.size });
  }

  /**
   * Charge toutes les configurations depuis la DB
   */
  loadAll() {
    if (!this.db) {
      logger.error('Database not initialized');
      return;
    }

    try {
      const stmt = this.db.prepare('SELECT key, value FROM config');
      const rows = stmt.all();

      this.cache.clear();
      for (const row of rows) {
        try {
          // Ne pas parser les snowflakes Discord (grands nombres) en JSON
          // car JSON.parse les convertit en Number et perd la précision
          if (/^\d{17,20}$/.test(row.value)) {
            this.cache.set(row.key, row.value);
          } else {
            this.cache.set(row.key, JSON.parse(row.value));
          }
        } catch {
          // Sinon garder comme string
          this.cache.set(row.key, row.value);
        }
      }

      logger.debug('Configuration loaded', { count: this.cache.size });
    } catch (error) {
      logger.error('Failed to load configuration', { error: error.message });
    }
  }

  /**
   * Récupère une valeur de configuration
   */
  get(key, defaultValue = null) {
    if (!this.initialized) {
      logger.warn('ConfigManager not initialized, returning default', { key });
      return defaultValue;
    }

    const value = this.cache.get(key);
    return value !== undefined ? value : defaultValue;
  }

  /**
   * Définit une valeur de configuration
   */
  set(key, value) {
    if (!this.initialized || !this.db) {
      logger.error('ConfigManager not initialized');
      return false;
    }

    try {
      const stringValue = typeof value === 'object' 
        ? JSON.stringify(value) 
        : String(value);

      const stmt = this.db.prepare(`
        INSERT INTO config (key, value, updated_at)
        VALUES (?, ?, strftime('%s', 'now'))
        ON CONFLICT(key) DO UPDATE SET
          value = excluded.value,
          updated_at = excluded.updated_at
      `);

      stmt.run(key, stringValue);
      this.cache.set(key, value);

      logger.info('Configuration updated', { key });
      return true;
    } catch (error) {
      logger.error('Failed to set configuration', { key, error: error.message });
      return false;
    }
  }

  /**
   * Supprime une configuration
   */
  delete(key) {
    if (!this.initialized || !this.db) {
      logger.error('ConfigManager not initialized');
      return false;
    }

    try {
      const stmt = this.db.prepare('DELETE FROM config WHERE key = ?');
      stmt.run(key);
      this.cache.delete(key);

      logger.info('Configuration deleted', { key });
      return true;
    } catch (error) {
      logger.error('Failed to delete configuration', { key, error: error.message });
      return false;
    }
  }

  /**
   * Vérifie si une clé existe
   */
  has(key) {
    return this.cache.has(key);
  }

  /**
   * Récupère toutes les configurations
   */
  getAll() {
    return Object.fromEntries(this.cache);
  }

  /**
   * Récupère les clés de configuration
   */
  keys() {
    return Array.from(this.cache.keys());
  }

  /**
   * Réinitialise le cache
   */
  reload() {
    this.loadAll();
  }

  // ==================== Clés de configuration prédéfinies ====================

  /**
   * ID de la catégorie Discord où créer les channels
   */
  getCategoryId() {
    return this.get('discord.category_id', null);
  }

  setCategoryId(categoryId) {
    return this.set('discord.category_id', categoryId);
  }

  /**
   * URL du webhook Discord pour les alertes monitoring
   */
  getMonitoringWebhookUrl() {
    return this.get('monitoring.webhook_url', process.env.MONITORING_WEBHOOK_URL || null);
  }

  setMonitoringWebhookUrl(url) {
    return this.set('monitoring.webhook_url', url);
  }

  /**
   * Règles par défaut des parties
   */
  getDefaultGameRules() {
    return this.get('game.default_rules', {
      minPlayers: 5,
      maxPlayers: 10,
      disableVoiceMute: false
    });
  }

  setDefaultGameRules(rules) {
    return this.set('game.default_rules', rules);
  }

  /**
   * Configuration des rôles activés
   */
  getEnabledRoles() {
    return this.get('game.enabled_roles', [
      'Loup-Garou',
      'Voyante',
      'Sorcière',
      'Chasseur',
      'Petite Fille',
      'Cupidon',
      'Villageois'
    ]);
  }

  setEnabledRoles(roles) {
    return this.set('game.enabled_roles', roles);
  }

  /**
   * Durée du timeout des lobbys (en ms)
   */
  getLobbyTimeout() {
    return this.get('game.lobby_timeout', 3600000); // 1h par défaut
  }

  setLobbyTimeout(timeout) {
    return this.set('game.lobby_timeout', timeout);
  }

  /**
   * Intervalle de collecte des métriques (en ms)
   */
  getMetricsInterval() {
    return this.get('monitoring.metrics_interval', 60000); // 60s par défaut
  }

  setMetricsInterval(interval) {
    return this.set('monitoring.metrics_interval', interval);
  }

  /**
   * Alertes monitoring activées
   */
  isMonitoringAlertsEnabled() {
    return this.get('monitoring.alerts_enabled', true);
  }

  setMonitoringAlertsEnabled(enabled) {
    return this.set('monitoring.alerts_enabled', enabled);
  }

  /**
   * Emoji personnalisés
   */
  getEmojis() {
    return this.get('discord.emojis', {
      wolf: '🐺',
      villager: '👨',
      seer: '🔮',
      witch: '🧙',
      hunter: '🎯',
      cupid: '💘',
      littleGirl: '👧'
    });
  }

  setEmojis(emojis) {
    return this.set('discord.emojis', emojis);
  }

  // ==================== Validation du setup ====================

  /**
   * Vérifie si le setup initial est complet
   */
  isSetupComplete() {
    const requiredKeys = [
      'discord.category_id'
    ];

    for (const key of requiredKeys) {
      if (!this.has(key) || !this.get(key)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Récupère les clés manquantes pour le setup
   */
  getMissingSetupKeys() {
    const required = {
      'discord.category_id': 'ID de la catégorie Discord'
    };

    const missing = [];
    for (const [key, description] of Object.entries(required)) {
      if (!this.has(key) || !this.get(key)) {
        missing.push({ key, description });
      }
    }

    return missing;
  }

  /**
   * Récupère un résumé de la configuration
   */
  getSummary() {
    return {
      setupComplete: this.isSetupComplete(),
      discord: {
        categoryId: this.getCategoryId(),
        emojis: Object.keys(this.getEmojis()).length
      },
      monitoring: {
        webhookUrl: this.getMonitoringWebhookUrl() ? '✓ Configuré' : '✗ Non configuré',
        alertsEnabled: this.isMonitoringAlertsEnabled(),
        metricsInterval: `${this.getMetricsInterval() / 1000}s`
      },
      game: {
        defaultRules: this.getDefaultGameRules(),
        enabledRoles: this.getEnabledRoles().length,
        lobbyTimeout: `${this.getLobbyTimeout() / 60000}min`
      },
      totalKeys: this.cache.size
    };
  }
}

// Export singleton
let instance = null;

module.exports = {
  initialize: (database) => {
    if (!instance) {
      instance = new ConfigManager();
    }
    instance.initialize(database);
    return instance;
  },

  getInstance: () => {
    if (!instance) {
      instance = new ConfigManager();
    }
    return instance;
  }
};
