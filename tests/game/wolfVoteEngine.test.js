/**
 * Tests for game/wolfVoteEngine.js — Wolf collective vote engine.
 */

const {
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
} = require('../../game/wolfVoteEngine');

const ROLES = require('../../game/roles');

// ─── getWolfMajority ───────────────────────────────────────────────

describe('getWolfMajority', () => {
  test('1 wolf → majority = 1', () => {
    expect(getWolfMajority(1)).toBe(1);
  });

  test('2 wolves → majority = 2 (unanimity)', () => {
    expect(getWolfMajority(2)).toBe(2);
  });

  test('3 wolves → majority = 2', () => {
    expect(getWolfMajority(3)).toBe(2);
  });

  test('4 wolves → majority = 3', () => {
    expect(getWolfMajority(4)).toBe(3);
  });

  test('5 wolves → majority = 3', () => {
    expect(getWolfMajority(5)).toBe(3);
  });

  test('6 wolves → majority = 4', () => {
    expect(getWolfMajority(6)).toBe(4);
  });

  test('0 wolves → majority = 1 (safety)', () => {
    expect(getWolfMajority(0)).toBe(1);
  });
});

// ─── getAliveWolves ────────────────────────────────────────────────

describe('getAliveWolves', () => {
  test('returns alive WEREWOLF and WHITE_WOLF', () => {
    const game = {
      players: [
        { id: 'w1', role: ROLES.WEREWOLF, alive: true },
        { id: 'w2', role: ROLES.WHITE_WOLF, alive: true },
        { id: 'v1', role: ROLES.VILLAGER, alive: true },
        { id: 'w3', role: ROLES.WEREWOLF, alive: false },
      ],
    };
    const result = getAliveWolves(game);
    expect(result).toHaveLength(2);
    expect(result.map(w => w.id)).toEqual(['w1', 'w2']);
  });

  test('filters by isRealPlayerId when provided', () => {
    const game = {
      players: [
        { id: 'w1', role: ROLES.WEREWOLF, alive: true },
        { id: 'fake_w2', role: ROLES.WEREWOLF, alive: true },
      ],
    };
    const result = getAliveWolves(game, id => !id.startsWith('fake'));
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('w1');
  });
});

// ─── createWolvesVoteState ─────────────────────────────────────────

describe('createWolvesVoteState', () => {
  test('creates fresh state with round 1', () => {
    const state = createWolvesVoteState();
    expect(state.round).toBe(1);
    expect(state.votes).toBeInstanceOf(Map);
    expect(state.votes.size).toBe(0);
    expect(state.resolved).toBe(false);
  });

  test('creates state with custom round', () => {
    const state = createWolvesVoteState(2);
    expect(state.round).toBe(2);
  });
});

// ─── registerWolfVote ──────────────────────────────────────────────

describe('registerWolfVote', () => {
  test('registers a vote and returns votes for target', () => {
    const state = createWolvesVoteState();
    const count = registerWolfVote(state, 'w1', 'v1');
    expect(count).toBe(1);
    expect(state.votes.get('w1')).toBe('v1');
  });

  test('allows updating a vote', () => {
    const state = createWolvesVoteState();
    registerWolfVote(state, 'w1', 'v1');
    const count = registerWolfVote(state, 'w1', 'v2');
    expect(count).toBe(1);
    expect(state.votes.get('w1')).toBe('v2');
  });

  test('multiple wolves voting for same target', () => {
    const state = createWolvesVoteState();
    registerWolfVote(state, 'w1', 'v1');
    const count = registerWolfVote(state, 'w2', 'v1');
    expect(count).toBe(2);
  });

  test('returns null when resolved', () => {
    const state = createWolvesVoteState();
    state.resolved = true;
    const count = registerWolfVote(state, 'w1', 'v1');
    expect(count).toBeNull();
    expect(state.votes.size).toBe(0);
  });
});

// ─── checkWolfMajority ─────────────────────────────────────────────

describe('checkWolfMajority', () => {
  test('returns null when no majority', () => {
    const state = createWolvesVoteState();
    state.votes.set('w1', 'v1');
    state.votes.set('w2', 'v2');
    const result = checkWolfMajority(state, 3);
    expect(result).toBeNull();
  });

  test('returns winner when majority reached (3 wolves, 2 agree)', () => {
    const state = createWolvesVoteState();
    state.votes.set('w1', 'v1');
    state.votes.set('w2', 'v1');
    const result = checkWolfMajority(state, 3);
    expect(result).toEqual({ targetId: 'v1', count: 2 });
  });

  test('requires unanimity for 2 wolves', () => {
    const state = createWolvesVoteState();
    state.votes.set('w1', 'v1');
    // Only 1 vote — not enough for majority of 2
    expect(checkWolfMajority(state, 2)).toBeNull();

    state.votes.set('w2', 'v1');
    // Now both agree → majority = 2
    expect(checkWolfMajority(state, 2)).toEqual({ targetId: 'v1', count: 2 });
  });

  test('returns first target to reach majority', () => {
    const state = createWolvesVoteState();
    state.votes.set('w1', 'v1');
    state.votes.set('w2', 'v2');
    state.votes.set('w3', 'v1');
    const result = checkWolfMajority(state, 4);
    // majority for 4 = 3, so 2 votes for v1 is not enough
    expect(result).toBeNull();
  });
});

// ─── allWolvesVoted ────────────────────────────────────────────────

describe('allWolvesVoted', () => {
  test('returns false when not all voted', () => {
    const state = createWolvesVoteState();
    state.votes.set('w1', 'v1');
    expect(allWolvesVoted(state, ['w1', 'w2'])).toBe(false);
  });

  test('returns true when all voted', () => {
    const state = createWolvesVoteState();
    state.votes.set('w1', 'v1');
    state.votes.set('w2', 'v2');
    expect(allWolvesVoted(state, ['w1', 'w2'])).toBe(true);
  });
});

// ─── resolveWolfKill ───────────────────────────────────────────────

describe('resolveWolfKill', () => {
  test('marks state as resolved', () => {
    const state = createWolvesVoteState();
    resolveWolfKill(state);
    expect(state.resolved).toBe(true);
  });
});

// ─── advanceWolfRound ──────────────────────────────────────────────

describe('advanceWolfRound', () => {
  test('advances to round 2 and resets votes', () => {
    const state = createWolvesVoteState();
    state.votes.set('w1', 'v1');
    state.votes.set('w2', 'v2');

    const newRound = advanceWolfRound(state);

    expect(newRound).toBe(2);
    expect(state.round).toBe(2);
    expect(state.votes.size).toBe(0);
    expect(state.resolved).toBe(false);
  });
});

// ─── processWolfVote ───────────────────────────────────────────────

describe('processWolfVote', () => {
  test('majority reached → kill', () => {
    const state = createWolvesVoteState();
    state.votes.set('w1', 'v1');
    state.votes.set('w2', 'v1');

    const result = processWolfVote(state, ['w1', 'w2', 'w3'], 3);

    expect(result.action).toBe('kill');
    expect(result.targetId).toBe('v1');
    expect(result.votesForTarget).toBe(2);
    expect(state.resolved).toBe(true);
  });

  test('all voted round 1 no majority → advance_round', () => {
    const state = createWolvesVoteState();
    state.votes.set('w1', 'v1');
    state.votes.set('w2', 'v2');
    state.votes.set('w3', 'v3');

    const result = processWolfVote(state, ['w1', 'w2', 'w3'], 3);

    expect(result.action).toBe('advance_round');
    expect(state.round).toBe(2);
    expect(state.votes.size).toBe(0);
    expect(state.resolved).toBe(false);
  });

  test('all voted round 2 no majority → no_kill', () => {
    const state = createWolvesVoteState(2);
    state.votes.set('w1', 'v1');
    state.votes.set('w2', 'v2');
    state.votes.set('w3', 'v3');

    const result = processWolfVote(state, ['w1', 'w2', 'w3'], 3);

    expect(result.action).toBe('no_kill');
    expect(state.resolved).toBe(true);
  });

  test('pending when not all voted and no majority', () => {
    const state = createWolvesVoteState();
    state.votes.set('w1', 'v1');

    const result = processWolfVote(state, ['w1', 'w2', 'w3'], 3);

    expect(result.action).toBe('pending');
    expect(result.votesForTarget).toBe(1);
    expect(result.majorityNeeded).toBe(2);
    expect(state.resolved).toBe(false);
  });

  test('2 wolves must be unanimous in round 1', () => {
    const state = createWolvesVoteState();
    state.votes.set('w1', 'v1');
    state.votes.set('w2', 'v2');

    const result = processWolfVote(state, ['w1', 'w2'], 2);

    // All voted, no majority (need 2), round 1 → advance_round
    expect(result.action).toBe('advance_round');
  });

  test('2 wolves unanimous → kill', () => {
    const state = createWolvesVoteState();
    state.votes.set('w1', 'v1');
    state.votes.set('w2', 'v1');

    const result = processWolfVote(state, ['w1', 'w2'], 2);

    expect(result.action).toBe('kill');
    expect(result.targetId).toBe('v1');
  });

  test('4 wolves need 3 to agree', () => {
    const state = createWolvesVoteState();
    state.votes.set('w1', 'v1');
    state.votes.set('w2', 'v1');
    // Only 2 votes for v1, majority is 3 for 4 wolves

    const result = processWolfVote(state, ['w1', 'w2', 'w3', 'w4'], 4);

    expect(result.action).toBe('pending');
    expect(result.majorityNeeded).toBe(3);
  });

  test('solo wolf kills immediately', () => {
    const state = createWolvesVoteState();
    state.votes.set('w1', 'v1');

    const result = processWolfVote(state, ['w1'], 1);

    expect(result.action).toBe('kill');
    expect(result.targetId).toBe('v1');
  });
});

// ─── resolveOnTimeout ──────────────────────────────────────────────

describe('resolveOnTimeout', () => {
  test('kills the target with the most votes (plurality)', () => {
    const state = createWolvesVoteState();
    state.votes.set('w1', 'v1');
    state.votes.set('w2', 'v1');
    state.votes.set('w3', 'v2');

    const result = resolveOnTimeout(state);

    expect(result.action).toBe('kill');
    expect(result.targetId).toBe('v1');
    expect(state.resolved).toBe(true);
  });

  test('single vote becomes decisive (1 wolf voted, others AFK)', () => {
    const state = createWolvesVoteState();
    state.votes.set('w1', 'v1');
    // w2 and w3 are AFK — did not vote

    const result = resolveOnTimeout(state);

    expect(result.action).toBe('kill');
    expect(result.targetId).toBe('v1');
    expect(state.resolved).toBe(true);
  });

  test('strict tie between top targets → no kill', () => {
    const state = createWolvesVoteState();
    state.votes.set('w1', 'v1');
    state.votes.set('w2', 'v2');

    const result = resolveOnTimeout(state);

    expect(result.action).toBe('no_kill');
    expect(state.resolved).toBe(true);
  });

  test('no kill when no votes at all', () => {
    const state = createWolvesVoteState();
    const result = resolveOnTimeout(state);

    expect(result.action).toBe('no_kill');
    expect(state.resolved).toBe(true);
  });

  test('returns already_resolved when state is already resolved', () => {
    const state = createWolvesVoteState();
    state.resolved = true;
    state.votes.set('w1', 'v1');

    const result = resolveOnTimeout(state);

    expect(result.action).toBe('already_resolved');
    expect(state.resolved).toBe(true); // unchanged
  });

  test('3-way tie with 3 wolves → no kill', () => {
    const state = createWolvesVoteState();
    state.votes.set('w1', 'v1');
    state.votes.set('w2', 'v2');
    state.votes.set('w3', 'v3');

    const result = resolveOnTimeout(state);

    expect(result.action).toBe('no_kill');
    expect(state.resolved).toBe(true);
  });

  test('2 votes vs 1 vote → plurality winner kills', () => {
    const state = createWolvesVoteState();
    state.votes.set('w1', 'v2');
    state.votes.set('w2', 'v2');
    state.votes.set('w3', 'v1');
    state.votes.set('w4', 'v3');

    const result = resolveOnTimeout(state);

    expect(result.action).toBe('kill');
    expect(result.targetId).toBe('v2');
    expect(state.resolved).toBe(true);
  });
});
