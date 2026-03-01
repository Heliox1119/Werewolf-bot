/**
 * interactions/common/guards.js — Centralized guard functions for button interactions.
 *
 * These guards mirror the exact same checks used by the slash commands
 * (steal.js, skip.js) but return structured error results instead of
 * replying directly, so button handlers can respond appropriately.
 *
 * Each guard returns `{ ok: true, game, player }` on success,
 * or `{ ok: false, message }` on failure.
 */

const gameManager = require('../../game/gameManager');
const ROLES = require('../../game/roles');
const PHASES = require('../../game/phases');
const { t } = require('../../utils/i18n');

/**
 * Validate that the interaction targets a valid thief steal action.
 * Exactly mirrors the guard chain in commands/steal.js.
 *
 * @param {ButtonInteraction} interaction
 * @returns {{ ok: true, game: object, player: object } | { ok: false, message: string }}
 */
function validateThiefSteal(interaction) {
  const game = gameManager.getGameByChannelId(interaction.channelId);
  if (!game) {
    return { ok: false, message: t('error.no_game') };
  }

  if (interaction.channelId !== game.thiefChannelId) {
    return { ok: false, message: t('error.only_thief_channel') };
  }

  if (game.phase !== PHASES.NIGHT) {
    return { ok: false, message: t('error.action_forbidden') };
  }

  if (game.subPhase !== PHASES.VOLEUR) {
    return { ok: false, message: t('error.not_thief_turn') };
  }

  const player = game.players.find(p => p.id === interaction.user.id);
  if (!player || player.role !== ROLES.THIEF) {
    return { ok: false, message: t('error.not_thief') };
  }

  if (!player.alive) {
    return { ok: false, message: t('error.you_are_dead') };
  }

  if (!game.thiefExtraRoles || game.thiefExtraRoles.length !== 2) {
    return { ok: false, message: t('error.action_forbidden') };
  }

  return { ok: true, game, player };
}

/**
 * Validate that the interaction targets a valid thief skip action.
 * Exactly mirrors the guard chain in commands/skip.js for the VOLEUR sub-phase.
 *
 * @param {ButtonInteraction} interaction
 * @returns {{ ok: true, game: object, player: object } | { ok: false, message: string }}
 */
function validateThiefSkip(interaction) {
  const game = gameManager.getGameByChannelId(interaction.channelId);
  if (!game) {
    return { ok: false, message: t('error.no_game_dot') };
  }

  if (game.phase !== PHASES.NIGHT) {
    return { ok: false, message: t('error.skip_night_only') };
  }

  const player = game.players.find(p => p.id === interaction.user.id);
  if (!player || !player.alive) {
    return { ok: false, message: t('error.not_participating_or_dead') };
  }

  if (player.role !== ROLES.THIEF) {
    return { ok: false, message: t('error.skip_role_mismatch', { label: 'Voleur' }) };
  }

  if (game.subPhase !== PHASES.VOLEUR) {
    return { ok: false, message: t('error.cannot_skip_phase') };
  }

  // Both-wolves rule: skip is forbidden
  if (game.thiefExtraRoles && game.thiefExtraRoles.length === 2) {
    const isWolf = (r) => r === ROLES.WEREWOLF || r === ROLES.WHITE_WOLF;
    if (isWolf(game.thiefExtraRoles[0]) && isWolf(game.thiefExtraRoles[1])) {
      return { ok: false, message: t('cmd.steal.must_take_wolf') };
    }
  }

  return { ok: true, game, player };
}

// ─── Wolf Kill (vote) ──────────────────────────────────────────────

/**
 * Validate a wolf vote via select menu.
 * Mirrors the guard chain in commands/kill.js (LOUPS phase).
 */
function validateWolfKill(interaction, targetId) {
  const game = gameManager.getGameByChannelId(interaction.channelId);
  if (!game) return { ok: false, message: t('error.no_game') };

  if (interaction.channelId !== game.wolvesChannelId) {
    return { ok: false, message: t('error.only_wolves_channel') };
  }
  if (game.phase !== PHASES.NIGHT) {
    return { ok: false, message: t('error.wolves_only_at_night') };
  }
  if (game.subPhase !== PHASES.LOUPS) {
    return { ok: false, message: t('error.not_wolves_turn') };
  }
  // Prevent votes after the round is resolved
  if (game.wolvesVoteState && game.wolvesVoteState.resolved) {
    return { ok: false, message: t('error.wolves_already_resolved') };
  }

  const player = game.players.find(p => p.id === interaction.user.id);
  if (!player || !player.alive) {
    return { ok: false, message: t('error.you_are_dead') };
  }
  const isWolf = player.role === ROLES.WEREWOLF || player.role === ROLES.WHITE_WOLF;
  if (!isWolf) {
    return { ok: false, message: t('error.not_werewolf') };
  }

  const target = game.players.find(p => p.id === targetId);
  if (!target) return { ok: false, message: t('error.player_not_found') };
  if (!target.alive) return { ok: false, message: t('error.player_already_dead') };
  if (target.role === ROLES.WEREWOLF || target.role === ROLES.WHITE_WOLF) {
    return { ok: false, message: t('error.cannot_kill_wolf') };
  }

  return { ok: true, game, player, target };
}

// ─── White Wolf Kill ───────────────────────────────────────────────

/**
 * Validate the White Wolf's solo kill during LOUP_BLANC phase.
 * Mirrors commands/kill.js handleWhiteWolfKill.
 */
function validateWhiteWolfKill(interaction, targetId) {
  const game = gameManager.getGameByChannelId(interaction.channelId);
  if (!game) return { ok: false, message: t('error.no_game') };

  if (interaction.channelId !== game.whiteWolfChannelId) {
    return { ok: false, message: t('error.action_forbidden') };
  }
  if (game.phase !== PHASES.NIGHT) {
    return { ok: false, message: t('error.wolves_only_at_night') };
  }
  if (game.subPhase !== PHASES.LOUP_BLANC) {
    return { ok: false, message: t('error.action_forbidden') };
  }

  const player = game.players.find(p => p.id === interaction.user.id);
  if (!player || !player.alive) {
    return { ok: false, message: t('error.you_are_dead') };
  }
  if (player.role !== ROLES.WHITE_WOLF) {
    return { ok: false, message: t('error.action_forbidden') };
  }

  const target = game.players.find(p => p.id === targetId);
  if (!target) return { ok: false, message: t('error.player_not_found') };
  if (!target.alive) return { ok: false, message: t('error.player_already_dead') };
  if (target.role !== ROLES.WEREWOLF) {
    return { ok: false, message: t('error.white_wolf_target_must_be_wolf') };
  }

  return { ok: true, game, player, target };
}

// ─── Seer See ──────────────────────────────────────────────────────

/**
 * Validate a seer "see" action via select menu.
 * Mirrors commands/see.js guard chain.
 */
function validateSeerSee(interaction, targetId) {
  const game = gameManager.getGameByChannelId(interaction.channelId);
  if (!game) return { ok: false, message: t('error.no_game') };

  if (interaction.channelId !== game.seerChannelId) {
    return { ok: false, message: t('error.only_seer_channel') };
  }
  if (game.phase !== PHASES.NIGHT) {
    return { ok: false, message: t('error.seer_night_only') };
  }
  if (game.subPhase !== PHASES.VOYANTE) {
    return { ok: false, message: t('error.not_seer_turn') };
  }

  const player = game.players.find(p => p.id === interaction.user.id);
  if (!player || player.role !== ROLES.SEER) {
    return { ok: false, message: t('error.not_seer') };
  }
  if (!player.alive) {
    return { ok: false, message: t('error.seer_dead') };
  }
  if (game.villageRolesPowerless) {
    return { ok: false, message: t('error.powers_lost') };
  }

  const target = game.players.find(p => p.id === targetId);
  if (!target) return { ok: false, message: t('error.player_not_found') };
  if (!target.alive) return { ok: false, message: t('error.target_already_dead') };

  return { ok: true, game, player, target };
}

// ─── Salvateur Protect ─────────────────────────────────────────────

/**
 * Validate a salvateur protect action via select menu.
 * Mirrors commands/protect.js guard chain.
 */
function validateSalvateurProtect(interaction, targetId) {
  const game = gameManager.getGameByChannelId(interaction.channelId);
  if (!game) return { ok: false, message: t('error.no_game') };

  if (interaction.channelId !== game.salvateurChannelId) {
    return { ok: false, message: t('error.only_salvateur_channel') };
  }
  if (game.phase !== PHASES.NIGHT) {
    return { ok: false, message: t('error.salvateur_night_only') };
  }
  if (game.subPhase !== PHASES.SALVATEUR) {
    return { ok: false, message: t('error.not_salvateur_turn') };
  }

  const player = game.players.find(p => p.id === interaction.user.id);
  if (!player || player.role !== ROLES.SALVATEUR) {
    return { ok: false, message: t('error.not_salvateur') };
  }
  if (!player.alive) {
    return { ok: false, message: t('error.salvateur_dead') };
  }
  if (game.villageRolesPowerless) {
    return { ok: false, message: t('error.powers_lost') };
  }

  if (targetId === interaction.user.id) {
    return { ok: false, message: t('error.cannot_protect_self') };
  }

  const target = game.players.find(p => p.id === targetId);
  if (!target) return { ok: false, message: t('error.player_not_found') };
  if (!target.alive) return { ok: false, message: t('error.target_dead') };

  if (game.lastProtectedPlayerId && game.lastProtectedPlayerId === targetId) {
    return { ok: false, message: t('error.cannot_protect_same') };
  }

  return { ok: true, game, player, target };
}

// ─── Witch Potion ──────────────────────────────────────────────────

/**
 * Validate the common witch guards (channel, phase, role, alive, powers).
 * Used by both life and death potion actions.
 */
function validateWitchBase(interaction) {
  const game = gameManager.getGameByChannelId(interaction.channelId);
  if (!game) return { ok: false, message: t('error.no_game') };

  if (interaction.channelId !== game.witchChannelId) {
    return { ok: false, message: t('error.only_witch_channel') };
  }
  if (game.phase !== PHASES.NIGHT) {
    return { ok: false, message: t('error.witch_night_only') };
  }
  if (game.subPhase !== PHASES.SORCIERE) {
    return { ok: false, message: t('error.not_witch_turn') };
  }

  const player = game.players.find(p => p.id === interaction.user.id);
  if (!player || player.role !== ROLES.WITCH) {
    return { ok: false, message: t('error.not_witch') };
  }
  if (!player.alive) {
    return { ok: false, message: t('error.witch_dead') };
  }
  if (game.villageRolesPowerless) {
    return { ok: false, message: t('error.powers_lost') };
  }

  return { ok: true, game, player };
}

/**
 * Validate a witch life potion action (button).
 */
function validateWitchLife(interaction) {
  const base = validateWitchBase(interaction);
  if (!base.ok) return base;

  const { game } = base;
  if (!game.witchPotions.life) {
    return { ok: false, message: t('error.no_life_potion') };
  }
  if (!game.nightVictim) {
    return { ok: false, message: t('error.no_victim_tonight') };
  }

  return base;
}

/**
 * Validate a witch death potion action (select menu).
 */
function validateWitchDeath(interaction, targetId) {
  const base = validateWitchBase(interaction);
  if (!base.ok) return base;

  const { game } = base;
  if (!game.witchPotions.death) {
    return { ok: false, message: t('error.no_death_potion') };
  }

  const target = game.players.find(p => p.id === targetId);
  if (!target || !target.alive) {
    return { ok: false, message: t('error.target_invalid') };
  }
  if (targetId === interaction.user.id) {
    return { ok: false, message: t('error.cannot_poison_self') };
  }

  return { ...base, target };
}

/**
 * Validate a witch skip action (button).
 */
function validateWitchSkip(interaction) {
  return validateWitchBase(interaction);
}

// ─── Cupid Love ────────────────────────────────────────────────────

/**
 * Validate a cupid love action (multi-select menu).
 * Mirrors commands/love.js guard chain.
 */
function validateCupidLove(interaction, targetAId, targetBId) {
  const game = gameManager.getGameByChannelId(interaction.channelId);
  if (!game) return { ok: false, message: t('error.no_game') };

  if (interaction.channelId !== game.cupidChannelId) {
    return { ok: false, message: t('error.only_cupid_channel') };
  }

  const player = game.players.find(p => p.id === interaction.user.id);
  if (!player || player.role !== ROLES.CUPID) {
    return { ok: false, message: t('error.not_cupid') };
  }
  if (game.lovers && game.lovers.length > 0) {
    return { ok: false, message: t('error.cupid_already_used') };
  }

  if (targetAId === targetBId) {
    return { ok: false, message: t('error.same_person') };
  }

  const pa = game.players.find(p => p.id === targetAId);
  const pb = game.players.find(p => p.id === targetBId);
  if (!pa || !pb) {
    return { ok: false, message: t('error.targets_must_be_players') };
  }
  if (!pa.alive || !pb.alive) {
    return { ok: false, message: t('error.targets_must_be_alive') };
  }

  if (game.phase !== PHASES.NIGHT) {
    return { ok: false, message: t('error.cupid_night_only') };
  }
  if (game.subPhase !== PHASES.CUPIDON) {
    return { ok: false, message: t('error.cupid_wrong_time') };
  }

  return { ok: true, game, player, targetA: pa, targetB: pb };
}

// ─── Generic Skip (reusable) ───────────────────────────────────────

/**
 * Validate a skip action for any role with a skip button.
 * Mirrors the skip.js guard chain for a specific role.
 *
 * @param {Interaction} interaction
 * @param {string} expectedRole   ROLES constant (e.g. ROLES.SEER)
 * @param {string} expectedPhase  PHASES constant (e.g. PHASES.VOYANTE)
 * @param {string} label          Display label for error messages
 */
function validateSkip(interaction, expectedRole, expectedPhase, label) {
  const game = gameManager.getGameByChannelId(interaction.channelId);
  if (!game) return { ok: false, message: t('error.no_game_dot') };

  if (game.phase !== PHASES.NIGHT) {
    return { ok: false, message: t('error.skip_night_only') };
  }

  const player = game.players.find(p => p.id === interaction.user.id);
  if (!player || !player.alive) {
    return { ok: false, message: t('error.not_participating_or_dead') };
  }
  if (player.role !== expectedRole) {
    return { ok: false, message: t('error.skip_role_mismatch', { label }) };
  }
  if (game.subPhase !== expectedPhase) {
    return { ok: false, message: t('error.cannot_skip_phase') };
  }

  return { ok: true, game, player };
}

// ─── Little Girl Listen ─────────────────────────────────────────────

/**
 * Validate a Little Girl listen action (village panel button).
 * New mechanic: ephemeral button in village channel, once per night,
 * with exposure tracking and permanent reveal.
 *
 * @param {ButtonInteraction} interaction  Already deferred (ephemeral).
 * @returns {{ ok: true, game: object, player: object } | { ok: false, message: string }}
 */
function validateLittleGirlListen(interaction) {
  // Find the game for this player (may be in village channel or any channel)
  let game = gameManager.getGameByChannelId(interaction.channelId);
  if (!game) {
    // Fallback: search by guild + player id
    game = Array.from(gameManager.games.values())
      .filter(g => g.guildId === interaction.guildId)
      .find(g => g.players.some(p => p.id === interaction.user.id));
  }
  if (!game) {
    return { ok: false, message: t('error.not_in_any_game') };
  }

  const player = game.players.find(p => p.id === interaction.user.id);
  if (!player || player.role !== ROLES.PETITE_FILLE) {
    return { ok: false, message: t('error.not_petite_fille') };
  }
  if (!player.alive) {
    return { ok: false, message: t('error.dead_cannot_listen') };
  }
  if (game.villageRolesPowerless) {
    return { ok: false, message: t('error.powers_lost') };
  }
  if (game.phase !== PHASES.NIGHT) {
    return { ok: false, message: t('error.listen_night_only') };
  }
  if (game.subPhase !== PHASES.LOUPS) {
    return { ok: false, message: t('error.wolves_not_deliberating') };
  }
  if (!game.wolvesChannelId) {
    return { ok: false, message: t('error.wolves_channel_missing') };
  }
  if (game.littleGirlListenedThisNight) {
    return { ok: false, message: t('error.already_listened_tonight') };
  }
  if (game.littleGirlExposed) {
    return { ok: false, message: t('error.lgirl_exposed') };
  }

  return { ok: true, game, player };
}

module.exports = {
  validateThiefSteal,
  validateThiefSkip,
  // Wolves
  validateWolfKill,
  validateWhiteWolfKill,
  // Seer
  validateSeerSee,
  // Salvateur
  validateSalvateurProtect,
  // Witch
  validateWitchBase,
  validateWitchLife,
  validateWitchDeath,
  validateWitchSkip,
  // Cupid
  validateCupidLove,
  // Generic skip
  validateSkip,
  // Ephemeral role actions
  validateLittleGirlListen,
};
