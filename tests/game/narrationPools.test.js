/**
 * Tests for game/narrationPools.js — Dynamic immersive narration system.
 *
 * Validates:
 * - buildNarrativeContext extracts correct counts from game state
 * - selectNightTone returns correct tone based on context
 * - selectDayTone returns correct tone based on context
 * - selectNarrative returns valid narrative object
 * - pickRandom returns text from pool
 * - Narrative text is stable (no recalculation)
 * - Pools are non-empty and contain short text
 * - No crash if game context is missing/partial
 * - NARRATIVE_SELECTED log is emitted
 */

const ROLES = require('../../game/roles');

jest.mock('../../utils/logger', () => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const {
  NARRATION,
  buildNarrativeContext,
  selectNightTone,
  selectDayTone,
  selectNarrative,
  pickRandom,
} = require('../../game/narrationPools');

const logger = require('../../utils/logger');

// ─── Helpers ──────────────────────────────────────────────────────

function createTestGame(overrides = {}) {
  return {
    mainChannelId: 'ch123',
    phase: 'Nuit',
    subPhase: 'Loups',
    dayCount: 2,
    captainId: 'p1',
    players: [
      { id: 'p1', username: 'Alice', role: ROLES.WEREWOLF, alive: true },
      { id: 'p2', username: 'Bob', role: ROLES.SEER, alive: true },
      { id: 'p3', username: 'Charlie', role: ROLES.VILLAGER, alive: false },
      { id: 'p4', username: 'Diana', role: ROLES.WITCH, alive: true },
      { id: 'p5', username: 'Eve', role: ROLES.VILLAGER, alive: true },
    ],
    _lastNightDeathCount: 0,
    currentNarrative: null,
    ...overrides,
  };
}

// ─── NARRATION pools structure ────────────────────────────────────

describe('NARRATION pools', () => {
  test('has night and day top-level keys', () => {
    expect(NARRATION).toHaveProperty('night');
    expect(NARRATION).toHaveProperty('day');
  });

  test('night has default, tense, critical pools', () => {
    expect(NARRATION.night).toHaveProperty('default');
    expect(NARRATION.night).toHaveProperty('tense');
    expect(NARRATION.night).toHaveProperty('critical');
  });

  test('day has calm, suspicious, critical pools', () => {
    expect(NARRATION.day).toHaveProperty('calm');
    expect(NARRATION.day).toHaveProperty('suspicious');
    expect(NARRATION.day).toHaveProperty('critical');
  });

  test('each pool has 3-4 entries', () => {
    for (const [, tones] of Object.entries(NARRATION)) {
      for (const [toneName, pool] of Object.entries(tones)) {
        expect(pool.length).toBeGreaterThanOrEqual(3);
        expect(pool.length).toBeLessThanOrEqual(4);
      }
    }
  });

  test('all texts are non-empty strings under 120 chars per line', () => {
    for (const [, tones] of Object.entries(NARRATION)) {
      for (const [, pool] of Object.entries(tones)) {
        for (const text of pool) {
          expect(typeof text).toBe('string');
          expect(text.length).toBeGreaterThan(0);
          // Each line should be short
          for (const line of text.split('\n')) {
            expect(line.length).toBeLessThanOrEqual(120);
          }
        }
      }
    }
  });

  test('no text reveals role names or mechanical info', () => {
    const forbidden = ['Loup-Garou', 'Voyante', 'Sorcière', 'Chasseur', 'vote', 'élimin'];
    for (const [, tones] of Object.entries(NARRATION)) {
      for (const [, pool] of Object.entries(tones)) {
        for (const text of pool) {
          for (const word of forbidden) {
            expect(text.toLowerCase()).not.toContain(word.toLowerCase());
          }
        }
      }
    }
  });
});

// ─── buildNarrativeContext ─────────────────────────────────────────

describe('buildNarrativeContext', () => {
  test('counts wolves and villagers correctly', () => {
    const game = createTestGame();
    const ctx = buildNarrativeContext(game);
    expect(ctx.wolvesAlive).toBe(1);   // Alice (Werewolf)
    expect(ctx.villagersAlive).toBe(3); // Bob, Diana, Eve
    expect(ctx.totalAlive).toBe(4);
  });

  test('includes White Wolf in wolves count', () => {
    const game = createTestGame({
      players: [
        { id: 'p1', username: 'A', role: ROLES.WEREWOLF, alive: true },
        { id: 'p2', username: 'B', role: ROLES.WHITE_WOLF, alive: true },
        { id: 'p3', username: 'C', role: ROLES.VILLAGER, alive: true },
      ],
    });
    const ctx = buildNarrativeContext(game);
    expect(ctx.wolvesAlive).toBe(2);
    expect(ctx.villagersAlive).toBe(1);
  });

  test('uses _lastNightDeathCount for lastNightDeaths', () => {
    const game = createTestGame({ _lastNightDeathCount: 2 });
    const ctx = buildNarrativeContext(game);
    expect(ctx.lastNightDeaths).toBe(2);
  });

  test('defaults lastNightDeaths to 0 if missing', () => {
    const game = createTestGame();
    delete game._lastNightDeathCount;
    const ctx = buildNarrativeContext(game);
    expect(ctx.lastNightDeaths).toBe(0);
  });

  test('handles empty players array', () => {
    const game = createTestGame({ players: [] });
    const ctx = buildNarrativeContext(game);
    expect(ctx.wolvesAlive).toBe(0);
    expect(ctx.villagersAlive).toBe(0);
    expect(ctx.totalAlive).toBe(0);
  });

  test('handles missing players property', () => {
    const game = createTestGame();
    delete game.players;
    const ctx = buildNarrativeContext(game);
    expect(ctx.totalAlive).toBe(0);
  });
});

// ─── selectNightTone ──────────────────────────────────────────────

describe('selectNightTone', () => {
  test('returns critical when wolves >= villagers', () => {
    expect(selectNightTone({ wolvesAlive: 3, villagersAlive: 3, lastNightDeaths: 1 })).toBe('critical');
    expect(selectNightTone({ wolvesAlive: 4, villagersAlive: 2, lastNightDeaths: 1 })).toBe('critical');
  });

  test('returns tense when no deaths last night', () => {
    expect(selectNightTone({ wolvesAlive: 1, villagersAlive: 5, lastNightDeaths: 0 })).toBe('tense');
  });

  test('returns default otherwise', () => {
    expect(selectNightTone({ wolvesAlive: 1, villagersAlive: 5, lastNightDeaths: 1 })).toBe('default');
  });

  test('critical takes priority over tense', () => {
    // wolves >= villagers AND 0 deaths → should be critical (checked first)
    expect(selectNightTone({ wolvesAlive: 3, villagersAlive: 3, lastNightDeaths: 0 })).toBe('critical');
  });
});

// ─── selectDayTone ────────────────────────────────────────────────

describe('selectDayTone', () => {
  test('returns critical when 3 or fewer alive', () => {
    expect(selectDayTone({ totalAlive: 3, wolvesAlive: 1, villagersAlive: 2 })).toBe('critical');
    expect(selectDayTone({ totalAlive: 2, wolvesAlive: 1, villagersAlive: 1 })).toBe('critical');
  });

  test('returns suspicious when wolves close to winning', () => {
    // wolves >= villagersAlive - 1 (but totalAlive > 3)
    expect(selectDayTone({ totalAlive: 5, wolvesAlive: 2, villagersAlive: 3 })).toBe('suspicious');
  });

  test('returns calm when village is safe', () => {
    expect(selectDayTone({ totalAlive: 8, wolvesAlive: 2, villagersAlive: 6 })).toBe('calm');
  });

  test('critical takes priority over suspicious', () => {
    expect(selectDayTone({ totalAlive: 2, wolvesAlive: 1, villagersAlive: 1 })).toBe('critical');
  });
});

// ─── pickRandom ───────────────────────────────────────────────────

describe('pickRandom', () => {
  test('returns element from pool', () => {
    const pool = ['a', 'b', 'c'];
    const result = pickRandom(pool);
    expect(pool).toContain(result);
  });

  test('returns empty string for empty pool', () => {
    expect(pickRandom([])).toBe('');
  });

  test('returns empty string for null/undefined pool', () => {
    expect(pickRandom(null)).toBe('');
    expect(pickRandom(undefined)).toBe('');
  });
});

// ─── selectNarrative ──────────────────────────────────────────────

describe('selectNarrative', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns narrative object with required fields for night', () => {
    const game = createTestGame();
    const result = selectNarrative(game, 'Nuit');
    expect(result).toHaveProperty('phase', 'night');
    expect(result).toHaveProperty('text');
    expect(result).toHaveProperty('tone');
    expect(result).toHaveProperty('context');
    expect(typeof result.text).toBe('string');
    expect(result.text.length).toBeGreaterThan(0);
  });

  test('returns narrative object with required fields for day', () => {
    const game = createTestGame();
    const result = selectNarrative(game, 'Jour');
    expect(result).toHaveProperty('phase', 'day');
    expect(result).toHaveProperty('text');
    expect(result).toHaveProperty('tone');
    expect(result).toHaveProperty('context');
  });

  test('selects from correct pool based on night tone', () => {
    // Critical night: wolves >= villagers
    const game = createTestGame({
      players: [
        { id: 'p1', username: 'A', role: ROLES.WEREWOLF, alive: true },
        { id: 'p2', username: 'B', role: ROLES.WHITE_WOLF, alive: true },
        { id: 'p3', username: 'C', role: ROLES.VILLAGER, alive: true },
      ],
    });
    const result = selectNarrative(game, 'Nuit');
    expect(result.tone).toBe('critical');
    expect(NARRATION.night.critical).toContain(result.text);
  });

  test('selects from correct pool based on day tone', () => {
    // Calm day: many villagers alive
    const game = createTestGame({
      players: [
        { id: 'p1', username: 'A', role: ROLES.WEREWOLF, alive: true },
        { id: 'p2', username: 'B', role: ROLES.VILLAGER, alive: true },
        { id: 'p3', username: 'C', role: ROLES.VILLAGER, alive: true },
        { id: 'p4', username: 'D', role: ROLES.VILLAGER, alive: true },
        { id: 'p5', username: 'E', role: ROLES.VILLAGER, alive: true },
        { id: 'p6', username: 'F', role: ROLES.VILLAGER, alive: true },
        { id: 'p7', username: 'G', role: ROLES.VILLAGER, alive: true },
        { id: 'p8', username: 'H', role: ROLES.SEER, alive: true },
      ],
    });
    const result = selectNarrative(game, 'Jour');
    expect(result.tone).toBe('calm');
    expect(NARRATION.day.calm).toContain(result.text);
  });

  test('logs NARRATIVE_SELECTED in debug', () => {
    const game = createTestGame();
    selectNarrative(game, 'Nuit');
    expect(logger.debug).toHaveBeenCalledWith('NARRATIVE_SELECTED', expect.objectContaining({
      phase: 'night',
      tone: expect.any(String),
      context: expect.any(Object),
      textPreview: expect.any(String),
    }));
  });

  test('does not crash with empty game state', () => {
    const game = { players: [] };
    expect(() => selectNarrative(game, 'Nuit')).not.toThrow();
    expect(() => selectNarrative(game, 'Jour')).not.toThrow();
  });

  test('does not crash with missing players property', () => {
    const game = {};
    expect(() => selectNarrative(game, 'Nuit')).not.toThrow();
    expect(() => selectNarrative(game, 'Jour')).not.toThrow();
  });
});

// ─── Narrative stability (the core guarantee) ─────────────────────

describe('narrative stability', () => {
  test('selectNarrative result is a plain object (storable in game state)', () => {
    const game = createTestGame();
    const result = selectNarrative(game, 'Nuit');
    expect(typeof result).toBe('object');
    expect(result).not.toBeInstanceOf(Function);
    // Should be JSON-serializable
    expect(() => JSON.stringify(result)).not.toThrow();
  });

  test('stored narrative is not affected by subsequent game state changes', () => {
    const game = createTestGame();
    const result = selectNarrative(game, 'Nuit');
    const originalText = result.text;

    // Mutate game state
    game.players[0].alive = false;
    game._lastNightDeathCount = 5;

    // Stored narrative should be unchanged
    expect(result.text).toBe(originalText);
  });

  test('narrative text stays identical across multiple reads', () => {
    const narrative = selectNarrative(createTestGame(), 'Nuit');
    const text1 = narrative.text;
    const text2 = narrative.text;
    const text3 = narrative.text;
    expect(text1).toBe(text2);
    expect(text2).toBe(text3);
  });
});
