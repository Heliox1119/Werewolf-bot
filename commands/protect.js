const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const gameManager = require("../game/gameManager");
const ROLES = require("../game/roles");
const PHASES = require("../game/phases");
const { safeReply } = require("../utils/interaction");
const { isInGameCategory } = require("../utils/validators");
const { t } = require("../utils/i18n");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("protect")
    .setDescription("Salvateur : protéger un joueur cette nuit")
    .addUserOption(option =>
      option
        .setName("target")
        .setDescription("Le joueur à protéger")
        .setRequired(true)
    ),

  async execute(interaction) {
    // Vérification catégorie
    if (!await isInGameCategory(interaction)) {
      await safeReply(interaction, { content: t('error.action_forbidden'), flags: MessageFlags.Ephemeral });
      return;
    }

    const game = gameManager.getGameByChannelId(interaction.channelId);
    if (!game) {
      await safeReply(interaction, { content: t('error.no_game'), flags: MessageFlags.Ephemeral });
      return;
    }

    // Vérifier que c'est le channel du salvateur
    if (interaction.channelId !== game.salvateurChannelId) {
      await safeReply(interaction, { content: t('error.only_salvateur_channel'), flags: MessageFlags.Ephemeral });
      return;
    }

    // Vérifier que c'est la nuit
    if (game.phase !== PHASES.NIGHT) {
      await safeReply(interaction, { content: t('error.salvateur_night_only'), flags: MessageFlags.Ephemeral });
      return;
    }

    // Vérifier que c'est la sous-phase du salvateur
    if (game.subPhase !== PHASES.SALVATEUR) {
      await safeReply(interaction, { content: t('error.not_salvateur_turn'), flags: MessageFlags.Ephemeral });
      return;
    }

    // Vérifier que c'est le salvateur vivant
    const player = game.players.find(p => p.id === interaction.user.id);
    if (!player || player.role !== ROLES.SALVATEUR) {
      await safeReply(interaction, { content: t('error.not_salvateur'), flags: MessageFlags.Ephemeral });
      return;
    }
    if (!player.alive) {
      await safeReply(interaction, { content: t('error.salvateur_dead'), flags: MessageFlags.Ephemeral });
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
      await safeReply(interaction, { content: t('error.target_dead'), flags: MessageFlags.Ephemeral });
      return;
    }

    // Ne peut pas protéger soi-même
    if (target.id === interaction.user.id) {
      await safeReply(interaction, { content: t('error.cannot_protect_self'), flags: MessageFlags.Ephemeral });
      return;
    }

    // Ne peut pas protéger la même personne deux nuits de suite
    if (game.lastProtectedPlayerId && game.lastProtectedPlayerId === target.id) {
      await safeReply(interaction, { content: t('error.cannot_protect_same'), flags: MessageFlags.Ephemeral });
      return;
    }

    // Enregistrer la protection
    game.protectedPlayerId = target.id;
    gameManager.logAction(game, `Salvateur protège ${targetPlayer.username}`);

    await safeReply(interaction, { content: t('cmd.protect.success', { name: targetPlayer.username }) });

    // Avancer la sous-phase
    gameManager.clearNightAfkTimeout(game);
    await gameManager.advanceSubPhase(interaction.guild, game);
  },
};
