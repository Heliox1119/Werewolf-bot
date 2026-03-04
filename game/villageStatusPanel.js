/**
 * game/villageStatusPanel.js — Definitive master GUI panel for #village.
 *
 * DESIGN PHILOSOPHY — Immersive Village Board:
 * ┌──────────────────────────────────────────────────┐
 * │ 🌙 NUIT — Jour 3                                │  ← HEADER: phase + day
 * ├──────────────────────────────────────────────────┤
 * │ [━━━━━━ villageNuit.png ━━━━━━]                  │  ← IMAGE: ambiance
 * │                                                  │
 * │ *Des hurlements déchirent la nuit.*              │  ← NARRATION (strophe)
 * │ *Les Loups rôdent et choisissent…*               │
 * │                                                  │
 * │ ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌                   │
 * │ 🐺  Les Loups choisissent leur victime…          │  ← FOCUS LINE
 * │                                                  │
 * │ > ⏱ **1:30**  █████▓░░░░░                       │  ← TIMER (blockquote)
 * │                                                  │
 * ├──────────────────────────────────────────────────┤
 * │ 📊 État du jeu              │ ✅ Villageois      │  ← FIELDS: state + players
 * │ 👥 6 · ☠️ 2 · 📅 3 · 👑 Ali │ ✅ Alice 👑        │
 * │                              │ ✅ Bob             │
 * │                              │ ✅ Diana           │
 * ├──────────────────────────────────────────────────┤
 * │ 🔄 Mise à jour automatique                       │  ← FOOTER
 * └──────────────────────────────────────────────────┘
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
const BalanceMode = require('./balanceMode');
const { t, translatePhase } = require('../utils/i18n');
const {
  formatTimeRemaining,
  buildAnimatedTimerBar,
  getTransitionEmoji,
  getTransitionColor,
  getAnimatedSubPhaseEmoji,
} = require('./gameStateView');

// ─── Separator (light dashed — separates without blocking visual flow) ──
const SEP = '╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌';

// ─── Phase image mapping ──────────────────────────────────────────

const PHASE_IMAGES = {
  [PHASES.NIGHT]: 'villageNuit.png',
  [PHASES.DAY]:   'villageJour.png',
};

/**
 * Get the image filename for the current phase.
 * @param {string} phase
 * @returns {string|null}  Filename (e.g. 'villageNuit.png') or null for ENDED.
 */
function getPhaseImage(phase) {
  return PHASE_IMAGES[phase] || null;
}

// ─── CLASSIC mode helper ──────────────────────────────────────────

/**
 * Returns true when the game is in CLASSIC balance mode
 * and the current phase is NIGHT (not DAY, not ENDED).
 * In that situation, public displays must hide role identities.
 */
function isClassicNight(game) {
  return game.balanceMode === BalanceMode.CLASSIC && game.phase === PHASES.NIGHT;
}

// ─── Narration line ───────────────────────────────────────────────

/**
 * Build the atmospheric HERO narration — cinematic, iconic.
 * May contain \n for a 2-line strophe (split at locale level).
 * Derived ONLY from (phase + subPhase). Never reveals secrets.
 *
 * For main-phase ambiance (generic night/day text), uses the dynamic
 * currentNarrative picked once at phase transition — providing variety
 * and context-aware tone, without changing on GUI refresh.
 * Sub-phase narrations (wolves, witch, seer…) stay locale-based.
 *
 * @param {object} game
 * @param {string} guildId
 * @returns {string}
 */
function buildNarrationLine(game, guildId) {
  // Dynamic narration helper — returns the stored text if available
  const dynamicText = game.currentNarrative && game.currentNarrative.text;

  if (game.phase === PHASES.ENDED) {
    return t('village_panel.narration_ended', {}, guildId);
  }

  if (game.phase === PHASES.DAY) {
    switch (game.subPhase) {
      case PHASES.VOTE_CAPITAINE:
        return t('village_panel.narration_captain_vote', {}, guildId);
      case PHASES.VOTE:
        return dynamicText || t('village_panel.narration_vote', {}, guildId);
      default:
        return dynamicText || t('village_panel.narration_day', {}, guildId);
    }
  }

  // CLASSIC night — generic atmospheric narration, no role names
  if (isClassicNight(game)) {
    return t('village_panel.classic_night_narration', {}, guildId);
  }

  // Night — sub-phase-specific narrations stay locale-based
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
      return dynamicText || t('village_panel.narration_night', {}, guildId);
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
      case PHASES.VOTE:
        return t('village_panel.focus_vote', {}, guildId);
      case PHASES.VOTE_CAPITAINE:
        return t('village_panel.focus_captain_vote', {}, guildId);
      default:
        return t('village_panel.focus_day', {}, guildId);
    }
  }

  // CLASSIC night — generic focus, no role names
  if (isClassicNight(game)) {
    return t('village_panel.classic_night_focus', {}, guildId);
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

// ─── Player list builder ──────────────────────────────────────────

/**
 * Build the alive player list — compact, no roles, captain badge.
 * @param {object} game
 * @returns {string}
 */
function buildPlayerList(game) {
  const alive = (game.players || []).filter(p => p.alive);
  if (alive.length === 0) return '—';
  return alive.map(p => {
    const badge = p.id === game.captainId ? ' 👑' : '';
    return `✅ ${p.username}${badge}`;
  }).join('\n');
}

// ─── Game state summary builder ───────────────────────────────────

/**
 * Build ultra-compact game state — one field value.
 * @param {object} game
 * @param {string} guildId
 * @returns {string}
 */
function buildGameState(game, guildId) {
  const alive = (game.players || []).filter(p => p.alive);
  const dead = (game.players || []).filter(p => !p.alive);
  const dayCount = game.dayCount || 0;

  const captainName = game.captainId
    ? (() => {
        const cap = (game.players || []).find(p => p.id === game.captainId);
        return cap ? cap.username : '—';
      })()
    : '—';

  const lines = [
    `👥 ${t('gui.alive', {}, guildId)} : **${alive.length}**`,
    `☠️ ${t('gui.dead', {}, guildId)} : **${dead.length}**`,
    `📅 ${t('gui.day', {}, guildId)} : **${dayCount}**`,
    `👑 ${t('gui.captain', {}, guildId)} : **${captainName}**`,
  ];
  return lines.join('\n');
}

// ─── Master Embed Builder ─────────────────────────────────────────

/**
 * Build the DEFINITIVE village master embed.
 *
 * @param {object} game        Game state (read-only)
 * @param {object|null} timerInfo  { type, remainingMs, totalMs } or null
 * @param {string} guildId
 * @returns {EmbedBuilder}
 */
function buildVillageMasterEmbed(game, timerInfo, guildId) {
  const phase = game.phase;
  const dayCount = game.dayCount || 0;
  const lastChange = game._lastPhaseChangeAt || null;

  // ── Phase visuals (animated during transition window) ──
  const titleEmoji = getTransitionEmoji(phase, lastChange);
  const embedColor = getTransitionColor(phase, lastChange, guildId);
  const subEmoji   = getAnimatedSubPhaseEmoji(game.subPhase);

  // ── Title: "{emoji} PHASE — Jour N" ──
  const phaseLabel = translatePhase(phase).toUpperCase();
  const title = phase === PHASES.ENDED
    ? `${titleEmoji}  ${t('village_panel.title_ended', {}, guildId)}`
    : `${titleEmoji}  ${phaseLabel} — ${t('gui.day', {}, guildId)} ${dayCount}`;

  // ── Image: phase-driven ambiance ──
  const imageFile = getPhaseImage(phase);

  // ── Description: narration + separator + focus + timer ──
  const narration = buildNarrationLine(game, guildId);
  const focus = buildFocusMessage(game, guildId);

  // Multi-line narration: each line wrapped in *italic* for strophe effect
  const narrationLines = narration.split('\n').map(line => `*${line}*`);

  const descLines = [
    '',
    ...narrationLines,
    '',
    SEP,
    `${subEmoji}  ${focus}`,
  ];

  // Timer (only when active — blockquote for visual anchoring)
  if (timerInfo && timerInfo.remainingMs > 0) {
    const bar = buildAnimatedTimerBar(timerInfo.remainingMs, timerInfo.totalMs, 12);
    const timeStr = formatTimeRemaining(timerInfo.remainingMs);
    descLines.push('');
    descLines.push(`> ⏱ **${timeStr}**  ${bar}`);
  }

  // ── Build embed ──
  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription(descLines.join('\n'))
    .setColor(embedColor)
    .setTimestamp();

  // ── Image: phase ambiance (only for active phases) ──
  if (imageFile) {
    embed.setImage(`attachment://${imageFile}`);
  }

  // ── Field: Game State (compact inline) ──
  embed.addFields({
    name: `📊 ${t('village_panel.state_header', {}, guildId)}`,
    value: buildGameState(game, guildId),
    inline: true,
  });

  // ── Field: Alive Players list ──
  const alivePlayers = (game.players || []).filter(p => p.alive);
  if (alivePlayers.length > 0) {
    embed.addFields({
      name: `🏘️ ${t('village_panel.players_header', {}, guildId)}`,
      value: buildPlayerList(game),
      inline: true,
    });
  }

  // ── Footer ──
  embed.setFooter({ text: t('village_panel.footer', {}, guildId) });
  return embed;
}

module.exports = {
  buildVillageMasterEmbed,
  buildFocusMessage,
  buildNarrationLine,
  buildPlayerList,
  buildGameState,
  getPhaseImage,
  isClassicNight,
};
