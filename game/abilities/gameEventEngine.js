/**
 * Game Event Engine — Centralized, deterministic event dispatcher
 * for the composable ability system.
 * 
 * Dispatches events through ability hooks, resolves conflicts,
 * and commits mutations atomically. NO async inside ability execution.
 * NO dynamic code. NO eval.
 * 
 * @module game/abilities/gameEventEngine
 */

'use strict';

const { ABILITY_TRIGGERS, EFFECT_PRIORITY, MAX_EVENT_DEPTH } = require('./abilitySchema');
const { getHandler } = require('./effectHandlers');
const { resolveConflicts } = require('./conflictResolver');
const { game: logger } = require('../../utils/logger');

// ─── Event Names ─────────────────────────────────────────────────────────────

const EVENTS = Object.freeze({
  NIGHT_ACTION:      'night_action',
  PLAYER_TARGETED:   'player_targeted',
  VOTE_CAST:         'vote_cast',
  PLAYER_DEATH:      'player_death',
  PHASE_START:       'phase_start',
  PHASE_END:         'phase_end',
});

// ─── Ability Runtime State ───────────────────────────────────────────────────

/**
 * Per-game runtime state for ability tracking.
 * Stored on game._abilityState (serializable).
 * 
 * @typedef {Object} AbilityRuntimeState
 * @property {Object.<string, number>} chargesUsed     - { "playerId:abilityId": usageCount }
 * @property {Object.<string, number>} lastUsedTurn    - { "playerId:abilityId": dayCount }
 * @property {string[]} executedThisCycle               - Ability keys executed this resolution cycle
 */

/**
 * Initialize or get the ability runtime state for a game.
 * @param {Object} game
 * @returns {AbilityRuntimeState}
 */
function getAbilityState(game) {
  if (!game._abilityState) {
    game._abilityState = {
      chargesUsed: {},
      lastUsedTurn: {},
      executedThisCycle: [],
    };
  }
  return game._abilityState;
}

/**
 * Reset per-cycle tracking (call at start of each resolution).
 * @param {Object} game
 */
function resetCycleState(game) {
  const state = getAbilityState(game);
  state.executedThisCycle = [];
}

// ─── Ability Collection ──────────────────────────────────────────────────────

/**
 * Collect all abilities from all alive players that match the given trigger.
 * Respects charges, cooldowns, and block status.
 * 
 * @param {Object} game - Game state
 * @param {string} trigger - Event trigger name
 * @param {Object} [context] - Additional context (phase, targetId, etc.)
 * @returns {Array<{ player: Object, ability: Object }>}
 */
function collectMatchingAbilities(game, trigger, context = {}) {
  const abilityState = getAbilityState(game);
  const matches = [];

  for (const player of game.players) {
    if (!player.alive) continue;
    if (!player._customRole || !player._customRole.abilities) continue;

    for (const ability of player._customRole.abilities) {
      if (ability.trigger !== trigger) continue;

      // Phase filter
      if (ability.phase && ability.phase !== 'any') {
        const currentMainPhase = game.phase === 'Nuit' ? 'night' : game.phase === 'Jour' ? 'day' : null;
        if (ability.phase !== currentMainPhase) continue;
      }

      // Check charges
      const key = `${player.id}:${ability.id}`;
      if (ability.charges !== null) {
        const used = abilityState.chargesUsed[key] || 0;
        if (used >= ability.charges) continue;
      }

      // Check cooldown
      if (ability.cooldown !== null) {
        const lastUsed = abilityState.lastUsedTurn[key];
        if (lastUsed !== undefined) {
          const turnsSince = (game.dayCount || 0) - lastUsed;
          if (turnsSince < ability.cooldown) continue;
        }
      }

      // Check if player is blocked this cycle
      if (context.cycleState && context.cycleState.blocked) {
        const isBlocked = context.cycleState.blocked.some(b => b.targetId === player.id);
        if (isBlocked && ability.type !== 'passive') continue;
      }

      // Already executed this cycle? Prevent re-trigger
      if (abilityState.executedThisCycle.includes(key)) continue;

      matches.push({ player, ability });
    }
  }

  return matches;
}

/**
 * Sort abilities by priority (deterministic order).
 * Lower priority number = earlier execution.
 * Ties broken by player join order (index in players array).
 * 
 * @param {Object} game
 * @param {Array<{ player: Object, ability: Object }>} abilities
 * @returns {Array<{ player: Object, ability: Object }>}
 */
function sortByPriority(game, abilities) {
  const playerIndex = new Map();
  game.players.forEach((p, i) => playerIndex.set(p.id, i));

  return abilities.slice().sort((a, b) => {
    const prioA = a.ability.priority ?? EFFECT_PRIORITY[a.ability.effect] ?? 50;
    const prioB = b.ability.priority ?? EFFECT_PRIORITY[b.ability.effect] ?? 50;
    if (prioA !== prioB) return prioA - prioB;
    // Tie-break by player order
    return (playerIndex.get(a.player.id) || 0) - (playerIndex.get(b.player.id) || 0);
  });
}

// ─── Core Dispatch ───────────────────────────────────────────────────────────

/**
 * Dispatch an event through the ability system.
 * 
 * This is the main entry point. It:
 * 1. Collects matching abilities
 * 2. Sorts by priority
 * 3. Executes handlers synchronously
 * 4. Resolves conflicts
 * 5. Returns results for the caller to commit through runAtomic
 * 
 * MUST be called inside runAtomic or equivalent atomic context.
 * NO async inside this function.
 * 
 * @param {string} eventName  - One of EVENTS
 * @param {Object} context    - Event context
 * @param {Object} context.game       - Mutable game state
 * @param {Object} [context.source]   - Player triggering the event
 * @param {Object} [context.target]   - Target player (if applicable)
 * @param {number} [context.depth=0]  - Recursion depth
 * @param {Object} [context.cycleState] - Shared cycle state (auto-created)
 * @returns {{ results: Array, cycleState: Object }}
 */
function dispatch(eventName, context) {
  const { game, depth = 0 } = context;

  // Prevent infinite recursion
  if (depth >= MAX_EVENT_DEPTH) {
    logger.warn('Event engine: max recursion depth reached', { eventName, depth });
    return { results: [], cycleState: context.cycleState || {} };
  }

  // Validate event name
  if (!Object.values(EVENTS).includes(eventName)) {
    logger.warn('Event engine: unknown event', { eventName });
    return { results: [], cycleState: context.cycleState || {} };
  }

  // Map event name to trigger
  const trigger = eventName;

  // Initialize cycle state
  const cycleState = context.cycleState || {
    protections: [],
    pendingKills: [],
    immunities: [],
    redirects: [],
    blocked: [],
    silenced: [],
    reveals: [],
    voteModifiers: [],
    winOverrides: [],
  };

  if (depth === 0) {
    resetCycleState(game);
  }

  // Collect matching abilities
  const matching = collectMatchingAbilities(game, trigger, { cycleState });
  if (matching.length === 0) {
    return { results: [], cycleState };
  }

  // Sort by priority
  const sorted = sortByPriority(game, matching);

  // Execute handlers
  const results = [];
  const abilityState = getAbilityState(game);

  for (const { player, ability } of sorted) {
    const handler = getHandler(ability.effect);
    if (!handler) {
      logger.warn('Event engine: no handler for effect', { effect: ability.effect });
      continue;
    }

    // Build mutation context
    const mutCtx = {
      game,
      source: player,
      target: context.target || null,
      ability,
      parameters: ability.parameters || {},
      cycleState,
      logAction: context.logAction || (() => {}),
    };

    try {
      const result = handler(mutCtx);
      results.push({
        playerId: player.id,
        abilityId: ability.id,
        effect: ability.effect,
        ...result,
      });

      if (result.applied) {
        // Track usage
        const key = `${player.id}:${ability.id}`;
        abilityState.executedThisCycle.push(key);

        if (ability.charges !== null) {
          abilityState.chargesUsed[key] = (abilityState.chargesUsed[key] || 0) + 1;
        }
        if (ability.cooldown !== null) {
          abilityState.lastUsedTurn[key] = game.dayCount || 0;
        }
      }
    } catch (err) {
      logger.error('Event engine: handler error', {
        effect: ability.effect,
        playerId: player.id,
        error: err.message,
      });
      results.push({
        playerId: player.id,
        abilityId: ability.id,
        effect: ability.effect,
        applied: false,
        action: `Error: ${err.message}`,
      });
    }
  }

  // Resolve conflicts in the cycle state
  const resolved = resolveConflicts(cycleState, game);

  // If there are on-death triggers from pending kills, dispatch recursively
  if (resolved.confirmedKills && resolved.confirmedKills.length > 0 && depth < MAX_EVENT_DEPTH - 1) {
    for (const kill of resolved.confirmedKills) {
      const deadPlayer = game.players.find(p => p.id === kill.targetId);
      if (deadPlayer) {
        const deathResults = dispatch(EVENTS.PLAYER_DEATH, {
          game,
          source: deadPlayer,
          target: deadPlayer,
          depth: depth + 1,
          cycleState: resolved.cycleState,
          logAction: context.logAction,
        });
        results.push(...deathResults.results);
      }
    }
  }

  return { results, cycleState: resolved.cycleState || cycleState };
}

// ─── Convenience Methods ─────────────────────────────────────────────────────

/**
 * Dispatch night_action event for all custom-role players.
 * @param {Object} game
 * @param {Function} logAction
 * @returns {{ results: Array, cycleState: Object }}
 */
function dispatchNightActions(game, logAction) {
  return dispatch(EVENTS.NIGHT_ACTION, { game, logAction });
}

/**
 * Dispatch phase_start event.
 * @param {Object} game
 * @param {Function} logAction
 * @returns {{ results: Array, cycleState: Object }}
 */
function dispatchPhaseStart(game, logAction) {
  return dispatch(EVENTS.PHASE_START, { game, logAction });
}

/**
 * Dispatch phase_end event.
 * @param {Object} game
 * @param {Function} logAction
 * @returns {{ results: Array, cycleState: Object }}
 */
function dispatchPhaseEnd(game, logAction) {
  return dispatch(EVENTS.PHASE_END, { game, logAction });
}

/**
 * Dispatch player_death event.
 * @param {Object} game
 * @param {Object} deadPlayer
 * @param {Function} logAction
 * @returns {{ results: Array, cycleState: Object }}
 */
function dispatchPlayerDeath(game, deadPlayer, logAction) {
  return dispatch(EVENTS.PLAYER_DEATH, {
    game,
    source: deadPlayer,
    target: deadPlayer,
    logAction,
  });
}

/**
 * Dispatch vote_cast event.
 * @param {Object} game
 * @param {Object} voter
 * @param {Object} target
 * @param {Function} logAction
 * @returns {{ results: Array, cycleState: Object }}
 */
function dispatchVoteCast(game, voter, target, logAction) {
  return dispatch(EVENTS.VOTE_CAST, {
    game,
    source: voter,
    target,
    logAction,
  });
}

/**
 * Check if any player has abilities matching a given trigger/effect combo.
 * Useful for the FSM to know if custom role phases are needed.
 * 
 * @param {Object} game
 * @param {string} trigger
 * @param {string} [effect]
 * @returns {boolean}
 */
function hasAbilitiesForTrigger(game, trigger, effect) {
  for (const player of game.players) {
    if (!player.alive) continue;
    if (!player._customRole || !player._customRole.abilities) continue;
    for (const ability of player._customRole.abilities) {
      if (ability.trigger === trigger) {
        if (!effect || ability.effect === effect) return true;
      }
    }
  }
  return false;
}

/**
 * Serialize ability runtime state for persistence.
 * @param {Object} game
 * @returns {string} JSON string
 */
function serializeAbilityState(game) {
  const state = game._abilityState;
  if (!state) return '{}';
  // Only persist charges and cooldown tracking, not cycle state
  return JSON.stringify({
    chargesUsed: state.chargesUsed,
    lastUsedTurn: state.lastUsedTurn,
  });
}

/**
 * Restore ability runtime state from persisted JSON.
 * @param {Object} game
 * @param {string} json
 */
function restoreAbilityState(game, json) {
  try {
    const data = JSON.parse(json || '{}');
    game._abilityState = {
      chargesUsed: data.chargesUsed || {},
      lastUsedTurn: data.lastUsedTurn || {},
      executedThisCycle: [],
    };
  } catch {
    game._abilityState = {
      chargesUsed: {},
      lastUsedTurn: {},
      executedThisCycle: [],
    };
  }
}

// ─── Exports ─────────────────────────────────────────────────────────────────

module.exports = {
  EVENTS,
  dispatch,
  dispatchNightActions,
  dispatchPhaseStart,
  dispatchPhaseEnd,
  dispatchPlayerDeath,
  dispatchVoteCast,
  hasAbilitiesForTrigger,
  getAbilityState,
  resetCycleState,
  collectMatchingAbilities,
  sortByPriority,
  serializeAbilityState,
  restoreAbilityState,
};
