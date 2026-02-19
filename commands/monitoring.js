const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { app: logger } = require('../utils/logger');
const { t } = require('../utils/i18n');
const { getColor, getHealthColor } = require('../utils/theme');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('monitoring')
    .setDescription('📊 Dashboard de monitoring du bot (admin uniquement)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(subcommand =>
      subcommand
        .setName('dashboard')
        .setDescription('Affiche le dashboard complet des métriques')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('health')
        .setDescription('Affiche le statut de santé du bot')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('alerts')
        .setDescription('Gère le système d\'alertes')
        .addStringOption(option =>
          option
            .setName('action')
            .setDescription('Action à effectuer')
            .setRequired(true)
            .addChoices(
              { name: 'Voir les stats', value: 'stats' },
              { name: 'Activer', value: 'enable' },
              { name: 'Désactiver', value: 'disable' }
            )
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('history')
        .setDescription('Affiche l\'historique des métriques (24h)')
    ),

  async execute(interaction) {
    try {
      // Importer les modules de monitoring
      const MetricsCollector = require('../monitoring/metrics');
      const AlertSystem = require('../monitoring/alerts');
      
      const metrics = MetricsCollector.getInstance();
      const alerts = AlertSystem.getInstance();
      
      const subcommand = interaction.options.getSubcommand();
      
      switch (subcommand) {
        case 'dashboard':
          await this.showDashboard(interaction, metrics);
          break;
        case 'health':
          await this.showHealth(interaction, metrics);
          break;
        case 'alerts':
          await this.manageAlerts(interaction, alerts);
          break;
        case 'history':
          await this.showHistory(interaction, metrics);
          break;
        default:
          await interaction.reply({ 
            content: t('cmd.monitoring.unknown_subcommand'), 
            ephemeral: true 
          });
      }
      
      logger.info('Monitoring command executed', {
        subcommand,
        userId: interaction.user.id
      });
      
    } catch (error) {
      logger.error('Error executing monitoring command', {
        error: error.message,
        stack: error.stack
      });
      
      const reply = {
        content: t('cmd.monitoring.error'),
        ephemeral: true
      };
      
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(reply);
      } else {
        await interaction.reply(reply);
      }
    }
  },

  /**
   * Affiche le dashboard complet
   */
  async showDashboard(interaction, metrics) {
    const currentMetrics = metrics.getMetrics();
    const healthStatus = metrics.getHealthStatus();
    
    // Icônes de statut
    const statusIcons = {
      HEALTHY: '🟢',
      DEGRADED: '🟡',
      UNHEALTHY: '🔴'
    };
    
    const embed = new EmbedBuilder()
      .setTitle(t('cmd.monitoring.dashboard.title'))
      .setDescription(t('cmd.monitoring.dashboard.global_status', { icon: statusIcons[healthStatus.status], status: healthStatus.status }))
      .setColor(getHealthColor(interaction.guildId, healthStatus.status))
      .setTimestamp()
      .setFooter({ text: 'Werewolf Bot Monitoring' });
    
    // Métriques système
    const mem = currentMetrics.system.memory;
    // Barre de progression basée sur RSS vs seuil 512MB (pas le heap)
    const memoryBarMax = 512; // MB, échelle de la barre
    const memoryBarPercent = Math.min(100, Math.round((mem.rss / memoryBarMax) * 100));
    const memoryBar = this.createProgressBar(memoryBarPercent, 100);
    const cpuBar = this.createProgressBar(currentMetrics.system.cpu, 100);
    
    embed.addFields({
      name: t('cmd.monitoring.dashboard.system'),
      value: [
        `**${t('cmd.monitoring.dashboard.memory')}:** ${memoryBar} ${mem.rss}MB`,
        `└─ Heap: ${mem.heapUsed}MB/${mem.heapTotal}MB | System: ${mem.systemFree}MB libre / ${mem.systemTotal}MB`,
        `**${t('cmd.monitoring.dashboard.cpu')}:** ${cpuBar} ${currentMetrics.system.cpu}%`,
        `**${t('cmd.monitoring.dashboard.uptime')}:** ${this.formatUptime(currentMetrics.system.uptime)}`
      ].join('\n'),
      inline: false
    });
    
    // Métriques Discord
    const wsStatus = currentMetrics.discord.wsStatus === 0 ? t('cmd.monitoring.dashboard.ws_connected') : t('cmd.monitoring.dashboard.ws_disconnected');
    
    embed.addFields({
      name: t('cmd.monitoring.dashboard.discord'),
      value: [
        `**${t('cmd.monitoring.dashboard.servers')}:** ${currentMetrics.discord.guilds}`,
        `**${t('cmd.monitoring.dashboard.users')}:** ${currentMetrics.discord.users.toLocaleString()}`,
        `**${t('cmd.monitoring.dashboard.latency')}:** ${currentMetrics.discord.latency}ms`,
        `**${t('cmd.monitoring.dashboard.websocket')}:** ${wsStatus}`
      ].join('\n'),
      inline: true
    });
    
    // Métriques jeux
    embed.addFields({
      name: t('cmd.monitoring.dashboard.games'),
      value: [
        `**${t('cmd.monitoring.dashboard.active')}:** ${currentMetrics.game.activeGames}`,
        `**${t('cmd.monitoring.dashboard.total_players')}:** ${currentMetrics.game.totalPlayers}`,
        `**${t('cmd.monitoring.dashboard.created_24h')}:** ${currentMetrics.game.gamesCreated24h}`,
        `**${t('cmd.monitoring.dashboard.completed_24h')}:** ${currentMetrics.game.gamesCompleted24h}`
      ].join('\n'),
      inline: true
    });
    
    // Métriques commandes
    const errorRate = currentMetrics.commands.total > 0 
      ? ((currentMetrics.commands.errors / currentMetrics.commands.total) * 100).toFixed(1)
      : '0.0';
    
    embed.addFields({
      name: t('cmd.monitoring.dashboard.commands'),
      value: [
        `**${t('cmd.monitoring.dashboard.total')}:** ${currentMetrics.commands.total}`,
        `**${t('cmd.monitoring.dashboard.errors')}:** ${currentMetrics.commands.errors} (${errorRate}%)`,
        `**${t('cmd.monitoring.dashboard.rate_limited')}:** ${currentMetrics.commands.rateLimited}`,
        `**${t('cmd.monitoring.dashboard.avg_response')}:** ${currentMetrics.commands.avgResponseTime}ms`
      ].join('\n'),
      inline: false
    });
    
    // Problèmes détectés
    if (healthStatus.issues.length > 0) {
      embed.addFields({
        name: t('cmd.monitoring.dashboard.issues'),
        value: healthStatus.issues.map(issue => `• ${issue}`).join('\n'),
        inline: false
      });
    }
    
    await interaction.reply({ embeds: [embed], ephemeral: true });
  },

  /**
   * Affiche le statut de santé
   */
  async showHealth(interaction, metrics) {
    const healthStatus = metrics.getHealthStatus();
    
    const statusIcons = {
      HEALTHY: '🟢',
      DEGRADED: '🟡',
      UNHEALTHY: '🔴'
    };
    
    const statusDescriptions = {
      HEALTHY: t('cmd.monitoring.health.healthy'),
      DEGRADED: t('cmd.monitoring.health.degraded'),
      UNHEALTHY: t('cmd.monitoring.health.unhealthy'),
    };
    
    const embed = new EmbedBuilder()
      .setTitle(t('cmd.monitoring.health.title', { icon: statusIcons[healthStatus.status] }))
      .setDescription(statusDescriptions[healthStatus.status])
      .setColor(getHealthColor(interaction.guildId, healthStatus.status))
      .setTimestamp();
    
    if (healthStatus.issues.length > 0) {
      embed.addFields({
        name: t('cmd.monitoring.health.issues'),
        value: healthStatus.issues.map(issue => `• ${issue}`).join('\n'),
        inline: false
      });
    } else {
      embed.addFields({
        name: t('cmd.monitoring.health.checks_ok'),
        value: [
          `• ${t('cmd.monitoring.health.memory_ok')}`,
          `• ${t('cmd.monitoring.health.latency_ok')}`,
          `• ${t('cmd.monitoring.health.websocket_ok')}`,
          `• ${t('cmd.monitoring.health.error_rate_ok')}`
        ].join('\n'),
        inline: false
      });
    }
    
    // Recommandations
    if (healthStatus.status !== 'HEALTHY') {
      const recommendations = [];
      
      if (healthStatus.issues.some(i => i.includes('mémoire'))) {
        recommendations.push(`• ${t('cmd.monitoring.health.rec_restart')}`);
        recommendations.push(`• ${t('cmd.monitoring.health.rec_memory_leak')}`);
      }
      
      if (healthStatus.issues.some(i => i.includes('latence'))) {
        recommendations.push(`• ${t('cmd.monitoring.health.rec_check_internet')}`);
        recommendations.push(`• ${t('cmd.monitoring.health.rec_contact_discord')}`);
      }
      
      if (healthStatus.issues.some(i => i.includes('erreur'))) {
        recommendations.push(`• ${t('cmd.monitoring.health.rec_check_logs')}`);
        recommendations.push(`• ${t('cmd.monitoring.health.rec_check_perms')}`);
      }
      
      if (recommendations.length > 0) {
        embed.addFields({
          name: t('cmd.monitoring.health.recommendations'),
          value: recommendations.join('\n'),
          inline: false
        });
      }
    }
    
    await interaction.reply({ embeds: [embed], ephemeral: true });
  },

  /**
   * Gère le système d'alertes
   */
  async manageAlerts(interaction, alerts) {
    const action = interaction.options.getString('action');
    
    switch (action) {
      case 'stats': {
        const stats = alerts.getAlertStats();
        
        const embed = new EmbedBuilder()
          .setTitle(t('cmd.monitoring.alerts.stats_title'))
          .setColor(getColor(interaction.guildId, 'info'))
          .setTimestamp();
        
        embed.addFields({
          name: t('cmd.monitoring.alerts.total'),
          value: stats.total.toString(),
          inline: true
        });
        
        if (Object.keys(stats.byType).length > 0) {
          const byTypeText = Object.entries(stats.byType)
            .map(([type, count]) => `**${type}:** ${count}`)
            .join('\n');
          
          embed.addFields({
            name: t('cmd.monitoring.alerts.by_type'),
            value: byTypeText,
            inline: false
          });
        } else {
          embed.addFields({
            name: t('cmd.monitoring.alerts.by_type'),
            value: t('cmd.monitoring.alerts.no_alerts'),
            inline: false
          });
        }
        
        await interaction.reply({ embeds: [embed], ephemeral: true });
        break;
      }
      
      case 'enable':
        alerts.setEnabled(true);
        await interaction.reply({
          content: t('cmd.monitoring.alerts.enabled'),
          ephemeral: true
        });
        break;
      
      case 'disable':
        alerts.setEnabled(false);
        await interaction.reply({
          content: t('cmd.monitoring.alerts.disabled'),
          ephemeral: true
        });
        break;
    }
  },

  /**
   * Affiche l'historique des métriques
   */
  async showHistory(interaction, metrics) {
    const history = metrics.getHistory();
    const count = history.timestamps ? history.timestamps.length : 0;
    
    if (count === 0) {
      await interaction.reply({
        content: t('cmd.monitoring.history.no_data'),
        ephemeral: true
      });
      return;
    }
    
    // Calculer les moyennes sur les tableaux parallèles
    const sum = (arr) => arr.reduce((s, v) => s + (v || 0), 0);
    const avgMemory = sum(history.memory) / count;
    const avgLatency = sum(history.latency) / count;
    
    // Trouver les pics
    const maxMemory = Math.max(...history.memory);
    const maxLatency = Math.max(...history.latency);
    
    const embed = new EmbedBuilder()
      .setTitle(t('cmd.monitoring.history.title'))
      .setColor(getColor(interaction.guildId, 'purple'))
      .setTimestamp()
      .setFooter({ text: t('cmd.monitoring.history.data_points', { count }) });
    
    embed.addFields({
      name: t('cmd.monitoring.history.memory'),
      value: [
        `**${t('cmd.monitoring.history.average')}:** ${avgMemory.toFixed(1)}%`,
        `**${t('cmd.monitoring.history.peak')}:** ${maxMemory.toFixed(1)}%`
      ].join('\n'),
      inline: true
    });
    
    embed.addFields({
      name: t('cmd.monitoring.history.latency'),
      value: [
        `**${t('cmd.monitoring.history.average')}:** ${avgLatency.toFixed(0)}ms`,
        `**${t('cmd.monitoring.history.peak')}:** ${maxLatency.toFixed(0)}ms`
      ].join('\n'),
      inline: true
    });
    
    embed.addFields({
      name: t('cmd.monitoring.history.active_games'),
      value: `**${t('cmd.monitoring.history.last_value')}:** ${history.activeGames[count - 1] || 0}`,
      inline: true
    });
    
    // Graphique ASCII simple pour la mémoire
    const memoryGraph = this.createASCIIGraph(
      history.memory.slice(-12),
      t('cmd.monitoring.history.graph_title')
    );
    
    embed.addFields({
      name: t('cmd.monitoring.history.memory_graph'),
      value: '```\n' + memoryGraph + '\n```',
      inline: false
    });
    
    await interaction.reply({ embeds: [embed], ephemeral: true });
  },

  /**
   * Crée une barre de progression
   */
  createProgressBar(value, max, length = 10) {
    const percentage = Math.min((value / max) * 100, 100);
    const filled = Math.round((percentage / 100) * length);
    const empty = length - filled;
    
    const bar = '█'.repeat(filled) + '░'.repeat(empty);
    
    return bar;
  },

  /**
   * Formate l'uptime
   */
  formatUptime(seconds) {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    
    const parts = [];
    if (days > 0) parts.push(`${days}${t('cmd.monitoring.uptime.days')}`);
    if (hours > 0) parts.push(`${hours}${t('cmd.monitoring.uptime.hours')}`);
    if (minutes > 0) parts.push(`${minutes}${t('cmd.monitoring.uptime.minutes')}`);
    
    return parts.join(' ') || t('cmd.monitoring.uptime.less_than_1m');
  },

  /**
   * Crée un graphique ASCII simple
   */
  createASCIIGraph(values, title) {
    if (values.length === 0) return t('cmd.monitoring.history.no_graph_data');
    
    const height = 5;
    const max = Math.max(...values);
    const min = Math.min(...values);
    const range = max - min || 1;
    
    const lines = [];
    lines.push(title);
    lines.push('');
    
    // Échelle Y
    for (let i = height; i >= 0; i--) {
      const threshold = min + (range * i / height);
      let line = `${threshold.toFixed(0).padStart(3)}% `;
      
      for (const value of values) {
        const normalized = ((value - min) / range) * height;
        if (normalized >= i) {
          line += '█';
        } else if (normalized >= i - 0.5) {
          line += '▄';
        } else {
          line += ' ';
        }
      }
      lines.push(line);
    }
    
    // Échelle X
    lines.push('     ' + '─'.repeat(values.length));
    lines.push(`     ${t('cmd.monitoring.history.time_axis', { count: values.length })}`);
    
    return lines.join('\n');
  }
};
