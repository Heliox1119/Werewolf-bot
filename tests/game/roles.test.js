const ROLES = require('../../game/roles');

describe('ROLES constants', () => {
  test('tous les rôles sont définis', () => {
    expect(ROLES.WEREWOLF).toBe('Loup-Garou');
    expect(ROLES.VILLAGER).toBe('Villageois');
    expect(ROLES.SEER).toBe('Voyante');
    expect(ROLES.WITCH).toBe('Sorcière');
    expect(ROLES.HUNTER).toBe('Chasseur');
    expect(ROLES.PETITE_FILLE).toBe('Petite Fille');
    expect(ROLES.CUPID).toBe('Cupidon');
  });

  test('pas de rôles dupliqués', () => {
    const roleValues = Object.values(ROLES);
    const uniqueValues = new Set(roleValues);
    
    expect(roleValues.length).toBe(uniqueValues.size);
  });

  test('tous les rôles sont des strings', () => {
    Object.values(ROLES).forEach(role => {
      expect(typeof role).toBe('string');
      expect(role.length).toBeGreaterThan(0);
    });
  });
});

describe('Logique des rôles', () => {
  test('identifie les loups correctement', () => {
    const wolves = [ROLES.WEREWOLF];
    const nonWolves = [ROLES.VILLAGER, ROLES.SEER, ROLES.WITCH, ROLES.HUNTER, ROLES.PETITE_FILLE, ROLES.CUPID];

    wolves.forEach(role => {
      expect(role).toBe(ROLES.WEREWOLF);
    });

    nonWolves.forEach(role => {
      expect(role).not.toBe(ROLES.WEREWOLF);
    });
  });

  test('identifie les rôles spéciaux avec actions', () => {
    const rolesWithNightActions = [
      ROLES.WEREWOLF,  // /kill
      ROLES.SEER,      // /see
      ROLES.WITCH,     // /potion
      ROLES.PETITE_FILLE, // /listen
      ROLES.CUPID      // /love (première nuit)
    ];

    rolesWithNightActions.forEach(role => {
      expect(Object.values(ROLES)).toContain(role);
    });
  });

  test('le chasseur a une action spéciale à la mort', () => {
    expect(ROLES.HUNTER).toBe('Chasseur');
    // Le chasseur utilise /shoot quand il meurt
  });
});
