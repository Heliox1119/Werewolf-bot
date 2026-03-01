const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const gameManager = require("../game/gameManager");
const { isInGameCategory } = require("../utils/validators");
const { safeReply } = require("../utils/interaction");
const { t } = require('../utils/i18n');
const { buildStatusEmbed, buildPlayerEmbed, buildSpectatorEmbed } = require('../game/gameStateView');

module.exports = {
  data: new SlashCommandBuilder()
    .setName("status")
    .setDescription("Voir l'état de la partie / Game status panel"),

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

    // Choose embed based on channel context
    const embed = isSpectator
      ? buildSpectatorEmbed(game, timerInfo, guildId)
      : buildStatusEmbed(game, timerInfo, guildId);

    // Send public status embed (visible to all, registered for auto-update)
    await safeReply(interaction, { embeds: [embed] });

    // Register panel for auto-update on state changes
    try {
      const msg = await interaction.fetchReply();
      if (msg) {
        if (!gameManager.statusPanels.has(game.mainChannelId)) {
          gameManager.statusPanels.set(game.mainChannelId, {});
        }
        const ref = gameManager.statusPanels.get(game.mainChannelId);
        if (isSpectator) {
          ref.spectatorMsg = msg;
        } else {
          ref.villageMsg = msg;
        }
      }
    } catch (_) { /* ignore fetch failures */ }

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
