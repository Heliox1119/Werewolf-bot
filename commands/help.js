const {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ComponentType
} = require("discord.js");
const { t } = require('../utils/i18n');
const { getColor } = require('../utils/theme');

const buildOverviewEmbed = (guildId) =>
  new EmbedBuilder()
    .setTitle(t('help.title'))
    .setColor(getColor(guildId, 'primary'))
    .setDescription(t('help.description'))
    .addFields(
      { name: t('help.quick_start_title'), value: t('help.quick_start_value'), inline: false },
      { name: t('help.flow_title'), value: t('help.flow_value'), inline: false }
    )
    .setFooter({ text: t('help.footer') });

const buildSetupEmbed = (guildId) =>
  new EmbedBuilder()
    .setTitle(t('help.setup_title'))
    .setColor(getColor(guildId, 'primary'))
    .setDescription(t('help.setup_desc'))
    .addFields(
      { name: t('help.setup_create_title'), value: t('help.setup_create_value'), inline: false },
      { name: t('help.setup_join_title'), value: t('help.setup_join_value'), inline: false },
      { name: t('help.setup_start_title'), value: t('help.setup_start_value'), inline: false }
    )
    .setFooter({ text: t('help.setup_footer') });

const buildNightEmbed = (guildId) =>
  new EmbedBuilder()
    .setTitle(t('help.night_title'))
    .setColor(getColor(guildId, 'accent'))
    .addFields(
      { name: t('help.night_wolves_title'), value: t('help.night_wolves_value'), inline: false },
      { name: t('help.night_seer_title'), value: t('help.night_seer_value'), inline: false },
      { name: t('help.night_witch_title'), value: t('help.night_witch_value'), inline: false },
      { name: t('help.night_cupid_title'), value: t('help.night_cupid_value'), inline: false },
      { name: t('help.night_petite_fille_title'), value: t('help.night_petite_fille_value'), inline: false }
    )
    .setFooter({ text: t('help.night_footer') });

const buildDayEmbed = (guildId) =>
  new EmbedBuilder()
    .setTitle(t('help.day_title'))
    .setColor(getColor(guildId, 'accent'))
    .addFields(
      { name: t('help.day_vote_title'), value: t('help.day_vote_value'), inline: false },
      { name: t('help.day_captain_title'), value: t('help.day_captain_value'), inline: false },
      { name: t('help.day_hunter_title'), value: t('help.day_hunter_value'), inline: false }
    )
    .setFooter({ text: t('help.day_footer') });

const buildAdminEmbed = (guildId) =>
  new EmbedBuilder()
    .setTitle(t('help.admin_title'))
    .setColor(getColor(guildId, 'special'))
    .addFields(
      { name: t('help.admin_end_title'), value: t('help.admin_end_value'), inline: false },
      { name: t('help.admin_clear_title'), value: t('help.admin_clear_value'), inline: false },
      { name: t('help.admin_debug_phase_title'), value: t('help.admin_debug_phase_value'), inline: false },
      { name: t('help.admin_debug_title'), value: t('help.admin_debug_value'), inline: false }
    )
    .setFooter({ text: t('help.admin_footer') });

const HELP_SECTIONS = {
  overview: buildOverviewEmbed,
  setup: buildSetupEmbed,
  night: buildNightEmbed,
  day: buildDayEmbed,
  admin: buildAdminEmbed
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName("help")
    .setDescription("📖 Afficher l'aide complète du bot Loup-Garou"),

  async execute(interaction) {
    const select = new StringSelectMenuBuilder()
      .setCustomId("help_menu")
      .setPlaceholder(t('ui.select.placeholder'))
      .addOptions(
        { label: t('ui.select.overview'), value: "overview", description: t('ui.select.overview_desc'), emoji: "📌" },
        { label: t('ui.select.setup'), value: "setup", description: t('ui.select.setup_desc'), emoji: "🧩" },
        { label: t('ui.select.night'), value: "night", description: t('ui.select.night_desc'), emoji: "🌙" },
        { label: t('ui.select.day'), value: "day", description: t('ui.select.day_desc'), emoji: "☀️" },
        { label: t('ui.select.admin'), value: "admin", description: t('ui.select.admin_desc'), emoji: "🛠️" }
      );

    const row = new ActionRowBuilder().addComponents(select);
    const guildId = interaction.guildId;
    const embed = buildOverviewEmbed(guildId);

    await interaction.reply({
      embeds: [embed],
      components: [row],
      flags: MessageFlags.Ephemeral
    });

    const message = await interaction.fetchReply();
    const collector = message.createMessageComponentCollector({
      componentType: ComponentType.StringSelect,
      time: 120000
    });

    collector.on("collect", async (selectInteraction) => {
      if (selectInteraction.user.id !== interaction.user.id) {
        await selectInteraction.reply({ content: t('error.help_author_only'), flags: MessageFlags.Ephemeral });
        return;
      }

      const key = selectInteraction.values[0];
      const builder = HELP_SECTIONS[key] || buildOverviewEmbed;
      await selectInteraction.update({ embeds: [builder(guildId)], components: [row] });
    });

    collector.on("end", async () => {
      try {
        select.setDisabled(true);
        await message.edit({ components: [new ActionRowBuilder().addComponents(select)] });
      } catch (e) {
        // Ignore edit failures
      }
    });
  }
};