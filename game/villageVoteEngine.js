/**
 * game/villageVoteEngine.js — Modular village vote engine for day phase.
 *
 * DESIGN:
 *   • All alive villagers vote to eliminate a player during VOTE subPhase.
 *   • Every alive player gets exactly ONE vote (no captain ×2).
 *   • Votes are modifiable until resolution.
 *   • Resolution: strict plurality wins. Tie → captain tiebreak subphase.
 *   • Idiot du Village: survives first village vote, revealed, loses vote right.
 *
 * ABSOLUTE CONSTRAINTS:
 *   ❌ No Discord API calls — pure logic only.
 *   ❌ No database writes — the caller is responsible.
 *   ❌ No global state — operates on the villageVoteState sub-object.
 *
 * Every function is pure / deterministic (given the state) and fully testable.
 */

const ROLES = require('./roles');

// ─── State Factory ─────────────────────────────────────────────────

/**
 * Create a fresh villageVoteState.
 * Called at start of VOTE subPhase.
 *
 * @returns {{ votes: Map<string,string>, resolved: boolean, tiedCandidates: string[] }}
 */
function createVillageVoteState() {
  return {
    votes: new Map(),    // voterId → targetId
    resolved: false,
    tiedCandidates: [],  // populated only when tie detected
  };
}

// ─── Eligible Voters ───────────────────────────────────────────────

/**
 * Get all players eligible to vote.
 * Excludes: dead players, revealed Idiot du Village, fake players.
 *
 * @param {object} game
 * @param {Function} [isRealPlayerId] - Optional filter for real players.
 * @returns {Array<object>}
 */
function getEligibleVoters(game, isRealPlayerId) {
  return (game.players || []).filter(p => {
    if (!p.alive) return false;
    if (isRealPlayerId && !isRealPlayerId(p.id)) return false;
    // Revealed Idiot cannot vote
    if (p.role === ROLES.IDIOT && p.idiotRevealed) return false;
    return true;
  });
}

/**
 * Get all alive players who can be voted against (vote targets).
 * All alive players can be targeted (even revealed Idiot, even self).
 *
 * @param {object} game
 * @param {string} [excludeId] - Optional player ID to exclude (self).
 * @returns {Array<object>}
 */
function getVoteTargets(game, excludeId) {
  return (game.players || []).filter(p => {
    if (!p.alive) return false;
    if (excludeId && p.id === excludeId) return false;
    return true;
  });
}

// ─── Vote Registration ────────────────────────────────────────────

/**
 * Register (or update) a player's vote.
 * Returns null if already resolved. Otherwise returns the new vote count for target.
 *
 * @param {{ votes: Map, resolved: boolean }} state
 * @param {string} voterId
 * @param {string} targetId
 * @returns {number|null} - Votes for target after this vote, or null if resolved.
 */
function registerVillageVote(state, voterId, targetId) {
  if (state.resolved) return null;
  state.votes.set(voterId, targetId);
  return [...state.votes.values()].filter(v => v === targetId).length;
}

// ─── Vote Tally ───────────────────────────────────────────────────

/**
 * Tally all votes and return sorted results.
 *
 * @param {{ votes: Map }} state
 * @returns {Array<{ targetId: string, count: number }>} - Sorted by count DESC.
 */
function tallyVotes(state) {
  const counts = new Map();
  for (const targetId of state.votes.values()) {
    counts.set(targetId, (counts.get(targetId) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([targetId, count]) => ({ targetId, count }))
    .sort((a, b) => b.count - a.count);
}

// ─── All Voted Check ──────────────────────────────────────────────

/**
 * Check whether every eligible voter has cast a vote.
 *
 * @param {{ votes: Map }} state
 * @param {string[]} eligibleVoterIds
 * @returns {boolean}
 */
function allVotersVoted(state, eligibleVoterIds) {
  return eligibleVoterIds.every(id => state.votes.has(id));
}

// ─── Resolution ───────────────────────────────────────────────────

/**
 * Check whether any candidate has reached absolute majority.
 * Absolute majority = strictly more than half the eligible voters.
 * Example: 5 eligible voters → need 3 votes (floor(5/2) + 1).
 *
 * @param {{ votes: Map }} state
 * @param {number} totalEligible - Number of eligible voters.
 * @returns {{ targetId: string, count: number }|null} - Winner if majority, null otherwise.
 */
function hasAbsoluteMajority(state, totalEligible) {
  const threshold = Math.floor(totalEligible / 2) + 1;
  const counts = new Map();
  for (const targetId of state.votes.values()) {
    const c = (counts.get(targetId) || 0) + 1;
    counts.set(targetId, c);
    if (c >= threshold) {
      return { targetId, count: c };
    }
  }
  return null;
}

/**
 * Resolve the village vote.
 *
 * Outcomes:
 *   - { action: 'already_resolved' }                                  → No-op.
 *   - { action: 'eliminate', targetId, count }                        → Clear winner.
 *   - { action: 'tie', tiedCandidates: [id1, id2, ...], count }      → Need captain tiebreak.
 *   - { action: 'no_vote' }                                          → No votes cast.
 *
 * NOTE: This does NOT handle Idiot du Village logic — the caller must check
 * the eliminated player's role after resolution and call resolveIdiotEffect().
 *
 * @param {{ votes: Map, resolved: boolean, tiedCandidates: string[] }} state
 * @returns {{ action: string, targetId?: string, tiedCandidates?: string[], count?: number }}
 */
function resolveVillageVote(state) {
  if (state.resolved) return { action: 'already_resolved' };

  if (state.votes.size === 0) {
    state.resolved = true;
    return { action: 'no_vote' };
  }

  const tally = tallyVotes(state);
  const topCount = tally[0].count;
  const topCandidates = tally.filter(t => t.count === topCount);

  if (topCandidates.length === 1) {
    // Clear winner
    state.resolved = true;
    return {
      action: 'eliminate',
      targetId: topCandidates[0].targetId,
      count: topCount,
    };
  }

  // Tie — store tiedCandidates for captain tiebreak
  state.tiedCandidates = topCandidates.map(c => c.targetId);
  // Don't mark resolved yet — captain tiebreak pending
  return {
    action: 'tie',
    tiedCandidates: state.tiedCandidates,
    count: topCount,
  };
}

// ─── Captain Tiebreak ─────────────────────────────────────────────

/**
 * Record the captain's tiebreak decision.
 *
 * @param {{ resolved: boolean, tiedCandidates: string[] }} state
 * @param {string} targetId - Must be in tiedCandidates.
 * @returns {{ action: 'eliminate', targetId: string }|{ action: 'invalid' }|{ action: 'already_resolved' }}
 */
function resolveCaptainTiebreak(state, targetId) {
  if (state.resolved) return { action: 'already_resolved' };
  if (!state.tiedCandidates.includes(targetId)) return { action: 'invalid' };

  state.resolved = true;
  return { action: 'eliminate', targetId };
}

/**
 * Resolve when the captain fails to tiebreak (AFK).
 * Per spec: nobody dies.
 *
 * @param {{ resolved: boolean }} state
 * @returns {{ action: 'no_kill' }|{ action: 'already_resolved' }}
 */
function resolveCaptainTiebreakTimeout(state) {
  if (state.resolved) return { action: 'already_resolved' };
  state.resolved = true;
  return { action: 'no_kill' };
}

// ─── Idiot du Village ─────────────────────────────────────────────

/**
 * Check if the eliminated player is the Idiot du Village (first reveal).
 * If so, the Idiot survives, is revealed, and loses vote rights.
 *
 * Returns the modified player object, or null if Idiot effect doesn't apply.
 *
 * @param {object} player - The eliminated player object.
 * @returns {{ isIdiot: true, player: object }|null}
 */
function resolveIdiotEffect(player) {
  if (!player) return null;
  if (player.role !== ROLES.IDIOT) return null;
  if (player.idiotRevealed) return null; // already revealed → dies normally

  // First time: survive + reveal + lose vote
  player.idiotRevealed = true;
  return { isIdiot: true, player };
}

// ─── Vote Display Helpers ─────────────────────────────────────────

/**
 * Build a display-ready vote tally for the public embed.
 * Shows only target → count (never reveals who voted for whom).
 *
 * @param {{ votes: Map }} state
 * @param {Array<object>} players - All game players (for name lookup).
 * @returns {Array<{ name: string, id: string, count: number }>}
 */
function buildVoteDisplay(state, players) {
  const tally = tallyVotes(state);
  return tally.map(({ targetId, count }) => {
    const player = players.find(p => p.id === targetId);
    return {
      name: player ? player.username : targetId,
      id: targetId,
      count,
    };
  });
}

module.exports = {
  createVillageVoteState,
  getEligibleVoters,
  getVoteTargets,
  registerVillageVote,
  tallyVotes,
  allVotersVoted,
  hasAbsoluteMajority,
  resolveVillageVote,
  resolveCaptainTiebreak,
  resolveCaptainTiebreakTimeout,
  resolveIdiotEffect,
  buildVoteDisplay,
};
