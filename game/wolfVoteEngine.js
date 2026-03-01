/**
 * game/wolfVoteEngine.js — Modular wolf vote engine with majority, rounds, and resolution.
 *
 * DESIGN:
 *   • Wolves vote collectively to choose a victim during the LOUPS subPhase.
 *   • Majority = floor(aliveWolves / 2) + 1  (e.g. 3→2, 4→3, 2→2 unanimity).
 *   • Round 1: if majority reached → immediate kill. If all voted, no majority → round 2.
 *   • Round 2: if majority reached → kill. If all voted, no majority → no kill.
 *   • Timer expiry: plurality wins (most votes → kill). Tie or no votes → no kill.
 *     Majority is NOT required at timeout — this is a pragmatic AFK fallback.
 *
 * ABSOLUTE CONSTRAINTS:
 *   ❌ No Discord API calls — pure logic only.
 *   ❌ No database writes — the caller is responsible.
 *   ❌ No global state — operates on the wolvesVoteState sub-object.
 *
 * Every function is pure / deterministic (given the state) and fully testable.
 */

const ROLES = require('./roles');

// ─── Majority Calculation ──────────────────────────────────────────

/**
 * Calculate the strict majority needed for wolves to agree.
 *   majority = floor(totalWolves / 2) + 1
 *
 * Examples:
 *   2 wolves → 2 (unanimity)
 *   3 wolves → 2
 *   4 wolves → 3
 *   5 wolves → 3
 *
 * @param {number} totalWolves - Number of alive wolves
 * @returns {number}
 */
function getWolfMajority(totalWolves) {
  if (totalWolves <= 0) return 1;
  return Math.floor(totalWolves / 2) + 1;
}

// ─── Alive Wolves Helper ──────────────────────────────────────────

/**
 * Get all alive wolf players from a game.
 * Includes both WEREWOLF and WHITE_WOLF.
 *
 * @param {object} game
 * @param {Function} [isRealPlayerId] - Optional function to filter out fake/bot players.
 * @returns {Array<object>}
 */
function getAliveWolves(game, isRealPlayerId) {
  return (game.players || []).filter(
    p =>
      (p.role === ROLES.WEREWOLF || p.role === ROLES.WHITE_WOLF) &&
      p.alive &&
      (!isRealPlayerId || isRealPlayerId(p.id))
  );
}

// ─── State Factory ─────────────────────────────────────────────────

/**
 * Create a fresh wolvesVoteState.
 * Called at game init, night transition, and round advance.
 *
 * @param {number} [round=1] - Starting round (1 or 2).
 * @returns {{ round: number, votes: Map<string,string>, resolved: boolean }}
 */
function createWolvesVoteState(round = 1) {
  return {
    round,
    votes: new Map(),
    resolved: false,
  };
}

// ─── Vote Registration ────────────────────────────────────────────

/**
 * Register (or update) a wolf's vote for a target.
 * A wolf can change their vote as long as the round is not resolved.
 *
 * @param {{ round: number, votes: Map, resolved: boolean }} state
 * @param {string} wolfUserId
 * @param {string} targetId
 * @returns {number|null} - Number of votes for that target after this vote, or null if resolved.
 */
function registerWolfVote(state, wolfUserId, targetId) {
  if (state.resolved) return null;
  state.votes.set(wolfUserId, targetId);
  return [...state.votes.values()].filter(v => v === targetId).length;
}

// ─── Majority Check ───────────────────────────────────────────────

/**
 * Check if any target has reached majority among current votes.
 *
 * @param {{ votes: Map }} state
 * @param {number} totalWolves - Alive wolf count (for majority computation).
 * @returns {{ targetId: string, count: number }|null} - Winner if majority reached, null otherwise.
 */
function checkWolfMajority(state, totalWolves) {
  const majority = getWolfMajority(totalWolves);
  const counts = new Map();

  for (const targetId of state.votes.values()) {
    const count = (counts.get(targetId) || 0) + 1;
    counts.set(targetId, count);
    if (count >= majority) {
      return { targetId, count };
    }
  }

  return null;
}

// ─── All Voted Check ──────────────────────────────────────────────

/**
 * Check whether every alive wolf has cast a vote in this round.
 *
 * @param {{ votes: Map }} state
 * @param {string[]} aliveWolfIds - IDs of alive wolves.
 * @returns {boolean}
 */
function allWolvesVoted(state, aliveWolfIds) {
  return aliveWolfIds.every(id => state.votes.has(id));
}

// ─── Resolution ───────────────────────────────────────────────────

/**
 * Resolve the wolf vote: mark state as resolved.
 * The caller is responsible for setting game.nightVictim and advancing.
 *
 * @param {{ resolved: boolean }} state
 */
function resolveWolfKill(state) {
  state.resolved = true;
}

// ─── Round Advance ────────────────────────────────────────────────

/**
 * Advance from round 1 to round 2.
 * Resets all votes and increments the round counter.
 *
 * @param {{ round: number, votes: Map }} state
 * @returns {number} - New round number (always 2).
 */
function advanceWolfRound(state) {
  state.round = 2;
  state.votes = new Map();
  return state.round;
}

// ─── Full Vote Processing ─────────────────────────────────────────

/**
 * Process a wolf vote and determine the outcome.
 * This is the main entry point called by handlers after registering a vote.
 *
 * Returns an outcome object describing what happened:
 *   - { action: 'kill', targetId, votesForTarget }          → Majority reached, kill target.
 *   - { action: 'advance_round' }                           → Round 1 exhausted, advancing to round 2.
 *   - { action: 'no_kill' }                                 → Round 2 exhausted, no one dies.
 *   - { action: 'pending', votesForTarget, majorityNeeded } → Votes still in progress.
 *
 * @param {{ round: number, votes: Map, resolved: boolean }} state
 * @param {string[]} aliveWolfIds
 * @param {number} totalWolves
 * @returns {{ action: string, targetId?: string, votesForTarget?: number, majorityNeeded?: number }}
 */
function processWolfVote(state, aliveWolfIds, totalWolves) {
  const majorityNeeded = getWolfMajority(totalWolves);

  // 1. Check majority
  const majorityResult = checkWolfMajority(state, totalWolves);
  if (majorityResult) {
    resolveWolfKill(state);
    return {
      action: 'kill',
      targetId: majorityResult.targetId,
      votesForTarget: majorityResult.count,
    };
  }

  // 2. Check if all wolves voted
  if (allWolvesVoted(state, aliveWolfIds)) {
    if (state.round === 1) {
      advanceWolfRound(state);
      return { action: 'advance_round' };
    }
    // Round 2 — no consensus
    resolveWolfKill(state);
    return { action: 'no_kill' };
  }

  // 3. Still waiting for votes
  // Get the vote count for the most recent target (last vote)
  const lastTarget = [...state.votes.values()].pop();
  const votesForTarget = lastTarget
    ? [...state.votes.values()].filter(v => v === lastTarget).length
    : 0;

  return {
    action: 'pending',
    votesForTarget,
    majorityNeeded,
  };
}

// ─── Timer Resolution ─────────────────────────────────────────────

/**
 * Resolve the wolf vote on timer expiry (AFK timeout).
 *
 * Timeout uses PLURALITY, not majority:
 *   • If already resolved → { action: 'already_resolved' }
 *   • If no votes cast → no kill.
 *   • If votes exist → the target with the most votes dies.
 *   • Strict tie between top targets → no kill.
 *
 * This is intentionally different from active-phase resolution (which
 * requires strict majority).  Timeout is a pragmatic fallback to avoid
 * soft-locks when wolves are AFK or disagree.
 *
 * @param {{ votes: Map, resolved: boolean }} state
 * @returns {{ action: 'already_resolved' }|{ action: 'kill', targetId: string }|{ action: 'no_kill' }}
 */
function resolveOnTimeout(state) {
  if (state.resolved) return { action: 'already_resolved' };

  resolveWolfKill(state);

  // No votes at all → no kill
  if (state.votes.size === 0) return { action: 'no_kill' };

  // Count votes per target
  const counts = new Map();
  for (const targetId of state.votes.values()) {
    counts.set(targetId, (counts.get(targetId) || 0) + 1);
  }

  // Find the maximum vote count
  let maxCount = 0;
  for (const count of counts.values()) {
    if (count > maxCount) maxCount = count;
  }

  // Collect all targets with the max count
  const topTargets = [];
  for (const [targetId, count] of counts.entries()) {
    if (count === maxCount) topTargets.push(targetId);
  }

  // Strict tie → no kill
  if (topTargets.length > 1) return { action: 'no_kill' };

  // Single plurality winner → kill
  return { action: 'kill', targetId: topTargets[0] };
}

module.exports = {
  getWolfMajority,
  getAliveWolves,
  createWolvesVoteState,
  registerWolfVote,
  checkWolfMajority,
  allWolvesVoted,
  resolveWolfKill,
  advanceWolfRound,
  processWolfVote,
  resolveOnTimeout,
};
