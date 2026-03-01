/**
 * game/gameStateView.js — Pure read-only embed builders for the game GUI.
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
 * A bright segment (▓) travels across the filled portion of a dark bar (█)
 * on each refresh tick, creating a ripple animation.
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
 * Shows a sunrise/sunset emoji for ~30 s after the phase flip.
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
 * Sunrise = warm orange, Sunset = deep navy.
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

// ─── Status Panel (public, visible to everyone) ──────────────────

/**
 * Build the main game status embed.
 * Shows: phase, subPhase, dayCount, active timer, alive/dead counts, player list.
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

  const embed = new EmbedBuilder()
    .setTitle(`${phaseEmoji} ${t('gui.panel_title', {}, guildId)}`)
    .setColor(getPhaseColor(phase, guildId))
    .setTimestamp();

  // Phase / SubPhase / Day
  embed.addFields(
    { name: t('gui.phase', {}, guildId), value: `${phaseEmoji} **${translatePhase(phase)}**`, inline: true },
    { name: t('gui.sub_phase', {}, guildId), value: `${subPhaseEmoji} **${translatePhase(subPhase)}**`, inline: true },
    { name: t('gui.day', {}, guildId), value: `📅 **${dayCount}**`, inline: true }
  );

  // Timer
  if (timerInfo && timerInfo.remainingMs > 0) {
    const bar = buildProgressBar(timerInfo.remainingMs, timerInfo.totalMs, 12);
    const timeStr = formatTimeRemaining(timerInfo.remainingMs);
    embed.addFields({
      name: `⏱️ ${t('gui.timer', {}, guildId)}`,
      value: `**${timeStr}** ${bar}`,
      inline: false
    });
  }

  // Counts + Captain
  const captainText = game.captainId
    ? (() => { const cap = (game.players || []).find(p => p.id === game.captainId); return cap ? cap.username : '—'; })()
    : '—';

  embed.addFields(
    { name: `🧑 ${t('gui.alive', {}, guildId)}`, value: `**${alive.length}**`, inline: true },
    { name: `💀 ${t('gui.dead', {}, guildId)}`, value: `**${dead.length}**`, inline: true },
    { name: `👑 ${t('gui.captain', {}, guildId)}`, value: captainText, inline: true }
  );

  // Alive player list
  if (alive.length > 0) {
    const aliveList = alive.map(p => {
      const cap = p.id === game.captainId ? ' 👑' : '';
      return `✅ ${p.username}${cap}`;
    }).join('\n');
    embed.addFields({
      name: `${t('gui.alive_list', {}, guildId)} (${alive.length})`,
      value: aliveList.slice(0, 1024),
      inline: true
    });
  }

  // Dead player list
  if (dead.length > 0) {
    const deadList = dead.map(p => `💀 ~~${p.username}~~`).join('\n');
    embed.addFields({
      name: `${t('gui.dead_list', {}, guildId)} (${dead.length})`,
      value: deadList.slice(0, 1024),
      inline: true
    });
  }

  embed.setFooter({ text: t('gui.footer', {}, guildId) });
  return embed;
}

// ─── Player View (private / ephemeral) ───────────────────────────

/**
 * Build the private player view embed.
 * Shows: role, alive/dead, contextual message (your turn / waiting for X).
 * @param {object} game
 * @param {string} playerId
 * @param {object|null} timerInfo
 * @param {string} guildId
 * @returns {EmbedBuilder|null}
 */
function buildPlayerEmbed(game, playerId, timerInfo, guildId) {
  const player = (game.players || []).find(p => p.id === playerId);
  if (!player) return null;

  const embed = new EmbedBuilder()
    .setTitle(`🎭 ${t('gui.player_title', {}, guildId)}`)
    .setColor(player.alive ? 0x57F287 : 0xED4245)
    .setTimestamp();

  // Role + Status
  embed.addFields(
    { name: t('gui.your_role', {}, guildId), value: `**${translateRole(player.role)}**`, inline: true },
    {
      name: t('gui.your_status', {}, guildId),
      value: player.alive
        ? `✅ ${t('gui.alive_status', {}, guildId)}`
        : `💀 ${t('gui.dead_status', {}, guildId)}`,
      inline: true
    }
  );

  // Contextual message — only for alive players in an active game
  if (player.alive && game.phase !== PHASES.ENDED) {
    const activeRoles = SUB_PHASE_ACTIVE_ROLES[game.subPhase];
    let contextMsg;

    if (activeRoles === null) {
      // Village-wide action (deliberation, vote, captain vote)
      contextMsg = `🟢 ${t('gui.your_turn', {}, guildId)}`;
    } else if (activeRoles && activeRoles.includes(player.role)) {
      // This player's role is currently active
      contextMsg = `🟢 ${t('gui.your_turn', {}, guildId)}`;
    } else {
      // Waiting for another role/phase
      const waitingFor = translatePhase(game.subPhase);
      contextMsg = `⏳ ${t('gui.waiting_for', { name: waitingFor }, guildId)}`;
    }

    embed.addFields({
      name: t('gui.context', {}, guildId),
      value: contextMsg,
      inline: false
    });

    // Timer display
    if (timerInfo && timerInfo.remainingMs > 0) {
      embed.addFields({
        name: `⏱️ ${t('gui.timer', {}, guildId)}`,
        value: `**${formatTimeRemaining(timerInfo.remainingMs)}**`,
        inline: true
      });
    }
  }

  // Love indicator
  if (player.inLove) {
    embed.addFields({
      name: '💘',
      value: t('gui.in_love', {}, guildId),
      inline: true
    });
  }

  embed.setFooter({ text: t('gui.player_footer', {}, guildId) });
  return embed;
}

// ─── Spectator View (no roles revealed) ──────────────────────────

/**
 * Build the spectator view embed.
 * Shows: phase, subPhase, dayCount, timer, player list (NO roles), progression.
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
  const total = (game.players || []).length;
  const phaseEmoji = getPhaseEmoji(phase);
  const subPhaseEmoji = getSubPhaseEmoji(subPhase);

  const embed = new EmbedBuilder()
    .setTitle(`${phaseEmoji} ${t('gui.spectator_title', {}, guildId)}`)
    .setColor(getPhaseColor(phase, guildId))
    .setTimestamp();

  // Phase row
  embed.addFields(
    { name: t('gui.phase', {}, guildId), value: `${phaseEmoji} **${translatePhase(phase)}**`, inline: true },
    { name: t('gui.sub_phase', {}, guildId), value: `${subPhaseEmoji} **${translatePhase(subPhase)}**`, inline: true },
    { name: t('gui.day', {}, guildId), value: `📅 **${dayCount}**`, inline: true }
  );

  // Timer
  if (timerInfo && timerInfo.remainingMs > 0) {
    const bar = buildProgressBar(timerInfo.remainingMs, timerInfo.totalMs, 12);
    const timeStr = formatTimeRemaining(timerInfo.remainingMs);
    embed.addFields({
      name: `⏱️ ${t('gui.timer', {}, guildId)}`,
      value: `**${timeStr}** ${bar}`,
      inline: false
    });
  }

  // Player lists (NO ROLES — spectator-safe)
  if (alive.length > 0) {
    const aliveList = alive.map(p => {
      const cap = p.id === game.captainId ? ' 👑' : '';
      return `• ${p.username}${cap}`;
    }).join('\n');
    embed.addFields({
      name: `🧑 ${t('gui.alive', {}, guildId)} (${alive.length})`,
      value: aliveList.slice(0, 1024),
      inline: true
    });
  }

  if (dead.length > 0) {
    const deadList = dead.map(p => `• ~~${p.username}~~`).join('\n');
    embed.addFields({
      name: `💀 ${t('gui.dead', {}, guildId)} (${dead.length})`,
      value: deadList.slice(0, 1024),
      inline: true
    });
  }

  // Progression bar
  if (total > 0) {
    const pct = Math.round((dead.length / total) * 100);
    const bar = buildProgressBar(total - dead.length, total, 12);
    embed.addFields({
      name: t('gui.progression', {}, guildId),
      value: `${bar} ${pct}% ${t('gui.eliminated', {}, guildId)}`,
      inline: false
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
