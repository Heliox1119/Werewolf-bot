const { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const { t } = require('../utils/i18n');
const gameManager = require('../game/gameManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('debug-toggle-fakephases')
    .setDescription('🐛 [DEBUG] Active/désactive les phases pour les bots/fake joueurs')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    if (!interaction.member.permissions.has('Administrator')) {
      await interaction.reply({ content: t('error.admin_only'), flags: MessageFlags.Ephemeral });
      return;
    }
    const game = gameManager.getGameByChannelId(interaction.channelId);
    if (!game) {
      await interaction.reply({ content: t('error.no_game'), flags: MessageFlags.Ephemeral });
      return;
    }
    // Default is undefined (=skip fake phases). Toggle between false (play all) and true/undefined (skip)
    if (game.skipFakePhases === false) {
      game.skipFakePhases = true;
    } else {
      game.skipFakePhases = false;
    }
    const status = game.skipFakePhases === false
      ? '▶️ Phases des bots/fake joueurs: **activées** (jouées normalement avec AFK timeout)'
      : '⏭️ Phases des bots/fake joueurs: **désactivées** (skip automatique)';
    await interaction.reply({ content: status });
  }
};
