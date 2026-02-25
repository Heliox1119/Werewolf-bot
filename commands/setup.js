const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ComponentType, MessageFlags } = require('discord.js');
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
            flags: MessageFlags.Ephemeral
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
        flags: MessageFlags.Ephemeral
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
        flags: MessageFlags.Ephemeral
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

      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });

      // Vérifier si le setup est complet
      if (config.isSetupComplete(interaction.guildId)) {
        await interaction.followUp({
          content: t('cmd.setup.setup_complete'),
          flags: MessageFlags.Ephemeral
        });
      }
    } else {
      await interaction.reply({
        content: t('error.category_config_failed'),
        flags: MessageFlags.Ephemeral
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
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    // Vérifier que l'URL est valide
    if (!url.startsWith('https://discord.com/api/webhooks/')) {
      await interaction.reply({
        content: t('error.webhook_invalid'),
        flags: MessageFlags.Ephemeral
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

      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });

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
        flags: MessageFlags.Ephemeral
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
        flags: MessageFlags.Ephemeral
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
        flags: MessageFlags.Ephemeral
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

      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    } else {
      await interaction.reply({
        content: t('error.rules_config_failed'),
        flags: MessageFlags.Ephemeral
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
        flags: MessageFlags.Ephemeral
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

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
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

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },

  /**
   * Assistant de configuration interactif
   */
  async runWizard(interaction, config) {
    // Check Manage Guild permission
    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
      await interaction.reply({
        content: t('cmd.setup.wizard_permission_required'),
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    // Vérifier si déjà configuré
    if (config.isSetupComplete(interaction.guildId)) {
      await interaction.reply({
        content: t('cmd.setup.already_configured'),
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const guildId = interaction.guildId;

    const embed = new EmbedBuilder()
      .setTitle(t('cmd.setup.wizard_title'))
      .setDescription(t('cmd.setup.wizard_desc'))
      .setColor(getColor(interaction.guildId, 'info'))
      .setTimestamp();

    const buttons = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('setup_wizard_auto')
        .setLabel(t('cmd.setup.wizard_btn_auto'))
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('setup_wizard_choose')
        .setLabel(t('cmd.setup.wizard_btn_choose'))
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('setup_wizard_cancel')
        .setLabel(t('cmd.setup.wizard_btn_cancel'))
        .setStyle(ButtonStyle.Danger)
    );

    const response = await interaction.reply({
      embeds: [embed],
      components: [buttons],
      flags: MessageFlags.Ephemeral,
      withResponse: true
    });
    const replyMessage = response.resource.message;

    // Collect button interaction
    let buttonInteraction;
    try {
      buttonInteraction = await replyMessage.awaitMessageComponent({
        componentType: ComponentType.Button,
        filter: (i) => i.user.id === interaction.user.id,
        time: 60_000
      });
    } catch {
      // Timeout
      await interaction.editReply({
        content: t('cmd.setup.wizard_timeout'),
        embeds: [],
        components: []
      });
      return;
    }

    // Acknowledge button IMMEDIATELY to avoid 3-second expiry (10062)
    try { await buttonInteraction.deferUpdate(); } catch {}

    const action = buttonInteraction.customId;

    // ── Cancel ──
    if (action === 'setup_wizard_cancel') {
      await interaction.editReply({
        content: t('cmd.setup.wizard_cancelled'),
        embeds: [],
        components: []
      });
      return;
    }

    // ── Automatic Setup ──
    if (action === 'setup_wizard_auto') {
      try {
        const guild = interaction.guild;

        // Check if a "🐺 Werewolf" category already exists
        const existingCategory = guild.channels.cache.find(
          ch => ch.type === ChannelType.GuildCategory && ch.name === '🐺 Werewolf'
        );

        let category;
        let channelName = '🎮 start-game';
        let startChannel;

        if (existingCategory) {
          category = existingCategory;
          logger.info('Wizard: reusing existing Werewolf category', { id: category.id });
        } else {
          category = await guild.channels.create({
            name: '🐺 Werewolf',
            type: ChannelType.GuildCategory
          });
          logger.info('Wizard: created Werewolf category', { id: category.id });
        }

        // Create start-game channel inside the category if it doesn't exist
        const existingChannel = guild.channels.cache.find(
          ch => ch.parentId === category.id && ch.name === '🎮-start-game'
        );

        if (!existingChannel) {
          startChannel = await guild.channels.create({
            name: channelName,
            type: ChannelType.GuildText,
            parent: category.id
          });
          logger.info('Wizard: created start-game channel', { id: startChannel.id });
        } else {
          startChannel = existingChannel;
        }

        // Save category_id in guild config (idempotent)
        const success = config.setCategoryId(category.id, guildId);
        if (!success) {
          await interaction.editReply({
            content: t('cmd.setup.wizard_auto_error'),
            embeds: [],
            components: []
          });
          return;
        }

        const successEmbed = new EmbedBuilder()
          .setTitle(t('cmd.setup.wizard_title'))
          .setDescription(t('cmd.setup.wizard_auto_success', {
            category: category.name,
            channel: startChannel.name
          }))
          .setColor(getColor(guildId, 'success'))
          .setTimestamp();

        await interaction.editReply({
          embeds: [successEmbed],
          components: []
        });

      } catch (err) {
        logger.error('Wizard auto setup failed', { error: err.message, stack: err.stack });
        await interaction.editReply({
          content: t('cmd.setup.wizard_auto_error'),
          embeds: [],
          components: []
        });
      }
      return;
    }

    // ── Choose Category ──
    if (action === 'setup_wizard_choose') {
      const guild = interaction.guild;
      const categories = guild.channels.cache
        .filter(ch => ch.type === ChannelType.GuildCategory)
        .first(25); // Discord SelectMenu limit

      if (categories.length === 0) {
        await interaction.editReply({
          content: t('cmd.setup.wizard_no_categories'),
          embeds: [],
          components: []
        });
        return;
      }

      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('setup_wizard_category_select')
        .setPlaceholder(t('cmd.setup.wizard_select_placeholder'))
        .addOptions(
          categories.map(cat => ({
            label: cat.name.substring(0, 100),
            value: cat.id,
            description: `ID: ${cat.id}`
          }))
        );

      const selectRow = new ActionRowBuilder().addComponents(selectMenu);

      await interaction.editReply({
        content: t('cmd.setup.wizard_select_prompt'),
        embeds: [],
        components: [selectRow]
      });

      // Collect select menu interaction
      let selectInteraction;
      try {
        selectInteraction = await replyMessage.awaitMessageComponent({
          componentType: ComponentType.StringSelect,
          filter: (i) => i.user.id === interaction.user.id,
          time: 60_000
        });
      } catch {
        await interaction.editReply({
          content: t('cmd.setup.wizard_timeout'),
          embeds: [],
          components: []
        });
        return;
      }

      // Acknowledge select immediately
      try { await selectInteraction.deferUpdate(); } catch {}

      const selectedCategoryId = selectInteraction.values[0];
      const selectedCategory = guild.channels.cache.get(selectedCategoryId);

      const success = config.setCategoryId(selectedCategoryId, guildId);

      if (success && selectedCategory) {
        const successEmbed = new EmbedBuilder()
          .setTitle(t('cmd.setup.wizard_title'))
          .setDescription(t('cmd.setup.wizard_select_success', {
            name: selectedCategory.name,
            id: selectedCategoryId
          }))
          .setColor(getColor(guildId, 'success'))
          .setTimestamp();

        await interaction.editReply({
          embeds: [successEmbed],
          content: null,
          components: []
        });
      } else {
        await interaction.editReply({
          content: t('cmd.setup.wizard_select_error'),
          embeds: [],
          components: []
        });
      }
      return;
    }
  }
};
