const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const logger = require('../utils/logger');

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
            content: '❌ Sous-commande inconnue', 
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
        content: '❌ Erreur lors de l\'exécution de la commande monitoring',
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
    
    // Couleur selon le statut
    const colors = {
      HEALTHY: 0x2ECC71,    // Vert
      DEGRADED: 0xF39C12,   // Orange
      UNHEALTHY: 0xE74C3C   // Rouge
    };
    
    // Icônes de statut
    const statusIcons = {
      HEALTHY: '🟢',
      DEGRADED: '🟡',
      UNHEALTHY: '🔴'
    };
    
    const embed = new EmbedBuilder()
      .setTitle('📊 Dashboard de Monitoring')
      .setDescription(`**Statut global:** ${statusIcons[healthStatus.status]} ${healthStatus.status}`)
      .setColor(colors[healthStatus.status])
      .setTimestamp()
      .setFooter({ text: 'Werewolf Bot Monitoring' });
    
    // Métriques système
    const memoryBar = this.createProgressBar(currentMetrics.system.memory.percentage, 100);
    const cpuBar = this.createProgressBar(currentMetrics.system.cpu, 100);
    
    embed.addFields({
      name: '💻 Système',
      value: [
        `**Mémoire:** ${memoryBar} ${currentMetrics.system.memory.percentage}%`,
        `└─ ${currentMetrics.system.memory.used}MB / ${currentMetrics.system.memory.total}MB`,
        `**CPU:** ${cpuBar} ${currentMetrics.system.cpu}%`,
        `**Uptime:** ${this.formatUptime(currentMetrics.system.uptime)}`
      ].join('\n'),
      inline: false
    });
    
    // Métriques Discord
    const wsStatus = currentMetrics.discord.wsStatus === 'READY' ? '🟢 Connecté' : '🔴 Déconnecté';
    
    embed.addFields({
      name: '📡 Discord',
      value: [
        `**Serveurs:** ${currentMetrics.discord.guilds}`,
        `**Utilisateurs:** ${currentMetrics.discord.users.toLocaleString()}`,
        `**Latence:** ${currentMetrics.discord.latency}ms`,
        `**WebSocket:** ${wsStatus}`
      ].join('\n'),
      inline: true
    });
    
    // Métriques jeux
    embed.addFields({
      name: '🎮 Parties',
      value: [
        `**Actives:** ${currentMetrics.game.activeGames}`,
        `**Joueurs:** ${currentMetrics.game.totalPlayers}`,
        `**Créées (24h):** ${currentMetrics.game.gamesCreated24h}`,
        `**Terminées (24h):** ${currentMetrics.game.gamesCompleted24h}`
      ].join('\n'),
      inline: true
    });
    
    // Métriques commandes
    const errorRate = currentMetrics.commands.total > 0 
      ? ((currentMetrics.commands.errors / currentMetrics.commands.total) * 100).toFixed(1)
      : '0.0';
    
    embed.addFields({
      name: '🔨 Commandes',
      value: [
        `**Total:** ${currentMetrics.commands.total}`,
        `**Erreurs:** ${currentMetrics.commands.errors} (${errorRate}%)`,
        `**Rate limited:** ${currentMetrics.commands.rateLimited}`,
        `**Temps moy.:** ${currentMetrics.commands.avgResponseTime}ms`
      ].join('\n'),
      inline: false
    });
    
    // Problèmes détectés
    if (healthStatus.issues.length > 0) {
      embed.addFields({
        name: '⚠️ Problèmes détectés',
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
    
    const colors = {
      HEALTHY: 0x2ECC71,
      DEGRADED: 0xF39C12,
      UNHEALTHY: 0xE74C3C
    };
    
    const statusIcons = {
      HEALTHY: '🟢',
      DEGRADED: '🟡',
      UNHEALTHY: '🔴'
    };
    
    const statusDescriptions = {
      HEALTHY: 'Tous les systèmes fonctionnent normalement',
      DEGRADED: 'Certaines métriques sont au-dessus des seuils normaux',
      UNHEALTHY: 'Le bot rencontre des problèmes critiques'
    };
    
    const embed = new EmbedBuilder()
      .setTitle(`${statusIcons[healthStatus.status]} Statut de santé`)
      .setDescription(statusDescriptions[healthStatus.status])
      .setColor(colors[healthStatus.status])
      .setTimestamp();
    
    if (healthStatus.issues.length > 0) {
      embed.addFields({
        name: '⚠️ Problèmes',
        value: healthStatus.issues.map(issue => `• ${issue}`).join('\n'),
        inline: false
      });
    } else {
      embed.addFields({
        name: '✅ Vérifications',
        value: [
          '• Mémoire: OK',
          '• Latence: OK',
          '• WebSocket: OK',
          '• Taux d\'erreur: OK'
        ].join('\n'),
        inline: false
      });
    }
    
    // Recommandations
    if (healthStatus.status !== 'HEALTHY') {
      const recommendations = [];
      
      if (healthStatus.issues.some(i => i.includes('mémoire'))) {
        recommendations.push('• Redémarrer le bot pour libérer la mémoire');
        recommendations.push('• Vérifier les memory leaks dans les parties actives');
      }
      
      if (healthStatus.issues.some(i => i.includes('latence'))) {
        recommendations.push('• Vérifier la connexion internet');
        recommendations.push('• Contacter Discord si le problème persiste');
      }
      
      if (healthStatus.issues.some(i => i.includes('erreur'))) {
        recommendations.push('• Consulter les logs pour identifier les erreurs');
        recommendations.push('• Vérifier les permissions du bot');
      }
      
      if (recommendations.length > 0) {
        embed.addFields({
          name: '💡 Recommandations',
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
          .setTitle('📊 Statistiques des alertes')
          .setColor(0x3498DB)
          .setTimestamp();
        
        embed.addFields({
          name: '📈 Total',
          value: stats.total.toString(),
          inline: true
        });
        
        if (Object.keys(stats.byType).length > 0) {
          const byTypeText = Object.entries(stats.byType)
            .map(([type, count]) => `**${type}:** ${count}`)
            .join('\n');
          
          embed.addFields({
            name: '📊 Par type',
            value: byTypeText,
            inline: false
          });
        } else {
          embed.addFields({
            name: '📊 Par type',
            value: 'Aucune alerte envoyée',
            inline: false
          });
        }
        
        await interaction.reply({ embeds: [embed], ephemeral: true });
        break;
      }
      
      case 'enable':
        alerts.setEnabled(true);
        await interaction.reply({
          content: '✅ Système d\'alertes activé',
          ephemeral: true
        });
        break;
      
      case 'disable':
        alerts.setEnabled(false);
        await interaction.reply({
          content: '⚠️ Système d\'alertes désactivé',
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
        content: '📊 Pas encore d\'historique disponible',
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
      .setTitle('📈 Historique des métriques (24h)')
      .setColor(0x9B59B6)
      .setTimestamp()
      .setFooter({ text: `${count} points de données` });
    
    embed.addFields({
      name: '💾 Mémoire',
      value: [
        `**Moyenne:** ${avgMemory.toFixed(1)}%`,
        `**Pic:** ${maxMemory.toFixed(1)}%`
      ].join('\n'),
      inline: true
    });
    
    embed.addFields({
      name: '📡 Latence',
      value: [
        `**Moyenne:** ${avgLatency.toFixed(0)}ms`,
        `**Pic:** ${maxLatency.toFixed(0)}ms`
      ].join('\n'),
      inline: true
    });
    
    embed.addFields({
      name: '🎮 Parties actives',
      value: `**Dernière valeur:** ${history.activeGames[count - 1] || 0}`,
      inline: true
    });
    
    // Graphique ASCII simple pour la mémoire
    const memoryGraph = this.createASCIIGraph(
      history.memory.slice(-12),
      'Mémoire (12 dernières heures)'
    );
    
    embed.addFields({
      name: '📊 Graphique mémoire',
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
    if (days > 0) parts.push(`${days}j`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    
    return parts.join(' ') || '< 1m';
  },

  /**
   * Crée un graphique ASCII simple
   */
  createASCIIGraph(values, title) {
    if (values.length === 0) return 'Pas de données';
    
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
    lines.push(`     ${values.length}h ago → now`);
    
    return lines.join('\n');
  }
};
