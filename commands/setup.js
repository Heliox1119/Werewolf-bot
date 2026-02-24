const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const logger = require('../utils/logger').app;
const { t } = require('../utils/i18n');
const { getColor } = require('../utils/theme');

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
            content: t('error.unknown_subcommand'),
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
        content: t('error.setup_execution_error'),
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
        content: t('error.invalid_category'),
        ephemeral: true
      });
      return;
    }

    const success = config.setCategoryId(category.id, interaction.guildId);

    if (success) {
      const embed = new EmbedBuilder()
        .setTitle(t('cmd.setup.category_title'))
        .setDescription(t('cmd.setup.category_desc', { name: category.name }))
        .addFields(
          { name: t('cmd.setup.field_id'), value: category.id, inline: true },
          { name: t('cmd.setup.field_position'), value: t('cmd.setup.position_value', { position: category.position }), inline: true }
        )
        .setColor(getColor(interaction.guildId, 'success'))
        .setTimestamp();

      await interaction.reply({ embeds: [embed], ephemeral: true });

      // Vérifier si le setup est complet
      if (config.isSetupComplete(interaction.guildId)) {
        await interaction.followUp({
          content: t('cmd.setup.setup_complete'),
          ephemeral: true
        });
      }
    } else {
      await interaction.reply({
        content: t('error.category_config_failed'),
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
      config.setMonitoringWebhookUrl(null, interaction.guildId);
      await interaction.reply({
        content: t('cmd.setup.webhook_disabled'),
        ephemeral: true
      });
      return;
    }

    // Vérifier que l'URL est valide
    if (!url.startsWith('https://discord.com/api/webhooks/')) {
      await interaction.reply({
        content: t('error.webhook_invalid'),
        ephemeral: true
      });
      return;
    }

    const success = config.setMonitoringWebhookUrl(url, interaction.guildId);

    if (success) {
      const embed = new EmbedBuilder()
        .setTitle(t('cmd.setup.webhook_title'))
        .setDescription(t('cmd.setup.webhook_desc'))
        .addFields(
          { name: t('cmd.setup.field_url'), value: url.substring(0, 50) + '...', inline: false },
          { name: t('cmd.setup.field_status'), value: t('cmd.setup.webhook_status_value'), inline: false }
        )
        .setColor(getColor(interaction.guildId, 'success'))
        .setTimestamp();

      await interaction.reply({ embeds: [embed], ephemeral: true });

      // Envoyer une alerte de test
      try {
        const AlertSystem = require('../monitoring/alerts');
        const alerts = AlertSystem.getInstance();
        alerts.setWebhookUrl(url);
        await alerts.sendAlert(
          t('cmd.setup.webhook_test_title'),
          t('cmd.setup.webhook_test_desc'),
          'info'
        );
      } catch (error) {
        logger.error('Failed to send test alert', { error: error.message });
      }
    } else {
      await interaction.reply({
        content: t('error.webhook_config_failed'),
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
        content: t('error.specify_parameter'),
        ephemeral: true
      });
      return;
    }

    const guildId = interaction.guildId;
    const currentRules = config.getDefaultGameRules(guildId);
    const newRules = {
      minPlayers: minPlayers || currentRules.minPlayers,
      maxPlayers: maxPlayers || currentRules.maxPlayers,
      disableVoiceMute: currentRules.disableVoiceMute
    };

    // Validation
    if (newRules.minPlayers > newRules.maxPlayers) {
      await interaction.reply({
        content: t('error.min_greater_than_max'),
        ephemeral: true
      });
      return;
    }

    const success = config.setDefaultGameRules(newRules, guildId);

    if (success) {
      const embed = new EmbedBuilder()
        .setTitle(t('cmd.setup.rules_title'))
        .setDescription(t('cmd.setup.rules_desc'))
        .addFields(
          { name: t('cmd.setup.field_min'), value: newRules.minPlayers.toString(), inline: true },
          { name: t('cmd.setup.field_max'), value: newRules.maxPlayers.toString(), inline: true }
        )
        .setColor(getColor(interaction.guildId, 'success'))
        .setTimestamp();

      await interaction.reply({ embeds: [embed], ephemeral: true });
    } else {
      await interaction.reply({
        content: t('error.rules_config_failed'),
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
        content: t('error.specify_parameter'),
        ephemeral: true
      });
      return;
    }

    const changes = [];

    if (interval !== null) {
      const intervalMs = interval * 1000;
      config.setMetricsInterval(intervalMs);
      changes.push(t('cmd.setup.interval_change', { interval }));

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
      changes.push(alertsEnabled ? t('cmd.setup.alerts_enabled') : t('cmd.setup.alerts_disabled'));

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
      .setTitle(t('cmd.setup.monitoring_title'))
      .setDescription(t('cmd.setup.monitoring_desc'))
      .addFields({
        name: t('cmd.setup.field_changes'),
        value: changes.join('\n'),
        inline: false
      })
      .setColor(getColor(interaction.guildId, 'success'))
      .setTimestamp();

    await interaction.reply({ embeds: [embed], ephemeral: true });
  },

  /**
   * Affiche la configuration actuelle
   */
  async showStatus(interaction, config) {
    const guildId = interaction.guildId;
    const summary = config.getSummary(guildId);
    const setupComplete = summary.setupComplete;

    const embed = new EmbedBuilder()
      .setTitle(t('cmd.setup.status_title'))
      .setDescription(
        setupComplete
          ? t('cmd.setup.status_complete')
          : t('cmd.setup.status_incomplete')
      )
      .setColor(setupComplete ? getColor(interaction.guildId, 'success') : getColor(interaction.guildId, 'warning'))
      .setTimestamp();

    // Discord
    const categoryId = summary.discord.categoryId;
    const categoryInfo = categoryId
      ? `<#${categoryId}> (${categoryId})`
      : t('cmd.setup.category_not_set');

    embed.addFields({
      name: t('cmd.setup.field_discord'),
      value: [
        t('cmd.setup.status_category', { info: categoryInfo }),
        t('cmd.setup.status_emojis', { count: summary.discord.emojis })
      ].join('\n'),
      inline: false
    });

    // Monitoring
    embed.addFields({
      name: t('cmd.setup.field_monitoring'),
      value: [
        t('cmd.setup.status_webhook', { url: summary.monitoring.webhookUrl }),
        t('cmd.setup.status_alerts', { status: summary.monitoring.alertsEnabled ? t('cmd.setup.status_alerts_on') : t('cmd.setup.status_alerts_off') }),
        t('cmd.setup.status_interval', { interval: summary.monitoring.metricsInterval })
      ].join('\n'),
      inline: false
    });

    // Jeux
    const rules = summary.game.defaultRules;
    embed.addFields({
      name: t('cmd.setup.field_games'),
      value: [
        t('cmd.setup.status_players', { range: `${rules.minPlayers}-${rules.maxPlayers}` }),
        t('cmd.setup.status_roles', { roles: summary.game.enabledRoles }),
        t('cmd.setup.status_lobby_timeout', { timeout: summary.game.lobbyTimeout })
      ].join('\n'),
      inline: false
    });

    // Statistiques
    embed.addFields({
      name: t('cmd.setup.field_stats'),
      value: t('cmd.setup.status_total_keys', { count: summary.totalKeys }),
      inline: false
    });

    // Ajouter les clés manquantes si setup incomplet
    if (!setupComplete) {
      const missing = config.getMissingSetupKeys(guildId);
      embed.addFields({
        name: t('cmd.setup.missing_config'),
        value: missing.map(m => `• **${m.description}** (\`${m.key}\`)`).join('\n'),
        inline: false
      });

      embed.setFooter({ text: t('cmd.setup.status_footer') });
    }

    await interaction.reply({ embeds: [embed], ephemeral: true });
  },

  /**
   * Assistant de configuration
   */
  async runWizard(interaction, config) {
    // Vérifier si déjà configuré
    if (config.isSetupComplete(interaction.guildId)) {
      await interaction.reply({
        content: t('cmd.setup.already_configured'),
        ephemeral: true
      });
      return;
    }

    const guildId = interaction.guildId;

    const embed = new EmbedBuilder()
      .setTitle(t('cmd.setup.wizard_title'))
      .setDescription(t('cmd.setup.wizard_desc'))
      .setColor(getColor(interaction.guildId, 'info'))
      .setTimestamp();

    // Étapes de configuration
    const steps = [];

    // Catégorie (requis)
    if (!config.getCategoryId(guildId)) {
      steps.push({
        name: t('cmd.setup.wizard_step1_title'),
        value: [
          t('cmd.setup.wizard_step1_action'),
          t('cmd.setup.wizard_step1_cmd'),
          t('cmd.setup.wizard_step1_info')
        ].join('\n'),
        inline: false
      });
    }

    // Webhook (optionnel)
    if (!config.getMonitoringWebhookUrl(guildId)) {
      steps.push({
        name: t('cmd.setup.wizard_step2_title'),
        value: [
          t('cmd.setup.wizard_step2_action'),
          t('cmd.setup.wizard_step2_cmd'),
          t('cmd.setup.wizard_step2_info')
        ].join('\n'),
        inline: false
      });
    }

    // Règles (optionnel)
    steps.push({
      name: t('cmd.setup.wizard_step3_title'),
      value: [
        t('cmd.setup.wizard_step3_cmd'),
        t('cmd.setup.wizard_step3_info'),
        t('cmd.setup.wizard_step3_current', { range: `${config.getDefaultGameRules(guildId).minPlayers}-${config.getDefaultGameRules(guildId).maxPlayers}` })
      ].join('\n'),
      inline: false
    });

    if (steps.length > 0) {
      embed.addFields(steps);
    }

    // Instructions finales
    embed.addFields({
      name: t('cmd.setup.wizard_verify_title'),
      value: t('cmd.setup.wizard_verify_value'),
      inline: false
    });

    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
};
