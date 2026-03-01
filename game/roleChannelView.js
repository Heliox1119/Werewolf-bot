/**
 * game/roleChannelView.js — Persistent, read-only embed panels for role channels.
 *
 * DESIGN PHILOSOPHY — "Cinematic, not Dashboard":
 * Each role panel is a scene — atmospheric, focused, dramatic.
 * Description-first layout. Phase/SubPhase/Day are NOT repeated as fields.
 * Only role-specific data gets a field. Context + timer live in description.
 *
 * ABSOLUTE CONSTRAINTS:
 * ❌ No buttons or action components
 * ❌ No database writes
 * ❌ No game state mutation
 * ❌ No decision logic — the engine is the single source of truth
 *
 * Each builder is pure: (game, timerInfo, guildId, ...extras) → EmbedBuilder
 * Panels are posted ONCE per channel and EDITED on state changes.
 */

const { EmbedBuilder } = require('discord.js');
const PHASES = require('./phases');
const ROLES = require('./roles');
const { t, translatePhase, translateRole } = require('../utils/i18n');
const {
  formatTimeRemaining,
  getPhaseColor,
  getSubPhaseEmoji,
  buildAnimatedTimerBar,
  getAnimatedSubPhaseEmoji,
} = require('./gameStateView');

// ─── Separator ────────────────────────────────────────────────────
const SEP = '━━━━━━━━━━━━━━━━━━━━';

// ─── Role→Channel mapping helpers ──────────────────────────────────

/**
 * Map each role key to its channelId field name on the game object.
 */
const ROLE_CHANNEL_MAP = {
  wolves:     'wolvesChannelId',
  seer:       'seerChannelId',
  witch:      'witchChannelId',
  cupid:      'cupidChannelId',
  salvateur:  'salvateurChannelId',
  white_wolf: 'whiteWolfChannelId',
  thief:      'thiefChannelId',
};

/**
 * Return a mapping of roleKey → channelId for a game,
 * only for channels that actually exist.
 */
function getRoleChannels(game) {
  const result = {};
  for (const [key, field] of Object.entries(ROLE_CHANNEL_MAP)) {
    if (game[field]) result[key] = game[field];
  }
  return result;
}

// ─── Shared helpers ────────────────────────────────────────────────

/**
 * Check whether the given role key is currently the active sub-phase.
 */
function isRoleTurn(game, roleKey) {
  const map = {
    wolves:     [PHASES.LOUPS],
    seer:       [PHASES.VOYANTE],
    witch:      [PHASES.SORCIERE],
    cupid:      [PHASES.CUPIDON],
    salvateur:  [PHASES.SALVATEUR],
    white_wolf: [PHASES.LOUP_BLANC],
    thief:      [PHASES.VOLEUR],
  };
  return (map[roleKey] || []).includes(game.subPhase);
}

/**
 * Build the context string for a role panel.
 * Shows: game ended / day rest / your turn / waiting for.
 */
function buildContextField(game, roleKey, guildId) {
  if (game.phase === PHASES.ENDED) {
    return `🏁 ${t('role_panel.game_ended', {}, guildId)}`;
  }
  if (game.phase === PHASES.DAY) {
    return `☀️ ${t('role_panel.day_rest', {}, guildId)}`;
  }
  if (isRoleTurn(game, roleKey)) {
    return `🟢 ${t('gui.your_turn', {}, guildId)}`;
  }
  const waitingFor = translatePhase(game.subPhase);
  return `⏳ ${t('gui.waiting_for', { name: waitingFor }, guildId)}`;
}

/**
 * Build the description block shared by all role panels.
 * Contains: context line + timer (if active) + optional action hint.
 */
function buildRoleDescription(game, timerInfo, roleKey, guildId, hint) {
  const subEmoji = getAnimatedSubPhaseEmoji(game.subPhase);
  const context = buildContextField(game, roleKey, guildId);
  const lines = [
    '',
    `${subEmoji}  ${context}`,
  ];

  // Timer (only when active)
  if (timerInfo && timerInfo.remainingMs > 0) {
    const bar = buildAnimatedTimerBar(timerInfo.remainingMs, timerInfo.totalMs, 12);
    const timeStr = formatTimeRemaining(timerInfo.remainingMs);
    lines.push(`⏱ **${timeStr}**  ${bar}`);
  }

  // Action hint (only when it's this role's turn)
  if (hint && isRoleTurn(game, roleKey)) {
    lines.push('');
    lines.push(`-# ${hint}`);
  }

  return lines.join('\n');
}

// ─── Wolves Panel ──────────────────────────────────────────────────

function buildWolvesPanel(game, timerInfo, guildId) {
  const wolves = (game.players || []).filter(
    p => (p.role === ROLES.WEREWOLF || p.role === ROLES.WHITE_WOLF) && p.alive
  );
  const wolfList = wolves.length > 0
    ? wolves.map(w => `🐺 **${w.username}**`).join('\n')
    : '—';

  const desc = buildRoleDescription(game, timerInfo, 'wolves', guildId,
    t('role_panel.wolves_action_hint', {}, guildId));

  const embed = new EmbedBuilder()
    .setTitle(`🐺 ${t('role_panel.wolves_title', {}, guildId)}`)
    .setDescription(desc)
    .setColor(getPhaseColor(game.phase, guildId))
    .setTimestamp();

  embed.addFields({
    name: t('role_panel.pack_members', {}, guildId),
    value: wolfList,
    inline: false,
  });

  embed.setFooter({ text: t('role_panel.footer', {}, guildId) });
  return embed;
}

// ─── Seer Panel ────────────────────────────────────────────────────

function buildSeerPanel(game, timerInfo, guildId) {
  const desc = buildRoleDescription(game, timerInfo, 'seer', guildId,
    t('role_panel.seer_action_hint', {}, guildId));

  const embed = new EmbedBuilder()
    .setTitle(`🔮 ${t('role_panel.seer_title', {}, guildId)}`)
    .setDescription(desc)
    .setColor(getPhaseColor(game.phase, guildId))
    .setTimestamp();

  embed.setFooter({ text: t('role_panel.footer', {}, guildId) });
  return embed;
}

// ─── Witch Panel ───────────────────────────────────────────────────

function buildWitchPanel(game, timerInfo, guildId) {
  const potions = game.witchPotions || { life: true, death: true };
  const lifeEmoji = potions.life ? '✅' : '❌';
  const deathEmoji = potions.death ? '✅' : '❌';
  const potionStatus = `${lifeEmoji} ${t('role_panel.potion_life', {}, guildId)}  ·  ${deathEmoji} ${t('role_panel.potion_death', {}, guildId)}`;

  const desc = buildRoleDescription(game, timerInfo, 'witch', guildId,
    t('role_panel.witch_action_hint', {}, guildId));

  const embed = new EmbedBuilder()
    .setTitle(`🧪 ${t('role_panel.witch_title', {}, guildId)}`)
    .setDescription(desc)
    .setColor(getPhaseColor(game.phase, guildId))
    .setTimestamp();

  embed.addFields({
    name: t('role_panel.potions', {}, guildId),
    value: potionStatus,
    inline: false,
  });

  // Show victim info only during witch's turn
  if (isRoleTurn(game, 'witch') && game.nightVictim) {
    const victim = (game.players || []).find(p => p.id === game.nightVictim);
    if (victim) {
      embed.addFields({
        name: t('role_panel.wolf_victim', {}, guildId),
        value: `💀 **${victim.username}**`,
        inline: false,
      });
    }
  }

  embed.setFooter({ text: t('role_panel.footer', {}, guildId) });
  return embed;
}

// ─── Cupid Panel ───────────────────────────────────────────────────

function buildCupidPanel(game, timerInfo, guildId) {
  const lovers = game.lovers || [];
  const loversDone = lovers.length >= 2;

  // Override context when lovers are chosen
  let desc;
  if (loversDone) {
    const subEmoji = getAnimatedSubPhaseEmoji(game.subPhase);
    const lines = [
      '',
      `${subEmoji}  ✅ ${t('role_panel.cupid_done', {}, guildId)}`,
    ];
    desc = lines.join('\n');
  } else {
    desc = buildRoleDescription(game, timerInfo, 'cupid', guildId,
      t('role_panel.cupid_action_hint', {}, guildId));
  }

  const embed = new EmbedBuilder()
    .setTitle(`💘 ${t('role_panel.cupid_title', {}, guildId)}`)
    .setDescription(desc)
    .setColor(getPhaseColor(game.phase, guildId))
    .setTimestamp();

  if (loversDone) {
    const names = lovers.map(id => {
      const p = (game.players || []).find(pl => pl.id === id);
      return p ? `💕 **${p.username}**` : id;
    }).join('  &  ');
    embed.addFields({
      name: t('role_panel.lovers', {}, guildId),
      value: names,
      inline: false,
    });
  }

  embed.setFooter({ text: t('role_panel.footer', {}, guildId) });
  return embed;
}

// ─── Salvateur Panel ───────────────────────────────────────────────

function buildSalvateurPanel(game, timerInfo, guildId) {
  const lastProtected = game.lastProtectedPlayerId
    ? (() => { const p = (game.players || []).find(pl => pl.id === game.lastProtectedPlayerId); return p ? p.username : '—'; })()
    : '—';

  const desc = buildRoleDescription(game, timerInfo, 'salvateur', guildId,
    t('role_panel.salvateur_action_hint', {}, guildId));

  const embed = new EmbedBuilder()
    .setTitle(`🛡️ ${t('role_panel.salvateur_title', {}, guildId)}`)
    .setDescription(desc)
    .setColor(getPhaseColor(game.phase, guildId))
    .setTimestamp();

  embed.addFields({
    name: t('role_panel.last_protected', {}, guildId),
    value: `🚫 **${lastProtected}**`,
    inline: false,
  });

  embed.setFooter({ text: t('role_panel.footer', {}, guildId) });
  return embed;
}

// ─── White Wolf Panel ──────────────────────────────────────────────

function buildWhiteWolfPanel(game, timerInfo, guildId) {
  const isOddNight = (game.dayCount || 0) % 2 === 1;

  const desc = buildRoleDescription(game, timerInfo, 'white_wolf', guildId,
    t('role_panel.white_wolf_action_hint', {}, guildId));

  const embed = new EmbedBuilder()
    .setTitle(`🐺🔪 ${t('role_panel.white_wolf_title', {}, guildId)}`)
    .setDescription(desc)
    .setColor(getPhaseColor(game.phase, guildId))
    .setTimestamp();

  const nightInfo = isOddNight
    ? `🔴 ${t('role_panel.white_wolf_hunt_night', {}, guildId)}`
    : `⚪ ${t('role_panel.white_wolf_rest_night', {}, guildId)}`;

  embed.addFields({
    name: t('role_panel.night_type', {}, guildId),
    value: nightInfo,
    inline: false,
  });

  embed.setFooter({ text: t('role_panel.footer', {}, guildId) });
  return embed;
}

// ─── Thief Panel ───────────────────────────────────────────────────

function buildThiefPanel(game, timerInfo, guildId) {
  const cards = game.thiefExtraRoles || [];
  const hasCards = cards.length === 2;
  const thiefPhaseOver = game.subPhase !== PHASES.VOLEUR;

  // Override context when thief is done
  let desc;
  if (thiefPhaseOver && game.phase === PHASES.NIGHT) {
    const subEmoji = getAnimatedSubPhaseEmoji(game.subPhase);
    const lines = [
      '',
      `${subEmoji}  ✅ ${t('role_panel.thief_done', {}, guildId)}`,
    ];
    desc = lines.join('\n');
  } else {
    desc = buildRoleDescription(game, timerInfo, 'thief', guildId,
      (hasCards ? t('role_panel.thief_action_hint', {}, guildId) : null));
  }

  const embed = new EmbedBuilder()
    .setTitle(`🎭 ${t('role_panel.thief_title', {}, guildId)}`)
    .setDescription(desc)
    .setColor(getPhaseColor(game.phase, guildId))
    .setTimestamp();

  if (hasCards) {
    const card1 = translateRole(cards[0]);
    const card2 = translateRole(cards[1]);
    embed.addFields({
      name: t('role_panel.thief_cards', {}, guildId),
      value: `🃏 **${card1}**  ·  🃏 **${card2}**`,
      inline: false,
    });

    const bothWolves = (cards[0] === ROLES.WEREWOLF || cards[0] === ROLES.WHITE_WOLF) &&
                       (cards[1] === ROLES.WEREWOLF || cards[1] === ROLES.WHITE_WOLF);
    if (bothWolves) {
      embed.addFields({
        name: '⚠️',
        value: t('role_panel.thief_must_take', {}, guildId),
        inline: false,
      });
    }
  }

  embed.setFooter({ text: t('role_panel.footer', {}, guildId) });
  return embed;
}

// ─── Panel builder dispatch ────────────────────────────────────────

const PANEL_BUILDERS = {
  wolves:     buildWolvesPanel,
  seer:       buildSeerPanel,
  witch:      buildWitchPanel,
  cupid:      buildCupidPanel,
  salvateur:  buildSalvateurPanel,
  white_wolf: buildWhiteWolfPanel,
  thief:      buildThiefPanel,
};

/**
 * Build the embed for a given role key.
 * @param {string} roleKey  One of: wolves, seer, witch, cupid, salvateur, white_wolf, thief
 * @param {object} game     Game state (read-only)
 * @param {object|null} timerInfo
 * @param {string} guildId
 * @returns {EmbedBuilder|null}
 */
function buildRolePanel(roleKey, game, timerInfo, guildId) {
  const builder = PANEL_BUILDERS[roleKey];
  if (!builder) return null;
  return builder(game, timerInfo, guildId);
}

module.exports = {
  ROLE_CHANNEL_MAP,
  getRoleChannels,
  buildRolePanel,
  buildWolvesPanel,
  buildSeerPanel,
  buildWitchPanel,
  buildCupidPanel,
  buildSalvateurPanel,
  buildWhiteWolfPanel,
  buildThiefPanel,
  PANEL_BUILDERS,
  // Re-export for testing
  isRoleTurn,
  buildContextField,
};
