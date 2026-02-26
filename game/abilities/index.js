/**
 * Abilities Module — Barrel export for the composable role ability system.
 * 
 * @module game/abilities
 */

'use strict';

const abilitySchema = require('./abilitySchema');
const effectHandlers = require('./effectHandlers');
const gameEventEngine = require('./gameEventEngine');
const conflictResolver = require('./conflictResolver');
const builtinRoles = require('./builtinRoles');
const RoleBuilderService = require('./roleBuilderService');

module.exports = {
  // Schema & Validation
  ...abilitySchema,

  // Effect Handlers
  handlers: effectHandlers.handlers,
  getHandler: effectHandlers.getHandler,
  getPlayerAlignment: effectHandlers.getPlayerAlignment,

  // Event Engine
  EVENTS: gameEventEngine.EVENTS,
  dispatch: gameEventEngine.dispatch,
  dispatchNightActions: gameEventEngine.dispatchNightActions,
  dispatchPhaseStart: gameEventEngine.dispatchPhaseStart,
  dispatchPhaseEnd: gameEventEngine.dispatchPhaseEnd,
  dispatchPlayerDeath: gameEventEngine.dispatchPlayerDeath,
  dispatchVoteCast: gameEventEngine.dispatchVoteCast,
  hasAbilitiesForTrigger: gameEventEngine.hasAbilitiesForTrigger,
  getAbilityState: gameEventEngine.getAbilityState,
  serializeAbilityState: gameEventEngine.serializeAbilityState,
  restoreAbilityState: gameEventEngine.restoreAbilityState,

  // Conflict Resolution
  resolveConflicts: conflictResolver.resolveConflicts,
  applyKills: conflictResolver.applyKills,

  // Built-in Role Definitions
  BUILTIN_ROLE_DEFINITIONS: builtinRoles.BUILTIN_ROLE_DEFINITIONS,
  getBuiltinDefinition: builtinRoles.getBuiltinDefinition,
  hasBuiltinDefinition: builtinRoles.hasBuiltinDefinition,

  // Role Builder Service
  RoleBuilderService,
};
