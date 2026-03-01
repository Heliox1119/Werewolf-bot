/**
 * game/villageStatusPanel.js — Persistent master GUI panel for #🏠-village.
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
 *
 * "If all players close Discord for 5 minutes, then come back,
 *  the first message they see in #village MUST tell them exactly
 *  where the game stands."
 */

const { EmbedBuilder } = require('discord.js');
const PHASES = require('./phases');
const { t, translatePhase } = require('../utils/i18n');
const {
  formatTimeRemaining,
  buildProgressBar,
  getPhaseColor,
  getPhaseEmoji,
  getSubPhaseEmoji,
  // Animation helpers (server-side embed-edit animations)
  buildAnimatedTimerBar,
  getAnimatedSubPhaseEmoji,
  getTransitionEmoji,
  getTransitionColor,
} = require('./gameStateView');

// ─── Dynamic Focus ────────────────────────────────────────────────

/**
 * Build the dynamic "📣 En cours" focus message.
 * Changes with every phase/subPhase transition.
 * ⚠️ MUST NOT reveal any secret (roles, votes, identities).
 *
 * @param {object} game
 * @param {string} guildId
 * @returns {string}
 */
function buildFocusMessage(game, guildId) {
  if (game.phase === PHASES.ENDED) {
    return `🏁 ${t('village_panel.focus_ended', {}, guildId)}`;
  }

  if (game.phase === PHASES.DAY) {
    switch (game.subPhase) {
      case PHASES.DELIBERATION:
        return `💬 ${t('village_panel.focus_deliberation', {}, guildId)}`;
      case PHASES.VOTE:
        return `🗳️ ${t('village_panel.focus_vote', {}, guildId)}`;
      case PHASES.VOTE_CAPITAINE:
        return `👑 ${t('village_panel.focus_captain_vote', {}, guildId)}`;
      default:
        return `☀️ ${t('village_panel.focus_day', {}, guildId)}`;
    }
  }

  // Night sub-phases
  const subEmoji = getSubPhaseEmoji(game.subPhase);
  switch (game.subPhase) {
    case PHASES.VOLEUR:
      return `${subEmoji} ${t('village_panel.focus_thief', {}, guildId)}`;
    case PHASES.CUPIDON:
      return `${subEmoji} ${t('village_panel.focus_cupid', {}, guildId)}`;
    case PHASES.SALVATEUR:
      return `${subEmoji} ${t('village_panel.focus_salvateur', {}, guildId)}`;
    case PHASES.LOUPS:
      return `${subEmoji} ${t('village_panel.focus_wolves', {}, guildId)}`;
    case PHASES.LOUP_BLANC:
      return `${subEmoji} ${t('village_panel.focus_white_wolf', {}, guildId)}`;
    case PHASES.SORCIERE:
      return `${subEmoji} ${t('village_panel.focus_witch', {}, guildId)}`;
    case PHASES.VOYANTE:
      return `${subEmoji} ${t('village_panel.focus_seer', {}, guildId)}`;
    case PHASES.REVEIL:
      return `🌅 ${t('village_panel.focus_wakeup', {}, guildId)}`;
    default:
      return `⏳ ${t('village_panel.focus_waiting', {}, guildId)}`;
  }
}

// ─── Narrative line ───────────────────────────────────────────────

/**
 * Build the atmospheric narrative line derived ONLY from (phase + subPhase).
 * This replaces ALL channel.send() narrative messages (night falls, day breaks, etc.).
 * Recalculated on every GUI refresh — never creates a new message.
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

// ─── Master Embed Builder ─────────────────────────────────────────

/**
 * Build the master village status embed.
 *
 * Layout:
 * ┌─────────────────────────────────┐
 * │ 🌙/☀️  Panneau Village          │
 * ├─────────────────────────────────┤
 * │ Phase | Sous-phase | Jour       │
 * │ ⏱️ Timer (if active)            │
 * ├─────────────────────────────────┤
 * │ 📣 En cours                     │
 * │ 🐺 Les Loups choisissent…       │
 * ├─────────────────────────────────┤
 * │ 🧑 Vivants | 💀 Morts | 👑 Cap │
 * │ Player lists                    │
 * └─────────────────────────────────┘
 *
 * @param {object} game        Game state (read-only)
 * @param {object|null} timerInfo  { type, remainingMs, totalMs } or null
 * @param {string} guildId
 * @returns {EmbedBuilder}
 */
function buildVillageMasterEmbed(game, timerInfo, guildId) {
  const phase = game.phase;
  const subPhase = game.subPhase;
  const dayCount = game.dayCount || 0;
  const alive = (game.players || []).filter(p => p.alive);
  const dead = (game.players || []).filter(p => !p.alive);
  const lastChange = game._lastPhaseChangeAt || null;

  // ── Animated visuals (change on each embed edit → flipbook effect) ──
  const titleEmoji     = getTransitionEmoji(phase, lastChange);
  const embedColor     = getTransitionColor(phase, lastChange, guildId);
  const phaseEmoji     = getTransitionEmoji(phase, lastChange);
  const subPhaseEmoji  = getAnimatedSubPhaseEmoji(subPhase);

  const embed = new EmbedBuilder()
    .setTitle(`${titleEmoji} ${t('village_panel.title', {}, guildId)}`)
    .setColor(embedColor)
    .setTimestamp();

  // ── Phase / SubPhase / Day ──
  embed.addFields(
    { name: t('gui.phase', {}, guildId), value: `${phaseEmoji} **${translatePhase(phase)}**`, inline: true },
    { name: t('gui.sub_phase', {}, guildId), value: `${subPhaseEmoji} **${translatePhase(subPhase)}**`, inline: true },
    { name: t('gui.day', {}, guildId), value: `📅 **${dayCount}**`, inline: true },
  );

  // ── Timer (animated shimmer bar) ──
  if (timerInfo && timerInfo.remainingMs > 0) {
    const bar = buildAnimatedTimerBar(timerInfo.remainingMs, timerInfo.totalMs, 12);
    const timeStr = formatTimeRemaining(timerInfo.remainingMs);
    embed.addFields({
      name: `⏱️ ${t('gui.timer', {}, guildId)}`,
      value: `**${timeStr}** ${bar}`,
      inline: false,
    });
  }

  // ── � Narration ──
  const narration = buildNarrationLine(game, guildId);
  const focusMsg = buildFocusMessage(game, guildId);
  embed.addFields({
    name: `📜 ${t('village_panel.narration_header', {}, guildId)}`,
    value: `${narration}\n${focusMsg}`,
    inline: false,
  });

  // ── Counts + Captain ──
  const captainText = game.captainId
    ? (() => {
        const cap = (game.players || []).find(p => p.id === game.captainId);
        return cap ? `**${cap.username}**` : '—';
      })()
    : '—';

  embed.addFields(
    { name: `🧑 ${t('gui.alive', {}, guildId)}`, value: `**${alive.length}**`, inline: true },
    { name: `💀 ${t('gui.dead', {}, guildId)}`, value: `**${dead.length}**`, inline: true },
    { name: `👑 ${t('gui.captain', {}, guildId)}`, value: captainText, inline: true },
  );

  // ── Alive player list ──
  if (alive.length > 0) {
    const aliveList = alive.map(p => {
      const cap = p.id === game.captainId ? ' 👑' : '';
      return `✅ ${p.username}${cap}`;
    }).join('\n');
    embed.addFields({
      name: `${t('gui.alive_list', {}, guildId)} (${alive.length})`,
      value: aliveList.slice(0, 1024),
      inline: true,
    });
  }

  // ── Dead player list ──
  if (dead.length > 0) {
    const deadList = dead.map(p => `💀 ~~${p.username}~~`).join('\n');
    embed.addFields({
      name: `${t('gui.dead_list', {}, guildId)} (${dead.length})`,
      value: deadList.slice(0, 1024),
      inline: true,
    });
  }

  // ── Progression ──
  const total = (game.players || []).length;
  if (total > 0 && dead.length > 0) {
    const pct = Math.round((dead.length / total) * 100);
    const bar = buildProgressBar(total - dead.length, total, 12);
    embed.addFields({
      name: t('gui.progression', {}, guildId),
      value: `${bar} ${pct}% ${t('gui.eliminated', {}, guildId)}`,
      inline: false,
    });
  }

  embed.setFooter({ text: t('village_panel.footer', {}, guildId) });
  return embed;
}

module.exports = {
  buildVillageMasterEmbed,
  buildFocusMessage,
  buildNarrationLine,
};
