const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const gameManager = require("../game/gameManager");
const PHASES = require("../game/phases");
const ROLES = require("../game/roles");
const { safeReply } = require("../utils/interaction");
const { isInGameCategory } = require("../utils/validators");
const { t, translateRole } = require('../utils/i18n');
const {
  registerVillageVote,
  getEligibleVoters,
  allVotersVoted,
  resolveCaptainTiebreak,
  resolveIdiotEffect,
} = require('../game/villageVoteEngine');

module.exports = {
  data: new SlashCommandBuilder()
    .setName("vote")
    .setDescription("Voter pour éliminer quelqu'un (jour seulement) — préférez le menu GUI du panneau village")
    .addUserOption(option =>
      option
        .setName("target")
        .setDescription("La personne à éliminer")
        .setRequired(true)
    ),

  async execute(interaction) {
    // Vérification catégorie
    if (!await isInGameCategory(interaction)) {
      await safeReply(interaction, { content: t('error.action_forbidden'), flags: MessageFlags.Ephemeral });
      return;
    }
    if (gameManager.isRecentDuplicate('vote', interaction.channelId, interaction.user.id)) {
      return;
    }
    const game = gameManager.getGameByChannelId(interaction.channelId);
    if (!game) {
      await safeReply(interaction, { content: t('error.no_game'), flags: MessageFlags.Ephemeral });
      return;
    }

    const allowedChannels = [game.mainChannelId, game.villageChannelId].filter(Boolean);
    if (!allowedChannels.includes(interaction.channelId)) {
      await safeReply(interaction, { content: t('error.only_main_or_village'), flags: MessageFlags.Ephemeral });
      return;
    }

    // Vérifier que c'est le jour
    if (game.phase !== PHASES.DAY) {
      await safeReply(interaction, { content: t('error.vote_day_only'), flags: MessageFlags.Ephemeral });
      return;
    }

    const player = game.players.find(p => p.id === interaction.user.id);
    if (!player) {
      await safeReply(interaction, { content: t('error.player_not_in_game'), flags: MessageFlags.Ephemeral });
      return;
    }

    if (!player.alive) {
      await safeReply(interaction, { content: t('error.dead_cannot_vote'), flags: MessageFlags.Ephemeral });
      return;
    }

    // Idiot du Village révélé ne peut plus voter
    if (player.idiotRevealed) {
      await safeReply(interaction, { content: t('error.idiot_cannot_vote'), flags: MessageFlags.Ephemeral });
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

    // --- Captain tiebreak (via slash command fallback) ---
    const voteState = game.villageVoteState;
    if (voteState && voteState.tiedCandidates.length >= 2) {
      if (interaction.user.id !== game.captainId) {
        await safeReply(interaction, { content: t('error.captain_tiebreak_only'), flags: MessageFlags.Ephemeral });
        return;
      }
      if (!voteState.tiedCandidates.includes(target.id)) {
        const tiedNames = voteState.tiedCandidates.map(id => {
          const p = game.players.find(pl => pl.id === id);
          return p ? p.username : id;
        }).join(', ');
        await safeReply(interaction, { content: t('error.vote_among_tied', { names: tiedNames }), flags: MessageFlags.Ephemeral });
        return;
      }

      let tiebreakResult;
      try {
        tiebreakResult = await gameManager.runAtomic(game.mainChannelId, (state) => {
          const res = resolveCaptainTiebreak(state.villageVoteState, target.id);
          if (res.action === 'eliminate') {
            state._captainTiebreak = null;
          }
          return res;
        });
      } catch (e) {
        await safeReply(interaction, { content: t('error.internal'), flags: MessageFlags.Ephemeral });
        return;
      }

      if (tiebreakResult.action !== 'eliminate') {
        await safeReply(interaction, { content: t('error.vote_already_resolved'), flags: MessageFlags.Ephemeral });
        return;
      }

      // Cancel the AFK tiebreak timer
      gameManager.clearCaptainTiebreakTimeout(game);

      const villageChannel = game.villageChannelId
        ? await interaction.guild.channels.fetch(game.villageChannelId)
        : await interaction.guild.channels.fetch(game.mainChannelId);

      // Check Idiot du Village
      const idiotEffect = resolveIdiotEffect(targetPlayer);
      if (idiotEffect) {
        await gameManager.runAtomic(game.mainChannelId, (state) => {
          const p = state.players.find(pl => pl.id === targetPlayer.id);
          if (p) p.idiotRevealed = true;
        });
        await villageChannel.send(t('game.idiot_revealed', { name: targetPlayer.username }));
        gameManager.logAction(game, `Idiot du Village ${targetPlayer.username} révélé via départage capitaine`);
      } else {
        if (targetPlayer.role === ROLES.ANCIEN) {
          await gameManager.runAtomic(game.mainChannelId, (state) => { state.villageRolesPowerless = true; });
          await villageChannel.send(t('game.ancien_power_drain', { name: targetPlayer.username }));
          gameManager.logAction(game, `Ancien ${targetPlayer.username} tué par départage capitaine — pouvoirs perdus`);
        }

        if (game.voiceChannelId) {
          await gameManager.playAmbience(game.voiceChannelId, 'death.mp3');
        }
        await villageChannel.send(t('game.captain_tiebreak', { name: targetPlayer.username }));
        const collateral = gameManager.kill(game.mainChannelId, target.id, { throwOnDbFailure: true });
        gameManager.logAction(game, `Départage capitaine: ${targetPlayer.username} éliminé`);

        for (const dead of collateral) {
          await villageChannel.send(t('game.lover_death', { name: dead.username }));
          gameManager.logAction(game, `Mort d'amour: ${dead.username}`);
        }

        if (targetPlayer.role === ROLES.HUNTER && !game.villageRolesPowerless) {
          game._hunterMustShoot = targetPlayer.id;
          await villageChannel.send(t('game.hunter_death', { name: targetPlayer.username }));
          gameManager.startHunterTimeout(interaction.guild, game, targetPlayer.id);
        }
      }

      await safeReply(interaction, { content: t('cmd.vote.tiebreak_success', { name: target.username }), flags: MessageFlags.Ephemeral });

      if (gameManager.checkWinner(game)) {
        await gameManager.announceVictoryIfAny(interaction.guild, game);
      } else {
        await gameManager.transitionToNight(interaction.guild, game);
      }
      return;
    }

    // --- Regular vote (slash command fallback for GUI select menu) ---
    if (game.subPhase !== PHASES.VOTE) {
      await safeReply(interaction, { content: t('error.vote_not_vote_phase'), flags: MessageFlags.Ephemeral });
      return;
    }

    if (!voteState || voteState.resolved) {
      await safeReply(interaction, { content: t('error.vote_already_resolved'), flags: MessageFlags.Ephemeral });
      return;
    }

    let voteResult;
    try {
      voteResult = await gameManager.runAtomic(game.mainChannelId, (state) => {
        const count = registerVillageVote(state.villageVoteState, interaction.user.id, target.id);
        if (count === null) {
          return { action: 'already_resolved' };
        }

        gameManager.db.addVoteIfChanged(state.mainChannelId, interaction.user.id, target.id, 'village', state.dayCount || 0);
        gameManager.logAction(state, `${interaction.user.username} vote contre ${target.username}`);

        const eligible = getEligibleVoters(state, (id) => gameManager.isRealPlayerId(id));
        const eligibleIds = eligible.map(p => p.id);
        const allDone = allVotersVoted(state.villageVoteState, eligibleIds);

        return { action: 'voted', count, allDone, totalVotes: state.villageVoteState.votes.size, totalEligible: eligibleIds.length };
      });
    } catch (e) {
      await safeReply(interaction, { content: t('error.internal'), flags: MessageFlags.Ephemeral });
      return;
    }

    if (voteResult.action === 'already_resolved') {
      await safeReply(interaction, { content: t('error.vote_already_resolved'), flags: MessageFlags.Ephemeral });
      return;
    }

    await safeReply(interaction, { content: t('cmd.vote.success', { name: target.username, count: voteResult.count }), flags: MessageFlags.Ephemeral });

    // Refresh GUI panels to show updated vote tally
    await gameManager._refreshAllGui(game.mainChannelId);

    // If all eligible voters have voted → transition to night
    if (voteResult.allDone) {
      gameManager.clearDayTimeout(game);
      await gameManager.transitionToNight(interaction.guild, game);
    }
  }
};
