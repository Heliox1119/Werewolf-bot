const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { app: logger } = require('../utils/logger');
const { t, setLocale, getLocale, getAvailableLocales } = require('../utils/i18n');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('lang')
    .setDescription('🌐 Change the bot language / Changer la langue du bot')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(option =>
      option
        .setName('language')
        .setDescription('Language / Langue')
        .setRequired(true)
        .addChoices(
          { name: '🇫🇷 Français', value: 'fr' },
          { name: '🇬🇧 English', value: 'en' }
        )
    ),

  async execute(interaction) {
    const locale = interaction.options.getString('language');

    try {
      // Get the config DB
      const ConfigManager = require('../utils/config');
      const config = ConfigManager.getInstance();
      const configDb = config?.db || null;

      const success = setLocale(locale, configDb);

      if (!success) {
        const available = getAvailableLocales().join(', ');
        return interaction.reply({
          content: t('lang.invalid', { list: available }),
          flags: MessageFlags.Ephemeral,
        });
      }

      const langName = t('lang.names.' + locale);
      return interaction.reply({
        content: t('lang.changed', { locale, name: langName }),
      });
    } catch (error) {
      logger.error('Error changing language', { error: error.message });
      return interaction.reply({
        content: '❌ Error / Erreur',
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};
