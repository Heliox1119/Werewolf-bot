const { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } = require("discord.js");
const gameManager = require("../game/gameManager");
const { t } = require('../utils/i18n');

module.exports = {
  data: new SlashCommandBuilder()
    .setName("debug-reset")
    .setDescription("🐛 [DEBUG] Réinitialiser la partie en mémoire")
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

    // Déconnecter la voix
    if (game.voiceChannelId) {
      gameManager.disconnectVoice(game.voiceChannelId);
    }

    // Effacer la partie de la mémoire et de la DB
    try { gameManager.db.deleteGame(interaction.channelId); } catch (e) { /* ignore */ }
    gameManager.games.delete(interaction.channelId);

    await interaction.reply({
      content: t('cmd.debug_reset.success'),
      flags: MessageFlags.Ephemeral
    });
  }
};
