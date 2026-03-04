/**
 * Balance mode enum — Werewolf bot
 *
 * Defines how the role pool is built when a game starts.
 * Stored on each game object and persisted to the DB.
 *
 *   DYNAMIC  – Progressive role inclusion based on player count (current default).
 *              Small games get core roles; larger games unlock more specials.
 *   CLASSIC  – (Not yet implemented) Fixed role distribution.
 */

'use strict';

const BalanceMode = Object.freeze({
  DYNAMIC: 'DYNAMIC',
  CLASSIC: 'CLASSIC',
});

module.exports = BalanceMode;
