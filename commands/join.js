const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const gameManager = require("../game/gameManager");
const { isInGameCategory } = require("../utils/validators");
const { safeReply } = require("../utils/interaction");
const { t } = require('../utils/i18n');

module.exports = {
  data: new SlashCommandBuilder()
    .setName("join")
    .setDescription("Rejoindre la partie"),

  async execute(interaction) {
    // Vérification catégorie
    if (!await isInGameCategory(interaction)) {
      await safeReply(interaction, { content: t('error.action_forbidden'), flags: MessageFlags.Ephemeral });
      return;
    }
    if (gameManager.isRecentDuplicate('join', interaction.channelId, interaction.user.id)) {
      return;
    }
    // Trouver la partie via n'importe quel channel de la catégorie
    const game = gameManager.getGameByChannelId(interaction.channelId);
    if (!game) {
      await safeReply(interaction, { content: t('error.no_game_dot'), flags: MessageFlags.Ephemeral });
      return;
    }
    const ok = gameManager.join(game.mainChannelId, interaction.user);
    if (!ok) {
      await safeReply(interaction, { content: t('error.join_failed'), flags: MessageFlags.Ephemeral });
      return;
    }
    await safeReply(interaction, {
      content: t('lobby.join_success', { name: interaction.user.username })
    });

    // Mettre à jour le lobby embed
    try {
      if (game.lobbyMessageId) {
        const { buildLobbyMessage } = require('../utils/lobbyBuilder');
        const mainChannel = await interaction.guild.channels.fetch(game.mainChannelId);
        const lobbyMessage = await mainChannel.messages.fetch(game.lobbyMessageId);
        const lobbyData = buildLobbyMessage(game, game.lobbyHostId);
        await lobbyMessage.edit(lobbyData);
      }
    } catch (e) { /* ignore */ }
  }
};
