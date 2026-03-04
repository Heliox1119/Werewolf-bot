/**
 * ELO Guards — Pure utility functions for the ELO ranking system.
 *
 * All functions are stateless & side-effect free so they can be unit-tested in
 * isolation without touching the database or Discord API.
 *
 * @module game/eloGuards
 */

'use strict';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Minimum ELO rating a player can have (hard floor). */
const ELO_FLOOR = 800;

/** Number of ranked games required to complete placement. */
const PLACEMENT_GAMES = 5;

/** ELO K-factor multiplier applied during placement phase. */
const PLACEMENT_MULTIPLIER = 1.25;

/** Maximum number of no-kill cycles before a game is considered inactivity. */
const MAX_NO_KILL_CYCLES = 3;

// ─── Tier Definitions (ordered high → low) ───────────────────────────────────

const TIERS = [
  { id: 'diamant',  min: 1600, name: 'Diamant',  nameEn: 'Diamond',  emoji: '💎' },
  { id: 'platine',  min: 1400, name: 'Platine',  nameEn: 'Platinum', emoji: '⚜️' },
  { id: 'or',       min: 1200, name: 'Or',        nameEn: 'Gold',     emoji: '🥇' },
  { id: 'argent',   min: 1000, name: 'Argent',    nameEn: 'Silver',   emoji: '🥈' },
  { id: 'bronze',   min: 800,  name: 'Bronze',    nameEn: 'Bronze',   emoji: '🥉' },
];

const UNRANKED_TIER = {
  id: 'unranked',
  name: 'Non classé',
  nameEn: 'Unranked',
  emoji: '❔',
};

// ─── Pure Functions ──────────────────────────────────────────────────────────

/**
 * Whether the player is still in their placement phase.
 * @param {number|undefined} rankedGamesPlayed - Number of ranked games completed.
 *   Pass `undefined` or `null` to skip placement check (backward compat).
 * @returns {boolean}
 */
function isPlacementPhase(rankedGamesPlayed) {
  if (rankedGamesPlayed == null) return false; // unknown → assume placed (backward compat)
  return rankedGamesPlayed < PLACEMENT_GAMES;
}

/**
 * Return the placement K-factor multiplier (>1 during placement, 1 after).
 * @param {number} rankedGamesPlayed
 * @returns {number}
 */
function getPlacementMultiplier(rankedGamesPlayed) {
  return isPlacementPhase(rankedGamesPlayed) ? PLACEMENT_MULTIPLIER : 1.0;
}

/**
 * Clamp an ELO value to the hard floor.
 * @param {number} elo
 * @returns {number}
 */
function clampElo(elo) {
  return Math.max(ELO_FLOOR, elo);
}

/**
 * Resolve a tier object from an ELO rating + placement status.
 *
 * During placement the player is shown as "Non classé / Unranked".
 *
 * @param {number} elo
 * @param {number} [rankedGamesPlayed=999] - Pass 999+ to skip placement check.
 * @returns {{ id: string, name: string, nameEn: string, emoji: string }}
 */
function getEloTier(elo, rankedGamesPlayed) {
  if (isPlacementPhase(rankedGamesPlayed)) {
    return { ...UNRANKED_TIER };
  }
  for (const tier of TIERS) {
    if (elo >= tier.min) return { ...tier };
  }
  // Below ELO_FLOOR (shouldn't happen after clamping, but safety)
  return { ...TIERS[TIERS.length - 1] };
}

/**
 * Detect whether a game object represents an inactivity draw.
 *
 * An inactivity draw is triggered when the no-kill-cycle counter reaches
 * MAX_NO_KILL_CYCLES. The flag `_endedByInactivity` is set explicitly by
 * `endGameByInactivity()` in gameManager as an extra safety net.
 *
 * @param {object} game
 * @returns {boolean}
 */
function isInactivityDraw(game) {
  if (!game) return false;
  if (game._endedByInactivity === true) return true;
  if ((game._noKillCycles ?? 0) >= MAX_NO_KILL_CYCLES) return true;
  return false;
}

/**
 * Determine if ELO should be skipped entirely for this game.
 *
 * Rules (any → skip):
 *   1. Game ended by inactivity draw
 *   2. Game was cancelled / aborted before Night 1 (dayCount === 0)
 *   3. Winner is explicitly null / undefined (game not actually finished)
 *
 * @param {object} game
 * @param {string|null} winner
 * @returns {boolean}
 */
function shouldSkipElo(game, winner) {
  if (!game) return true;
  if (winner == null) return true;                       // no winner resolved
  if (isInactivityDraw(game)) return true;               // AFK draw
  if ((game.dayCount ?? 0) === 0 && winner === 'draw') return true; // aborted before night 1
  return false;
}

// ─── Exports ─────────────────────────────────────────────────────────────────

module.exports = {
  // Constants
  ELO_FLOOR,
  PLACEMENT_GAMES,
  PLACEMENT_MULTIPLIER,
  MAX_NO_KILL_CYCLES,
  TIERS,
  UNRANKED_TIER,

  // Functions
  isPlacementPhase,
  getPlacementMultiplier,
  clampElo,
  getEloTier,
  isInactivityDraw,
  shouldSkipElo,
};
