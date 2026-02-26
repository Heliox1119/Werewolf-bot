/**
 * Effect Handlers — Pure, deterministic functions that apply ability effects.
 * 
 * Each handler receives a MutationContext and returns a result object.
 * NO async. NO side effects beyond the mutation context. NO eval.
 * 
 * @module game/abilities/effectHandlers
 */

'use strict';

/**
 * @typedef {Object} MutationContext
 * @property {Object} game            - In-memory game state (mutable within runAtomic)
 * @property {Object} source          - Player who owns the ability
 * @property {Object|null} target     - Targeted player (if any)
 * @property {Object} ability         - The ability being executed
 * @property {Object} parameters      - Resolved parameters
 * @property {Object} cycleState      - Shared state for this resolution cycle
 * @property {Function} logAction     - (game, text) => void
 */

/**
 * @typedef {Object} EffectResult
 * @property {boolean} applied     - Whether the effect was successfully applied
 * @property {string} action       - Human-readable action description
 * @property {Object} [data]       - Optional data payload for the caller
 */

// ─── Handler Registry ────────────────────────────────────────────────────────

const handlers = Object.create(null);

// ─── protect ─────────────────────────────────────────────────────────────────

handlers.protect = function protectHandler(ctx) {
  const { game, target, source, ability } = ctx;
  if (!target) return { applied: false, action: 'protect: no target' };

  // Track protection in cycle state for conflict resolution
  if (!ctx.cycleState.protections) ctx.cycleState.protections = [];
  ctx.cycleState.protections.push({
    sourceId: source.id,
    targetId: target.id,
    abilityId: ability.id,
  });

  // Apply protection to game state
  game.protectedPlayerId = target.id;

  return {
    applied: true,
    action: `${source.username} protects ${target.username}`,
    data: { protectedId: target.id },
  };
};

// ─── kill ────────────────────────────────────────────────────────────────────

handlers.kill = function killHandler(ctx) {
  const { game, target, source, ability, parameters } = ctx;
  if (!target) return { applied: false, action: 'kill: no target' };
  if (!target.alive) return { applied: false, action: `kill: ${target.username} already dead` };

  // Check if target is protected (unless bypassProtection is set)
  if (!parameters.bypassProtection) {
    const protections = ctx.cycleState.protections || [];
    const isProtected = protections.some(p => p.targetId === target.id);
    if (isProtected) {
      return {
        applied: false,
        action: `${source.username} tried to kill ${target.username} but they were protected`,
        data: { blocked: true, reason: 'protected' },
      };
    }

    // Check immune_to_kill passive
    const immunities = ctx.cycleState.immunities || [];
    const isImmune = immunities.some(im => im.targetId === target.id);
    if (isImmune) {
      return {
        applied: false,
        action: `${source.username} tried to kill ${target.username} but they are immune`,
        data: { blocked: true, reason: 'immune' },
      };
    }
  }

  // Check if target is blocked by redirect
  const redirects = ctx.cycleState.redirects || [];
  const redirect = redirects.find(r => r.originalTargetId === target.id);
  if (redirect) {
    const redirectedTarget = game.players.find(p => p.id === redirect.newTargetId);
    if (redirectedTarget && redirectedTarget.alive) {
      // Queue the kill on the redirected target instead
      if (!ctx.cycleState.pendingKills) ctx.cycleState.pendingKills = [];
      ctx.cycleState.pendingKills.push({
        targetId: redirect.newTargetId,
        sourceId: source.id,
        abilityId: ability.id,
        reason: 'redirected',
      });
      return {
        applied: true,
        action: `${source.username}'s kill on ${target.username} redirected to ${redirectedTarget.username}`,
        data: { redirected: true, originalTargetId: target.id, newTargetId: redirect.newTargetId },
      };
    }
  }

  // Queue kill — actual death applied in commit phase
  if (!ctx.cycleState.pendingKills) ctx.cycleState.pendingKills = [];
  ctx.cycleState.pendingKills.push({
    targetId: target.id,
    sourceId: source.id,
    abilityId: ability.id,
    reason: 'ability',
  });

  return {
    applied: true,
    action: `${source.username} kills ${target.username}`,
    data: { killedId: target.id },
  };
};

// ─── inspect_alignment ───────────────────────────────────────────────────────

handlers.inspect_alignment = function inspectAlignmentHandler(ctx) {
  const { target, source } = ctx;
  if (!target) return { applied: false, action: 'inspect_alignment: no target' };

  // Determine alignment from role
  const alignment = getPlayerAlignment(ctx.game, target);

  return {
    applied: true,
    action: `${source.username} inspects ${target.username}'s alignment: ${alignment}`,
    data: { targetId: target.id, alignment },
  };
};

// ─── inspect_role ────────────────────────────────────────────────────────────

handlers.inspect_role = function inspectRoleHandler(ctx) {
  const { target, source } = ctx;
  if (!target) return { applied: false, action: 'inspect_role: no target' };

  return {
    applied: true,
    action: `${source.username} inspects ${target.username}'s role: ${target.role}`,
    data: { targetId: target.id, role: target.role },
  };
};

// ─── double_vote ─────────────────────────────────────────────────────────────

handlers.double_vote = function doubleVoteHandler(ctx) {
  const { source, game } = ctx;

  if (!ctx.cycleState.voteModifiers) ctx.cycleState.voteModifiers = [];
  ctx.cycleState.voteModifiers.push({
    playerId: source.id,
    weight: 2,
    reason: 'double_vote',
  });

  return {
    applied: true,
    action: `${source.username}'s vote counts double`,
    data: { playerId: source.id, weight: 2 },
  };
};

// ─── silence ─────────────────────────────────────────────────────────────────

handlers.silence = function silenceHandler(ctx) {
  const { target, source, parameters } = ctx;
  if (!target) return { applied: false, action: 'silence: no target' };

  if (!ctx.cycleState.silenced) ctx.cycleState.silenced = [];
  ctx.cycleState.silenced.push({
    targetId: target.id,
    sourceId: source.id,
    duration: parameters.duration || 1,
  });

  return {
    applied: true,
    action: `${source.username} silences ${target.username}`,
    data: { targetId: target.id },
  };
};

// ─── redirect ────────────────────────────────────────────────────────────────

handlers.redirect = function redirectHandler(ctx) {
  const { target, source, game } = ctx;
  if (!target) return { applied: false, action: 'redirect: no target' };

  // Second target via parameters isn't supported in the base system;
  // redirect sends actions aimed at the source to the target instead
  if (!ctx.cycleState.redirects) ctx.cycleState.redirects = [];
  ctx.cycleState.redirects.push({
    originalTargetId: source.id,
    newTargetId: target.id,
    sourceId: source.id,
  });

  return {
    applied: true,
    action: `${source.username} redirects actions to ${target.username}`,
    data: { fromId: source.id, toId: target.id },
  };
};

// ─── block ───────────────────────────────────────────────────────────────────

handlers.block = function blockHandler(ctx) {
  const { target, source, parameters } = ctx;
  if (!target) return { applied: false, action: 'block: no target' };

  if (!ctx.cycleState.blocked) ctx.cycleState.blocked = [];
  ctx.cycleState.blocked.push({
    targetId: target.id,
    sourceId: source.id,
    duration: parameters.duration || 1,
  });

  return {
    applied: true,
    action: `${source.username} blocks ${target.username}`,
    data: { targetId: target.id },
  };
};

// ─── reveal_role ─────────────────────────────────────────────────────────────

handlers.reveal_role = function revealRoleHandler(ctx) {
  const { target, source, parameters } = ctx;
  if (!target) return { applied: false, action: 'reveal_role: no target' };

  if (!ctx.cycleState.reveals) ctx.cycleState.reveals = [];
  ctx.cycleState.reveals.push({
    targetId: target.id,
    sourceId: source.id,
    type: 'role',
    value: target.role,
    toAll: parameters.toAll || false,
  });

  return {
    applied: true,
    action: `${source.username} reveals ${target.username}'s role: ${target.role}`,
    data: { targetId: target.id, role: target.role, toAll: parameters.toAll || false },
  };
};

// ─── reveal_alignment ────────────────────────────────────────────────────────

handlers.reveal_alignment = function revealAlignmentHandler(ctx) {
  const { game, target, source, parameters } = ctx;
  if (!target) return { applied: false, action: 'reveal_alignment: no target' };

  const alignment = getPlayerAlignment(game, target);
  if (!ctx.cycleState.reveals) ctx.cycleState.reveals = [];
  ctx.cycleState.reveals.push({
    targetId: target.id,
    sourceId: source.id,
    type: 'alignment',
    value: alignment,
    toAll: parameters.toAll || false,
  });

  return {
    applied: true,
    action: `${source.username} reveals ${target.username}'s alignment: ${alignment}`,
    data: { targetId: target.id, alignment, toAll: parameters.toAll || false },
  };
};

// ─── modify_vote_weight ──────────────────────────────────────────────────────

handlers.modify_vote_weight = function modifyVoteWeightHandler(ctx) {
  const { target, source, parameters } = ctx;
  const playerId = target ? target.id : source.id;

  if (!ctx.cycleState.voteModifiers) ctx.cycleState.voteModifiers = [];
  ctx.cycleState.voteModifiers.push({
    playerId,
    weight: parameters.weight,
    reason: 'modify_vote_weight',
  });

  return {
    applied: true,
    action: `Vote weight for ${playerId} set to ${parameters.weight}`,
    data: { playerId, weight: parameters.weight },
  };
};

// ─── swap_roles ──────────────────────────────────────────────────────────────

handlers.swap_roles = function swapRolesHandler(ctx) {
  const { target, source, game } = ctx;
  if (!target) return { applied: false, action: 'swap_roles: no target' };
  if (source.id === target.id) return { applied: false, action: 'swap_roles: cannot swap with self' };

  // Perform the swap on game state
  const sourcePlayer = game.players.find(p => p.id === source.id);
  const targetPlayer = game.players.find(p => p.id === target.id);
  if (!sourcePlayer || !targetPlayer) return { applied: false, action: 'swap_roles: player not found' };

  const tempRole = sourcePlayer.role;
  sourcePlayer.role = targetPlayer.role;
  targetPlayer.role = tempRole;

  return {
    applied: true,
    action: `${source.username} swaps roles with ${target.username}`,
    data: { sourceId: source.id, targetId: target.id },
  };
};

// ─── immune_to_kill ──────────────────────────────────────────────────────────

handlers.immune_to_kill = function immuneToKillHandler(ctx) {
  const { source, parameters } = ctx;

  if (!ctx.cycleState.immunities) ctx.cycleState.immunities = [];
  ctx.cycleState.immunities.push({
    targetId: source.id,
    maxUses: parameters.maxUses || null,
  });

  return {
    applied: true,
    action: `${source.username} is immune to kill`,
    data: { playerId: source.id },
  };
};

// ─── win_override ────────────────────────────────────────────────────────────

handlers.win_override = function winOverrideHandler(ctx) {
  const { source, parameters, game } = ctx;

  if (!ctx.cycleState.winOverrides) ctx.cycleState.winOverrides = [];
  ctx.cycleState.winOverrides.push({
    playerId: source.id,
    condition: parameters.condition,
  });

  return {
    applied: true,
    action: `${source.username} has win override: ${parameters.condition}`,
    data: { playerId: source.id, condition: parameters.condition },
  };
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Determine a player's alignment based on their role.
 * Uses built-in role knowledge + custom role camp field.
 * @param {Object} game
 * @param {Object} player
 * @returns {string} 'village' | 'wolves' | 'solo'
 */
function getPlayerAlignment(game, player) {
  const ROLES = require('../roles');
  const wolfRoles = [ROLES.WEREWOLF, ROLES.WHITE_WOLF];
  
  if (wolfRoles.includes(player.role)) return 'wolves';

  // Check if player has a custom role with camp info
  if (player._customRole && player._customRole.camp) {
    return player._customRole.camp;
  }

  return 'village';
}

/**
 * Get a handler for the given effect.
 * @param {string} effect
 * @returns {Function|null}
 */
function getHandler(effect) {
  return handlers[effect] || null;
}

// ─── Exports ─────────────────────────────────────────────────────────────────

module.exports = {
  handlers,
  getHandler,
  getPlayerAlignment,
};
