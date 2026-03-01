/**
 * game/villageStatusPanel.js — Persistent master GUI panel for #village.
 *
 * DESIGN PHILOSOPHY — "Cinematic, not Dashboard":
 * - The embed IS the stage. Phase = understood in < 1 second.
 * - HERO narration in the description — bold, short, iconic.
 * - Timer only when relevant. Counts ultra-compact in footer.
 * - NO player lists (moved to /status). NO tables. NO clutter.
 * - Embed color, title emoji, and narration change with the phase.
 *
 * ABSOLUTE CONSTRAINTS:
 * ❌ No buttons or action components
 * ❌ No database writes
 * ❌ No game state mutation
 * ❌ No decision logic — the engine is the single source of truth
 * ❌ No secret information revealed (roles, votes, etc.)
 *
 * All functions are pure: (gameState, timerInfo, guildId) → EmbedBuilder
 * The panel is posted ONCE and EDITED on every state change.
 */

const { EmbedBuilder } = require('discord.js');
const PHASES = require('./phases');
const { t, translatePhase } = require('../utils/i18n');
const {
  formatTimeRemaining,
  buildAnimatedTimerBar,
  getTransitionEmoji,
  getTransitionColor,
  getAnimatedSubPhaseEmoji,
} = require('./gameStateView');

// ─── Separator ────────────────────────────────────────────────────
const SEP = '━━━━━━━━━━━━━━━━━━━━';

// ─── Narration line ───────────────────────────────────────────────

/**
 * Build the atmospheric HERO narration — ONE sentence, cinematic, iconic.
 * This is the centerpiece of the embed description.
 * Derived ONLY from (phase + subPhase). Never reveals secrets.
 *
 * @param {object} game
 * @param {string} guildId
 * @returns {string}
 */
function buildNarrationLine(game, guildId) {
  if (game.phase === PHASES.ENDED) {
    return t('village_panel.narration_ended', {}, guildId);
  }

  if (game.phase === PHASES.DAY) {
    switch (game.subPhase) {
      case PHASES.VOTE_CAPITAINE:
        return t('village_panel.narration_captain_vote', {}, guildId);
      case PHASES.DELIBERATION:
        return t('village_panel.narration_deliberation', {}, guildId);
      case PHASES.VOTE:
        return t('village_panel.narration_vote', {}, guildId);
      default:
        return t('village_panel.narration_day', {}, guildId);
    }
  }

  // Night
  switch (game.subPhase) {
    case PHASES.VOLEUR:
      return t('village_panel.narration_thief', {}, guildId);
    case PHASES.CUPIDON:
      return t('village_panel.narration_cupid', {}, guildId);
    case PHASES.SALVATEUR:
      return t('village_panel.narration_salvateur', {}, guildId);
    case PHASES.LOUPS:
      return t('village_panel.narration_wolves', {}, guildId);
    case PHASES.LOUP_BLANC:
      return t('village_panel.narration_white_wolf', {}, guildId);
    case PHASES.SORCIERE:
      return t('village_panel.narration_witch', {}, guildId);
    case PHASES.VOYANTE:
      return t('village_panel.narration_seer', {}, guildId);
    case PHASES.REVEIL:
      return t('village_panel.narration_wakeup', {}, guildId);
    default:
      return t('village_panel.narration_night', {}, guildId);
  }
}

// ─── Focus line ───────────────────────────────────────────────────

/**
 * Short action focus — tells what's happening NOW.
 * One line, no secret. Placed under the narration.
 * @param {object} game
 * @param {string} guildId
 * @returns {string}
 */
function buildFocusMessage(game, guildId) {
  if (game.phase === PHASES.ENDED) {
    return t('village_panel.focus_ended', {}, guildId);
  }

  if (game.phase === PHASES.DAY) {
    switch (game.subPhase) {
      case PHASES.DELIBERATION:
        return t('village_panel.focus_deliberation', {}, guildId);
      case PHASES.VOTE:
        return t('village_panel.focus_vote', {}, guildId);
      case PHASES.VOTE_CAPITAINE:
        return t('village_panel.focus_captain_vote', {}, guildId);
      default:
        return t('village_panel.focus_day', {}, guildId);
    }
  }

  // Night sub-phases
  switch (game.subPhase) {
    case PHASES.VOLEUR:
      return t('village_panel.focus_thief', {}, guildId);
    case PHASES.CUPIDON:
      return t('village_panel.focus_cupid', {}, guildId);
    case PHASES.SALVATEUR:
      return t('village_panel.focus_salvateur', {}, guildId);
    case PHASES.LOUPS:
      return t('village_panel.focus_wolves', {}, guildId);
    case PHASES.LOUP_BLANC:
      return t('village_panel.focus_white_wolf', {}, guildId);
    case PHASES.SORCIERE:
      return t('village_panel.focus_witch', {}, guildId);
    case PHASES.VOYANTE:
      return t('village_panel.focus_seer', {}, guildId);
    case PHASES.REVEIL:
      return t('village_panel.focus_wakeup', {}, guildId);
    default:
      return t('village_panel.focus_waiting', {}, guildId);
  }
}

// ─── Master Embed Builder ─────────────────────────────────────────

/**
 * Build the PREMIUM village master embed — cinematic, minimal, iconic.
 *
 * Layout (max visual breathing room):
 * ┌──────────────────────────────────────┐
 * │  🌙  NUIT ━━━ Jour 3                │   ← Title: phase + day
 * ├──────────────────────────────────────┤
 * │                                      │
 * │  *Des hurlements déchirent la nuit.  │   ← Description:
 * │   Les Loups rôdent…*                 │      HERO narration (italic)
 * │                                      │
 * │  ━━━━━━━━━━━━━━━━━━━━                │
 * │  🐺  Les Loups agissent              │      Focus line
 * │                                      │
 * │  ⏱ 1:30  ██████▓░░░░░               │      Timer (only if active)
 * │                                      │
 * ├──────────────────────────────────────┤
 * │  👥 6 en vie · 💀 2 morts · 👑 Alice │   ← Footer: ultra-compact
 * └──────────────────────────────────────┘
 *
 * @param {object} game        Game state (read-only)
 * @param {object|null} timerInfo  { type, remainingMs, totalMs } or null
 * @param {string} guildId
 * @returns {EmbedBuilder}
 */
function buildVillageMasterEmbed(game, timerInfo, guildId) {
  const phase = game.phase;
  const dayCount = game.dayCount || 0;
  const alive = (game.players || []).filter(p => p.alive);
  const dead = (game.players || []).filter(p => !p.alive);
  const lastChange = game._lastPhaseChangeAt || null;

  // ── Phase visuals (animated during transition window) ──
  const titleEmoji = getTransitionEmoji(phase, lastChange);
  const embedColor = getTransitionColor(phase, lastChange, guildId);
  const subEmoji   = getAnimatedSubPhaseEmoji(game.subPhase);

  // ── Title: "{emoji}  PHASE ━━━ Day N" ──
  const phaseLabel = translatePhase(phase).toUpperCase();
  const title = phase === PHASES.ENDED
    ? `${titleEmoji}  ${t('village_panel.title_ended', {}, guildId)}`
    : `${titleEmoji}  ${phaseLabel} ━━━ ${t('gui.day', {}, guildId)} ${dayCount}`;

  // ── Description: cinematic narration block ──
  const narration = buildNarrationLine(game, guildId);
  const focus = buildFocusMessage(game, guildId);

  const descLines = [
    '',
    `*${narration}*`,
    '',
    SEP,
    `${subEmoji}  ${focus}`,
  ];

  // Timer (only when active — part of the description for visual flow)
  if (timerInfo && timerInfo.remainingMs > 0) {
    const bar = buildAnimatedTimerBar(timerInfo.remainingMs, timerInfo.totalMs, 12);
    const timeStr = formatTimeRemaining(timerInfo.remainingMs);
    descLines.push('');
    descLines.push(`⏱ **${timeStr}**  ${bar}`);
  }

  // ── Build embed ──
  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription(descLines.join('\n'))
    .setColor(embedColor)
    .setTimestamp();

  // ── Footer: ultra-compact status line ──
  const captainName = game.captainId
    ? (() => {
        const cap = (game.players || []).find(p => p.id === game.captainId);
        return cap ? cap.username : null;
      })()
    : null;

  const footerParts = [
    `👥 ${alive.length} ${t('gui.alive', {}, guildId)}`,
    `💀 ${dead.length}`,
  ];
  if (captainName) footerParts.push(`👑 ${captainName}`);

  embed.setFooter({ text: footerParts.join('  ·  ') });
  return embed;
}

module.exports = {
  buildVillageMasterEmbed,
  buildFocusMessage,
  buildNarrationLine,
};
