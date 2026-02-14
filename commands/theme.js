const { SlashCommandBuilder } = require("discord.js");
const { setTheme, getThemeKey, listThemes, getColor } = require("../utils/theme");
const { EmbedBuilder } = require("discord.js");
const { t } = require("../utils/i18n");
const { safeReply } = require("../utils/interaction");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("theme")
    .setDescription(t('cmd.theme.desc'))
    .addStringOption(option =>
      option
        .setName("name")
        .setDescription(t('cmd.theme.option_name'))
        .setRequired(true)
        .addChoices(
          { name: "🐺 Classic", value: "classic" },
          { name: "🌙 Midnight", value: "midnight" },
          { name: "🌿 Nature", value: "nature" },
          { name: "🩸 Blood Moon", value: "blood" },
        )
    ),

  async execute(interaction) {
    const themeName = interaction.options.getString("name");
    const guildId = interaction.guildId;

    const success = setTheme(guildId, themeName);
    if (!success) {
      return safeReply(interaction, { content: t('cmd.theme.invalid'), ephemeral: true });
    }

    const themes = listThemes();
    const selected = themes.find(th => th.key === themeName);

    const embed = new EmbedBuilder()
      .setTitle(t('cmd.theme.title'))
      .setDescription(t('cmd.theme.applied', { theme: `${selected.emoji} ${selected.name}` }))
      .setColor(getColor(guildId, 'primary'))
      .addFields(
        themes.map(th => ({
          name: `${th.emoji} ${th.name}`,
          value: th.key === themeName ? '✅' : '—',
          inline: true,
        }))
      );

    return safeReply(interaction, { embeds: [embed], ephemeral: true });
  },
};
