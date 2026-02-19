const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const gameManager = require("../game/gameManager");
const ROLES = require("../game/roles");
const { isInGameCategory } = require("../utils/validators");
const { safeReply } = require("../utils/interaction");
const { commands: logger } = require("../utils/logger");
const { t } = require('../utils/i18n');

// Chance que les loups soient alertés (30%)
const DETECTION_CHANCE = 0.3;

module.exports = {
  data: new SlashCommandBuilder()
    .setName("listen")
    .setDescription("Petite Fille : espionner les loups en temps réel (DM anonymisé)")
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

    // Déjà en écoute ?
    if (game.listenRelayUserId === interaction.user.id) {
      await safeReply(interaction, { content: t('error.already_listening'), flags: MessageFlags.Ephemeral });
      return;
    }

    try {
      // Activer le relais temps réel
      game.listenRelayUserId = interaction.user.id;

      // Envoyer un DM de confirmation à la Petite Fille
      await interaction.user.send(t('cmd.listen.relay_started'));
      await safeReply(interaction, { content: t('cmd.listen.relay_active'), flags: MessageFlags.Ephemeral });

      // Chance de détection par les loups
      if (Math.random() < DETECTION_CHANCE) {
        const wolvesChannel = await interaction.guild.channels.fetch(game.wolvesChannelId);
        if (wolvesChannel) {
          // Indice : première lettre du pseudo
          const firstLetter = player.username.charAt(0).toUpperCase();
          await wolvesChannel.send(t('cmd.listen.wolves_alert', { letter: firstLetter }));
        }
      }

      // Log l'action
      gameManager.logAction(game.mainChannelId, {
        type: 'listen',
        playerId: interaction.user.id,
        detected: false
      });

    } catch (err) {
      logger.error("Erreur /listen:", { error: err.message });
      game.listenRelayUserId = null;
      await safeReply(interaction, { content: t('error.listen_fetch_error'), flags: MessageFlags.Ephemeral });
    }
  }
};
