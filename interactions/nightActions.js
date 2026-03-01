/**
 * interactions/nightActions.js — Button & Select Menu handlers for all night roles.
 *
 * Handles:
 *   • wolves_kill      — Select menu: wolves vote for a victim
 *   • ww_kill          — Select menu: White Wolf devours a wolf
 *   • ww_skip          — Button: White Wolf skips
 *   • seer_see         — Select menu: Seer sees a player
 *   • seer_skip        — Button: Seer skips
 *   • salvateur_protect — Select menu: Salvateur protects
 *   • salvateur_skip   — Button: Salvateur skips
 *   • witch_life       — Button: Witch uses life potion
 *   • witch_death      — Select menu: Witch uses death potion
 *   • witch_skip       — Button: Witch skips
 *   • cupid_love       — Multi-select menu: Cupid links two players
 *   • cupid_skip       — Button: Cupid skips
 *
 * Every guard and business-logic step is identical to the slash commands.
 * This file ONLY adapts the interaction plumbing (deferred ephemeral + editReply).
 */

const { MessageFlags } = require('discord.js');
const gameManager = require('../game/gameManager');
const ROLES = require('../game/roles');
const PHASES = require('../game/phases');
const {
  validateWolfKill,
  validateWhiteWolfKill,
  validateSeerSee,
  validateSalvateurProtect,
  validateWitchLife,
  validateWitchDeath,
  validateWitchSkip,
  validateCupidLove,
  validateSkip,
} = require('./common/guards');
const { safeEditReply } = require('../utils/interaction');
const { t, translateRole } = require('../utils/i18n');
const {
  getAliveWolves,
  registerWolfVote,
  processWolfVote,
  getWolfMajority,
} = require('../game/wolfVoteEngine');

// ─── Wolves Kill (collective vote with majority) ───────────────────

async function handleWolvesKill(interaction) {
  const targetId = interaction.values[0];
  const result = validateWolfKill(interaction, targetId);
  if (!result.ok) {
    await safeEditReply(interaction, { content: result.message, flags: MessageFlags.Ephemeral });
    return;
  }

  const { game, target } = result;

  const aliveWolves = getAliveWolves(game, (id) => gameManager.isRealPlayerId(id));
  const aliveWolfIds = aliveWolves.map(w => w.id);
  const totalWolves = aliveWolves.length;
  const majorityNeeded = getWolfMajority(totalWolves);

  let outcome;
  try {
    outcome = await gameManager.runAtomic(game.mainChannelId, (state) => {
      // Register vote
      const votesForTarget = registerWolfVote(state.wolvesVoteState, interaction.user.id, targetId);
      if (votesForTarget === null) {
        return { action: 'already_resolved' };
      }
      gameManager.db.addVoteIfChanged(state.mainChannelId, interaction.user.id, targetId, 'wolves', state.dayCount || 0);

      // Process vote outcome
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
    await safeEditReply(interaction, { content: t('error.internal'), flags: MessageFlags.Ephemeral });
    return;
  }

  // Handle outcome
  if (outcome.action === 'already_resolved') {
    await safeEditReply(interaction, { content: t('error.wolves_already_resolved'), flags: MessageFlags.Ephemeral });
    return;
  }

  if (outcome.action === 'kill') {
    await safeEditReply(interaction, { content: t('cmd.kill.wolves_majority_reached', { name: outcome.victimName }), flags: MessageFlags.Ephemeral });
    // Refresh GUI (panel shows resolved state) then advance
    await gameManager._refreshAllGui(game.mainChannelId).catch(() => {});
    await gameManager.advanceSubPhase(interaction.guild, game);
  } else if (outcome.action === 'advance_round') {
    await safeEditReply(interaction, { content: t('cmd.kill.wolves_round2_start'), flags: MessageFlags.Ephemeral });
    // Send disagreement warning to wolves channel
    try {
      const wolvesChannel = await interaction.guild.channels.fetch(game.wolvesChannelId);
      await wolvesChannel.send(t('cmd.kill.wolves_no_consensus_warning'));
    } catch (_) { /* ignore */ }
    // Refresh GUI to show round 2 with fresh select menu
    await gameManager._refreshAllGui(game.mainChannelId).catch(() => {});
  } else if (outcome.action === 'no_kill') {
    await safeEditReply(interaction, { content: t('cmd.kill.wolves_no_kill'), flags: MessageFlags.Ephemeral });
    // Send no-kill message to wolves channel
    try {
      const wolvesChannel = await interaction.guild.channels.fetch(game.wolvesChannelId);
      await wolvesChannel.send(t('cmd.kill.wolves_no_kill'));
    } catch (_) { /* ignore */ }
    // Refresh GUI then advance
    await gameManager._refreshAllGui(game.mainChannelId).catch(() => {});
    await gameManager.advanceSubPhase(interaction.guild, game);
  } else {
    // Pending — show vote confirmation
    await safeEditReply(interaction, {
      content: t('cmd.kill.wolves_vote_registered', {
        name: target.username,
        n: outcome.votesForTarget,
        m: majorityNeeded,
      }),
      flags: MessageFlags.Ephemeral,
    });
    // Refresh GUI panel to show updated vote status
    await gameManager._refreshAllGui(game.mainChannelId).catch(() => {});
  }
}

// ─── White Wolf Kill ───────────────────────────────────────────────

async function handleWhiteWolfKill(interaction) {
  const targetId = interaction.values[0];
  const result = validateWhiteWolfKill(interaction, targetId);
  if (!result.ok) {
    await safeEditReply(interaction, { content: result.message, flags: MessageFlags.Ephemeral });
    return;
  }

  const { game, target } = result;

  try {
    await gameManager.runAtomic(game.mainChannelId, () => {
      game.whiteWolfKillTarget = targetId;
      gameManager.clearNightAfkTimeout(game);
      gameManager.logAction(game, `Loup Blanc choisit de dévorer: ${target.username}`);
      const ok = gameManager.db.addNightAction(game.mainChannelId, game.dayCount || 0, 'white_wolf_kill', interaction.user.id, targetId);
      if (!ok) throw new Error('Failed to persist white wolf action');
    });
  } catch (e) {
    await safeEditReply(interaction, { content: t('error.internal'), flags: MessageFlags.Ephemeral });
    return;
  }

  await safeEditReply(interaction, { content: t('cmd.kill.white_wolf_success', { name: target.username }), flags: MessageFlags.Ephemeral });
  await gameManager.advanceSubPhase(interaction.guild, game);
}

// ─── Seer See ──────────────────────────────────────────────────────

async function handleSeerSee(interaction) {
  const targetId = interaction.values[0];
  const result = validateSeerSee(interaction, targetId);
  if (!result.ok) {
    await safeEditReply(interaction, { content: result.message, flags: MessageFlags.Ephemeral });
    return;
  }

  const { game, player, target } = result;

  gameManager.clearNightAfkTimeout(game);
  const actionResult = gameManager.db.addNightActionOnce(game.mainChannelId, game.dayCount || 0, 'see', interaction.user.id, targetId);
  if (!actionResult.ok) {
    await safeEditReply(interaction, { content: t('error.internal'), flags: MessageFlags.Ephemeral });
    return;
  }
  if (actionResult.affectedRows === 0) {
    await safeEditReply(interaction, { content: t('error.not_seer_turn'), flags: MessageFlags.Ephemeral });
    return;
  }

  await safeEditReply(interaction, {
    content: t('cmd.see.result', { name: target.username, role: translateRole(target.role) }),
    flags: MessageFlags.Ephemeral,
  });
  gameManager.logAction(game, `Voyante regarde ${target.username} (${target.role})`);

  // Track achievement
  if (target.role === ROLES.WEREWOLF && gameManager.achievements) {
    try { gameManager.achievements.trackEvent(player.id, 'seer_found_wolf'); } catch (_) { /* ignore */ }
  }

  if (game.phase === PHASES.NIGHT) {
    await gameManager.advanceSubPhase(interaction.guild, game);
  }
}

// ─── Salvateur Protect ─────────────────────────────────────────────

async function handleSalvateurProtect(interaction) {
  const targetId = interaction.values[0];
  const result = validateSalvateurProtect(interaction, targetId);
  if (!result.ok) {
    await safeEditReply(interaction, { content: result.message, flags: MessageFlags.Ephemeral });
    return;
  }

  const { game, target } = result;

  try {
    await gameManager.runAtomic(game.mainChannelId, (state) => {
      state.protectedPlayerId = targetId;
      gameManager.logAction(state, `Salvateur protège ${target.username}`);
    });
  } catch (e) {
    await safeEditReply(interaction, { content: t('error.internal'), flags: MessageFlags.Ephemeral });
    return;
  }

  await safeEditReply(interaction, { content: t('cmd.protect.success', { name: target.username }), flags: MessageFlags.Ephemeral });

  gameManager.clearNightAfkTimeout(game);
  await gameManager.advanceSubPhase(interaction.guild, game);
}

// ─── Witch Life ────────────────────────────────────────────────────

async function handleWitchLife(interaction) {
  const result = validateWitchLife(interaction);
  if (!result.ok) {
    await safeEditReply(interaction, { content: result.message, flags: MessageFlags.Ephemeral });
    return;
  }

  const { game, player } = result;
  gameManager.clearNightAfkTimeout(game);

  const victimPlayer = game.players.find(p => p.id === game.nightVictim);
  const victimName = victimPlayer ? victimPlayer.username : t('game.someone');

  let lifeResult;
  try {
    lifeResult = await gameManager.runAtomic(game.mainChannelId, () => {
      const potionClaim = gameManager.db.useWitchPotionIfAvailable(game.mainChannelId, 'life');
      if (!potionClaim.ok) throw new Error('Failed to persist life potion claim');
      if (potionClaim.affectedRows === 0) return { alreadyExecuted: true };

      const actionResult = gameManager.db.addNightActionOnce(game.mainChannelId, game.dayCount || 0, 'save', interaction.user.id, game.nightVictim);
      if (!actionResult.ok) throw new Error('Failed to persist life potion action');
      if (actionResult.affectedRows === 0) return { alreadyExecuted: true };

      game.witchPotions.life = false;
      game.witchSave = true;
      game.witchKillTarget = null;
      gameManager.logAction(game, `Sorciere utilise potion de vie pour sauver ${victimName}`);
      return { alreadyExecuted: false };
    });
  } catch (e) {
    await safeEditReply(interaction, { content: t('error.internal'), flags: MessageFlags.Ephemeral });
    return;
  }

  if (lifeResult.alreadyExecuted) {
    await safeEditReply(interaction, { content: t('error.no_life_potion'), flags: MessageFlags.Ephemeral });
    return;
  }

  // Track achievement
  if (gameManager.achievements) {
    try { gameManager.achievements.trackEvent(player.id, 'witch_save'); } catch (_) { /* ignore */ }
  }

  await safeEditReply(interaction, { content: t('cmd.potion.life_success', { name: victimName }), flags: MessageFlags.Ephemeral });

  if (game.phase === PHASES.NIGHT) {
    await gameManager.advanceSubPhase(interaction.guild, game);
  }
}

// ─── Witch Death ───────────────────────────────────────────────────

async function handleWitchDeath(interaction) {
  const targetId = interaction.values[0];
  const result = validateWitchDeath(interaction, targetId);
  if (!result.ok) {
    await safeEditReply(interaction, { content: result.message, flags: MessageFlags.Ephemeral });
    return;
  }

  const { game, target } = result;
  gameManager.clearNightAfkTimeout(game);

  let deathResult;
  try {
    deathResult = await gameManager.runAtomic(game.mainChannelId, () => {
      const potionClaim = gameManager.db.useWitchPotionIfAvailable(game.mainChannelId, 'death');
      if (!potionClaim.ok) throw new Error('Failed to persist death potion claim');
      if (potionClaim.affectedRows === 0) return { alreadyExecuted: true };

      const actionResult = gameManager.db.addNightActionOnce(game.mainChannelId, game.dayCount || 0, 'poison', interaction.user.id, targetId);
      if (!actionResult.ok) throw new Error('Failed to persist death potion action');
      if (actionResult.affectedRows === 0) return { alreadyExecuted: true };

      game.witchPotions.death = false;
      game.witchKillTarget = targetId;
      gameManager.logAction(game, `Sorciere empoisonne: ${target.username}`);
      return { alreadyExecuted: false };
    });
  } catch (e) {
    await safeEditReply(interaction, { content: t('error.internal'), flags: MessageFlags.Ephemeral });
    return;
  }

  if (deathResult.alreadyExecuted) {
    await safeEditReply(interaction, { content: t('error.no_death_potion'), flags: MessageFlags.Ephemeral });
    return;
  }

  await safeEditReply(interaction, { content: t('cmd.potion.death_success', { name: target.username }), flags: MessageFlags.Ephemeral });

  if (game.phase === PHASES.NIGHT) {
    await gameManager.advanceSubPhase(interaction.guild, game);
  }
}

// ─── Cupid Love ────────────────────────────────────────────────────

async function handleCupidLove(interaction) {
  const [targetAId, targetBId] = interaction.values;
  const result = validateCupidLove(interaction, targetAId, targetBId);
  if (!result.ok) {
    await safeEditReply(interaction, { content: result.message, flags: MessageFlags.Ephemeral });
    return;
  }

  const { game, targetA, targetB } = result;

  try {
    await gameManager.runAtomic(game.mainChannelId, (state) => {
      state.lovers.push([targetAId, targetBId]);
      gameManager.logAction(state, `Cupidon lie ${targetA.username} et ${targetB.username}`);
      const ok = gameManager.db.addNightAction(state.mainChannelId, state.dayCount || 0, 'love', interaction.user.id, targetAId);
      if (!ok) throw new Error('Failed to persist cupid action');
    });
  } catch (e) {
    await safeEditReply(interaction, { content: t('error.internal'), flags: MessageFlags.Ephemeral });
    return;
  }

  // DM both lovers
  try {
    const client = require.main?.exports?.client;
    if (client) {
      const userA = await client.users.fetch(targetAId);
      const userB = await client.users.fetch(targetBId);
      await userA.send(t('cmd.love.dm', { name: targetB.username }));
      await userB.send(t('cmd.love.dm', { name: targetA.username }));
    }
  } catch (_) { /* DM failures non-critical */ }

  await safeEditReply(interaction, {
    content: t('cmd.love.success', { a: targetA.username, b: targetB.username }),
    flags: MessageFlags.Ephemeral,
  });

  await gameManager.advanceSubPhase(interaction.guild, game);
}

// ─── Generic Skip Handler ──────────────────────────────────────────

/**
 * Handle skip buttons for seer, salvateur, witch, cupid.
 * @param {Interaction} interaction  Already deferred (ephemeral).
 * @param {string} expectedRole   ROLES constant
 * @param {string} expectedPhase  PHASES constant
 * @param {string} label          Display label
 */
async function handleSkipButton(interaction, expectedRole, expectedPhase, label) {
  const result = validateSkip(interaction, expectedRole, expectedPhase, label);
  if (!result.ok) {
    await safeEditReply(interaction, { content: result.message, flags: MessageFlags.Ephemeral });
    return;
  }

  const { game } = result;

  gameManager.clearNightAfkTimeout(game);
  gameManager.logAction(game, `${label} passe son action (skip)`);

  await safeEditReply(interaction, { content: t('cmd.skip.success', { label }), flags: MessageFlags.Ephemeral });
  await gameManager.advanceSubPhase(interaction.guild, game);
}

// ─── White Wolf Skip Handler ───────────────────────────────────────

async function handleWhiteWolfSkip(interaction) {
  const game = gameManager.getGameByChannelId(interaction.channelId);
  if (!game) {
    await safeEditReply(interaction, { content: t('error.no_game'), flags: MessageFlags.Ephemeral });
    return;
  }
  if (game.phase !== PHASES.NIGHT || game.subPhase !== PHASES.LOUP_BLANC) {
    await safeEditReply(interaction, { content: t('error.action_forbidden'), flags: MessageFlags.Ephemeral });
    return;
  }
  const player = game.players.find(p => p.id === interaction.user.id);
  if (!player || player.role !== ROLES.WHITE_WOLF || !player.alive) {
    await safeEditReply(interaction, { content: t('error.action_forbidden'), flags: MessageFlags.Ephemeral });
    return;
  }

  gameManager.clearNightAfkTimeout(game);
  gameManager.logAction(game, 'Loup Blanc passe son action (skip)');

  await safeEditReply(interaction, { content: t('cmd.skip.success', { label: 'Loup Blanc' }), flags: MessageFlags.Ephemeral });
  await gameManager.advanceSubPhase(interaction.guild, game);
}

// ─── Main Routers ──────────────────────────────────────────────────

/**
 * Route button presses for night roles.
 * Called from index.js when customId matches a known role prefix.
 * @param {ButtonInteraction} interaction  Already deferred (ephemeral).
 */
async function handleNightButton(interaction) {
  const id = interaction.customId;

  if (id === 'witch_life')       return handleWitchLife(interaction);
  if (id === 'witch_skip')       return handleSkipButton(interaction, ROLES.WITCH, PHASES.SORCIERE, 'Sorcière');
  if (id === 'seer_skip')        return handleSkipButton(interaction, ROLES.SEER, PHASES.VOYANTE, 'Voyante');
  if (id === 'salvateur_skip')   return handleSkipButton(interaction, ROLES.SALVATEUR, PHASES.SALVATEUR, 'Salvateur');
  if (id === 'cupid_skip')       return handleSkipButton(interaction, ROLES.CUPID, PHASES.CUPIDON, 'Cupidon');
  if (id === 'ww_skip')          return handleWhiteWolfSkip(interaction);
}

/**
 * Route select menu interactions for night roles.
 * Called from index.js for StringSelectMenu interactions.
 * @param {StringSelectMenuInteraction} interaction  Already deferred (ephemeral).
 */
async function handleNightSelect(interaction) {
  const id = interaction.customId;

  if (id === 'wolves_kill')       return handleWolvesKill(interaction);
  if (id === 'ww_kill')           return handleWhiteWolfKill(interaction);
  if (id === 'seer_see')          return handleSeerSee(interaction);
  if (id === 'salvateur_protect') return handleSalvateurProtect(interaction);
  if (id === 'witch_death')       return handleWitchDeath(interaction);
  if (id === 'cupid_love')        return handleCupidLove(interaction);
}

module.exports = {
  handleNightButton,
  handleNightSelect,
  // Export individual handlers for testing
  handleWolvesKill,
  handleWhiteWolfKill,
  handleSeerSee,
  handleSalvateurProtect,
  handleWitchLife,
  handleWitchDeath,
  handleCupidLove,
  handleSkipButton,
  handleWhiteWolfSkip,
};
