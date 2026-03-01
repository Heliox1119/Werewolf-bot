const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const gameManager = require("../game/gameManager");
const ROLES = require("../game/roles");
const PHASES = require("../game/phases");
const { safeReply } = require("../utils/interaction");
const { isInGameCategory } = require("../utils/validators");
const { t } = require("../utils/i18n");
const {
  getAliveWolves,
  registerWolfVote,
  processWolfVote,
  getWolfMajority,
} = require("../game/wolfVoteEngine");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("kill")
    .setDescription("Loups-garous : choisir une victime")
    .addUserOption(option =>
      option
        .setName("target")
        .setDescription("La victime")
        .setRequired(true)
    ),

  async execute(interaction) {
    // Vérification catégorie
    if (!await isInGameCategory(interaction)) {
      await safeReply(interaction, { content: t('error.action_forbidden'), flags: MessageFlags.Ephemeral });
      return;
    }
    if (gameManager.isRecentDuplicate('kill', interaction.channelId, interaction.user.id)) {
      return;
    }
    const game = gameManager.getGameByChannelId(interaction.channelId);
    if (!game) {
      await safeReply(interaction, { content: t('error.no_game'), flags: MessageFlags.Ephemeral });
      return;
    }

    // Vérifier que c'est la nuit
    if (game.phase !== PHASES.NIGHT) {
      await safeReply(interaction, { content: t('error.wolves_only_at_night'), flags: MessageFlags.Ephemeral });
      return;
    }

    const player = game.players.find(p => p.id === interaction.user.id);
    if (!player || !player.alive) {
      await safeReply(interaction, { content: t('error.you_are_dead'), flags: MessageFlags.Ephemeral });
      return;
    }

    // === LOUP BLANC solo kill phase ===
    if (interaction.channelId === game.whiteWolfChannelId && game.subPhase === PHASES.LOUP_BLANC) {
      return await this.handleWhiteWolfKill(interaction, game, player);
    }

    // === Regular wolves kill phase ===
    if (interaction.channelId !== game.wolvesChannelId) {
      await safeReply(interaction, { content: t('error.only_wolves_channel'), flags: MessageFlags.Ephemeral });
      return;
    }
    if (game.subPhase !== PHASES.LOUPS) {
      await safeReply(interaction, { content: t('error.not_wolves_turn'), flags: MessageFlags.Ephemeral });
      return;
    }

    // Vérifier que c'est un loup vivant (WEREWOLF ou WHITE_WOLF)
    const isWolf = player.role === ROLES.WEREWOLF || player.role === ROLES.WHITE_WOLF;
    if (!isWolf) {
      await safeReply(interaction, { content: t('error.not_werewolf'), flags: MessageFlags.Ephemeral });
      return;
    }

    const target = interaction.options.getUser("target");
    const targetPlayer = game.players.find(p => p.id === target.id);

    if (!targetPlayer) {
      await safeReply(interaction, { content: t('error.player_not_found'), flags: MessageFlags.Ephemeral });
      return;
    }

    if (!targetPlayer.alive) {
      await safeReply(interaction, { content: t('error.player_already_dead'), flags: MessageFlags.Ephemeral });
      return;
    }

    // Les loups ne peuvent pas tuer un autre loup (pendant la phase LOUPS)
    if (targetPlayer.role === ROLES.WEREWOLF || targetPlayer.role === ROLES.WHITE_WOLF) {
      await safeReply(interaction, { content: t('error.cannot_kill_wolf'), flags: MessageFlags.Ephemeral });
      return;
    }

    // Check resolved
    if (game.wolvesVoteState && game.wolvesVoteState.resolved) {
      await safeReply(interaction, { content: t('error.wolves_already_resolved'), flags: MessageFlags.Ephemeral });
      return;
    }

    const aliveWolves = getAliveWolves(game, (id) => gameManager.isRealPlayerId(id));
    const aliveWolfIds = aliveWolves.map(w => w.id);
    const totalWolves = aliveWolves.length;
    const majorityNeeded = getWolfMajority(totalWolves);

    let outcome;
    try {
      outcome = await gameManager.runAtomic(game.mainChannelId, (state) => {
        const votesForTarget = registerWolfVote(state.wolvesVoteState, interaction.user.id, target.id);
        if (votesForTarget === null) {
          return { action: 'already_resolved' };
        }
        gameManager.db.addVoteIfChanged(state.mainChannelId, interaction.user.id, target.id, 'wolves', state.dayCount || 0);

        const result = processWolfVote(state.wolvesVoteState, aliveWolfIds, totalWolves);

        if (result.action === 'kill') {
          const victimPlayer = state.players.find(p => p.id === result.targetId);
          state.nightVictim = result.targetId;
          gameManager.db.clearVotes(state.mainChannelId, 'wolves', state.dayCount || 0);
          gameManager.clearNightAfkTimeout(state);
          const victimName = victimPlayer ? victimPlayer.username : result.targetId;
          gameManager.logAction(state, `Loups choisissent: ${victimName} (majorité ${result.votesForTarget}/${totalWolves})`);
          const ok = gameManager.db.addNightAction(state.mainChannelId, state.dayCount || 0, 'kill', interaction.user.id, result.targetId);
          if (!ok) throw new Error('Failed to persist wolf kill action');
          result.victimName = victimName;
        } else if (result.action === 'advance_round') {
          gameManager.db.clearVotes(state.mainChannelId, 'wolves', state.dayCount || 0);
          gameManager.logAction(state, 'Loups: pas de majorité round 1, passage au round 2');
        } else if (result.action === 'no_kill') {
          gameManager.db.clearVotes(state.mainChannelId, 'wolves', state.dayCount || 0);
          gameManager.clearNightAfkTimeout(state);
          gameManager.logAction(state, 'Loups: consensus impossible après 2 rounds, personne ne meurt');
        }

        return result;
      });
    } catch (e) {
      await safeReply(interaction, { content: t('error.internal'), flags: MessageFlags.Ephemeral });
      return;
    }

    if (outcome.action === 'already_resolved') {
      await safeReply(interaction, { content: t('error.wolves_already_resolved'), flags: MessageFlags.Ephemeral });
      return;
    }

    if (outcome.action === 'kill') {
      await safeReply(interaction, { content: t('cmd.kill.wolves_majority_reached', { name: outcome.victimName }), flags: MessageFlags.Ephemeral });
      await gameManager._refreshAllGui(game.mainChannelId).catch(() => {});
      await this.advanceFromWolves(interaction.guild, game);
    } else if (outcome.action === 'advance_round') {
      await safeReply(interaction, { content: t('cmd.kill.wolves_round2_start'), flags: MessageFlags.Ephemeral });
      try {
        const wolvesChannel = await interaction.guild.channels.fetch(game.wolvesChannelId);
        await wolvesChannel.send(t('cmd.kill.wolves_no_consensus_warning'));
      } catch (_) { /* ignore */ }
      await gameManager._refreshAllGui(game.mainChannelId).catch(() => {});
    } else if (outcome.action === 'no_kill') {
      await safeReply(interaction, { content: t('cmd.kill.wolves_no_kill'), flags: MessageFlags.Ephemeral });
      try {
        const wolvesChannel = await interaction.guild.channels.fetch(game.wolvesChannelId);
        await wolvesChannel.send(t('cmd.kill.wolves_no_kill'));
      } catch (_) { /* ignore */ }
      await gameManager._refreshAllGui(game.mainChannelId).catch(() => {});
      await this.advanceFromWolves(interaction.guild, game);
    } else {
      await safeReply(interaction, { content: t('cmd.kill.wolves_vote_registered', { name: target.username, n: outcome.votesForTarget, m: majorityNeeded }), flags: MessageFlags.Ephemeral });
      await gameManager._refreshAllGui(game.mainChannelId).catch(() => {});
    }
  },

  /**
   * Advance from LOUPS phase — delegates to the single-source-of-truth advanceSubPhase().
   */
  async advanceFromWolves(guild, game) {
    await gameManager.advanceSubPhase(guild, game);
  },

  /**
   * Handle the White Wolf's solo kill during LOUP_BLANC phase.
   * The White Wolf can kill ONE other wolf (WEREWOLF only, not itself).
   */
  async handleWhiteWolfKill(interaction, game, player) {
    if (player.role !== ROLES.WHITE_WOLF) {
      await safeReply(interaction, { content: t('error.action_forbidden'), flags: MessageFlags.Ephemeral });
      return;
    }

    const target = interaction.options.getUser("target");
    const targetPlayer = game.players.find(p => p.id === target.id);

    if (!targetPlayer) {
      await safeReply(interaction, { content: t('error.player_not_found'), flags: MessageFlags.Ephemeral });
      return;
    }

    if (!targetPlayer.alive) {
      await safeReply(interaction, { content: t('error.player_already_dead'), flags: MessageFlags.Ephemeral });
      return;
    }

    // Le Loup Blanc ne peut tuer que des loups normaux (pas lui-même, pas des villageois)
    if (targetPlayer.role !== ROLES.WEREWOLF) {
      await safeReply(interaction, { content: t('error.white_wolf_target_must_be_wolf'), flags: MessageFlags.Ephemeral });
      return;
    }

    try {
      await gameManager.runAtomic(game.mainChannelId, () => {
        game.whiteWolfKillTarget = target.id;
        gameManager.clearNightAfkTimeout(game);
        gameManager.logAction(game, `Loup Blanc choisit de dévorer: ${target.username}`);
        const ok = gameManager.db.addNightAction(game.mainChannelId, game.dayCount || 0, 'white_wolf_kill', interaction.user.id, target.id);
        if (!ok) throw new Error('Failed to persist white wolf action');
      });
    } catch (e) {
      await safeReply(interaction, { content: t('error.internal'), flags: MessageFlags.Ephemeral });
      return;
    }

    await safeReply(interaction, { content: t('cmd.kill.white_wolf_success', { name: target.username }), flags: MessageFlags.Ephemeral });

    // Advance to next sub-phase via centralized logic
    await gameManager.advanceSubPhase(interaction.guild, game);
  }
};
