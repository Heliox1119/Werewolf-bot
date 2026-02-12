const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const gameManager = require("../game/gameManager");
const { isInGameCategory } = require("../utils/validators");
const { safeReply } = require("../utils/interaction");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("join")
    .setDescription("Rejoindre la partie"),

  async execute(interaction) {
    // Vérification catégorie
    if (!await isInGameCategory(interaction)) {
      await safeReply(interaction, { content: "❌ Action interdite ici. Utilisez cette commande dans la catégorie dédiée au jeu.", flags: MessageFlags.Ephemeral });
      return;
    }
    // Trouver la partie via n'importe quel channel de la catégorie
    const game = gameManager.getGameByChannelId(interaction.channelId);
    if (!game) {
      await safeReply(interaction, { content: "❌ Aucune partie ici.", flags: MessageFlags.Ephemeral });
      return;
    }
    const ok = gameManager.join(game.mainChannelId, interaction.user);
    if (!ok) {
      await safeReply(interaction, { content: "❌ Impossible de rejoindre (déjà inscrit ou partie en cours).", flags: MessageFlags.Ephemeral });
      return;
    }
    await safeReply(interaction, {
      content: `✅ ${interaction.user.username} rejoint la partie`
    });

    // Mettre à jour le lobby embed
    try {
      if (game.lobbyMessageId) {
        const { buildLobbyMessage } = require('../utils/lobbyBuilder');
        const mainChannel = await interaction.guild.channels.fetch(game.mainChannelId);
        const lobbyMessage = await mainChannel.messages.fetch(game.lobbyMessageId);
        const lobbyData = buildLobbyMessage(game.players, game);
        await lobbyMessage.edit(lobbyData);
      }
    } catch (e) { /* ignore */ }
  }
};
