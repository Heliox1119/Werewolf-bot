const logger = require('./logger').app;
const path = require('path');
const { t } = require('./i18n');

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
      logger.warn('CONFIG_ALREADY_INITIALIZED');
      return;
    }

    this.db = database;
    this.loadAll();
    this.initialized = true;
    logger.info('CONFIG_INITIALIZED', { cachedKeys: this.cache.size });
  }

  /**
   * Charge toutes les configurations depuis la DB
   */
  loadAll() {
    if (!this.db) {
      logger.error('CONFIG_DB_NOT_INITIALIZED');
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

      logger.debug('CONFIG_LOADED', { count: this.cache.size });
    } catch (error) {
      logger.error('CONFIG_LOAD_FAILED', { error: error.message });
    }
  }

  /**
   * Récupère une valeur de configuration
   */
  get(key, defaultValue = null) {
    if (!this.initialized) {
      logger.warn('CONFIG_NOT_INITIALIZED', { key });
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
      logger.error('CONFIG_NOT_INITIALIZED');
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

      logger.info('CONFIG_KEY_UPDATED', { key });
      return true;
    } catch (error) {
      logger.error('CONFIG_SET_FAILED', { key, error: error.message });
      return false;
    }
  }

  /**
   * Supprime une configuration
   */
  delete(key) {
    if (!this.initialized || !this.db) {
      logger.error('CONFIG_NOT_INITIALIZED');
      return false;
    }

    try {
      const stmt = this.db.prepare('DELETE FROM config WHERE key = ?');
      stmt.run(key);
      this.cache.delete(key);

      logger.info('CONFIG_KEY_DELETED', { key });
      return true;
    } catch (error) {
      logger.error('CONFIG_DELETE_FAILED', { key, error: error.message });
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

  // ==================== Guild-scoped configuration ====================

  /**
   * Get a guild-scoped config value, with fallback to global
   * @param {string} guildId - Discord guild ID
   * @param {string} key - Config key
   * @param {*} defaultValue - Default if not found
   */
  getForGuild(guildId, key, defaultValue = null) {
    if (guildId) {
      const guildKey = `guild.${guildId}.${key}`;
      const guildValue = this.get(guildKey);
      if (guildValue !== null && guildValue !== undefined) {
        return guildValue;
      }
    }
    // Fallback to global config
    return this.get(key, defaultValue);
  }

  /**
   * Set a guild-scoped config value
   * @param {string} guildId - Discord guild ID
   * @param {string} key - Config key
   * @param {*} value - Value to set
   */
  setForGuild(guildId, key, value) {
    const guildKey = `guild.${guildId}.${key}`;
    return this.set(guildKey, value);
  }

  /**
   * Delete a guild-scoped config value
   * @param {string} guildId - Discord guild ID
   * @param {string} key - Config key
   */
  deleteForGuild(guildId, key) {
    const guildKey = `guild.${guildId}.${key}`;
    return this.delete(guildKey);
  }

  // ==================== Clés de configuration prédéfinies ====================

  /**
   * ID de la catégorie Discord où créer les channels
   * @param {string} [guildId] - Guild ID for per-guild config
   */
  getCategoryId(guildId = null) {
    return this.getForGuild(guildId, 'discord.category_id', null);
  }

  setCategoryId(categoryId, guildId = null) {
    if (guildId) {
      return this.setForGuild(guildId, 'discord.category_id', categoryId);
    }
    return this.set('discord.category_id', categoryId);
  }

  /**
   * Condition de victoire des loups (per-guild with global fallback)
   * @param {string} [guildId] - Guild ID for per-guild config
   * @returns {'majority'|'elimination'}
   */
  getWolfWinCondition(guildId = null) {
    return this.getForGuild(guildId, 'game.wolf_win_condition', 'majority');
  }

  setWolfWinCondition(condition, guildId = null) {
    if (guildId) {
      return this.setForGuild(guildId, 'game.wolf_win_condition', condition);
    }
    return this.set('game.wolf_win_condition', condition);
  }

  /**
   * URL du webhook Discord pour les alertes monitoring
   * @param {string} [guildId] - Guild ID for per-guild config
   */
  getMonitoringWebhookUrl(guildId = null) {
    return this.getForGuild(guildId, 'monitoring.webhook_url', process.env.MONITORING_WEBHOOK_URL || null);
  }

  setMonitoringWebhookUrl(url, guildId = null) {
    if (guildId) {
      return this.setForGuild(guildId, 'monitoring.webhook_url', url);
    }
    return this.set('monitoring.webhook_url', url);
  }

  /**
   * Règles par défaut des parties
   * @param {string} [guildId] - Guild ID for per-guild config
   */
  getDefaultGameRules(guildId = null) {
    return this.getForGuild(guildId, 'game.default_rules', {
      minPlayers: 5,
      maxPlayers: 10,
      disableVoiceMute: false
    });
  }

  setDefaultGameRules(rules, guildId = null) {
    if (guildId) {
      return this.setForGuild(guildId, 'game.default_rules', rules);
    }
    return this.set('game.default_rules', rules);
  }

  /**
   * Configuration des rôles activés
   * @param {string} [guildId] - Guild ID for per-guild config
   */
  getEnabledRoles(guildId = null) {
    return this.getForGuild(guildId, 'game.enabled_roles', [
      'Loup-Garou',
      'Voyante',
      'Sorcière',
      'Chasseur',
      'Petite Fille',
      'Cupidon',
      'Villageois'
    ]);
  }

  setEnabledRoles(roles, guildId = null) {
    if (guildId) {
      return this.setForGuild(guildId, 'game.enabled_roles', roles);
    }
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
   * Vérifie si le setup initial est complet (global ou per-guild)
   * @param {string} [guildId] - Guild ID
   */
  isSetupComplete(guildId = null) {
    if (guildId) {
      // Only check guild-scoped key — do NOT fall back to global
      const guildKey = `guild.${guildId}.discord.category_id`;
      return !!this.get(guildKey);
    }
    // Global fallback (no guild specified)
    return !!this.get('discord.category_id');
  }

  /**
   * Récupère les clés manquantes pour le setup
   * @param {string} [guildId] - Guild ID
   */
  getMissingSetupKeys(guildId = null) {
    const missing = [];
    if (guildId) {
      // Only check guild-scoped key
      const guildKey = `guild.${guildId}.discord.category_id`;
      if (!this.get(guildKey)) {
        missing.push({ key: 'discord.category_id', description: t('cmd.setup.config_category_desc') });
      }
    } else {
      if (!this.getCategoryId()) {
        missing.push({ key: 'discord.category_id', description: t('cmd.setup.config_category_desc') });
      }
    }
    return missing;
  }

  /**
   * Récupère un résumé de la configuration
   * @param {string} [guildId] - Guild ID for per-guild config
   */
  getSummary(guildId = null) {
    // For guild-specific summary, use guild-only category (no global fallback)
    const categoryId = guildId
      ? this.get(`guild.${guildId}.discord.category_id`)
      : this.getCategoryId();
    return {
      setupComplete: this.isSetupComplete(guildId),
      discord: {
        categoryId: categoryId || null,
        emojis: Object.keys(this.getEmojis()).length
      },
      monitoring: {
        webhookUrl: this.getMonitoringWebhookUrl(guildId) ? t('cmd.setup.configured') : t('cmd.setup.not_configured'),
        alertsEnabled: this.isMonitoringAlertsEnabled(),
        metricsInterval: `${this.getMetricsInterval() / 1000}s`
      },
      game: {
        defaultRules: this.getDefaultGameRules(guildId),
        enabledRoles: this.getEnabledRoles(guildId).length,
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
