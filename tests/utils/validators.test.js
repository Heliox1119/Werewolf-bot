const {
  isValidSnowflake,
  isAdmin,
  isPlayerInGame
} = require('../../utils/validators');

// Note: isInGameCategory uses ConfigManager which is harder to test in isolation.
// We test the simpler pure functions here.

describe('validators', () => {
  describe('isValidSnowflake()', () => {
    test('retourne true pour un snowflake valide (17 chiffres)', () => {
      expect(isValidSnowflake('12345678901234567')).toBe(true);
    });

    test('retourne true pour un snowflake valide (18 chiffres)', () => {
      expect(isValidSnowflake('123456789012345678')).toBe(true);
    });

    test('retourne true pour un snowflake valide (19 chiffres)', () => {
      expect(isValidSnowflake('1234567890123456789')).toBe(true);
    });

    test('retourne false pour un ID trop court', () => {
      expect(isValidSnowflake('1234')).toBe(false);
    });

    test('retourne false pour un ID trop long', () => {
      expect(isValidSnowflake('12345678901234567890')).toBe(false);
    });

    test('retourne false pour un ID non-numérique', () => {
      expect(isValidSnowflake('abcdefghijklmnopq')).toBe(false);
    });

    test('retourne false pour un non-string', () => {
      expect(isValidSnowflake(123456789012345678)).toBe(false);
      expect(isValidSnowflake(null)).toBe(false);
      expect(isValidSnowflake(undefined)).toBe(false);
    });
  });

  describe('isAdmin()', () => {
    test('retourne true si l\'utilisateur a la permission ADMINISTRATOR', () => {
      const interaction = {
        member: { permissions: { has: jest.fn(() => true) } }
      };
      expect(isAdmin(interaction)).toBe(true);
    });

    test('retourne false si pas admin', () => {
      const interaction = {
        member: { permissions: { has: jest.fn(() => false) } }
      };
      expect(isAdmin(interaction)).toBe(false);
    });

    test('retourne false si member est null', () => {
      expect(isAdmin({ member: null })).toBe(false);
    });

    test('retourne false si permissions est null', () => {
      expect(isAdmin({ member: { permissions: null } })).toBe(false);
    });
  });

  describe('isPlayerInGame()', () => {
    const players = [
      { id: 'p1', alive: true, role: 'Villager' },
      { id: 'p2', alive: false, role: 'Werewolf' }
    ];
    const game = { players };

    test('retourne inGame et alive pour un joueur vivant', () => {
      const result = isPlayerInGame(game, 'p1');
      expect(result.inGame).toBe(true);
      expect(result.alive).toBe(true);
      expect(result.player).toBeDefined();
      expect(result.player.id).toBe('p1');
    });

    test('retourne inGame et !alive pour un joueur mort', () => {
      const result = isPlayerInGame(game, 'p2');
      expect(result.inGame).toBe(true);
      expect(result.alive).toBe(false);
    });

    test('retourne !inGame pour un joueur absent', () => {
      const result = isPlayerInGame(game, 'unknown');
      expect(result.inGame).toBe(false);
      expect(result.alive).toBe(false);
    });

    test('gère un game null', () => {
      const result = isPlayerInGame(null, 'p1');
      expect(result.inGame).toBe(false);
      expect(result.alive).toBe(false);
    });
  });
});
