const { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } = require("discord.js");
const gameManager = require("../game/gameManager");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("debug-reset")
    .setDescription("🐛 [DEBUG] Réinitialiser la partie en mémoire")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    if (!interaction.member.permissions.has("ADMINISTRATOR")) {
      await interaction.reply({ content: "❌ Admin only", flags: MessageFlags.Ephemeral });
      return;
    }

    const game = gameManager.getGameByChannelId(interaction.channelId);
    if (!game) {
      await interaction.reply({ content: "❌ Aucune partie ici", flags: MessageFlags.Ephemeral });
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
      content: "✅ Partie supprimée de la mémoire ! Utilise `/create` pour recommencer.",
      flags: MessageFlags.Ephemeral
    });
  }
};
