const { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } = require("discord.js");
const gameManager = require("../game/gameManager");
const { checkCategoryAndDefer } = require("../utils/commands");
const { t } = require('../utils/i18n');

module.exports = {
  data: new SlashCommandBuilder()
    .setName("debugvoicemute")
    .setDescription("🛠️ [ADMIN] Désactiver le mute/unmute automatique (debug)")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    // Vérification admin
    if (!interaction.member.permissions.has('Administrator')) {
      await interaction.reply({ content: t('error.admin_only'), flags: MessageFlags.Ephemeral });
      return;
    }
    // Vérification catégorie et defer
    if (!await checkCategoryAndDefer(interaction)) return;
    const game = gameManager.getGameByChannelId(interaction.channelId);
    if (!game) {
      await interaction.editReply({ content: t('error.no_game'), flags: MessageFlags.Ephemeral });
      return;
    }
    // Ajoute un flag debug
    await gameManager.runAtomic(game.mainChannelId, (state) => {
      state.disableVoiceMute = true;
    });
    gameManager.scheduleSave();
    await interaction.editReply({ content: t('cmd.debug_voicemute.success'), flags: MessageFlags.Ephemeral });
  }
};
