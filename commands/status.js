const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const gameManager = require("../game/gameManager");
const { isInGameCategory } = require("../utils/validators");
const { safeReply } = require("../utils/interaction");
const { t } = require('../utils/i18n');
const { buildPlayerEmbed } = require('../game/gameStateView');

module.exports = {
  data: new SlashCommandBuilder()
    .setName("status")
    .setDescription("Voir l'état de la partie / Game status panel"),

  /**
   * GUI_MASTER architecture: /status does NOT create any new public message.
   * It forces an immediate refresh of all existing GUI panels (village master,
   * role channels, spectator) and replies with an ephemeral confirmation.
   * Optionally shows the private player view (role + contextual info).
   */
  async execute(interaction) {
    // Vérification catégorie
    if (!await isInGameCategory(interaction)) {
      await safeReply(interaction, { content: t('error.action_forbidden'), flags: MessageFlags.Ephemeral });
      return;
    }

    const game = gameManager.getGameByChannelId(interaction.channelId);
    if (!game) {
      return safeReply(interaction, { content: t('gui.no_game'), flags: MessageFlags.Ephemeral });
    }

    const guildId = interaction.guildId;
    const timerInfo = gameManager.getTimerInfo(game.mainChannelId);
    const isSpectator = interaction.channelId === game.spectatorChannelId;
    const player = game.players.find(p => p.id === interaction.user.id);

    // Force-refresh all existing GUI panels (edit in place, no new messages)
    try {
      await gameManager._refreshAllGui(game.mainChannelId);
    } catch (_) { /* ignore refresh failures */ }

    // Ephemeral confirmation — no public message created
    await safeReply(interaction, {
      content: t('gui.status_refreshed'),
      flags: MessageFlags.Ephemeral,
    });

    // Ephemeral player view (follow-up, only for game participants)
    if (player && !isSpectator) {
      const playerEmbed = buildPlayerEmbed(game, interaction.user.id, timerInfo, guildId);
      if (playerEmbed) {
        try {
          await interaction.followUp({ embeds: [playerEmbed], flags: MessageFlags.Ephemeral });
        } catch (_) { /* ignore followUp failures */ }
      }
    }
  }
};
