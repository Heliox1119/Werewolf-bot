const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const gameManager = require("../game/gameManager");
const ROLES = require("../game/roles");
const PHASES = require("../game/phases");
const { isInGameCategory } = require("../utils/validators");
const { safeReply } = require("../utils/interaction");
const { t, translateRole } = require('../utils/i18n');

module.exports = {
  data: new SlashCommandBuilder()
    .setName("see")
    .setDescription("Voyante : découvrir le rôle d'un joueur")
    .addUserOption(option =>
      option
        .setName("target")
        .setDescription("Le joueur à espionner")
        .setRequired(true)
    ),

  async execute(interaction) {
    // Vérification catégorie
    if (!await isInGameCategory(interaction)) {
      await safeReply(interaction, { content: t('error.action_forbidden'), flags: MessageFlags.Ephemeral });
      return;
    }
    if (gameManager.isRecentDuplicate('see', interaction.channelId, interaction.user.id)) {
      return;
    }
    const game = gameManager.getGameByChannelId(interaction.channelId);
    if (!game) {
      await safeReply(interaction, { content: t('error.no_game'), flags: MessageFlags.Ephemeral });
      return;
    }
    // Vérifier que c'est le channel de la voyante
    if (interaction.channelId !== game.seerChannelId) {
      await safeReply(interaction, { content: t('error.only_seer_channel'), flags: MessageFlags.Ephemeral });
      return;
    }

    // Vérifier que c'est la nuit ET la sous-phase de la voyante
    if (game.phase !== PHASES.NIGHT) {
      await safeReply(interaction, { content: t('error.seer_night_only'), flags: MessageFlags.Ephemeral });
      return;
    }
    if (game.subPhase !== PHASES.VOYANTE) {
      await safeReply(interaction, { content: t('error.not_seer_turn'), flags: MessageFlags.Ephemeral });
      return;
    }

    // Vérifier que c'est la voyante vivante
    const player = game.players.find(p => p.id === interaction.user.id);
    if (!player || player.role !== ROLES.SEER) {
      await safeReply(interaction, { content: t('error.not_seer'), flags: MessageFlags.Ephemeral });
      return;
    }
    if (!player.alive) {
      await safeReply(interaction, { content: t('error.seer_dead'), flags: MessageFlags.Ephemeral });
      return;
    }

    // Vérifier perte de pouvoirs (Ancien tué par le village)
    if (game.villageRolesPowerless) {
      await safeReply(interaction, { content: t('error.powers_lost'), flags: MessageFlags.Ephemeral });
      return;
    }

    const target = interaction.options.getUser("target");
    const targetPlayer = game.players.find(p => p.id === target.id);

    if (!targetPlayer) {
      await safeReply(interaction, { content: t('error.player_not_found'), flags: MessageFlags.Ephemeral });
      return;
    }

    if (!targetPlayer.alive) {
      await safeReply(interaction, { content: t('error.target_already_dead'), flags: MessageFlags.Ephemeral });
      return;
    }

    gameManager.clearNightAfkTimeout(game);
    const actionResult = gameManager.db.addNightActionOnce(game.mainChannelId, game.dayCount || 0, 'see', interaction.user.id, target.id);
    if (!actionResult.ok) {
      await safeReply(interaction, { content: t('error.internal'), flags: MessageFlags.Ephemeral });
      return;
    }
    if (actionResult.affectedRows === 0) {
      await safeReply(interaction, { content: t('error.not_seer_turn'), flags: MessageFlags.Ephemeral });
      return;
    }

    await safeReply(interaction, { content: t('cmd.see.result', { name: target.username, role: translateRole(targetPlayer.role) }), flags: MessageFlags.Ephemeral });
    gameManager.logAction(game, `Voyante regarde ${target.username} (${targetPlayer.role})`);

    // Track achievement: seer found a wolf
    if (targetPlayer.role === ROLES.WEREWOLF && gameManager.achievements) {
      try { gameManager.achievements.trackEvent(player.id, 'seer_found_wolf'); } catch (e) { /* ignore */ }
    }

    if (game.phase === PHASES.NIGHT) {
      // advanceSubPhase handles REVEIL → transitionToDay automatically
      await gameManager.advanceSubPhase(interaction.guild, game);
    }
  }
};
