const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const gameManager = require("../game/gameManager");
const PHASES = require("../game/phases");
const ROLES = require("../game/roles");
const { safeReply } = require("../utils/interaction");
const { isInGameCategory } = require("../utils/validators");
const { t, translateRole } = require('../utils/i18n');

module.exports = {
  data: new SlashCommandBuilder()
    .setName("vote")
    .setDescription("Voter pour éliminer quelqu'un (jour seulement)")
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
    if (player.role === ROLES.IDIOT && player.idiotRevealed) {
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

    // --- Départage capitaine ---
    if (game._captainTiebreak && Array.isArray(game._captainTiebreak)) {
      if (interaction.user.id !== game.captainId) {
        await safeReply(interaction, { content: t('error.captain_tiebreak_only'), flags: MessageFlags.Ephemeral });
        return;
      }
      if (!game._captainTiebreak.includes(target.id)) {
        const tiedNames = game._captainTiebreak.map(id => {
          const p = game.players.find(pl => pl.id === id);
          return p ? p.username : id;
        }).join(', ');
        await safeReply(interaction, { content: t('error.vote_among_tied', { names: tiedNames }), flags: MessageFlags.Ephemeral });
        return;
      }

      let tiebreakResult;
      try {
        tiebreakResult = await gameManager.runAtomic(game.mainChannelId, () => {
          const collateral = gameManager.kill(game.mainChannelId, target.id, { throwOnDbFailure: true });
          gameManager.logAction(game, `Départage capitaine: ${targetPlayer.username} éliminé`);
          const hunterTriggered = targetPlayer.role === ROLES.HUNTER;
          if (hunterTriggered) {
            game._hunterMustShoot = targetPlayer.id;
          }
          game._captainTiebreak = null;
          const victory = gameManager.checkWinner(game);
          return { collateral, hunterTriggered, victory };
        });
      } catch (e) {
        await safeReply(interaction, { content: t('error.internal'), flags: MessageFlags.Ephemeral });
        return;
      }

      // Cancel the AFK tiebreak timer — captain resolved manually
      gameManager.clearCaptainTiebreakTimeout(game);

      const villageChannel = game.villageChannelId
        ? await interaction.guild.channels.fetch(game.villageChannelId)
        : await interaction.guild.channels.fetch(game.mainChannelId);

      if (game.voiceChannelId) {
        await gameManager.playAmbience(game.voiceChannelId, 'death.mp3');
      }
      await villageChannel.send(t('game.captain_tiebreak', { name: targetPlayer.username }));

      for (const dead of tiebreakResult.collateral) {
        await villageChannel.send(t('game.lover_death', { name: dead.username }));
        gameManager.logAction(game, `Mort d'amour: ${dead.username}`);
      }

      if (tiebreakResult.hunterTriggered) {
        await villageChannel.send(t('game.hunter_death', { name: targetPlayer.username }));
        gameManager.startHunterTimeout(interaction.guild, game, targetPlayer.id);
      }

      await safeReply(interaction, { content: t('cmd.vote.tiebreak_success', { name: target.username }), flags: MessageFlags.Ephemeral });

      // Vérifier victoire puis passer à la nuit
      if (tiebreakResult.victory) {
        await gameManager.announceVictoryIfAny(interaction.guild, game);
      } else {
        await gameManager.transitionToNight(interaction.guild, game);
      }
      return;
    }

    // --- Guard: only allow regular votes during VOTE subPhase ---
    if (game.subPhase !== PHASES.VOTE) {
      await safeReply(interaction, { content: t('error.vote_not_vote_phase'), flags: MessageFlags.Ephemeral });
      return;
    }

    if (!game.voteVoters) {
      game.voteVoters = new Map();
    }

    const aliveReal = game.players.filter(p => p.alive && gameManager.isRealPlayerId(p.id));
    if (aliveReal.length <= 1) {
      await safeReply(interaction, { content: t('error.one_player_left'), flags: MessageFlags.Ephemeral });
      await gameManager.announceVictoryIfAny(interaction.guild, game);
      return;
    }

    let voteResult;
    try {
      voteResult = await gameManager.runAtomic(game.mainChannelId, () => {
        // Si le votant est le capitaine, son vote compte double
        const isCaptain = game.captainId && game.captainId === interaction.user.id;
        const increment = isCaptain ? 2 : 1;

        const dbVoteResult = gameManager.db.addVoteIfChanged(
          game.mainChannelId,
          interaction.user.id,
          target.id,
          'village',
          game.dayCount || 0
        );
        if (!dbVoteResult.ok) throw new Error('Failed to persist village vote');

        if (dbVoteResult.affectedRows === 0) {
          const note = increment === 2 ? " " + t('cmd.vote.captain_note') : "";
          const votedRealCount = aliveReal.filter(p => game.voteVoters.has(p.id)).length;
          return {
            count: game.votes.get(target.id) || 0,
            note,
            votedRealCount,
            alreadyExecuted: true
          };
        }

        // Remove previous vote if exists
        const previousTarget = game.voteVoters.get(interaction.user.id);
        if (previousTarget) {
          if (!game._voteIncrements) game._voteIncrements = new Map();
          const prevIncrement = game._voteIncrements.get(interaction.user.id) || 1;
          const prevCount = (game.votes.get(previousTarget) || 0) - prevIncrement;
          if (prevCount <= 0) {
            game.votes.delete(previousTarget);
          } else {
            game.votes.set(previousTarget, prevCount);
          }
        }

        if (!game._voteIncrements) game._voteIncrements = new Map();
        game._voteIncrements.set(interaction.user.id, increment);

        game.voteVoters.set(interaction.user.id, target.id);
        game.votes.set(target.id, (game.votes.get(target.id) || 0) + increment);

        const note = increment === 2 ? " " + t('cmd.vote.captain_note') : "";
        gameManager.logAction(game, `${interaction.user.username} vote contre ${target.username}${note}`);

        const votedRealCount = aliveReal.filter(p => game.voteVoters.has(p.id)).length;
        return {
          count: game.votes.get(target.id),
          note,
          votedRealCount,
          alreadyExecuted: false
        };
      });
    } catch (e) {
      await safeReply(interaction, { content: t('error.internal'), flags: MessageFlags.Ephemeral });
      return;
    }

    await safeReply(interaction, { content: t('cmd.vote.success', { name: target.username, count: voteResult.count }) + voteResult.note, flags: MessageFlags.Ephemeral });

    // Annonce publique dans le village
    try {
      const villageChannel = game.villageChannelId
        ? await interaction.guild.channels.fetch(game.villageChannelId)
        : await interaction.guild.channels.fetch(game.mainChannelId);
      const votedRealSoFar = voteResult.votedRealCount;
      await villageChannel.send(t('cmd.vote.public', { name: interaction.user.username, n: votedRealSoFar, total: aliveReal.length }));
    } catch (e) { /* ignore */ }

    if (aliveReal.length > 0 && voteResult.votedRealCount >= aliveReal.length) {
      await gameManager.transitionToNight(interaction.guild, game);
    }
  }
};
