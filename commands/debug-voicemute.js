const { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } = require("discord.js");
const gameManager = require("../game/gameManager");
const { checkCategoryAndDefer } = require("../utils/commands");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("debugvoicemute")
    .setDescription("🛠️ [ADMIN] Désactiver le mute/unmute automatique (debug)")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    // Vérification admin
    if (!interaction.member.permissions.has("ADMINISTRATOR")) {
      await interaction.reply({ content: "❌ Admin only", flags: MessageFlags.Ephemeral });
      return;
    }
    // Vérification catégorie et defer
    if (!await checkCategoryAndDefer(interaction)) return;
    const game = gameManager.getGameByChannelId(interaction.channelId);
    if (!game) {
      await interaction.editReply({ content: "❌ Aucune partie ici", flags: MessageFlags.Ephemeral });
      return;
    }
    // Ajoute un flag debug
    game.disableVoiceMute = true;
    gameManager.scheduleSave();
    await interaction.editReply({ content: "🛠️ Mute/unmute automatique désactivé pour cette partie.", flags: MessageFlags.Ephemeral });
  }
};
