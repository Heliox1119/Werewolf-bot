/**
 * Role pool generation — Werewolf bot
 *
 * Pure functions that build the initial role pool for a game based on
 * player count and balance mode.  No game state mutation, no side effects.
 *
 * These are called from GameManager.start() after the balance mode is
 * determined and before shuffle / thief extraction / distribution.
 */

'use strict';

const ROLES = require('./roles');
const BalanceMode = require('./balanceMode');

// ─── CLASSIC mode: role categories ──────────────────────────────
// Each category satisfies a gameplay function.  The selection algorithm
// ensures at least one investigation OR protection role is always present,
// and prevents degenerate all-chaos compositions.

const CLASSIC_CATEGORIES = Object.freeze({
  investigation: [ROLES.SEER, ROLES.PETITE_FILLE],
  protection:    [ROLES.SALVATEUR, ROLES.ANCIEN],
  impact:        [ROLES.WITCH, ROLES.HUNTER],
  chaos:         [ROLES.CUPID, ROLES.THIEF, ROLES.IDIOT],
});

/**
 * Ordered list of all special roles eligible for CLASSIC rotation.
 * WhiteWolf is excluded — it's conditionally injected (≥ 14 players)
 * as a wolf-slot upgrade, not a special-role pick.
 */
const CLASSIC_SPECIAL_POOL = Object.freeze([
  // investigation
  ROLES.SEER,
  ROLES.PETITE_FILLE,
  // protection
  ROLES.SALVATEUR,
  ROLES.ANCIEN,
  // impact
  ROLES.WITCH,
  ROLES.HUNTER,
  // chaos
  ROLES.CUPID,
  ROLES.THIEF,
  ROLES.IDIOT,
]);

/**
 * How many special (non-wolf, non-villager) roles are allowed for a
 * given player count in CLASSIC mode.
 *
 * @param {number} playerCount
 * @returns {number} Max specials (1–4)
 */
function getMaxSpecials(playerCount) {
  if (playerCount < 8)  return 1;
  if (playerCount <= 11) return 2;
  if (playerCount <= 15) return 3;
  return 4; // 16–20
}

/**
 * Look up which category a role belongs to.
 *
 * @param {string} role
 * @returns {string|null} Category name or null
 */
function getCategoryOf(role) {
  for (const [cat, members] of Object.entries(CLASSIC_CATEGORIES)) {
    if (members.includes(role)) return cat;
  }
  return null;
}

/**
 * Deterministic rotation-based special role selection for CLASSIC mode.
 *
 * Algorithm:
 *   1. Start at offset = rotationSeed % poolLength.
 *   2. Walk the pool circularly and pick up to `maxSpecials` roles.
 *   3. Enforce category diversity: max 1 chaos role, never 2+ from
 *      the same category in a row (skip, advance offset).
 *   4. Guarantee: at least one investigation OR protection role.
 *      If the walk didn't produce one, swap the last pick for the
 *      first available investigation/protection role.
 *
 * Because the seed changes per game (typically the DB auto-increment id
 * or guild-scoped counter), consecutive games get different offsets →
 * different compositions, deterministically.
 *
 * @param {number} maxSpecials   - How many to pick (1–4)
 * @param {number} rotationSeed  - Integer seed for offset (e.g. gameId)
 * @returns {string[]} Selected special roles
 */
function selectSpecials(maxSpecials, rotationSeed) {
  const pool = CLASSIC_SPECIAL_POOL;
  const poolLen = pool.length;
  const offset = ((rotationSeed % poolLen) + poolLen) % poolLen; // always positive

  const picked = [];
  const pickedCategories = {};  // category → count
  let chaosCount = 0;

  // Walk the pool circularly starting at offset
  for (let step = 0; step < poolLen && picked.length < maxSpecials; step++) {
    const idx = (offset + step) % poolLen;
    const role = pool[idx];
    const cat = getCategoryOf(role);

    // Category balancing: max 1 chaos role
    if (cat === 'chaos' && chaosCount >= 1) continue;

    // Category balancing: no 2 from same category
    if (cat && (pickedCategories[cat] || 0) >= 1 && poolLen - step > maxSpecials - picked.length) {
      // Only skip if there are enough remaining candidates
      continue;
    }

    picked.push(role);
    if (cat) pickedCategories[cat] = (pickedCategories[cat] || 0) + 1;
    if (cat === 'chaos') chaosCount++;
  }

  // Guarantee: at least one investigation OR protection role
  const hasInvestigation = picked.some(r => CLASSIC_CATEGORIES.investigation.includes(r));
  const hasProtection = picked.some(r => CLASSIC_CATEGORIES.protection.includes(r));

  if (!hasInvestigation && !hasProtection && picked.length > 0) {
    // Replace the last picked role with the first available investigation/protection
    const fallbackCandidates = [
      ...CLASSIC_CATEGORIES.investigation,
      ...CLASSIC_CATEGORIES.protection,
    ].filter(r => !picked.includes(r));

    if (fallbackCandidates.length > 0) {
      const fallback = fallbackCandidates[offset % fallbackCandidates.length];
      picked[picked.length - 1] = fallback;
    }
  }

  return picked;
}

/**
 * Generate the role pool using the CLASSIC balance mode.
 *
 * Design principles:
 *   - Wolves ≈ 25% of players (ceil).
 *   - Special roles capped by player count bracket.
 *   - Deterministic rotation prevents identical consecutive compositions.
 *   - Category diversity prevents degenerate picks.
 *   - WhiteWolf replaces one regular wolf at ≥ 14 players.
 *   - Remaining slots filled with Villagers.
 *   - No Villagers in the returned pool (padding done by start()).
 *     → Actually, CLASSIC explicitly pads to playerCount because the
 *       composition must be fully determined here (unlike DYNAMIC which
 *       lets start() pad).  However, to match the existing contract
 *       (start() handles thief extra + villager padding), we return
 *       wolves + specials only, same as generateDynamicRoles.
 *
 * @param {number} playerCount   - Number of players (5–20)
 * @param {number} [rotationSeed=0] - Seed for deterministic rotation
 * @returns {string[]} Raw role pool (wolves + specials, no villagers)
 */
function generateClassicRoles(playerCount, rotationSeed = 0) {
  // ── Wolves: ceil(25%) ─────────────────────────────────────
  let wolfCount = Math.ceil(playerCount * 0.25);
  // Minimum 1 wolf
  wolfCount = Math.max(1, wolfCount);

  const pool = [];

  // WhiteWolf replaces one regular wolf at 14+ players
  const includeWhiteWolf = playerCount >= 14;
  if (includeWhiteWolf) {
    pool.push(ROLES.WHITE_WOLF);
    for (let i = 1; i < wolfCount; i++) pool.push(ROLES.WEREWOLF);
  } else {
    for (let i = 0; i < wolfCount; i++) pool.push(ROLES.WEREWOLF);
  }

  // ── Specials: capped, rotated, category-balanced ──────────
  const maxSpecials = getMaxSpecials(playerCount);
  const specials = selectSpecials(maxSpecials, rotationSeed);
  pool.push(...specials);

  return pool;
}

/**
 * Generate the role pool using the DYNAMIC balance mode.
 *
 * Progressive role inclusion: small games get core roles, larger games
 * progressively unlock special roles.
 *
 * This is the original (and currently only) role generation algorithm,
 * extracted verbatim from GameManager.start().
 *
 * @param {number} playerCount - Number of players in the game (≥ 5)
 * @returns {string[]} Raw role pool (before config filtering / padding)
 */
function generateDynamicRoles(playerCount) {
  const pool = [];

  // 1 wolf if ≤5 players, 2 wolves at 6+
  if (playerCount <= 5) {
    pool.push(ROLES.WEREWOLF, ROLES.SEER, ROLES.WITCH, ROLES.HUNTER);
  } else {
    pool.push(ROLES.WEREWOLF, ROLES.WEREWOLF, ROLES.SEER, ROLES.WITCH, ROLES.HUNTER);
  }

  // Progressive special roles
  if (playerCount >= 6)  pool.push(ROLES.PETITE_FILLE);
  if (playerCount >= 7)  pool.push(ROLES.CUPID);
  if (playerCount >= 8)  pool.push(ROLES.THIEF);
  if (playerCount >= 9)  pool.push(ROLES.SALVATEUR);
  if (playerCount >= 10) pool.push(ROLES.ANCIEN);
  if (playerCount >= 11) pool.push(ROLES.WHITE_WOLF);
  if (playerCount >= 12) pool.push(ROLES.IDIOT);

  return pool;
}

/**
 * Generate the initial role pool for a given balance mode.
 *
 * @param {number} playerCount - Number of players
 * @param {string} balanceMode - One of BalanceMode values
 * @param {object} [options]   - Optional parameters
 * @param {number} [options.rotationSeed=0] - Seed for CLASSIC rotation (e.g. gameId)
 * @returns {string[]} Raw role pool
 * @throws {Error} If the balance mode is not implemented
 */
function generateRoles(playerCount, balanceMode = BalanceMode.DYNAMIC, options = {}) {
  switch (balanceMode) {
    case BalanceMode.DYNAMIC:
      return generateDynamicRoles(playerCount);
    case BalanceMode.CLASSIC:
      return generateClassicRoles(playerCount, options.rotationSeed || 0);
    default:
      throw new Error(`Unknown balance mode: ${balanceMode}`);
  }
}

module.exports = {
  generateDynamicRoles,
  generateClassicRoles,
  generateRoles,
  // Exported for testing only
  _CLASSIC_CATEGORIES: CLASSIC_CATEGORIES,
  _CLASSIC_SPECIAL_POOL: CLASSIC_SPECIAL_POOL,
  _getMaxSpecials: getMaxSpecials,
  _selectSpecials: selectSpecials,
  _getCategoryOf: getCategoryOf,
};
