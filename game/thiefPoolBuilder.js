/**
 * game/thiefPoolBuilder.js — Pure pool builder for CLASSIC-mode Thief selection.
 *
 * In CLASSIC balance mode the Thief does NOT draw from 2 physical extra cards.
 * Instead, a virtual selection pool is computed from the global role list
 * minus roles already assigned to players (and restricted roles).
 *
 * Rules enforced:
 *   1. Thief replaces his own role only (caller responsibility).
 *   2. Total role count unchanged (no extra cards needed).
 *   3. No role duplication — already-assigned roles are excluded.
 *   4. WHITE_WOLF cannot be duplicated (excluded if assigned).
 *   5. THIEF is always excluded (no second Thief).
 *   6. Only enabled roles appear in the pool.
 *   7. Empty pool → caller falls back to existing 2-card behaviour.
 *
 * This module is PURE: no Discord logic, no game-state mutation, no I/O.
 */

'use strict';

const ROLES = require('./roles');

/**
 * Every role constant, used as the global reference list.
 * Frozen to prevent accidental mutation.
 */
const ALL_ROLES = Object.freeze(Object.values(ROLES));

/**
 * Roles that are ALWAYS excluded from the Thief's classic selection pool,
 * regardless of what is currently assigned.
 */
const ALWAYS_RESTRICTED = Object.freeze(new Set([
  ROLES.THIEF, // No second Thief
]));

/**
 * Build the virtual selection pool for the Thief in CLASSIC balance mode.
 *
 * Pool = ALL_ROLES − assignedRoles − ALWAYS_RESTRICTED
 *        ∩ enabledRoles (when provided)
 *
 * @param {string[]} assignedRoles  - Roles currently assigned to all players
 *                                    (may contain duplicates, e.g. multiple WEREWOLF).
 * @param {string[]|null} [enabledRoles=null] - Guild-scoped enabled roles.
 *                                    When null, all roles are considered enabled.
 *                                    WEREWOLF and VILLAGER are always eligible
 *                                    (but will be excluded if already assigned).
 * @returns {string[]} De-duplicated array of roles the Thief can pick from.
 *                     Empty array when no valid options exist (→ fallback).
 */
function buildThiefClassicPool(assignedRoles, enabledRoles = null) {
  const assignedSet = new Set(assignedRoles);

  const enabledSet = enabledRoles ? new Set(enabledRoles) : null;

  return ALL_ROLES.filter(role => {
    // Always-restricted roles (THIEF)
    if (ALWAYS_RESTRICTED.has(role)) return false;

    // Exclude roles already assigned to any player
    if (assignedSet.has(role)) return false;

    // Guild-scoped enabled-roles filter
    if (enabledSet) {
      // Mandatory roles bypass the enabled filter
      if (role !== ROLES.WEREWOLF && role !== ROLES.VILLAGER) {
        if (!enabledSet.has(role)) return false;
      }
    }

    return true;
  });
}

module.exports = {
  buildThiefClassicPool,
  ALL_ROLES,
  ALWAYS_RESTRICTED,
};
