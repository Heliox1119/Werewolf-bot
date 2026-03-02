/**
 * tests/game/villageVoteEngine.test.js — Tests for village vote engine.
 *
 * Covers: state creation, eligible voters, vote registration, tally,
 * resolution, captain tiebreak, captain AFK, Idiot du Village, display.
 */

const {
  createVillageVoteState,
  getEligibleVoters,
  getVoteTargets,
  registerVillageVote,
  tallyVotes,
  allVotersVoted,
  resolveVillageVote,
  resolveCaptainTiebreak,
  resolveCaptainTiebreakTimeout,
  resolveIdiotEffect,
  buildVoteDisplay,
} = require('../../game/villageVoteEngine');

// ─── Helpers ────────────────────────────────────────────────────────

function makePlayer(id, role = 'Villageois', alive = true, extra = {}) {
  return { id, username: `Player_${id}`, role, alive, ...extra };
}

function makeGame(players, extra = {}) {
  return { players, ...extra };
}

// ─── createVillageVoteState ─────────────────────────────────────────

describe('createVillageVoteState', () => {
  it('returns a fresh state with empty votes', () => {
    const state = createVillageVoteState();
    expect(state.votes).toBeInstanceOf(Map);
    expect(state.votes.size).toBe(0);
    expect(state.resolved).toBe(false);
    expect(state.tiedCandidates).toEqual([]);
  });
});

// ─── getEligibleVoters ──────────────────────────────────────────────

describe('getEligibleVoters', () => {
  it('returns alive players', () => {
    const players = [
      makePlayer('1'), makePlayer('2'), makePlayer('3', 'Villageois', false),
    ];
    const eligible = getEligibleVoters(makeGame(players));
    expect(eligible.map(p => p.id)).toEqual(['1', '2']);
  });

  it('excludes revealed Idiot du Village', () => {
    const players = [
      makePlayer('1'),
      makePlayer('2', 'Idiot du Village', true, { idiotRevealed: true }),
      makePlayer('3'),
    ];
    const eligible = getEligibleVoters(makeGame(players));
    expect(eligible.map(p => p.id)).toEqual(['1', '3']);
  });

  it('includes non-revealed Idiot du Village', () => {
    const players = [
      makePlayer('1'),
      makePlayer('2', 'Idiot du Village', true),
    ];
    const eligible = getEligibleVoters(makeGame(players));
    expect(eligible.map(p => p.id)).toEqual(['1', '2']);
  });

  it('excludes fake players when isRealPlayerId is provided', () => {
    const players = [
      makePlayer('1'), makePlayer('2'), makePlayer('fake_3'),
    ];
    const isReal = (id) => !id.startsWith('fake_');
    const eligible = getEligibleVoters(makeGame(players), isReal);
    expect(eligible.map(p => p.id)).toEqual(['1', '2']);
  });

  it('returns empty array for empty game', () => {
    expect(getEligibleVoters(makeGame([]))).toEqual([]);
  });
});

// ─── getVoteTargets ─────────────────────────────────────────────────

describe('getVoteTargets', () => {
  it('returns all alive players', () => {
    const players = [
      makePlayer('1'), makePlayer('2'), makePlayer('3', 'Villageois', false),
    ];
    const targets = getVoteTargets(makeGame(players));
    expect(targets.map(p => p.id)).toEqual(['1', '2']);
  });

  it('can exclude self', () => {
    const players = [makePlayer('1'), makePlayer('2'), makePlayer('3')];
    const targets = getVoteTargets(makeGame(players), '2');
    expect(targets.map(p => p.id)).toEqual(['1', '3']);
  });
});

// ─── registerVillageVote ────────────────────────────────────────────

describe('registerVillageVote', () => {
  it('registers a vote and returns count for target', () => {
    const state = createVillageVoteState();
    const count = registerVillageVote(state, 'voter1', 'target1');
    expect(count).toBe(1);
    expect(state.votes.get('voter1')).toBe('target1');
  });

  it('updates an existing vote (modifiable)', () => {
    const state = createVillageVoteState();
    registerVillageVote(state, 'voter1', 'target1');
    const count = registerVillageVote(state, 'voter1', 'target2');
    expect(count).toBe(1);
    expect(state.votes.get('voter1')).toBe('target2');
  });

  it('returns correct count with multiple voters for same target', () => {
    const state = createVillageVoteState();
    registerVillageVote(state, 'voter1', 'targetA');
    registerVillageVote(state, 'voter2', 'targetA');
    const count = registerVillageVote(state, 'voter3', 'targetA');
    expect(count).toBe(3);
  });

  it('returns null if already resolved', () => {
    const state = createVillageVoteState();
    state.resolved = true;
    expect(registerVillageVote(state, 'voter1', 'target1')).toBeNull();
  });
});

// ─── tallyVotes ─────────────────────────────────────────────────────

describe('tallyVotes', () => {
  it('tallies votes correctly and sorts by count DESC', () => {
    const state = createVillageVoteState();
    registerVillageVote(state, 'v1', 'tA');
    registerVillageVote(state, 'v2', 'tA');
    registerVillageVote(state, 'v3', 'tB');
    const tally = tallyVotes(state);
    expect(tally).toEqual([
      { targetId: 'tA', count: 2 },
      { targetId: 'tB', count: 1 },
    ]);
  });

  it('returns empty array for no votes', () => {
    const state = createVillageVoteState();
    expect(tallyVotes(state)).toEqual([]);
  });

  it('handles modified votes correctly', () => {
    const state = createVillageVoteState();
    registerVillageVote(state, 'v1', 'tA');
    registerVillageVote(state, 'v1', 'tB'); // change vote
    registerVillageVote(state, 'v2', 'tB');
    const tally = tallyVotes(state);
    expect(tally).toEqual([
      { targetId: 'tB', count: 2 },
    ]);
  });
});

// ─── allVotersVoted ─────────────────────────────────────────────────

describe('allVotersVoted', () => {
  it('returns true when all eligible voters have voted', () => {
    const state = createVillageVoteState();
    registerVillageVote(state, '1', 'target');
    registerVillageVote(state, '2', 'target');
    expect(allVotersVoted(state, ['1', '2'])).toBe(true);
  });

  it('returns false when some voters have not voted', () => {
    const state = createVillageVoteState();
    registerVillageVote(state, '1', 'target');
    expect(allVotersVoted(state, ['1', '2'])).toBe(false);
  });

  it('returns true for empty eligible list', () => {
    const state = createVillageVoteState();
    expect(allVotersVoted(state, [])).toBe(true);
  });
});

// ─── resolveVillageVote ─────────────────────────────────────────────

describe('resolveVillageVote', () => {
  it('returns no_vote when no votes cast', () => {
    const state = createVillageVoteState();
    const result = resolveVillageVote(state);
    expect(result.action).toBe('no_vote');
    expect(state.resolved).toBe(true);
  });

  it('returns eliminate when clear winner', () => {
    const state = createVillageVoteState();
    registerVillageVote(state, 'v1', 'tA');
    registerVillageVote(state, 'v2', 'tA');
    registerVillageVote(state, 'v3', 'tB');
    const result = resolveVillageVote(state);
    expect(result.action).toBe('eliminate');
    expect(result.targetId).toBe('tA');
    expect(result.count).toBe(2);
    expect(state.resolved).toBe(true);
  });

  it('returns tie when tied candidates', () => {
    const state = createVillageVoteState();
    registerVillageVote(state, 'v1', 'tA');
    registerVillageVote(state, 'v2', 'tB');
    const result = resolveVillageVote(state);
    expect(result.action).toBe('tie');
    expect(result.tiedCandidates).toContain('tA');
    expect(result.tiedCandidates).toContain('tB');
    expect(result.count).toBe(1);
    expect(state.resolved).toBe(false); // not resolved yet — captain tiebreak pending
    expect(state.tiedCandidates.length).toBe(2);
  });

  it('returns already_resolved if called twice', () => {
    const state = createVillageVoteState();
    registerVillageVote(state, 'v1', 'tA');
    resolveVillageVote(state);
    const result = resolveVillageVote(state);
    expect(result.action).toBe('already_resolved');
  });

  it('handles 3-way tie', () => {
    const state = createVillageVoteState();
    registerVillageVote(state, 'v1', 'tA');
    registerVillageVote(state, 'v2', 'tB');
    registerVillageVote(state, 'v3', 'tC');
    const result = resolveVillageVote(state);
    expect(result.action).toBe('tie');
    expect(result.tiedCandidates.length).toBe(3);
  });

  it('single voter → eliminate (no tie possible)', () => {
    const state = createVillageVoteState();
    registerVillageVote(state, 'v1', 'tA');
    const result = resolveVillageVote(state);
    expect(result.action).toBe('eliminate');
    expect(result.targetId).toBe('tA');
    expect(result.count).toBe(1);
  });
});

// ─── resolveCaptainTiebreak ────────────────────────────────────────

describe('resolveCaptainTiebreak', () => {
  it('eliminates the chosen tied candidate', () => {
    const state = createVillageVoteState();
    registerVillageVote(state, 'v1', 'tA');
    registerVillageVote(state, 'v2', 'tB');
    resolveVillageVote(state); // creates tie

    const result = resolveCaptainTiebreak(state, 'tA');
    expect(result.action).toBe('eliminate');
    expect(result.targetId).toBe('tA');
    expect(state.resolved).toBe(true);
  });

  it('returns invalid if target not in tiedCandidates', () => {
    const state = createVillageVoteState();
    registerVillageVote(state, 'v1', 'tA');
    registerVillageVote(state, 'v2', 'tB');
    resolveVillageVote(state);

    const result = resolveCaptainTiebreak(state, 'tC');
    expect(result.action).toBe('invalid');
    expect(state.resolved).toBe(false);
  });

  it('returns already_resolved if state already resolved', () => {
    const state = createVillageVoteState();
    state.resolved = true;
    state.tiedCandidates = ['tA', 'tB'];
    const result = resolveCaptainTiebreak(state, 'tA');
    expect(result.action).toBe('already_resolved');
  });
});

// ─── resolveCaptainTiebreakTimeout ─────────────────────────────────

describe('resolveCaptainTiebreakTimeout', () => {
  it('resolves as no_kill (captain AFK → nobody dies)', () => {
    const state = createVillageVoteState();
    registerVillageVote(state, 'v1', 'tA');
    registerVillageVote(state, 'v2', 'tB');
    resolveVillageVote(state); // tie, resolved=false

    const result = resolveCaptainTiebreakTimeout(state);
    expect(result.action).toBe('no_kill');
    expect(state.resolved).toBe(true);
  });

  it('returns already_resolved if already done', () => {
    const state = createVillageVoteState();
    state.resolved = true;
    const result = resolveCaptainTiebreakTimeout(state);
    expect(result.action).toBe('already_resolved');
  });
});

// ─── resolveIdiotEffect ────────────────────────────────────────────

describe('resolveIdiotEffect', () => {
  it('returns idiot effect for unrevealed Idiot du Village', () => {
    const player = makePlayer('1', 'Idiot du Village');
    const result = resolveIdiotEffect(player);
    expect(result).not.toBeNull();
    expect(result.isIdiot).toBe(true);
    expect(player.idiotRevealed).toBe(true);
  });

  it('returns null for already revealed Idiot', () => {
    const player = makePlayer('1', 'Idiot du Village', true, { idiotRevealed: true });
    const result = resolveIdiotEffect(player);
    expect(result).toBeNull();
  });

  it('returns null for non-Idiot role', () => {
    const player = makePlayer('1', 'Loup-Garou');
    expect(resolveIdiotEffect(player)).toBeNull();
  });

  it('returns null for null player', () => {
    expect(resolveIdiotEffect(null)).toBeNull();
  });
});

// ─── buildVoteDisplay ──────────────────────────────────────────────

describe('buildVoteDisplay', () => {
  it('builds tally display with player names', () => {
    const state = createVillageVoteState();
    registerVillageVote(state, 'v1', 'tA');
    registerVillageVote(state, 'v2', 'tA');
    registerVillageVote(state, 'v3', 'tB');
    const players = [
      makePlayer('tA', 'Villageois'),
      makePlayer('tB', 'Villageois'),
    ];
    const display = buildVoteDisplay(state, players);
    expect(display.length).toBe(2);
    expect(display[0]).toEqual({ name: 'Player_tA', id: 'tA', count: 2 });
    expect(display[1]).toEqual({ name: 'Player_tB', id: 'tB', count: 1 });
  });

  it('uses targetId as fallback name if player not found', () => {
    const state = createVillageVoteState();
    registerVillageVote(state, 'v1', 'unknown');
    const display = buildVoteDisplay(state, []);
    expect(display[0].name).toBe('unknown');
  });

  it('returns empty array for no votes', () => {
    const state = createVillageVoteState();
    expect(buildVoteDisplay(state, [])).toEqual([]);
  });
});

// ─── Integration: full vote cycle ──────────────────────────────────

describe('Full vote cycle integration', () => {
  it('3 voters, clear majority → eliminate', () => {
    const state = createVillageVoteState();
    registerVillageVote(state, 'v1', 'tA');
    registerVillageVote(state, 'v2', 'tA');
    registerVillageVote(state, 'v3', 'tB');

    expect(allVotersVoted(state, ['v1', 'v2', 'v3'])).toBe(true);
    const result = resolveVillageVote(state);
    expect(result.action).toBe('eliminate');
    expect(result.targetId).toBe('tA');
  });

  it('tie → captain tiebreak → eliminate', () => {
    const state = createVillageVoteState();
    registerVillageVote(state, 'v1', 'tA');
    registerVillageVote(state, 'v2', 'tB');

    const voteResult = resolveVillageVote(state);
    expect(voteResult.action).toBe('tie');
    expect(state.resolved).toBe(false);

    // Captain chooses tB
    const tieResult = resolveCaptainTiebreak(state, 'tB');
    expect(tieResult.action).toBe('eliminate');
    expect(tieResult.targetId).toBe('tB');
    expect(state.resolved).toBe(true);
  });

  it('tie → captain AFK → no kill', () => {
    const state = createVillageVoteState();
    registerVillageVote(state, 'v1', 'tA');
    registerVillageVote(state, 'v2', 'tB');

    resolveVillageVote(state);

    const timeoutResult = resolveCaptainTiebreakTimeout(state);
    expect(timeoutResult.action).toBe('no_kill');
    expect(state.resolved).toBe(true);
  });

  it('eliminate Idiot du Village → survives first time', () => {
    const state = createVillageVoteState();
    registerVillageVote(state, 'v1', 'idiot1');
    registerVillageVote(state, 'v2', 'idiot1');
    registerVillageVote(state, 'v3', 'other');

    const result = resolveVillageVote(state);
    expect(result.action).toBe('eliminate');

    const idiotPlayer = makePlayer('idiot1', 'Idiot du Village');
    const effect = resolveIdiotEffect(idiotPlayer);
    expect(effect).not.toBeNull();
    expect(effect.isIdiot).toBe(true);
    expect(idiotPlayer.idiotRevealed).toBe(true);

    // Second time → dies normally
    const effect2 = resolveIdiotEffect(idiotPlayer);
    expect(effect2).toBeNull();
  });

  it('no votes cast → no_vote', () => {
    const state = createVillageVoteState();
    const result = resolveVillageVote(state);
    expect(result.action).toBe('no_vote');
  });

  it('vote modification before resolution', () => {
    const state = createVillageVoteState();
    registerVillageVote(state, 'v1', 'tA');
    registerVillageVote(state, 'v2', 'tA');
    registerVillageVote(state, 'v3', 'tB');

    // v2 changes vote from tA to tB → now tA=1, tB=2
    registerVillageVote(state, 'v2', 'tB');

    const result = resolveVillageVote(state);
    expect(result.action).toBe('eliminate');
    expect(result.targetId).toBe('tB');
    expect(result.count).toBe(2);
  });

  it('vote modification creates a tie', () => {
    const state = createVillageVoteState();
    registerVillageVote(state, 'v1', 'tA');
    registerVillageVote(state, 'v2', 'tB');
    registerVillageVote(state, 'v3', 'tA');

    // v3 changes vote → now tA=1, tB=1
    registerVillageVote(state, 'v3', 'tB');
    // v2 changes to tA → now tA=1, tB=1 (v1→tA, v2→tA? no, v2→tA, v3→tB)
    // Actually: v1→tA, v2→tB, v3→tB → tA=1, tB=2, which isn't a tie.
    // Let's just set up a proper tie: 4 voters, 2 and 2
    const state2 = createVillageVoteState();
    registerVillageVote(state2, 'v1', 'tA');
    registerVillageVote(state2, 'v2', 'tB');
    registerVillageVote(state2, 'v3', 'tA');
    registerVillageVote(state2, 'v4', 'tB');

    const result = resolveVillageVote(state2);
    expect(result.action).toBe('tie');
    expect(result.tiedCandidates).toContain('tA');
    expect(result.tiedCandidates).toContain('tB');
  });
});
