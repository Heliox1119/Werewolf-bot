/**
 * Built-in Role Definitions — Ability-based definitions for built-in roles.
 * 
 * These mirror the hardcoded behavior of existing roles but expressed
 * as composable abilities. This enables the event engine to process
 * both built-in and custom roles uniformly.
 * 
 * MIGRATION STRATEGY:
 * - Built-in roles still rely on existing FSM + hardcoded logic.
 * - These definitions provide a parallel path for the event engine.
 * - When a built-in role is processed by the event engine, it uses
 *   these definitions instead of creating duplicate logic.
 * - The existing commands (protect.js, shoot.js) remain untouched.
 * - The event engine hooks into transitionToDay() and advanceSubPhase()
 *   only for custom roles initially.
 * 
 * @module game/abilities/builtinRoles
 */

'use strict';

const ROLES = require('../roles');

// ─── Hunter ──────────────────────────────────────────────────────────────────

const HUNTER_DEFINITION = Object.freeze({
  name: ROLES.HUNTER,
  camp: 'village',
  winCondition: 'village_wins',
  abilities: Object.freeze([
    Object.freeze({
      id: 'hunter_shoot',
      type: 'on_death',
      trigger: 'player_death',
      phase: null,
      target: 'alive_other',
      effect: 'kill',
      charges: 1,
      cooldown: null,
      priority: 40,
      parameters: Object.freeze({ bypassProtection: false }),
    }),
  ]),
});

// ─── Salvateur ───────────────────────────────────────────────────────────────

const SALVATEUR_DEFINITION = Object.freeze({
  name: ROLES.SALVATEUR,
  camp: 'village',
  winCondition: 'village_wins',
  abilities: Object.freeze([
    Object.freeze({
      id: 'salvateur_protect',
      type: 'night_target',
      trigger: 'night_action',
      phase: 'night',
      target: 'alive_other',
      effect: 'protect',
      charges: null, // unlimited
      cooldown: null, // but can't protect same player twice in a row (enforced by command)
      priority: 30,
      parameters: Object.freeze({ protectSelf: false }),
    }),
  ]),
});

// ─── Seer ────────────────────────────────────────────────────────────────────

const SEER_DEFINITION = Object.freeze({
  name: ROLES.SEER,
  camp: 'village',
  winCondition: 'village_wins',
  abilities: Object.freeze([
    Object.freeze({
      id: 'seer_inspect',
      type: 'night_target',
      trigger: 'night_action',
      phase: 'night',
      target: 'alive_other',
      effect: 'inspect_role',
      charges: null,
      cooldown: null,
      priority: 50,
      parameters: Object.freeze({}),
    }),
  ]),
});

// ─── Witch ───────────────────────────────────────────────────────────────────

const WITCH_DEFINITION = Object.freeze({
  name: ROLES.WITCH,
  camp: 'village',
  winCondition: 'village_wins',
  abilities: Object.freeze([
    Object.freeze({
      id: 'witch_heal',
      type: 'night_target',
      trigger: 'night_action',
      phase: 'night',
      target: 'alive_player',
      effect: 'protect',
      charges: 1,
      cooldown: null,
      priority: 30,
      parameters: Object.freeze({ protectSelf: false }),
    }),
    Object.freeze({
      id: 'witch_poison',
      type: 'night_target',
      trigger: 'night_action',
      phase: 'night',
      target: 'alive_other',
      effect: 'kill',
      charges: 1,
      cooldown: null,
      priority: 40,
      parameters: Object.freeze({ bypassProtection: false }),
    }),
  ]),
});

// ─── Ancien ──────────────────────────────────────────────────────────────────

const ANCIEN_DEFINITION = Object.freeze({
  name: ROLES.ANCIEN,
  camp: 'village',
  winCondition: 'village_wins',
  abilities: Object.freeze([
    Object.freeze({
      id: 'ancien_extra_life',
      type: 'on_attacked',
      trigger: 'player_targeted',
      phase: null,
      target: 'self',
      effect: 'immune_to_kill',
      charges: 1,
      cooldown: null,
      priority: 35,
      parameters: Object.freeze({ maxUses: 1 }),
    }),
  ]),
});

// ─── Werewolf ────────────────────────────────────────────────────────────────

const WEREWOLF_DEFINITION = Object.freeze({
  name: ROLES.WEREWOLF,
  camp: 'wolves',
  winCondition: 'wolves_win',
  abilities: Object.freeze([
    Object.freeze({
      id: 'wolf_kill',
      type: 'night_target',
      trigger: 'night_action',
      phase: 'night',
      target: 'alive_non_wolf',
      effect: 'kill',
      charges: null,
      cooldown: null,
      priority: 40,
      parameters: Object.freeze({}),
    }),
  ]),
});

// ─── White Wolf ──────────────────────────────────────────────────────────────

const WHITE_WOLF_DEFINITION = Object.freeze({
  name: ROLES.WHITE_WOLF,
  camp: 'solo',
  winCondition: 'solo_survive',
  abilities: Object.freeze([
    Object.freeze({
      id: 'white_wolf_kill',
      type: 'night_target',
      trigger: 'night_action',
      phase: 'night',
      target: 'alive_wolf',
      effect: 'kill',
      charges: null,
      cooldown: 2, // every other night
      priority: 40,
      parameters: Object.freeze({}),
    }),
  ]),
});

// ─── Idiot du Village ────────────────────────────────────────────────────────

const IDIOT_DEFINITION = Object.freeze({
  name: ROLES.IDIOT,
  camp: 'village',
  winCondition: 'village_wins',
  abilities: Object.freeze([
    Object.freeze({
      id: 'idiot_reveal',
      type: 'on_vote',
      trigger: 'vote_cast',
      phase: 'day',
      target: 'self',
      effect: 'reveal_role',
      charges: 1,
      cooldown: null,
      priority: 55,
      parameters: Object.freeze({ toAll: true }),
    }),
  ]),
});

// ─── Registry ────────────────────────────────────────────────────────────────

const BUILTIN_ROLE_DEFINITIONS = Object.freeze({
  [ROLES.HUNTER]:       HUNTER_DEFINITION,
  [ROLES.SALVATEUR]:    SALVATEUR_DEFINITION,
  [ROLES.SEER]:         SEER_DEFINITION,
  [ROLES.WITCH]:        WITCH_DEFINITION,
  [ROLES.ANCIEN]:       ANCIEN_DEFINITION,
  [ROLES.WEREWOLF]:     WEREWOLF_DEFINITION,
  [ROLES.WHITE_WOLF]:   WHITE_WOLF_DEFINITION,
  [ROLES.IDIOT]:        IDIOT_DEFINITION,
});

/**
 * Get the ability-based definition for a built-in role.
 * @param {string} roleName 
 * @returns {Object|null}
 */
function getBuiltinDefinition(roleName) {
  return BUILTIN_ROLE_DEFINITIONS[roleName] || null;
}

/**
 * Check if a role has a built-in ability definition.
 * @param {string} roleName
 * @returns {boolean}
 */
function hasBuiltinDefinition(roleName) {
  return roleName in BUILTIN_ROLE_DEFINITIONS;
}

module.exports = {
  BUILTIN_ROLE_DEFINITIONS,
  HUNTER_DEFINITION,
  SALVATEUR_DEFINITION,
  SEER_DEFINITION,
  WITCH_DEFINITION,
  ANCIEN_DEFINITION,
  WEREWOLF_DEFINITION,
  WHITE_WOLF_DEFINITION,
  IDIOT_DEFINITION,
  getBuiltinDefinition,
  hasBuiltinDefinition,
};
