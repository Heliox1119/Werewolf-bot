/**
 * Tests for game/roleGeneration.js and game/balanceMode.js
 *
 * Verifies:
 *  - BalanceMode enum is frozen with correct keys
 *  - generateDynamicRoles produces the exact same pools as the old inline logic
 *  - generateRoles dispatches correctly
 *  - CLASSIC mode throws (not implemented yet)
 *  - Unknown mode throws
 *  - Game object stores balanceMode correctly
 *  - start() still produces valid role distributions
 */

const BalanceMode = require('../../game/balanceMode');
const { generateDynamicRoles, generateRoles } = require('../../game/roleGeneration');
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

  test('CLASSIC mode throws not-implemented error', () => {
    expect(() => generateRoles(5, BalanceMode.CLASSIC)).toThrow('CLASSIC balance mode is not implemented yet');
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
