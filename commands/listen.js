const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const gameManager = require("../game/gameManager");
const ROLES = require("../game/roles");
const { isInGameCategory } = require("../utils/validators");
const { safeReply } = require("../utils/interaction");
const { commands: logger } = require("../utils/logger");
const { t } = require('../utils/i18n');

module.exports = {
  data: new SlashCommandBuilder()
    .setName("listen")
    .setDescription("Petite Fille : écouter les chuchotements des loups (DM)")
    ,

  async execute(interaction) {
    // Vérification catégorie
    if (!await isInGameCategory(interaction)) {
      await safeReply(interaction, { content: t('error.action_forbidden'), flags: MessageFlags.Ephemeral });
      return;
    }
    if (!interaction.guild) {
      await safeReply(interaction, { content: t('error.listen_server_only'), flags: MessageFlags.Ephemeral });
      return;
    }
    // Trouver la partie associée (par channel ou par joueur)
    let game = gameManager.getGameByChannelId(interaction.channelId);
    if (!game) {
      game = Array.from(gameManager.games.values()).find(g => g.players.some(p => p.id === interaction.user.id));
    }
    if (!game) {
      await safeReply(interaction, { content: t('error.not_in_any_game'), flags: MessageFlags.Ephemeral });
      return;
    }

    const player = game.players.find(p => p.id === interaction.user.id);
    if (!player || player.role !== ROLES.PETITE_FILLE) {
      await safeReply(interaction, { content: t('error.not_petite_fille'), flags: MessageFlags.Ephemeral });
      return;
    }

    if (!player.alive) {
      await safeReply(interaction, { content: t('error.dead_cannot_listen'), flags: MessageFlags.Ephemeral });
      return;
    }

    // Vérifier perte de pouvoirs (Ancien tué par le village)
    if (game.villageRolesPowerless) {
      await safeReply(interaction, { content: t('error.powers_lost'), flags: MessageFlags.Ephemeral });
      return;
    }

    // La Petite Fille ne peut espionner que pendant la sous-phase des loups
    const PHASES = require('../game/phases');
    if (game.phase !== PHASES.NIGHT) {
      await safeReply(interaction, { content: t('error.listen_night_only'), flags: MessageFlags.Ephemeral });
      return;
    }
    if (game.subPhase !== PHASES.LOUPS) {
      await safeReply(interaction, { content: t('error.wolves_not_deliberating'), flags: MessageFlags.Ephemeral });
      return;
    }

    if (!game.wolvesChannelId) {
      await safeReply(interaction, { content: t('error.wolves_channel_missing'), flags: MessageFlags.Ephemeral });
      return;
    }

    try {
      const wolvesChannel = await interaction.guild.channels.fetch(game.wolvesChannelId);
      if (!wolvesChannel) {
        await safeReply(interaction, { content: t('error.wolves_channel_fetch_failed'), flags: MessageFlags.Ephemeral });
        return;
      }

      const messages = await wolvesChannel.messages.fetch({ limit: 20 });
      const recent = Array.from(messages.values()).reverse().slice(-10);

      if (recent.length === 0) {
        await interaction.user.send(t('cmd.listen.empty'));
        await safeReply(interaction, { content: t('cmd.listen.dm_sent_empty'), flags: MessageFlags.Ephemeral });
        return;
      }

      const summary = recent.map(m => `• ${m.author.username}: ${m.content}`).join("\n");

      await interaction.user.send(t('cmd.listen.summary', { summary }));
      await safeReply(interaction, { content: t('cmd.listen.dm_sent'), flags: MessageFlags.Ephemeral });
    } catch (err) {
      logger.error("Erreur /listen:", { error: err.message });
      await safeReply(interaction, { content: t('error.listen_fetch_error'), flags: MessageFlags.Ephemeral });
    }
  }
};
