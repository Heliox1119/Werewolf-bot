const { app: logger } = require('../utils/logger');
const { t } = require('../utils/i18n');
const { getSeverityColor } = require('../utils/theme');
const { EmbedBuilder, WebhookClient } = require('discord.js');

/**
 * Système d'alertes pour le monitoring
 * Envoie des notifications via webhook Discord pour les événements critiques
 */
class AlertSystem {
  constructor(webhookUrl = null) {
    this.webhookUrl = webhookUrl;
    this.webhook = null;
    this.enabled = false;
    
    // Règles d'alertes
    this.rules = {
      highMemory: { threshold: 85, cooldown: 300000, lastAlert: 0 }, // 5min cooldown
      highLatency: { threshold: 500, cooldown: 300000, lastAlert: 0 },
      highErrorRate: { threshold: 15, cooldown: 600000, lastAlert: 0 }, // 10min cooldown
      criticalError: { cooldown: 60000, lastAlert: 0 }, // 1min cooldown
      botDisconnected: { cooldown: 60000, lastAlert: 0 },
      rateLimitAbuse: { threshold: 10, cooldown: 300000, lastAlert: 0 }
    };
    
    // Compteur d'alertes
    this.alertCounts = {
      total: 0,
      byType: {}
    };
    
    this.initializeWebhook();
  }

  /**
   * Initialise le client webhook Discord
   */
  initializeWebhook() {
    if (!this.webhookUrl) {
      logger.warn('No webhook URL configured, alerts disabled');
      return;
    }
    
    try {
      this.webhook = new WebhookClient({ url: this.webhookUrl });
      this.enabled = true;
      logger.success('Alert system initialized with webhook');
    } catch (error) {
      logger.error('Failed to initialize webhook', { error: error.message });
      this.enabled = false;
    }
  }

  /**
   * Vérifie si une alerte peut être envoyée (cooldown)
   */
  canSendAlert(alertType) {
    const rule = this.rules[alertType];
    if (!rule) return true;
    
    const now = Date.now();
    if (now - rule.lastAlert < rule.cooldown) {
      logger.debug('Alert on cooldown', { alertType, remaining: rule.cooldown - (now - rule.lastAlert) });
      return false;
    }
    
    return true;
  }

  /**
   * Marque une alerte comme envoyée
   */
  markAlertSent(alertType) {
    if (this.rules[alertType]) {
      this.rules[alertType].lastAlert = Date.now();
    }
    
    this.alertCounts.total++;
    this.alertCounts.byType[alertType] = (this.alertCounts.byType[alertType] || 0) + 1;
  }

  /**
   * Envoie une alerte générique
   */
  async sendAlert(title, description, severity = 'warning', fields = []) {
    if (!this.enabled) {
      logger.debug('Alerts disabled, skipping', { title });
      return false;
    }
    
    try {
      const embed = new EmbedBuilder()
        .setTitle(`🚨 ${title}`)
        .setDescription(description)
        .setColor(getSeverityColor(null, severity))
        .setTimestamp()
        .setFooter({ text: `Werewolf Bot Alert • ${severity.toUpperCase()}` });
      
      if (fields.length > 0) {
        embed.addFields(fields);
      }
      
      await this.webhook.send({
        embeds: [embed],
        username: 'Werewolf Monitoring'
      });
      
      logger.info('Alert sent', { title, severity });
      return true;
    } catch (error) {
      logger.error('Failed to send alert', { title, error: error.message });
      return false;
    }
  }

  /**
   * Alerte : Mémoire élevée
   */
  async alertHighMemory(memoryPercentage, memoryUsed, memoryTotal) {
    const alertType = 'highMemory';
    if (!this.canSendAlert(alertType)) return false;
    
    const sent = await this.sendAlert(
      t('alerts.memory_title'),
      t('alerts.memory_desc'),
      'warning',
      [
        { name: '💾 Utilisation', value: `${memoryPercentage}%`, inline: true },
        { name: t('alerts.details'), value: `${memoryUsed}MB / ${memoryTotal}MB`, inline: true },
        { name: '⚠️ Seuil', value: `${this.rules.highMemory.threshold}%`, inline: true }
      ]
    );
    
    if (sent) this.markAlertSent(alertType);
    return sent;
  }

  /**
   * Alerte : Latence élevée
   */
  async alertHighLatency(latency) {
    const alertType = 'highLatency';
    if (!this.canSendAlert(alertType)) return false;
    
    const sent = await this.sendAlert(
      t('alerts.latency_title'),
      t('alerts.latency_desc'),
      'warning',
      [
        { name: t('alerts.latency_current'), value: `${latency}ms`, inline: true },
        { name: '⚠️ Seuil', value: `${this.rules.highLatency.threshold}ms`, inline: true },
        { name: t('alerts.latency_impact'), value: t('alerts.commands_slowed'), inline: true }
      ]
    );
    
    if (sent) this.markAlertSent(alertType);
    return sent;
  }

  /**
   * Alerte : Taux d'erreur élevé
   */
  async alertHighErrorRate(errorRate, totalCommands, errorCount) {
    const alertType = 'highErrorRate';
    if (!this.canSendAlert(alertType)) return false;
    
    const sent = await this.sendAlert(
      t('alerts.error_rate_title'),
      t('alerts.error_rate_desc'),
      'error',
      [
        { name: t('alerts.error_rate_field'), value: `${errorRate.toFixed(1)}%`, inline: true },
        { name: t('alerts.errors_field'), value: `${errorCount}/${totalCommands}`, inline: true },
        { name: '⚠️ Seuil', value: `${this.rules.highErrorRate.threshold}%`, inline: true }
      ]
    );
    
    if (sent) this.markAlertSent(alertType);
    return sent;
  }

  /**
   * Alerte : Erreur critique
   */
  async alertCriticalError(error, context = {}) {
    const alertType = 'criticalError';
    if (!this.canSendAlert(alertType)) return false;
    
    const fields = [
      { name: t('alerts.error_field'), value: error.message || 'Unknown error', inline: false }
    ];
    
    if (error.stack) {
      const stackLines = error.stack.split('\n').slice(0, 3).join('\n');
      fields.push({ name: '📋 Stack trace', value: `\`\`\`${stackLines}\`\`\``, inline: false });
    }
    
    if (Object.keys(context).length > 0) {
      fields.push({ 
        name: t('alerts.context_field'), 
        value: `\`\`\`json\n${JSON.stringify(context, null, 2).slice(0, 500)}\`\`\``, 
        inline: false 
      });
    }
    
    const sent = await this.sendAlert(
      t('alerts.critical_title'),
      t('alerts.critical_desc'),
      'critical',
      fields
    );
    
    if (sent) this.markAlertSent(alertType);
    return sent;
  }

  /**
   * Alerte : Bot déconnecté
   */
  async alertBotDisconnected(reason = 'Unknown') {
    const alertType = 'botDisconnected';
    if (!this.canSendAlert(alertType)) return false;
    
    const sent = await this.sendAlert(
      t('alerts.disconnect_title'),
      t('alerts.disconnect_desc'),
      'critical',
      [
        { name: t('alerts.reason_field'), value: reason, inline: true },
        { name: t('alerts.time_field'), value: new Date().toLocaleString('fr-FR'), inline: true },
        { name: t('alerts.action_field'), value: t('alerts.auto_reconnect'), inline: true }
      ]
    );
    
    if (sent) this.markAlertSent(alertType);
    return sent;
  }

  /**
   * Alerte : Abus de rate limiting
   */
  async alertRateLimitAbuse(userId, commandName, violations) {
    const alertType = 'rateLimitAbuse';
    if (!this.canSendAlert(alertType)) return false;
    
    const sent = await this.sendAlert(
      t('alerts.ratelimit_title'),
      t('alerts.ratelimit_desc'),
      'warning',
      [
        { name: t('alerts.user_field'), value: `<@${userId}>`, inline: true },
        { name: t('alerts.command_field'), value: commandName, inline: true },
        { name: '⚠️ Violations', value: violations.toString(), inline: true },
        { name: t('alerts.action_applied'), value: t('alerts.temp_ban_applied'), inline: false }
      ]
    );
    
    if (sent) this.markAlertSent(alertType);
    return sent;
  }

  /**
   * Alerte : Bot redémarré
   */
  async alertBotStarted(version, uptime) {
    const sent = await this.sendAlert(
      t('alerts.startup_title'),
      t('alerts.startup_desc'),
      'info',
      [
        { name: '📦 Version', value: version, inline: true },
        { name: t('alerts.previous_uptime'), value: uptime || 'N/A', inline: true },
        { name: t('alerts.status_field'), value: t('alerts.online'), inline: true }
      ]
    );
    
    return sent;
  }

  /**
   * Alerte : Statistiques quotidiennes
   */
  async sendDailySummary(metrics) {
    const sent = await this.sendAlert(
      t('alerts.daily_title'),
      t('alerts.daily_desc'),
      'info',
      [
        { name: t('alerts.games_field'), value: t('alerts.games_value', { created: metrics.game.gamesCreated24h, finished: metrics.game.gamesCompleted24h }), inline: false },
        { name: t('alerts.commands_field'), value: `${metrics.commands.total} (${metrics.commands.errors} erreurs)`, inline: true },
        { name: t('alerts.errors_label'), value: metrics.errors.last24h.toString(), inline: true },
        { name: t('alerts.ratelimits_field'), value: metrics.commands.rateLimited.toString(), inline: true },
        { name: t('alerts.avg_latency'), value: `${metrics.discord.latency}ms`, inline: true },
        { name: t('alerts.avg_memory'), value: `${metrics.system.memory.percentage}%`, inline: true },
        { name: t('alerts.uptime_field'), value: this.formatUptime(metrics.system.uptime), inline: true }
      ]
    );
    
    return sent;
  }

  /**
   * Vérifie les métriques et envoie des alertes si nécessaire
   */
  async checkMetrics(metrics) {
    const alerts = [];
    
    // Vérifier mémoire
    if (metrics.system.memory.percentage > this.rules.highMemory.threshold) {
      const sent = await this.alertHighMemory(
        metrics.system.memory.percentage,
        metrics.system.memory.used,
        metrics.system.memory.total
      );
      if (sent) alerts.push('highMemory');
    }
    
    // Vérifier latence
    if (metrics.discord.latency > this.rules.highLatency.threshold) {
      const sent = await this.alertHighLatency(metrics.discord.latency);
      if (sent) alerts.push('highLatency');
    }
    
    // Vérifier taux d'erreur
    if (metrics.commands.total > 50) { // Minimum 50 commandes pour calculer le taux
      const errorRate = (metrics.commands.errors / metrics.commands.total) * 100;
      if (errorRate > this.rules.highErrorRate.threshold) {
        const sent = await this.alertHighErrorRate(
          errorRate,
          metrics.commands.total,
          metrics.commands.errors
        );
        if (sent) alerts.push('highErrorRate');
      }
    }
    
    return alerts;
  }

  /**
   * Formate l'uptime
   */
  formatUptime(seconds) {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    
    if (days > 0) {
      return `${days}j ${hours}h`;
    } else if (hours > 0) {
      return `${hours}h ${minutes}m`;
    } else {
      return `${minutes}m`;
    }
  }

  /**
   * Récupère les statistiques des alertes
   */
  getAlertStats() {
    return {
      total: this.alertCounts.total,
      byType: { ...this.alertCounts.byType }
    };
  }

  /**
   * Réinitialise les compteurs d'alertes
   */
  resetCounters() {
    this.alertCounts = {
      total: 0,
      byType: {}
    };
    logger.info('Alert counters reset');
  }

  /**
   * Active ou désactive le système d'alertes
   */
  setEnabled(enabled) {
    this.enabled = enabled && this.webhook !== null;
    logger.info(`Alert system ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Met à jour l'URL du webhook
   */
  setWebhookUrl(webhookUrl) {
    this.webhookUrl = webhookUrl;
    this.initializeWebhook();
  }
}

// Export singleton
let instance = null;

module.exports = {
  initialize: (webhookUrl) => {
    if (!instance) {
      instance = new AlertSystem(webhookUrl);
    }
    return instance;
  },
  
  getInstance: () => {
    if (!instance) {
      // Créer une instance sans webhook si pas encore initialisé
      instance = new AlertSystem();
    }
    return instance;
  }
};
