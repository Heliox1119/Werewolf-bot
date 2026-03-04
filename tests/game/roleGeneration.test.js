/**
 * Tests for game/roleGeneration.js and game/balanceMode.js
 *
 * Verifies:
 *  - BalanceMode enum is frozen with correct keys
 *  - generateDynamicRoles produces the exact same pools as the old inline logic
 *  - generateClassicRoles produces category-balanced, deterministic compositions
 *  - generateRoles dispatches correctly
 *  - Unknown mode throws
 *  - Game object stores balanceMode correctly
 *  - start() still produces valid role distributions
 */

const BalanceMode = require('../../game/balanceMode');
const {
  generateDynamicRoles,
  generateClassicRoles,
  generateRoles,
  _CLASSIC_CATEGORIES,
  _CLASSIC_SPECIAL_POOL,
  _getMaxSpecials,
  _selectSpecials,
  _getCategoryOf,
} = require('../../game/roleGeneration');
const ROLES = require('../../game/roles');

// ─── BalanceMode enum ────────────────────────────────────────
describe('BalanceMode', () => {
  test('has DYNAMIC and CLASSIC values', () => {
    expect(BalanceMode.DYNAMIC).toBe('DYNAMIC');
    expect(BalanceMode.CLASSIC).toBe('CLASSIC');
  });

  test('is frozen (immutable)', () => {
    expect(Object.isFrozen(BalanceMode)).toBe(true);
  });

  test('has exactly 2 keys', () => {
    expect(Object.keys(BalanceMode)).toEqual(['DYNAMIC', 'CLASSIC']);
  });
});

// ─── generateDynamicRoles ────────────────────────────────────
describe('generateDynamicRoles', () => {
  test('5 players: 1 wolf + 3 specials', () => {
    const pool = generateDynamicRoles(5);
    expect(pool).toEqual([
      ROLES.WEREWOLF,
      ROLES.SEER,
      ROLES.WITCH,
      ROLES.HUNTER,
    ]);
  });

  test('6 players: 2 wolves + Petite Fille', () => {
    const pool = generateDynamicRoles(6);
    expect(pool).toEqual([
      ROLES.WEREWOLF, ROLES.WEREWOLF,
      ROLES.SEER, ROLES.WITCH, ROLES.HUNTER,
      ROLES.PETITE_FILLE,
    ]);
  });

  test('7 players: adds Cupid', () => {
    const pool = generateDynamicRoles(7);
    expect(pool).toContain(ROLES.CUPID);
    expect(pool).toContain(ROLES.PETITE_FILLE);
    expect(pool.filter(r => r === ROLES.WEREWOLF)).toHaveLength(2);
  });

  test('8 players: adds Thief', () => {
    const pool = generateDynamicRoles(8);
    expect(pool).toContain(ROLES.THIEF);
  });

  test('9 players: adds Salvateur', () => {
    const pool = generateDynamicRoles(9);
    expect(pool).toContain(ROLES.SALVATEUR);
  });

  test('10 players: adds Ancien', () => {
    const pool = generateDynamicRoles(10);
    expect(pool).toContain(ROLES.ANCIEN);
  });

  test('11 players: adds White Wolf', () => {
    const pool = generateDynamicRoles(11);
    expect(pool).toContain(ROLES.WHITE_WOLF);
  });

  test('12 players: adds Idiot — full roster', () => {
    const pool = generateDynamicRoles(12);
    expect(pool).toContain(ROLES.IDIOT);
    // Full roster: 2 wolves + seer + witch + hunter + petiteFille + cupid + thief + salvateur + ancien + whiteWolf + idiot = 12
    expect(pool).toHaveLength(12);
  });

  test('returns fresh array each call', () => {
    const a = generateDynamicRoles(5);
    const b = generateDynamicRoles(5);
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });

  test('no villagers in raw pool (padding is done by start())', () => {
    for (let n = 5; n <= 12; n++) {
      const pool = generateDynamicRoles(n);
      expect(pool).not.toContain(ROLES.VILLAGER);
    }
  });
});

// ─── generateRoles dispatcher ────────────────────────────────
describe('generateRoles', () => {
  test('DYNAMIC mode delegates to generateDynamicRoles', () => {
    const fromDispatcher = generateRoles(8, BalanceMode.DYNAMIC);
    const fromDirect = generateDynamicRoles(8);
    expect(fromDispatcher).toEqual(fromDirect);
  });

  test('defaults to DYNAMIC when no mode specified', () => {
    const pool = generateRoles(6);
    expect(pool).toEqual(generateDynamicRoles(6));
  });

  test('CLASSIC mode delegates to generateClassicRoles', () => {
    const fromDispatcher = generateRoles(10, BalanceMode.CLASSIC, { rotationSeed: 42 });
    const fromDirect = generateClassicRoles(10, 42);
    expect(fromDispatcher).toEqual(fromDirect);
  });

  test('unknown mode throws', () => {
    expect(() => generateRoles(5, 'TURBO')).toThrow('Unknown balance mode: TURBO');
  });
});

// ─── Integration: start() uses generateRoles via balanceMode ─
describe('start() — balanceMode integration', () => {
  let gameManager;

  beforeEach(() => {
    const { GameManager } = require('../../game/gameManager');
    gameManager = new GameManager();
    // Create a game and add 5 players
    gameManager.create('ch-bm', { guildId: 'g1' });
    for (let i = 1; i <= 5; i++) {
      gameManager.join('ch-bm', { id: `p${i}`, username: `Player${i}` });
    }
  });

  test('game object has balanceMode = DYNAMIC by default', () => {
    const game = gameManager.games.get('ch-bm');
    expect(game.balanceMode).toBe(BalanceMode.DYNAMIC);
  });

  test('start() without rolesOverride still distributes roles correctly', () => {
    const game = gameManager.start('ch-bm');
    expect(game).not.toBeNull();
    expect(game.players.every(p => p.role)).toBe(true);
    // Should contain at least 1 werewolf
    expect(game.players.some(p => p.role === ROLES.WEREWOLF)).toBe(true);
  });

  test('start() with rolesOverride bypasses generateRoles', () => {
    const override = [ROLES.WEREWOLF, ROLES.SEER, ROLES.WITCH, ROLES.HUNTER, ROLES.VILLAGER];
    const game = gameManager.start('ch-bm', override);
    expect(game).not.toBeNull();
    const roles = game.players.map(p => p.role).sort();
    expect(roles).toEqual(override.sort());
  });

  test('balanceMode is preserved in DB mock', () => {
    const dbGame = gameManager.db.getGame('ch-bm');
    expect(dbGame.balance_mode).toBe('DYNAMIC');
  });
});

// ─── CLASSIC internals: helper functions ─────────────────────
describe('CLASSIC internals', () => {
  describe('_getMaxSpecials', () => {
    test.each([
      [5, 1], [6, 1], [7, 1],
      [8, 2], [9, 2], [10, 2], [11, 2],
      [12, 3], [13, 3], [14, 3], [15, 3],
      [16, 4], [18, 4], [20, 4],
    ])('%i players → %i specials', (players, expected) => {
      expect(_getMaxSpecials(players)).toBe(expected);
    });
  });

  describe('_getCategoryOf', () => {
    test('SEER → investigation', () => {
      expect(_getCategoryOf(ROLES.SEER)).toBe('investigation');
    });
    test('PETITE_FILLE → investigation', () => {
      expect(_getCategoryOf(ROLES.PETITE_FILLE)).toBe('investigation');
    });
    test('SALVATEUR → protection', () => {
      expect(_getCategoryOf(ROLES.SALVATEUR)).toBe('protection');
    });
    test('ANCIEN → protection', () => {
      expect(_getCategoryOf(ROLES.ANCIEN)).toBe('protection');
    });
    test('WITCH → impact', () => {
      expect(_getCategoryOf(ROLES.WITCH)).toBe('impact');
    });
    test('HUNTER → impact', () => {
      expect(_getCategoryOf(ROLES.HUNTER)).toBe('impact');
    });
    test('CUPID → chaos', () => {
      expect(_getCategoryOf(ROLES.CUPID)).toBe('chaos');
    });
    test('THIEF → chaos', () => {
      expect(_getCategoryOf(ROLES.THIEF)).toBe('chaos');
    });
    test('IDIOT → chaos', () => {
      expect(_getCategoryOf(ROLES.IDIOT)).toBe('chaos');
    });
    test('WEREWOLF → null (not in categories)', () => {
      expect(_getCategoryOf(ROLES.WEREWOLF)).toBeNull();
    });
    test('VILLAGER → null', () => {
      expect(_getCategoryOf(ROLES.VILLAGER)).toBeNull();
    });
  });

  describe('_CLASSIC_SPECIAL_POOL', () => {
    test('is frozen', () => {
      expect(Object.isFrozen(_CLASSIC_SPECIAL_POOL)).toBe(true);
    });
    test('contains all 9 special roles', () => {
      expect(_CLASSIC_SPECIAL_POOL).toHaveLength(9);
    });
    test('does NOT contain WhiteWolf', () => {
      expect(_CLASSIC_SPECIAL_POOL).not.toContain(ROLES.WHITE_WOLF);
    });
    test('does NOT contain Villager or Werewolf', () => {
      expect(_CLASSIC_SPECIAL_POOL).not.toContain(ROLES.VILLAGER);
      expect(_CLASSIC_SPECIAL_POOL).not.toContain(ROLES.WEREWOLF);
    });
  });

  describe('_selectSpecials', () => {
    test('returns requested count of specials', () => {
      expect(_selectSpecials(1, 0)).toHaveLength(1);
      expect(_selectSpecials(2, 0)).toHaveLength(2);
      expect(_selectSpecials(3, 0)).toHaveLength(3);
      expect(_selectSpecials(4, 0)).toHaveLength(4);
    });

    test('deterministic: same seed → same result', () => {
      const a = _selectSpecials(3, 42);
      const b = _selectSpecials(3, 42);
      expect(a).toEqual(b);
    });

    test('different seeds can produce different results', () => {
      const results = new Set();
      for (let seed = 0; seed < 20; seed++) {
        results.add(JSON.stringify(_selectSpecials(3, seed)));
      }
      // With 9-item pool and category constraints, we should see multiple distinct sets
      expect(results.size).toBeGreaterThan(1);
    });

    test('max 1 chaos role in result', () => {
      const chaosRoles = [ROLES.CUPID, ROLES.THIEF, ROLES.IDIOT];
      for (let seed = 0; seed < 30; seed++) {
        const specials = _selectSpecials(4, seed);
        const chaosCount = specials.filter(r => chaosRoles.includes(r)).length;
        expect(chaosCount).toBeLessThanOrEqual(1);
      }
    });

    test('guarantees at least 1 investigation or protection role', () => {
      const invOrProt = [
        ..._CLASSIC_CATEGORIES.investigation,
        ..._CLASSIC_CATEGORIES.protection,
      ];
      for (let seed = 0; seed < 50; seed++) {
        for (let count = 1; count <= 4; count++) {
          const specials = _selectSpecials(count, seed);
          const hasInvOrProt = specials.some(r => invOrProt.includes(r));
          expect(hasInvOrProt).toBe(true);
        }
      }
    });

    test('handles negative seed gracefully', () => {
      const specials = _selectSpecials(3, -7);
      expect(specials).toHaveLength(3);
    });
  });
});

// ─── generateClassicRoles ────────────────────────────────────
describe('generateClassicRoles', () => {
  describe('wolf count: ceil(25%)', () => {
    test.each([
      [5, 2],   // ceil(1.25) = 2
      [6, 2],   // ceil(1.5) = 2
      [7, 2],   // ceil(1.75) = 2
      [8, 2],   // ceil(2) = 2
      [9, 3],   // ceil(2.25) = 3
      [10, 3],  // ceil(2.5) = 3
      [12, 3],  // ceil(3) = 3
      [14, 4],  // ceil(3.5) = 4
      [16, 4],  // ceil(4) = 4
      [18, 5],  // ceil(4.5) = 5
      [20, 5],  // ceil(5) = 5
    ])('%i players → %i wolves', (players, expectedWolves) => {
      const pool = generateClassicRoles(players, 0);
      const wolfTypes = [ROLES.WEREWOLF, ROLES.WHITE_WOLF];
      const wolves = pool.filter(r => wolfTypes.includes(r));
      expect(wolves).toHaveLength(expectedWolves);
    });
  });

  describe('WhiteWolf gate (≥14 players)', () => {
    test('no WhiteWolf below 14 players', () => {
      for (let n = 5; n <= 13; n++) {
        const pool = generateClassicRoles(n, 0);
        expect(pool).not.toContain(ROLES.WHITE_WOLF);
      }
    });

    test('WhiteWolf present at 14+ players', () => {
      for (let n = 14; n <= 20; n++) {
        const pool = generateClassicRoles(n, 0);
        expect(pool).toContain(ROLES.WHITE_WOLF);
        // Exactly 1 WhiteWolf
        expect(pool.filter(r => r === ROLES.WHITE_WOLF)).toHaveLength(1);
      }
    });

    test('WhiteWolf replaces one regular wolf (total wolf count unchanged)', () => {
      const pool14 = generateClassicRoles(14, 0);
      const wolfTypes = [ROLES.WEREWOLF, ROLES.WHITE_WOLF];
      const totalWolves = pool14.filter(r => wolfTypes.includes(r)).length;
      expect(totalWolves).toBe(Math.ceil(14 * 0.25)); // 4
      expect(pool14.filter(r => r === ROLES.WEREWOLF)).toHaveLength(3); // 4 - 1 WhiteWolf
    });
  });

  describe('special role cap', () => {
    test('7 players → 1 special (+ 2 wolves)', () => {
      const pool = generateClassicRoles(7, 0);
      const wolfTypes = [ROLES.WEREWOLF, ROLES.WHITE_WOLF];
      const specials = pool.filter(r => !wolfTypes.includes(r));
      expect(specials).toHaveLength(1);
    });

    test('10 players → 2 specials', () => {
      const pool = generateClassicRoles(10, 0);
      const wolfTypes = [ROLES.WEREWOLF, ROLES.WHITE_WOLF];
      const specials = pool.filter(r => !wolfTypes.includes(r));
      expect(specials).toHaveLength(2);
    });

    test('14 players → 3 specials', () => {
      const pool = generateClassicRoles(14, 0);
      const wolfTypes = [ROLES.WEREWOLF, ROLES.WHITE_WOLF];
      const specials = pool.filter(r => !wolfTypes.includes(r));
      expect(specials).toHaveLength(3);
    });

    test('18 players → 4 specials', () => {
      const pool = generateClassicRoles(18, 0);
      const wolfTypes = [ROLES.WEREWOLF, ROLES.WHITE_WOLF];
      const specials = pool.filter(r => !wolfTypes.includes(r));
      expect(specials).toHaveLength(4);
    });
  });

  describe('no villagers in raw pool', () => {
    test('raw pool never contains VILLAGER', () => {
      for (let n = 5; n <= 20; n++) {
        expect(generateClassicRoles(n, 0)).not.toContain(ROLES.VILLAGER);
      }
    });
  });

  describe('deterministic rotation', () => {
    test('same playerCount + seed → same pool', () => {
      const a = generateClassicRoles(12, 99);
      const b = generateClassicRoles(12, 99);
      expect(a).toEqual(b);
    });

    test('different seed → potentially different specials for same playerCount', () => {
      const pools = new Set();
      for (let seed = 0; seed < 20; seed++) {
        const pool = generateClassicRoles(12, seed);
        pools.add(JSON.stringify(pool.sort()));
      }
      expect(pools.size).toBeGreaterThan(1);
    });
  });

  describe('category diversity', () => {
    test('max 1 chaos role across all seeds/sizes', () => {
      const chaosRoles = [ROLES.CUPID, ROLES.THIEF, ROLES.IDIOT];
      for (let n = 5; n <= 20; n++) {
        for (let seed = 0; seed < 20; seed++) {
          const pool = generateClassicRoles(n, seed);
          const chaosCount = pool.filter(r => chaosRoles.includes(r)).length;
          expect(chaosCount).toBeLessThanOrEqual(1);
        }
      }
    });

    test('always at least 1 investigation or protection role', () => {
      const invOrProt = [ROLES.SEER, ROLES.PETITE_FILLE, ROLES.SALVATEUR, ROLES.ANCIEN];
      for (let n = 5; n <= 20; n++) {
        for (let seed = 0; seed < 50; seed++) {
          const pool = generateClassicRoles(n, seed);
          const hasInvOrProt = pool.some(r => invOrProt.includes(r));
          expect(hasInvOrProt).toBe(true);
        }
      }
    });
  });

  describe('default rotationSeed', () => {
    test('works with no seed (defaults to 0)', () => {
      const pool = generateClassicRoles(8);
      expect(pool.length).toBeGreaterThan(0);
      const wolfTypes = [ROLES.WEREWOLF, ROLES.WHITE_WOLF];
      expect(pool.some(r => wolfTypes.includes(r))).toBe(true);
    });
  });

  describe('edge cases', () => {
    test('minimum players (5)', () => {
      const pool = generateClassicRoles(5, 0);
      expect(pool.length).toBeGreaterThanOrEqual(2); // at least 1 wolf + 1 special
    });

    test('maximum players (20)', () => {
      const pool = generateClassicRoles(20, 0);
      const wolfTypes = [ROLES.WEREWOLF, ROLES.WHITE_WOLF];
      const wolves = pool.filter(r => wolfTypes.includes(r)).length;
      const specials = pool.filter(r => !wolfTypes.includes(r)).length;
      expect(wolves).toBe(5); // ceil(20*0.25)
      expect(specials).toBe(4); // max specials for 16-20
      expect(pool).toContain(ROLES.WHITE_WOLF);
    });

    test('fresh array each call', () => {
      const a = generateClassicRoles(10, 1);
      const b = generateClassicRoles(10, 1);
      expect(a).toEqual(b);
      expect(a).not.toBe(b);
    });
  });

  describe('example compositions', () => {
    test('7 players: 2 wolves + 1 special', () => {
      const pool = generateClassicRoles(7, 0);
      expect(pool).toHaveLength(3); // 2 wolves + 1 special
    });

    test('10 players: 3 wolves + 2 specials', () => {
      const pool = generateClassicRoles(10, 0);
      expect(pool).toHaveLength(5); // 3 wolves + 2 specials
    });

    test('14 players: 4 wolves (incl WhiteWolf) + 3 specials', () => {
      const pool = generateClassicRoles(14, 0);
      expect(pool).toHaveLength(7); // 4 wolves + 3 specials
      expect(pool).toContain(ROLES.WHITE_WOLF);
    });

    test('18 players: 5 wolves (incl WhiteWolf) + 4 specials', () => {
      const pool = generateClassicRoles(18, 0);
      expect(pool).toHaveLength(9); // 5 wolves + 4 specials
      expect(pool).toContain(ROLES.WHITE_WOLF);
    });
  });
});

// ─── Integration: start() with CLASSIC balance mode ──────────
describe('start() — CLASSIC balanceMode integration', () => {
  let gameManager;

  beforeEach(() => {
    const { GameManager } = require('../../game/gameManager');
    gameManager = new GameManager();
    gameManager.create('ch-classic', { guildId: 'g1', balanceMode: 'CLASSIC' });
    for (let i = 1; i <= 8; i++) {
      gameManager.join('ch-classic', { id: `p${i}`, username: `Player${i}` });
    }
  });

  test('game has balanceMode = CLASSIC', () => {
    const game = gameManager.games.get('ch-classic');
    expect(game.balanceMode).toBe(BalanceMode.CLASSIC);
  });

  test('game has numeric id from DB', () => {
    const game = gameManager.games.get('ch-classic');
    expect(typeof game.id).toBe('number');
  });

  test('start() distributes roles using CLASSIC generation', () => {
    const game = gameManager.start('ch-classic');
    expect(game).not.toBeNull();
    expect(game.players.every(p => p.role)).toBe(true);
    expect(game.players.some(p => p.role === ROLES.WEREWOLF)).toBe(true);
  });

  test('start() CLASSIC pool has correct wolf count', () => {
    const game = gameManager.start('ch-classic');
    const wolves = game.players.filter(p =>
      p.role === ROLES.WEREWOLF || p.role === ROLES.WHITE_WOLF
    );
    // 8 players → ceil(2) = 2 wolves
    expect(wolves.length).toBe(2);
  });
});
