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

module.exports = {
  validateThiefSteal,
  validateThiefSkip,
};
