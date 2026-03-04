/**
 * Tests for game/eloGuards.js — pure ELO guard functions.
 */

const {
  ELO_FLOOR,
  PLACEMENT_GAMES,
  PLACEMENT_MULTIPLIER,
  MAX_NO_KILL_CYCLES,
  TIERS,
  UNRANKED_TIER,
  isPlacementPhase,
  getPlacementMultiplier,
  clampElo,
  getEloTier,
  isInactivityDraw,
  shouldSkipElo,
} = require('../../game/eloGuards');

// ─── Constants ─────────────────────────────────────────────

describe('eloGuards constants', () => {
  test('ELO_FLOOR is 800', () => {
    expect(ELO_FLOOR).toBe(800);
  });

  test('PLACEMENT_GAMES is 5', () => {
    expect(PLACEMENT_GAMES).toBe(5);
  });

  test('PLACEMENT_MULTIPLIER is 1.25', () => {
    expect(PLACEMENT_MULTIPLIER).toBe(1.25);
  });

  test('MAX_NO_KILL_CYCLES is 3', () => {
    expect(MAX_NO_KILL_CYCLES).toBe(3);
  });

  test('TIERS has 5 entries ordered high→low', () => {
    expect(TIERS).toHaveLength(5);
    expect(TIERS[0].id).toBe('diamant');
    expect(TIERS[4].id).toBe('bronze');
    for (let i = 0; i < TIERS.length - 1; i++) {
      expect(TIERS[i].min).toBeGreaterThan(TIERS[i + 1].min);
    }
  });
});

// ─── isPlacementPhase ──────────────────────────────────────

describe('isPlacementPhase', () => {
  test('returns true for 0 ranked games', () => {
    expect(isPlacementPhase(0)).toBe(true);
  });

  test('returns true for 4 ranked games (still in placement)', () => {
    expect(isPlacementPhase(4)).toBe(true);
  });

  test('returns false for 5 ranked games (placement complete)', () => {
    expect(isPlacementPhase(5)).toBe(false);
  });

  test('returns false for 100 ranked games', () => {
    expect(isPlacementPhase(100)).toBe(false);
  });

  test('returns false for null (backward compat — assume placed)', () => {
    expect(isPlacementPhase(null)).toBe(false);
  });

  test('returns false for undefined (backward compat)', () => {
    expect(isPlacementPhase(undefined)).toBe(false);
  });
});

// ─── getPlacementMultiplier ────────────────────────────────

describe('getPlacementMultiplier', () => {
  test('returns 1.25 during placement', () => {
    expect(getPlacementMultiplier(0)).toBe(1.25);
    expect(getPlacementMultiplier(3)).toBe(1.25);
  });

  test('returns 1.0 after placement', () => {
    expect(getPlacementMultiplier(5)).toBe(1.0);
    expect(getPlacementMultiplier(50)).toBe(1.0);
  });

  test('returns 1.0 for undefined (backward compat)', () => {
    expect(getPlacementMultiplier(undefined)).toBe(1.0);
  });
});

// ─── clampElo ──────────────────────────────────────────────

describe('clampElo', () => {
  test('does not change values above floor', () => {
    expect(clampElo(1000)).toBe(1000);
    expect(clampElo(2500)).toBe(2500);
  });

  test('clamps to 800 when below floor', () => {
    expect(clampElo(500)).toBe(800);
    expect(clampElo(-100)).toBe(800);
    expect(clampElo(0)).toBe(800);
  });

  test('returns exactly 800 at boundary', () => {
    expect(clampElo(800)).toBe(800);
  });
});

// ─── getEloTier ────────────────────────────────────────────

describe('getEloTier', () => {
  test('returns Diamant for ELO ≥ 1600', () => {
    expect(getEloTier(1600, 10)).toMatchObject({ id: 'diamant', emoji: '💎' });
    expect(getEloTier(2500, 10)).toMatchObject({ id: 'diamant' });
  });

  test('returns Platine for 1400-1599', () => {
    expect(getEloTier(1400, 10)).toMatchObject({ id: 'platine', emoji: '⚜️' });
    expect(getEloTier(1599, 10)).toMatchObject({ id: 'platine' });
  });

  test('returns Or for 1200-1399', () => {
    expect(getEloTier(1200, 10)).toMatchObject({ id: 'or', emoji: '🥇' });
    expect(getEloTier(1399, 10)).toMatchObject({ id: 'or' });
  });

  test('returns Argent for 1000-1199', () => {
    expect(getEloTier(1000, 10)).toMatchObject({ id: 'argent', emoji: '🥈' });
    expect(getEloTier(1199, 10)).toMatchObject({ id: 'argent' });
  });

  test('returns Bronze for 800-999', () => {
    expect(getEloTier(800, 10)).toMatchObject({ id: 'bronze', emoji: '🥉' });
    expect(getEloTier(999, 10)).toMatchObject({ id: 'bronze' });
  });

  test('returns Bronze for values below 800 (edge case)', () => {
    expect(getEloTier(100, 10)).toMatchObject({ id: 'bronze' });
  });

  test('returns Unranked during placement phase', () => {
    expect(getEloTier(1500, 0)).toMatchObject({ id: 'unranked', emoji: '❔' });
    expect(getEloTier(1500, 4)).toMatchObject({ id: 'unranked' });
  });

  test('returns tier when rankedGamesPlayed not passed (backward compat)', () => {
    expect(getEloTier(1200)).toMatchObject({ id: 'or' });
    expect(getEloTier(1000, undefined)).toMatchObject({ id: 'argent' });
    expect(getEloTier(800, null)).toMatchObject({ id: 'bronze' });
  });

  test('returns a fresh copy each time (no shared references)', () => {
    const a = getEloTier(1600, 10);
    const b = getEloTier(1600, 10);
    expect(a).toEqual(b);
    expect(a).not.toBe(b); // different objects
  });
});

// ─── isInactivityDraw ──────────────────────────────────────

describe('isInactivityDraw', () => {
  test('returns true when _endedByInactivity flag is set', () => {
    expect(isInactivityDraw({ _endedByInactivity: true })).toBe(true);
  });

  test('returns true when _noKillCycles >= MAX_NO_KILL_CYCLES', () => {
    expect(isInactivityDraw({ _noKillCycles: 3 })).toBe(true);
    expect(isInactivityDraw({ _noKillCycles: 5 })).toBe(true);
  });

  test('returns false for normal game', () => {
    expect(isInactivityDraw({ _noKillCycles: 0 })).toBe(false);
    expect(isInactivityDraw({ _noKillCycles: 2 })).toBe(false);
    expect(isInactivityDraw({})).toBe(false);
  });

  test('returns false for null/undefined', () => {
    expect(isInactivityDraw(null)).toBe(false);
    expect(isInactivityDraw(undefined)).toBe(false);
  });
});

// ─── shouldSkipElo ─────────────────────────────────────────

describe('shouldSkipElo', () => {
  test('skips when game is null', () => {
    expect(shouldSkipElo(null, 'wolves')).toBe(true);
  });

  test('skips when winner is null', () => {
    expect(shouldSkipElo({}, null)).toBe(true);
  });

  test('skips when winner is undefined', () => {
    expect(shouldSkipElo({}, undefined)).toBe(true);
  });

  test('skips for inactivity draw', () => {
    expect(shouldSkipElo({ _endedByInactivity: true }, 'draw')).toBe(true);
    expect(shouldSkipElo({ _noKillCycles: 3 }, 'draw')).toBe(true);
  });

  test('skips for aborted game before night 1 (dayCount=0, draw)', () => {
    expect(shouldSkipElo({ dayCount: 0 }, 'draw')).toBe(true);
  });

  test('does NOT skip for legitimate draw after night 1', () => {
    expect(shouldSkipElo({ dayCount: 2 }, 'draw')).toBe(false);
  });

  test('does NOT skip for normal wolf victory', () => {
    expect(shouldSkipElo({ dayCount: 3 }, 'wolves')).toBe(false);
  });

  test('does NOT skip for village victory', () => {
    expect(shouldSkipElo({ dayCount: 1 }, 'village')).toBe(false);
  });

  test('does NOT skip for lovers victory', () => {
    expect(shouldSkipElo({ dayCount: 2 }, 'lovers')).toBe(false);
  });

  test('does NOT skip for white_wolf victory', () => {
    expect(shouldSkipElo({ dayCount: 4 }, 'white_wolf')).toBe(false);
  });
});
