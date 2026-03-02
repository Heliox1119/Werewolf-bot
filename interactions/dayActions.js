/**
 * interactions/dayActions.js — Select Menu handlers for day-phase village voting.
 *
 * Handles:
 *   • captain_elect      — Select menu: elect the captain (first day or after death)
 *   • village_vote       — Select menu: any alive player votes to eliminate someone
 *   • captain_tiebreak   — Select menu: captain breaks a tie
 *
 * Uses villageVoteEngine for pure logic, gameManager for state mutation.
 * Follows the same guard → runAtomic → respond → refreshGUI → advance pattern
 * as nightActions.js.
 */

const { MessageFlags } = require('discord.js');
const gameManager = require('../game/gameManager');
const ROLES = require('../game/roles');
const PHASES = require('../game/phases');
const {
  validateCaptainElect,
  validateVillageVote,
  validateCaptainTiebreak,
} = require('./common/guards');
const { safeEditReply } = require('../utils/interaction');
const { t } = require('../utils/i18n');
const {
  registerVillageVote,
  getEligibleVoters,
  allVotersVoted,
  hasAbsoluteMajority,
  buildVoteDisplay,
} = require('../game/villageVoteEngine');
const path = require('path');

// ─── Captain Election (select menu) ────────────────────────────────

async function handleCaptainElect(interaction) {
  const targetId = interaction.values[0];
  const result = validateCaptainElect(interaction, targetId);
  if (!result.ok) {
    await safeEditReply(interaction, { content: result.message, flags: MessageFlags.Ephemeral });
    return;
  }

  const { game, target } = result;
  const voterId = interaction.user.id;

  // voteCaptain handles: vote registration, tally, tie-break, captain assignment
  const res = await gameManager.voteCaptain(game.mainChannelId, voterId, targetId);

  if (!res.ok) {
    let msg = t('error.cannot_vote');
    switch (res.reason) {
      case 'not_day': msg = t('error.not_day'); break;
      case 'wrong_phase': msg = t('error.wrong_phase'); break;
      case 'captain_already': msg = t('error.captain_already'); break;
      case 'not_in_game': msg = t('error.not_in_game'); break;
      case 'voter_dead': msg = t('error.voter_dead'); break;
      case 'target_not_found': msg = t('error.target_invalid'); break;
      case 'target_dead': msg = t('error.target_dead'); break;
    }
    await safeEditReply(interaction, { content: msg, flags: MessageFlags.Ephemeral });
    return;
  }

  // Announce the vote publicly in #village
  const villageChannel = game.villageChannelId
    ? await interaction.guild.channels.fetch(game.villageChannelId)
    : await interaction.guild.channels.fetch(game.mainChannelId);

  if (res.allVoted && res.resolution && res.resolution.ok) {
    // ── Captain elected ──
    const resolution = res.resolution;
    const msgKey = resolution.wasTie ? 'game.captain_random_elected' : 'cmd.captain.elected';

    // Ack to voter
    await safeEditReply(interaction, {
      content: t('cmd.captainvote.success', { name: target.username }),
      flags: MessageFlags.Ephemeral,
    });

    // Public announcement
    await villageChannel.send(t(msgKey, { name: resolution.username }));
    gameManager.logAction(game, `Capitaine élu: ${resolution.username}${resolution.wasTie ? ' (égalité, tirage au sort)' : ''}`);

    // DM the new captain
    try {
      const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
      const user = await interaction.client.users.fetch(resolution.winnerId);
      const imageName = 'capitaine.webp';
      const imagePath = path.join(__dirname, '..', 'img', imageName);
      const embed = new EmbedBuilder()
        .setTitle(t('cmd.captain.dm_title'))
        .setDescription(t('cmd.captain.dm_desc'))
        .setColor(0xFFD166)
        .setImage(`attachment://${imageName}`);
      await user.send({ embeds: [embed], files: [new AttachmentBuilder(imagePath, { name: imageName })] });
    } catch (err) { /* Ignore DM failures */ }

    // Clear timeout and advance to VOTE
    gameManager.clearCaptainVoteTimeout(game);
    await gameManager.advanceSubPhase(interaction.guild, game);
  } else {
    // ── Vote registered, election not yet resolved ──
    const info = res.voted !== undefined ? ` (${res.voted}/${res.total})` : '';
    await safeEditReply(interaction, {
      content: t('cmd.captainvote.success', { name: target.username }) + info,
      flags: MessageFlags.Ephemeral,
    });
    await villageChannel.send(t('cmd.captainvote.public', {
      voter: interaction.user.username,
      target: target.username,
      voted: res.voted || '?',
      total: res.total || '?',
    }));
  }

  // Refresh the village panel to update the select menu / vote display
  await gameManager._refreshAllGui(game.mainChannelId);
}

// ─── Village Vote (select menu) ────────────────────────────────────

async function handleVillageVote(interaction) {
  const targetId = interaction.values[0];
  const result = validateVillageVote(interaction, targetId);
  if (!result.ok) {
    await safeEditReply(interaction, { content: result.message, flags: MessageFlags.Ephemeral });
    return;
  }

  const { game } = result;
  const voterId = interaction.user.id;

  let outcome;
  try {
    outcome = await gameManager.runAtomic(game.mainChannelId, (state) => {
      const voteState = state.villageVoteState;
      const count = registerVillageVote(voteState, voterId, targetId);
      if (count === null) {
        return { action: 'already_resolved' };
      }

      // Persist vote to DB
      gameManager.db.addVoteIfChanged(state.mainChannelId, voterId, targetId, 'village', state.dayCount || 0);

      // Check if all eligible voters have voted
      const eligible = getEligibleVoters(state, (id) => gameManager.isRealPlayerId(id));
      const eligibleIds = eligible.map(p => p.id);
      const allDone = allVotersVoted(voteState, eligibleIds);

      // Check absolute majority (floor(n/2)+1 votes for same target)
      const majorityResult = hasAbsoluteMajority(voteState, eligibleIds.length);

      // Build display data
      const display = buildVoteDisplay(voteState, state.players);
      const totalVotes = voteState.votes.size;
      const totalEligible = eligibleIds.length;

      return { action: 'voted', targetId, count, allDone, majorityResult, display, totalVotes, totalEligible };
    });
  } catch (err) {
    await safeEditReply(interaction, { content: t('error.action_forbidden'), flags: MessageFlags.Ephemeral });
    return;
  }

  if (outcome.action === 'already_resolved') {
    await safeEditReply(interaction, { content: t('error.vote_already_resolved', {}, game.guildId), flags: MessageFlags.Ephemeral });
    return;
  }

  // Acknowledge the vote to the voter (ephemeral)
  const targetPlayer = game.players.find(p => p.id === targetId);
  const targetName = targetPlayer ? targetPlayer.username : targetId;
  await safeEditReply(interaction, {
    content: t('village_panel.vote_registered', { target: targetName }, game.guildId),
    flags: MessageFlags.Ephemeral,
  });

  // Refresh the village panel to update vote tally display
  await gameManager._refreshAllGui(game.mainChannelId);

  // Early resolution: all voters voted OR absolute majority reached
  if (outcome.allDone || outcome.majorityResult) {
    const guild = interaction.guild;
    if (guild) {
      const { game: gameLogger } = require('../utils/logger');
      const reason = outcome.majorityResult ? 'absolute_majority' : 'all_voted';
      gameLogger.info('DAY_VOTE_RESOLVED_EARLY', {
        channelId: game.mainChannelId,
        reason,
        durationMs: Date.now() - (game.dayVoteStartedAt || 0),
        votes: outcome.totalVotes,
        eligible: outcome.totalEligible,
      });
      gameManager.clearDayTimeout(game);
      await gameManager.transitionToNight(guild, game);
    }
  }
}

// ─── Captain Tiebreak (select menu) ────────────────────────────────

async function handleCaptainTiebreak(interaction) {
  const targetId = interaction.values[0];
  const result = validateCaptainTiebreak(interaction, targetId);
  if (!result.ok) {
    await safeEditReply(interaction, { content: result.message, flags: MessageFlags.Ephemeral });
    return;
  }

  const { game } = result;
  const voteEngine = require('../game/villageVoteEngine');

  let resolution;
  try {
    resolution = await gameManager.runAtomic(game.mainChannelId, (state) => {
      const res = voteEngine.resolveCaptainTiebreak(state.villageVoteState, targetId);
      if (res.action === 'eliminate') {
        state._captainTiebreak = null;
      }
      return res;
    });
  } catch (err) {
    await safeEditReply(interaction, { content: t('error.action_forbidden'), flags: MessageFlags.Ephemeral });
    return;
  }

  if (resolution.action === 'already_resolved') {
    await safeEditReply(interaction, { content: t('error.vote_already_resolved', {}, game.guildId), flags: MessageFlags.Ephemeral });
    return;
  }

  if (resolution.action === 'invalid') {
    await safeEditReply(interaction, { content: t('error.captain_tiebreak_invalid', {}, game.guildId), flags: MessageFlags.Ephemeral });
    return;
  }

  // resolution.action === 'eliminate'
  const targetPlayer = game.players.find(p => p.id === resolution.targetId);
  const targetName = targetPlayer ? targetPlayer.username : resolution.targetId;
  await safeEditReply(interaction, {
    content: t('village_panel.tiebreak_chosen', { target: targetName }, game.guildId),
    flags: MessageFlags.Ephemeral,
  });

  // Clear tiebreak timer and proceed
  gameManager.clearCaptainTiebreakTimeout(game);

  // Now execute the elimination and transition to night
  const guild = interaction.guild;
  if (!guild) return;

  const mainChannel = game.villageChannelId
    ? await guild.channels.fetch(game.villageChannelId)
    : await guild.channels.fetch(game.mainChannelId);

  if (targetPlayer && targetPlayer.alive) {
    // Check Idiot du Village
    const idiotEffect = voteEngine.resolveIdiotEffect(targetPlayer);
    if (idiotEffect) {
      await gameManager.runAtomic(game.mainChannelId, (state) => {
        const p = state.players.find(pl => pl.id === targetPlayer.id);
        if (p) p.idiotRevealed = true;
      });
      await gameManager.sendLogged(mainChannel, t('game.idiot_revealed', { name: targetPlayer.username }), { type: 'idiotRevealed' });
      gameManager.logAction(game, `Idiot du Village ${targetPlayer.username} révélé via départage capitaine`);
    } else {
      // Check Ancien
      if (targetPlayer.role === ROLES.ANCIEN) {
        await gameManager.runAtomic(game.mainChannelId, (state) => {
          state.villageRolesPowerless = true;
        });
        await gameManager.sendLogged(mainChannel, t('game.ancien_power_drain', { name: targetPlayer.username }), { type: 'ancienPowerDrain' });
        gameManager.logAction(game, `Ancien ${targetPlayer.username} tué par départage capitaine — pouvoirs perdus`);
      }

      if (game.voiceChannelId) {
        gameManager.playAmbience(game.voiceChannelId, 'death.mp3');
      }

      await gameManager.sendLogged(mainChannel, t('game.captain_tiebreak_result', { name: targetPlayer.username }), { type: 'captainTiebreakResult' });
      const collateral = gameManager.kill(game.mainChannelId, resolution.targetId, { throwOnDbFailure: true });
      gameManager.logAction(game, `Départage capitaine: ${targetPlayer.username} éliminé`);
      await gameManager.announceDeathReveal(mainChannel, targetPlayer, 'village');

      for (const dead of collateral) {
        await gameManager.sendLogged(mainChannel, t('game.lover_death', { name: dead.username }), { type: 'loverDeath' });
        gameManager.logAction(game, `Mort d'amour: ${dead.username}`);
        await gameManager.announceDeathReveal(mainChannel, dead, 'love');
      }

      // Check Hunter
      if (targetPlayer.role === ROLES.HUNTER && !game.villageRolesPowerless) {
        game._hunterMustShoot = targetPlayer.id;
        await gameManager.sendLogged(mainChannel, t('game.hunter_death', { name: targetPlayer.username }), { type: 'hunterDeath' });
        gameManager.startHunterTimeout(guild, game, targetPlayer.id);
      }
    }
  }

  // Apply dead player lockouts
  await gameManager.applyDeadPlayerLockouts(guild);

  // Check victory
  const victoryCheck = gameManager.checkWinner(game);
  if (victoryCheck) {
    await gameManager.announceVictoryIfAny(guild, game);
    return;
  }

  // Transition to night
  await gameManager.transitionToNight(guild, game);
}

module.exports = {
  handleCaptainElect,
  handleVillageVote,
  handleCaptainTiebreak,
};
