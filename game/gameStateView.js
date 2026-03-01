/**
 * game/gameStateView.js — Pure read-only embed builders for the game GUI.
 *
 * DESIGN PHILOSOPHY — "Cinematic, not Dashboard":
 * Each embed is a scene, not a spreadsheet.
 * Description-first layout, minimal fields, breathing room.
 *
 * ABSOLUTE CONSTRAINTS:
 * ❌ No buttons or action components
 * ❌ No database writes
 * ❌ No game state modification
 * ❌ No mutation function calls (kill, vote, advanceSubPhase, etc.)
 * ❌ No decision logic
 *
 * All functions are pure: (gameState, timerInfo, guildId) → EmbedBuilder
 * The engine remains the single source of truth.
 */

const { EmbedBuilder } = require('discord.js');
const PHASES = require('./phases');
const ROLES = require('./roles');
const { t, translatePhase, translateRole } = require('../utils/i18n');
const { getColor } = require('../utils/theme');

// ─── Separator ────────────────────────────────────────────────────
const SEP = '━━━━━━━━━━━━━━━━━━━━';

// ─── SubPhase → Active Roles mapping ──────────────────────────────
// null  = all alive players are active (village-wide actions)
// []    = transition phase, nobody acts
const SUB_PHASE_ACTIVE_ROLES = {
  [PHASES.VOLEUR]:          [ROLES.THIEF],
  [PHASES.CUPIDON]:         [ROLES.CUPID],
  [PHASES.SALVATEUR]:       [ROLES.SALVATEUR],
  [PHASES.LOUPS]:           [ROLES.WEREWOLF, ROLES.WHITE_WOLF],
  [PHASES.LOUP_BLANC]:      [ROLES.WHITE_WOLF],
  [PHASES.SORCIERE]:        [ROLES.WITCH],
  [PHASES.VOYANTE]:         [ROLES.SEER],
  [PHASES.REVEIL]:          [],
  [PHASES.VOTE_CAPITAINE]:  null,
  [PHASES.DELIBERATION]:    null,
  [PHASES.VOTE]:            null,
};

// ─── Helpers ──────────────────────────────────────────────────────

function getPhaseEmoji(phase) {
  if (phase === PHASES.NIGHT) return '🌙';
  if (phase === PHASES.DAY) return '☀️';
  if (phase === PHASES.ENDED) return '🏁';
  return '❓';
}

function getSubPhaseEmoji(subPhase) {
  const map = {
    [PHASES.VOLEUR]: '🃏',
    [PHASES.CUPIDON]: '💘',
    [PHASES.SALVATEUR]: '🛡️',
    [PHASES.LOUPS]: '🐺',
    [PHASES.LOUP_BLANC]: '🐺',
    [PHASES.SORCIERE]: '🧪',
    [PHASES.VOYANTE]: '🔮',
    [PHASES.REVEIL]: '🌅',
    [PHASES.VOTE_CAPITAINE]: '👑',
    [PHASES.DELIBERATION]: '💬',
    [PHASES.VOTE]: '🗳️',
  };
  return map[subPhase] || '🔄';
}

function getPhaseColor(phase, guildId) {
  if (phase === PHASES.NIGHT) return 0x2C2F33;
  if (phase === PHASES.DAY) return 0xF9A825;
  if (phase === PHASES.ENDED) return 0xED4245;
  return getColor(guildId, 'blurple') || 0x5865F2;
}

/**
 * Format milliseconds as M:SS string.
 * @param {number} ms
 * @returns {string}
 */
function formatTimeRemaining(ms) {
  if (!ms || ms <= 0) return '0:00';
  const totalSec = Math.ceil(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, '0')}`;
}

/**
 * Build an ASCII progress bar.
 * @param {number} filled  Current value
 * @param {number} total   Maximum value
 * @param {number} length  Bar character count
 * @returns {string}
 */
function buildProgressBar(filled, total, length = 10) {
  if (!total || total <= 0) return '░'.repeat(length);
  const ratio = Math.max(0, Math.min(1, filled / total));
  const filledCount = Math.round(ratio * length);
  const emptyCount = length - filledCount;
  return '▓'.repeat(filledCount) + '░'.repeat(emptyCount);
}

// ─── Animation Helpers ────────────────────────────────────────────
// All animation is server-side via embed edits (no client JS).
// Each refresh tick produces a slightly different visual frame.

/** Duration (ms) during which a transition visual is shown after a phase change. */
const TRANSITION_DURATION_MS = 30_000;

/**
 * Compute an animation frame index from Date.now().
 * Changes every ~5 seconds, cycling 0-5.
 * @param {number} [now] - override for testing
 * @returns {number}
 */
function getAnimationFrame(now) {
  return Math.floor((now ?? Date.now()) / 5000) % 6;
}

/**
 * Build an animated timer progress bar with a "shimmer" effect.
 * @param {number} remainingMs
 * @param {number} totalMs
 * @param {number} length  Bar character count (default 12)
 * @param {number} [now]   Timestamp override for testing
 * @returns {string}
 */
function buildAnimatedTimerBar(remainingMs, totalMs, length = 12, now) {
  if (!totalMs || totalMs <= 0) return '░'.repeat(length);
  const ratio = Math.max(0, Math.min(1, remainingMs / totalMs));
  const filledCount = Math.round(ratio * length);
  const emptyCount = length - filledCount;
  if (filledCount === 0) return '░'.repeat(length);

  const frame = getAnimationFrame(now);
  const shimmerPos = frame % filledCount;

  const chars = [];
  for (let i = 0; i < filledCount; i++) {
    chars.push(i === shimmerPos ? '▓' : '█');
  }
  for (let i = 0; i < emptyCount; i++) {
    chars.push('░');
  }
  return chars.join('');
}

/**
 * Return a pulsing sub-phase emoji for the currently active role.
 * Alternates between the base emoji and base+sparkle on each tick.
 * @param {string} subPhase
 * @param {number} [now]  Timestamp override for testing
 * @returns {string}
 */
function getAnimatedSubPhaseEmoji(subPhase, now) {
  const base = getSubPhaseEmoji(subPhase);
  const frame = getAnimationFrame(now);
  return frame % 2 === 0 ? base : `${base}✨`;
}

/**
 * Phase emoji used during a Night↔Day transition window.
 * @param {string} phase      Current main phase
 * @param {number|null} lastPhaseChangeAt  game._lastPhaseChangeAt timestamp
 * @param {number} [now] Timestamp override
 * @returns {string}
 */
function getTransitionEmoji(phase, lastPhaseChangeAt, now) {
  const _now = now ?? Date.now();
  if (lastPhaseChangeAt && (_now - lastPhaseChangeAt) < TRANSITION_DURATION_MS) {
    if (phase === PHASES.DAY)   return '🌅';
    if (phase === PHASES.NIGHT) return '🌑';
  }
  return getPhaseEmoji(phase);
}

/**
 * Embed colour during a Night↔Day transition window.
 * @param {string} phase
 * @param {number|null} lastPhaseChangeAt
 * @param {string} guildId
 * @param {number} [now]
 * @returns {number}
 */
function getTransitionColor(phase, lastPhaseChangeAt, guildId, now) {
  const _now = now ?? Date.now();
  if (lastPhaseChangeAt && (_now - lastPhaseChangeAt) < TRANSITION_DURATION_MS) {
    if (phase === PHASES.DAY)   return 0xFF8C00; // sunrise orange
    if (phase === PHASES.NIGHT) return 0x1A1A2E; // sunset navy
  }
  return getPhaseColor(phase, guildId);
}

// ─── Status Panel (/status command) ──────────────────────────────
//
// This is the DETAILED view — accessed on demand via /status.
// Shows player lists, counts, captain. Complements the cinematic village panel.

/**
 * Build the game status embed (detailed, on-demand).
 *
 * Layout:
 * ┌─────────────────────────────────┐
 * │  🌙  Game Status — Day 2       │
 * ├─────────────────────────────────┤
 * │  *Night Phase — Wolves*         │   ← Description: phase context
 * │                                 │
 * │  ━━━━━━━━━━━━━━━━━━━━           │
 * │  ⏱ 1:30  █████▓░░░░░           │
 * ├─────────────────────────────────┤
 * │  ✅ Alive (3)    │ 💀 Dead (1) │   ← Fields: player lists
 * │  Alice 👑        │ ~~Charlie~~ │
 * │  Bob             │             │
 * │  Diana           │             │
 * ├─────────────────────────────────┤
 * │  🔄 Auto-updating              │
 * └─────────────────────────────────┘
 *
 * @param {object} game      Game state object (read-only)
 * @param {object|null} timerInfo  { type, remainingMs, totalMs } or null
 * @param {string} guildId
 * @returns {EmbedBuilder}
 */
function buildStatusEmbed(game, timerInfo, guildId) {
  const phase = game.phase;
  const subPhase = game.subPhase;
  const dayCount = game.dayCount || 0;
  const alive = (game.players || []).filter(p => p.alive);
  const dead = (game.players || []).filter(p => !p.alive);
  const phaseEmoji = getPhaseEmoji(phase);
  const subPhaseEmoji = getSubPhaseEmoji(subPhase);

  // ── Title ──
  const title = `${phaseEmoji}  ${t('gui.panel_title', {}, guildId)} ━━━ ${t('gui.day', {}, guildId)} ${dayCount}`;

  // ── Description: phase + sub-phase + timer ──
  const descLines = [
    '',
    `**${phaseEmoji} ${translatePhase(phase)}** — ${subPhaseEmoji} ${translatePhase(subPhase)}`,
  ];

  // Timer
  if (timerInfo && timerInfo.remainingMs > 0) {
    const bar = buildProgressBar(timerInfo.remainingMs, timerInfo.totalMs, 12);
    const timeStr = formatTimeRemaining(timerInfo.remainingMs);
    descLines.push('');
    descLines.push(`⏱ **${timeStr}**  ${bar}`);
  }

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription(descLines.join('\n'))
    .setColor(getPhaseColor(phase, guildId))
    .setTimestamp();

  // ── Captain ──
  const captainText = game.captainId
    ? (() => { const cap = (game.players || []).find(p => p.id === game.captainId); return cap ? cap.username : '—'; })()
    : '—';

  // ── Player lists (fields) ──
  if (alive.length > 0) {
    const aliveList = alive.map(p => {
      const cap = p.id === game.captainId ? ' 👑' : '';
      return `${p.username}${cap}`;
    }).join('\n');
    embed.addFields({
      name: `✅ ${t('gui.alive', {}, guildId)} (${alive.length})`,
      value: aliveList.slice(0, 1024),
      inline: true,
    });
  }

  if (dead.length > 0) {
    const deadList = dead.map(p => `~~${p.username}~~`).join('\n');
    embed.addFields({
      name: `💀 ${t('gui.dead', {}, guildId)} (${dead.length})`,
      value: deadList.slice(0, 1024),
      inline: true,
    });
  }

  // ── Footer ──
  const footerParts = [`👑 ${t('gui.captain', {}, guildId)}: ${captainText}`];
  embed.setFooter({ text: footerParts.join('  ·  ') });
  return embed;
}

// ─── Player View (private / ephemeral) ───────────────────────────
//
// Minimal, dramatic. Role identity + context. No clutter.

/**
 * Build the private player view embed.
 *
 * Layout:
 * ┌─────────────────────────────────┐
 * │  🎭  Your Role                  │
 * ├─────────────────────────────────┤
 * │                                 │
 * │  You are **Werewolf**           │
 * │                                 │
 * │  ━━━━━━━━━━━━━━━━━━━━           │
 * │  🟢 It's your turn to act!     │
 * │  ⏱ 1:00                        │
 * │                                 │
 * │  💘 You are in love 💕          │   (only if applicable)
 * ├─────────────────────────────────┤
 * │  👁️ Private view               │
 * └─────────────────────────────────┘
 *
 * @param {object} game
 * @param {string} playerId
 * @param {object|null} timerInfo
 * @param {string} guildId
 * @returns {EmbedBuilder|null}
 */
function buildPlayerEmbed(game, playerId, timerInfo, guildId) {
  const player = (game.players || []).find(p => p.id === playerId);
  if (!player) return null;

  const statusText = player.alive
    ? `✅ ${t('gui.alive_status', {}, guildId)}`
    : `💀 ${t('gui.dead_status', {}, guildId)}`;

  // ── Description ──
  const descLines = [
    '',
    `${t('gui.your_role', {}, guildId)}: **${translateRole(player.role)}**`,
    statusText,
  ];

  // Contextual message — only for alive players in an active game
  if (player.alive && game.phase !== PHASES.ENDED) {
    const activeRoles = SUB_PHASE_ACTIVE_ROLES[game.subPhase];
    let contextMsg;

    if (activeRoles === null) {
      contextMsg = `🟢 ${t('gui.your_turn', {}, guildId)}`;
    } else if (activeRoles && activeRoles.includes(player.role)) {
      contextMsg = `🟢 ${t('gui.your_turn', {}, guildId)}`;
    } else {
      const waitingFor = translatePhase(game.subPhase);
      contextMsg = `⏳ ${t('gui.waiting_for', { name: waitingFor }, guildId)}`;
    }

    descLines.push('');
    descLines.push(SEP);
    descLines.push(contextMsg);

    // Timer
    if (timerInfo && timerInfo.remainingMs > 0) {
      descLines.push(`⏱ **${formatTimeRemaining(timerInfo.remainingMs)}**`);
    }
  }

  // Love indicator
  if (player.inLove) {
    descLines.push('');
    descLines.push(`💘 ${t('gui.in_love', {}, guildId)}`);
  }

  const embed = new EmbedBuilder()
    .setTitle(`🎭 ${t('gui.player_title', {}, guildId)}`)
    .setDescription(descLines.join('\n'))
    .setColor(player.alive ? 0x57F287 : 0xED4245)
    .setTimestamp();

  embed.setFooter({ text: t('gui.player_footer', {}, guildId) });
  return embed;
}

// ─── Spectator View (no roles revealed) ──────────────────────────
//
// Atmospheric overview: phase + timer + compact player counts.
// No roles. No progression bar. Description-first.

/**
 * Build the spectator view embed.
 *
 * Layout:
 * ┌─────────────────────────────────┐
 * │  🌙  Spectator View             │
 * ├─────────────────────────────────┤
 * │                                 │
 * │  **Night** — 🐺 Wolves         │
 * │                                 │
 * │  ━━━━━━━━━━━━━━━━━━━━           │
 * │  ⏱ 0:45  ▓▓▓▓░░░░░░           │
 * ├─────────────────────────────────┤
 * │  ✅ Alive (3)  │ 💀 Dead (1)   │
 * │  Alice 👑      │ ~~Charlie~~   │
 * │  Bob           │               │
 * │  Diana         │               │
 * ├─────────────────────────────────┤
 * │  👻 Spectator mode              │
 * └─────────────────────────────────┘
 *
 * @param {object} game
 * @param {object|null} timerInfo
 * @param {string} guildId
 * @returns {EmbedBuilder}
 */
function buildSpectatorEmbed(game, timerInfo, guildId) {
  const phase = game.phase;
  const subPhase = game.subPhase;
  const dayCount = game.dayCount || 0;
  const alive = (game.players || []).filter(p => p.alive);
  const dead = (game.players || []).filter(p => !p.alive);
  const phaseEmoji = getPhaseEmoji(phase);
  const subPhaseEmoji = getSubPhaseEmoji(subPhase);

  // ── Title ──
  const title = `${phaseEmoji}  ${t('gui.spectator_title', {}, guildId)}`;

  // ── Description ──
  const descLines = [
    '',
    `**${phaseEmoji} ${translatePhase(phase)}** — ${subPhaseEmoji} ${translatePhase(subPhase)}`,
    `${t('gui.day', {}, guildId)} ${dayCount}`,
  ];

  // Timer
  if (timerInfo && timerInfo.remainingMs > 0) {
    const bar = buildProgressBar(timerInfo.remainingMs, timerInfo.totalMs, 12);
    const timeStr = formatTimeRemaining(timerInfo.remainingMs);
    descLines.push('');
    descLines.push(`⏱ **${timeStr}**  ${bar}`);
  }

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription(descLines.join('\n'))
    .setColor(getPhaseColor(phase, guildId))
    .setTimestamp();

  // ── Player lists (NO ROLES — spectator-safe) ──
  if (alive.length > 0) {
    const aliveList = alive.map(p => {
      const cap = p.id === game.captainId ? ' 👑' : '';
      return `${p.username}${cap}`;
    }).join('\n');
    embed.addFields({
      name: `✅ ${t('gui.alive', {}, guildId)} (${alive.length})`,
      value: aliveList.slice(0, 1024),
      inline: true,
    });
  }

  if (dead.length > 0) {
    const deadList = dead.map(p => `~~${p.username}~~`).join('\n');
    embed.addFields({
      name: `💀 ${t('gui.dead', {}, guildId)} (${dead.length})`,
      value: deadList.slice(0, 1024),
      inline: true,
    });
  }

  embed.setFooter({ text: t('gui.spectator_footer', {}, guildId) });
  return embed;
}

module.exports = {
  buildStatusEmbed,
  buildPlayerEmbed,
  buildSpectatorEmbed,
  getPhaseEmoji,
  getSubPhaseEmoji,
  getPhaseColor,
  formatTimeRemaining,
  buildProgressBar,
  // Animation helpers
  getAnimationFrame,
  buildAnimatedTimerBar,
  getAnimatedSubPhaseEmoji,
  getTransitionEmoji,
  getTransitionColor,
  TRANSITION_DURATION_MS,
  SUB_PHASE_ACTIVE_ROLES,
};
