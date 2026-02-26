/**
 * Conflict Resolver — Deterministic resolution of competing ability effects.
 * 
 * Resolution order (hardcoded):
 * 1. Redirects
 * 2. Blocks
 * 3. Protections
 * 4. Kills
 * 5. On-death triggers (handled by recursive dispatch in engine)
 * 
 * NO async. NO side effects. Pure function.
 * 
 * @module game/abilities/conflictResolver
 */

'use strict';

/**
 * Resolve conflicts between accumulated ability effects in a cycle.
 * 
 * @param {Object} cycleState - Accumulated effects from handlers
 * @param {Object} game       - Game state (read for player lookups)
 * @returns {{ cycleState: Object, confirmedKills: Array }}
 */
function resolveConflicts(cycleState, game) {
  const resolved = { ...cycleState };
  const confirmedKills = [];

  // ─── Step 1: Validate Redirects ─────────────────────────────────────────
  // Remove redirects that target dead players or self
  if (resolved.redirects) {
    resolved.redirects = resolved.redirects.filter(r => {
      const target = game.players.find(p => p.id === r.newTargetId);
      return target && target.alive && r.originalTargetId !== r.newTargetId;
    });
  }

  // ─── Step 2: Apply Blocks ──────────────────────────────────────────────
  // Blocked players' pending actions are removed
  if (resolved.blocked && resolved.blocked.length > 0) {
    const blockedIds = new Set(resolved.blocked.map(b => b.targetId));

    // Remove kills from blocked sources
    if (resolved.pendingKills) {
      resolved.pendingKills = resolved.pendingKills.filter(k => !blockedIds.has(k.sourceId));
    }

    // Remove protections from blocked sources
    if (resolved.protections) {
      resolved.protections = resolved.protections.filter(p => !blockedIds.has(p.sourceId));
    }

    // Remove redirects from blocked sources
    if (resolved.redirects) {
      resolved.redirects = resolved.redirects.filter(r => !blockedIds.has(r.sourceId));
    }
  }

  // ─── Step 3: Apply Redirects to Kills ──────────────────────────────────
  if (resolved.redirects && resolved.redirects.length > 0 && resolved.pendingKills) {
    for (const kill of resolved.pendingKills) {
      const redirect = resolved.redirects.find(r => r.originalTargetId === kill.targetId);
      if (redirect) {
        kill.originalTargetId = kill.targetId;
        kill.targetId = redirect.newTargetId;
        kill.redirected = true;
      }
    }
  }

  // ─── Step 4: Apply Protections vs Kills ────────────────────────────────
  if (resolved.pendingKills && resolved.pendingKills.length > 0) {
    const protectedIds = new Set();

    // Collect all protected player IDs
    if (resolved.protections) {
      for (const prot of resolved.protections) {
        protectedIds.add(prot.targetId);
      }
    }

    // Collect immune player IDs
    if (resolved.immunities) {
      for (const im of resolved.immunities) {
        protectedIds.add(im.targetId);
      }
    }

    // Filter kills: remove those targeting protected/immune players (unless bypass)
    const survived = [];
    const actualKills = [];

    for (const kill of resolved.pendingKills) {
      if (protectedIds.has(kill.targetId) && !kill.bypassProtection) {
        survived.push(kill);
      } else {
        actualKills.push(kill);
      }
    }

    resolved.pendingKills = actualKills;
    resolved.survivedKills = survived;
  }

  // ─── Step 5: Deduplicate Kills ─────────────────────────────────────────
  // Same player can't die twice in one cycle
  if (resolved.pendingKills && resolved.pendingKills.length > 0) {
    const seen = new Set();
    const deduped = [];
    for (const kill of resolved.pendingKills) {
      if (!seen.has(kill.targetId)) {
        seen.add(kill.targetId);
        deduped.push(kill);
        confirmedKills.push(kill);
      }
    }
    resolved.pendingKills = deduped;
  }

  // ─── Step 6: Validate Vote Modifiers ───────────────────────────────────
  // Last modifier wins for each player
  if (resolved.voteModifiers && resolved.voteModifiers.length > 0) {
    const lastMod = new Map();
    for (const mod of resolved.voteModifiers) {
      lastMod.set(mod.playerId, mod);
    }
    resolved.voteModifiers = Array.from(lastMod.values());
  }

  // ─── Step 7: Validate Silence ──────────────────────────────────────────
  // Deduplicate: a player can only be silenced once per cycle
  if (resolved.silenced && resolved.silenced.length > 0) {
    const silencedMap = new Map();
    for (const s of resolved.silenced) {
      if (!silencedMap.has(s.targetId)) {
        silencedMap.set(s.targetId, s);
      }
    }
    resolved.silenced = Array.from(silencedMap.values());
  }

  return {
    cycleState: resolved,
    confirmedKills,
  };
}

/**
 * Apply confirmed kills to game state.
 * Call AFTER conflict resolution, inside runAtomic.
 * 
 * @param {Array} confirmedKills - From resolveConflicts
 * @param {Object} game          - Mutable game state
 * @param {Function} killFn      - (channelId, playerId, options) => collateral[]
 * @returns {Array<Object>} All dead players (including collateral)
 */
function applyKills(confirmedKills, game, killFn) {
  const allDeaths = [];

  for (const kill of confirmedKills) {
    const target = game.players.find(p => p.id === kill.targetId);
    if (!target || !target.alive) continue;

    const collateral = killFn(game.mainChannelId, kill.targetId, { throwOnDbFailure: true });
    allDeaths.push({ player: target, kill, collateral });
  }

  return allDeaths;
}

module.exports = {
  resolveConflicts,
  applyKills,
};
