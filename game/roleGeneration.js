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
 * @returns {string[]} Raw role pool
 * @throws {Error} If the balance mode is not implemented
 */
function generateRoles(playerCount, balanceMode = BalanceMode.DYNAMIC) {
  switch (balanceMode) {
    case BalanceMode.DYNAMIC:
      return generateDynamicRoles(playerCount);
    case BalanceMode.CLASSIC:
      throw new Error('CLASSIC balance mode is not implemented yet');
    default:
      throw new Error(`Unknown balance mode: ${balanceMode}`);
  }
}

module.exports = { generateDynamicRoles, generateRoles };
