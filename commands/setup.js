const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const logger = require('../utils/logger').app;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setup')
    .setDescription('⚙️ Configuration du bot (admin uniquement)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(subcommand =>
      subcommand
        .setName('category')
        .setDescription('Configurer la catégorie Discord pour les channels de jeu')
        .addChannelOption(option =>
          option
            .setName('category')
            .setDescription('La catégorie où créer les channels')
            .addChannelTypes(ChannelType.GuildCategory)
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('webhook')
        .setDescription('Configurer le webhook Discord pour les alertes monitoring')
        .addStringOption(option =>
          option
            .setName('url')
            .setDescription('URL du webhook (laisser vide pour désactiver)')
            .setRequired(false)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('rules')
        .setDescription('Configurer les règles par défaut des parties')
        .addIntegerOption(option =>
          option
            .setName('min_players')
            .setDescription('Nombre minimum de joueurs')
            .setMinValue(3)
            .setMaxValue(20)
            .setRequired(false)
        )
        .addIntegerOption(option =>
          option
            .setName('max_players')
            .setDescription('Nombre maximum de joueurs')
            .setMinValue(3)
            .setMaxValue(20)
            .setRequired(false)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('monitoring')
        .setDescription('Configurer le système de monitoring')
        .addIntegerOption(option =>
          option
            .setName('interval')
            .setDescription('Intervalle de collecte en secondes (30-300)')
            .setMinValue(30)
            .setMaxValue(300)
            .setRequired(false)
        )
        .addBooleanOption(option =>
          option
            .setName('alerts_enabled')
            .setDescription('Activer/désactiver les alertes')
            .setRequired(false)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('status')
        .setDescription('Afficher la configuration actuelle du bot')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('wizard')
        .setDescription('Assistant de configuration automatique (première installation)')
    ),

  async execute(interaction) {
    try {
      const ConfigManager = require('../utils/config');
      const config = ConfigManager.getInstance();

      const subcommand = interaction.options.getSubcommand();

      switch (subcommand) {
        case 'category':
          await this.setupCategory(interaction, config);
          break;
        case 'webhook':
          await this.setupWebhook(interaction, config);
          break;
        case 'rules':
          await this.setupRules(interaction, config);
          break;
        case 'monitoring':
          await this.setupMonitoring(interaction, config);
          break;
        case 'status':
          await this.showStatus(interaction, config);
          break;
        case 'wizard':
          await this.runWizard(interaction, config);
          break;
        default:
          await interaction.reply({
            content: '❌ Sous-commande inconnue',
            ephemeral: true
          });
      }

      logger.info('Setup command executed', {
        subcommand,
        userId: interaction.user.id
      });

    } catch (error) {
      logger.error('Error executing setup command', {
        error: error.message,
        stack: error.stack
      });

      const reply = {
        content: '❌ Erreur lors de l\'exécution de la commande setup',
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
   * Configure la catégorie Discord
   */
  async setupCategory(interaction, config) {
    const category = interaction.options.getChannel('category');

    if (!category || category.type !== ChannelType.GuildCategory) {
      await interaction.reply({
        content: '❌ Vous devez spécifier une catégorie valide',
        ephemeral: true
      });
      return;
    }

    const success = config.setCategoryId(category.id);

    if (success) {
      const embed = new EmbedBuilder()
        .setTitle('✅ Catégorie configurée')
        .setDescription(`La catégorie **${category.name}** a été définie pour les channels de jeu.`)
        .addFields(
          { name: '📋 ID', value: category.id, inline: true },
          { name: '📍 Position', value: `Position ${category.position}`, inline: true }
        )
        .setColor(0x2ECC71)
        .setTimestamp();

      await interaction.reply({ embeds: [embed], ephemeral: true });

      // Vérifier si le setup est complet
      if (config.isSetupComplete()) {
        await interaction.followUp({
          content: '🎉 **Setup complet !** Le bot est maintenant configuré et prêt à l\'emploi.',
          ephemeral: true
        });
      }
    } else {
      await interaction.reply({
        content: '❌ Erreur lors de la configuration de la catégorie',
        ephemeral: true
      });
    }
  },

  /**
   * Configure le webhook de monitoring
   */
  async setupWebhook(interaction, config) {
    const url = interaction.options.getString('url');

    if (!url) {
      // Désactiver le webhook
      config.setMonitoringWebhookUrl(null);
      await interaction.reply({
        content: '✅ Webhook désactivé',
        ephemeral: true
      });
      return;
    }

    // Vérifier que l'URL est valide
    if (!url.startsWith('https://discord.com/api/webhooks/')) {
      await interaction.reply({
        content: '❌ URL de webhook invalide. Elle doit commencer par `https://discord.com/api/webhooks/`',
        ephemeral: true
      });
      return;
    }

    const success = config.setMonitoringWebhookUrl(url);

    if (success) {
      const embed = new EmbedBuilder()
        .setTitle('✅ Webhook configuré')
        .setDescription('Le webhook de monitoring a été configuré avec succès.')
        .addFields(
          { name: '🔗 URL', value: url.substring(0, 50) + '...', inline: false },
          { name: '📡 Statut', value: 'Les alertes seront envoyées sur ce webhook', inline: false }
        )
        .setColor(0x2ECC71)
        .setTimestamp();

      await interaction.reply({ embeds: [embed], ephemeral: true });

      // Envoyer une alerte de test
      try {
        const AlertSystem = require('../monitoring/alerts');
        const alerts = AlertSystem.getInstance();
        alerts.setWebhookUrl(url);
        await alerts.sendAlert(
          'Configuration réussie',
          'Le webhook de monitoring a été configuré avec succès.',
          'info'
        );
      } catch (error) {
        logger.error('Failed to send test alert', { error: error.message });
      }
    } else {
      await interaction.reply({
        content: '❌ Erreur lors de la configuration du webhook',
        ephemeral: true
      });
    }
  },

  /**
   * Configure les règles par défaut
   */
  async setupRules(interaction, config) {
    const minPlayers = interaction.options.getInteger('min_players');
    const maxPlayers = interaction.options.getInteger('max_players');

    if (!minPlayers && !maxPlayers) {
      await interaction.reply({
        content: '❌ Vous devez spécifier au moins un paramètre',
        ephemeral: true
      });
      return;
    }

    const currentRules = config.getDefaultGameRules();
    const newRules = {
      minPlayers: minPlayers || currentRules.minPlayers,
      maxPlayers: maxPlayers || currentRules.maxPlayers,
      disableVoiceMute: currentRules.disableVoiceMute
    };

    // Validation
    if (newRules.minPlayers > newRules.maxPlayers) {
      await interaction.reply({
        content: '❌ Le minimum de joueurs ne peut pas être supérieur au maximum',
        ephemeral: true
      });
      return;
    }

    const success = config.setDefaultGameRules(newRules);

    if (success) {
      const embed = new EmbedBuilder()
        .setTitle('✅ Règles configurées')
        .setDescription('Les règles par défaut des parties ont été mises à jour.')
        .addFields(
          { name: '👥 Minimum', value: newRules.minPlayers.toString(), inline: true },
          { name: '👥 Maximum', value: newRules.maxPlayers.toString(), inline: true }
        )
        .setColor(0x2ECC71)
        .setTimestamp();

      await interaction.reply({ embeds: [embed], ephemeral: true });
    } else {
      await interaction.reply({
        content: '❌ Erreur lors de la configuration des règles',
        ephemeral: true
      });
    }
  },

  /**
   * Configure le monitoring
   */
  async setupMonitoring(interaction, config) {
    const interval = interaction.options.getInteger('interval');
    const alertsEnabled = interaction.options.getBoolean('alerts_enabled');

    if (interval === null && alertsEnabled === null) {
      await interaction.reply({
        content: '❌ Vous devez spécifier au moins un paramètre',
        ephemeral: true
      });
      return;
    }

    const changes = [];

    if (interval !== null) {
      const intervalMs = interval * 1000;
      config.setMetricsInterval(intervalMs);
      changes.push(`• Intervalle: ${interval}s`);

      // Redémarrer la collecte avec le nouvel intervalle
      try {
        const MetricsCollector = require('../monitoring/metrics');
        const metrics = MetricsCollector.getInstance();
        metrics.startCollection(intervalMs);
      } catch (error) {
        logger.error('Failed to restart metrics collection', { error: error.message });
      }
    }

    if (alertsEnabled !== null) {
      config.setMonitoringAlertsEnabled(alertsEnabled);
      changes.push(`• Alertes: ${alertsEnabled ? 'Activées' : 'Désactivées'}`);

      // Mettre à jour le système d'alertes
      try {
        const AlertSystem = require('../monitoring/alerts');
        const alerts = AlertSystem.getInstance();
        alerts.setEnabled(alertsEnabled);
      } catch (error) {
        logger.error('Failed to update alerts status', { error: error.message });
      }
    }

    const embed = new EmbedBuilder()
      .setTitle('✅ Monitoring configuré')
      .setDescription('Les paramètres de monitoring ont été mis à jour.')
      .addFields({
        name: '🔧 Changements',
        value: changes.join('\n'),
        inline: false
      })
      .setColor(0x2ECC71)
      .setTimestamp();

    await interaction.reply({ embeds: [embed], ephemeral: true });
  },

  /**
   * Affiche la configuration actuelle
   */
  async showStatus(interaction, config) {
    const summary = config.getSummary();
    const setupComplete = summary.setupComplete;

    const embed = new EmbedBuilder()
      .setTitle('⚙️ Configuration du bot')
      .setDescription(
        setupComplete
          ? '✅ **Setup complet** - Le bot est configuré et prêt'
          : '⚠️ **Setup incomplet** - Configuration requise'
      )
      .setColor(setupComplete ? 0x2ECC71 : 0xF39C12)
      .setTimestamp();

    // Discord
    const categoryId = summary.discord.categoryId;
    const categoryInfo = categoryId
      ? `<#${categoryId}> (${categoryId})`
      : '❌ Non configuré - Utilisez `/setup category`';

    embed.addFields({
      name: '📡 Discord',
      value: [
        `**Catégorie:** ${categoryInfo}`,
        `**Emojis:** ${summary.discord.emojis} configurés`
      ].join('\n'),
      inline: false
    });

    // Monitoring
    embed.addFields({
      name: '📊 Monitoring',
      value: [
        `**Webhook:** ${summary.monitoring.webhookUrl}`,
        `**Alertes:** ${summary.monitoring.alertsEnabled ? '✅ Activées' : '❌ Désactivées'}`,
        `**Intervalle:** ${summary.monitoring.metricsInterval}`
      ].join('\n'),
      inline: false
    });

    // Jeux
    const rules = summary.game.defaultRules;
    embed.addFields({
      name: '🎮 Parties',
      value: [
        `**Joueurs:** ${rules.minPlayers}-${rules.maxPlayers}`,
        `**Rôles activés:** ${summary.game.enabledRoles}`,
        `**Timeout lobby:** ${summary.game.lobbyTimeout}`
      ].join('\n'),
      inline: false
    });

    // Statistiques
    embed.addFields({
      name: '📈 Statistiques',
      value: `**Clés totales:** ${summary.totalKeys}`,
      inline: false
    });

    // Ajouter les clés manquantes si setup incomplet
    if (!setupComplete) {
      const missing = config.getMissingSetupKeys();
      embed.addFields({
        name: '⚠️ Configuration requise',
        value: missing.map(m => `• **${m.description}** (\`${m.key}\`)`).join('\n'),
        inline: false
      });

      embed.setFooter({ text: 'Utilisez /setup wizard pour une configuration guidée' });
    }

    await interaction.reply({ embeds: [embed], ephemeral: true });
  },

  /**
   * Assistant de configuration
   */
  async runWizard(interaction, config) {
    // Vérifier si déjà configuré
    if (config.isSetupComplete()) {
      await interaction.reply({
        content: '✅ Le bot est déjà configuré ! Utilisez `/setup status` pour voir la configuration.',
        ephemeral: true
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle('🧙 Assistant de configuration')
      .setDescription(
        'Bienvenue dans l\'assistant de configuration du bot Werewolf !\n\n' +
        'Pour configurer le bot, suivez ces étapes :'
      )
      .setColor(0x3498DB)
      .setTimestamp();

    // Étapes de configuration
    const steps = [];

    // Catégorie (requis)
    if (!config.getCategoryId()) {
      steps.push({
        name: '1️⃣ Catégorie Discord (Requis)',
        value: [
          '**Action :** Créer une catégorie sur votre serveur',
          '**Commande :** `/setup category`',
          '**Info :** Les channels de jeu seront créés dans cette catégorie'
        ].join('\n'),
        inline: false
      });
    }

    // Webhook (optionnel)
    if (!config.getMonitoringWebhookUrl()) {
      steps.push({
        name: '2️⃣ Webhook monitoring (Optionnel)',
        value: [
          '**Action :** Créer un webhook dans un salon (ex: #bot-logs)',
          '**Commande :** `/setup webhook url:<webhook_url>`',
          '**Info :** Recevez des alertes automatiques sur les problèmes du bot'
        ].join('\n'),
        inline: false
      });
    }

    // Règles (optionnel)
    steps.push({
      name: '3️⃣ Règles par défaut (Optionnel)',
      value: [
        '**Commande :** `/setup rules min_players:5 max_players:10`',
        '**Info :** Définir les règles par défaut des parties',
        `**Actuel :** ${config.getDefaultGameRules().minPlayers}-${config.getDefaultGameRules().maxPlayers} joueurs`
      ].join('\n'),
      inline: false
    });

    if (steps.length > 0) {
      embed.addFields(steps);
    }

    // Instructions finales
    embed.addFields({
      name: '✅ Vérification',
      value: 'Utilisez `/setup status` pour vérifier votre configuration',
      inline: false
    });

    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
};
