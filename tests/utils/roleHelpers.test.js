const ROLES = require('../../game/roles');
const { getRoleDescription, getRoleImageName } = require('../../utils/roleHelpers');

describe('roleHelpers', () => {
  describe('getRoleDescription()', () => {
    test('retourne la description pour chaque rôle', () => {
      expect(getRoleDescription(ROLES.WEREWOLF)).toContain('loups');
      expect(getRoleDescription(ROLES.VILLAGER)).toContain('village');
      expect(getRoleDescription(ROLES.SEER)).toContain('voyante');
      expect(getRoleDescription(ROLES.WITCH)).toContain('sorciere');
      expect(getRoleDescription(ROLES.HUNTER)).toContain('shoot');
      expect(getRoleDescription(ROLES.PETITE_FILLE)).toContain('listen');
      expect(getRoleDescription(ROLES.CUPID)).toContain('love');
    });

    test('retourne un fallback pour un rôle inconnu', () => {
      expect(getRoleDescription('ROLE_INEXISTANT')).toBe('Rôle inconnu');
    });
  });

  describe('getRoleImageName()', () => {
    test('retourne le nom d\'image pour chaque rôle', () => {
      expect(getRoleImageName(ROLES.WEREWOLF)).toBe('loupSimple.webp');
      expect(getRoleImageName(ROLES.VILLAGER)).toBe('villageois.webp');
      expect(getRoleImageName(ROLES.SEER)).toBe('voyante.webp');
      expect(getRoleImageName(ROLES.WITCH)).toBe('sorciere.png');
      expect(getRoleImageName(ROLES.HUNTER)).toBe('chasseur.webp');
      expect(getRoleImageName(ROLES.PETITE_FILLE)).toBe('petiteFille.webp');
      expect(getRoleImageName(ROLES.CUPID)).toBe('cupidon.webp');
    });

    test('retourne null pour un rôle inconnu', () => {
      expect(getRoleImageName('ROLE_INEXISTANT')).toBeNull();
    });
  });
});
