/**
 * Tests for game/thiefPoolBuilder.js — Pure CLASSIC-mode Thief pool builder.
 */

const ROLES = require('../../game/roles');
const { buildThiefClassicPool, ALL_ROLES, ALWAYS_RESTRICTED } = require('../../game/thiefPoolBuilder');

describe('game/thiefPoolBuilder', () => {

  // ─── ALL_ROLES constant ──────────────────────────────────────────

  describe('ALL_ROLES', () => {
    it('contains every role from roles.js', () => {
      const expected = Object.values(ROLES);
      expect(ALL_ROLES).toEqual(expect.arrayContaining(expected));
      expect(ALL_ROLES.length).toBe(expected.length);
    });

    it('is frozen', () => {
      expect(Object.isFrozen(ALL_ROLES)).toBe(true);
    });
  });

  // ─── ALWAYS_RESTRICTED ───────────────────────────────────────────

  describe('ALWAYS_RESTRICTED', () => {
    it('always excludes THIEF', () => {
      expect(ALWAYS_RESTRICTED.has(ROLES.THIEF)).toBe(true);
    });

    it('is frozen', () => {
      expect(Object.isFrozen(ALWAYS_RESTRICTED)).toBe(true);
    });
  });

  // ─── buildThiefClassicPool ───────────────────────────────────────

  describe('buildThiefClassicPool', () => {

    it('returns an array', () => {
      const result = buildThiefClassicPool([]);
      expect(Array.isArray(result)).toBe(true);
    });

    it('never contains THIEF (always restricted)', () => {
      const result = buildThiefClassicPool([]);
      expect(result).not.toContain(ROLES.THIEF);
    });

    it('excludes all assigned roles', () => {
      const assigned = [ROLES.WEREWOLF, ROLES.SEER, ROLES.WITCH, ROLES.VILLAGER, ROLES.THIEF];
      const result = buildThiefClassicPool(assigned);
      for (const role of assigned) {
        expect(result).not.toContain(role);
      }
    });

    it('includes roles not in assigned list (except THIEF)', () => {
      const assigned = [ROLES.WEREWOLF, ROLES.SEER, ROLES.THIEF];
      const result = buildThiefClassicPool(assigned);
      // Should contain roles NOT in assigned and NOT THIEF
      expect(result).toContain(ROLES.WITCH);
      expect(result).toContain(ROLES.HUNTER);
      expect(result).toContain(ROLES.VILLAGER);
      expect(result).toContain(ROLES.WHITE_WOLF);
    });

    it('returns no duplicates even with duplicate assigned roles', () => {
      const assigned = [ROLES.WEREWOLF, ROLES.WEREWOLF, ROLES.VILLAGER, ROLES.VILLAGER];
      const result = buildThiefClassicPool(assigned);
      const unique = [...new Set(result)];
      expect(result.length).toBe(unique.length);
    });

    it('excludes WHITE_WOLF when it is assigned', () => {
      const assigned = [ROLES.WHITE_WOLF, ROLES.WEREWOLF, ROLES.THIEF];
      const result = buildThiefClassicPool(assigned);
      expect(result).not.toContain(ROLES.WHITE_WOLF);
    });

    it('includes WHITE_WOLF when it is NOT assigned', () => {
      const assigned = [ROLES.WEREWOLF, ROLES.SEER, ROLES.THIEF];
      const result = buildThiefClassicPool(assigned);
      expect(result).toContain(ROLES.WHITE_WOLF);
    });

    it('returns empty array when all roles are assigned', () => {
      // Assign every role
      const assigned = Object.values(ROLES);
      const result = buildThiefClassicPool(assigned);
      expect(result).toEqual([]);
    });

    it('returns empty when all non-THIEF roles are assigned', () => {
      const assigned = Object.values(ROLES).filter(r => r !== ROLES.THIEF);
      assigned.push(ROLES.THIEF); // just in case
      const result = buildThiefClassicPool(assigned);
      expect(result).toEqual([]);
    });

    // ── With enabledRoles filter ──

    it('filters by enabledRoles when provided', () => {
      const assigned = [ROLES.WEREWOLF, ROLES.THIEF];
      const enabled = [ROLES.SEER, ROLES.WITCH]; // only these specials enabled
      const result = buildThiefClassicPool(assigned, enabled);
      expect(result).toContain(ROLES.SEER);
      expect(result).toContain(ROLES.WITCH);
      // HUNTER is not enabled, should be excluded
      expect(result).not.toContain(ROLES.HUNTER);
      // VILLAGER bypasses enabledRoles (mandatory), but is not assigned so it stays
      expect(result).toContain(ROLES.VILLAGER);
    });

    it('WEREWOLF and VILLAGER bypass enabledRoles filter', () => {
      const assigned = [ROLES.THIEF]; // only THIEF assigned
      const enabled = [ROLES.SEER]; // only SEER in enabled list
      const result = buildThiefClassicPool(assigned, enabled);
      // Mandatory roles bypass enabled filter
      expect(result).toContain(ROLES.WEREWOLF);
      expect(result).toContain(ROLES.VILLAGER);
      // SEER is enabled → included
      expect(result).toContain(ROLES.SEER);
      // WITCH etc. not enabled → excluded
      expect(result).not.toContain(ROLES.WITCH);
    });

    it('null enabledRoles means all roles are eligible', () => {
      const assigned = [ROLES.WEREWOLF, ROLES.THIEF];
      const result = buildThiefClassicPool(assigned, null);
      // All non-assigned, non-THIEF roles should be in pool
      const expected = ALL_ROLES.filter(r => r !== ROLES.THIEF && r !== ROLES.WEREWOLF);
      expect(result).toEqual(expect.arrayContaining(expected));
    });

    // ── Typical game scenario ──

    it('produces correct pool for a typical 8-player CLASSIC game', () => {
      // Typical 8-player CLASSIC: 2 wolves, seer, salvateur, 1 chaos, 3 villagers
      const assigned = [
        ROLES.WEREWOLF, ROLES.WEREWOLF,
        ROLES.SEER, ROLES.SALVATEUR,
        ROLES.THIEF,
        ROLES.VILLAGER, ROLES.VILLAGER, ROLES.VILLAGER,
      ];
      const result = buildThiefClassicPool(assigned);
      // Should NOT contain: WEREWOLF, SEER, SALVATEUR, THIEF, VILLAGER
      expect(result).not.toContain(ROLES.WEREWOLF);
      expect(result).not.toContain(ROLES.SEER);
      expect(result).not.toContain(ROLES.SALVATEUR);
      expect(result).not.toContain(ROLES.THIEF);
      expect(result).not.toContain(ROLES.VILLAGER);
      // Should contain the remaining roles
      expect(result).toContain(ROLES.WHITE_WOLF);
      expect(result).toContain(ROLES.WITCH);
      expect(result).toContain(ROLES.HUNTER);
      expect(result).toContain(ROLES.PETITE_FILLE);
      expect(result).toContain(ROLES.CUPID);
      expect(result).toContain(ROLES.ANCIEN);
      expect(result).toContain(ROLES.IDIOT);
      expect(result.length).toBe(7);
    });

    it('is a pure function (no side effects)', () => {
      const assigned = [ROLES.WEREWOLF, ROLES.THIEF];
      const assignedCopy = [...assigned];
      buildThiefClassicPool(assigned);
      expect(assigned).toEqual(assignedCopy);
    });
  });
});
