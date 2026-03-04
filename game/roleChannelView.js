/**
 * game/roleChannelView.js — Persistent, read-only embed panels for role channels.
 *
 * DESIGN PHILOSOPHY — "Cinematic, not Dashboard":
 * Each role panel is a scene — atmospheric, focused, dramatic.
 * Description-first layout. Phase/SubPhase/Day are NOT repeated as fields.
 * Only role-specific data gets a field. Context + timer live in description.
 *
 * ABSOLUTE CONSTRAINTS:
 * ❌ No database writes
 * ❌ No game state mutation
 * ❌ No decision logic — the engine is the single source of truth
 *
 * Each builder is pure: (game, timerInfo, guildId, ...extras) → EmbedBuilder
 * Panels are posted ONCE per channel and EDITED on state changes.
 */

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const PHASES = require('./phases');
const ROLES = require('./roles');
const BalanceMode = require('./balanceMode');
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

// ─── Role key → image filename (thumbnail) ────────────────────────

const ROLE_KEY_IMAGES = {
  wolves:     'loupSimple.webp',
  seer:       'voyante.webp',
  witch:      'sorciere.png',
  cupid:      'cupidon.webp',
  salvateur:  'salvateur.webp',
  white_wolf: 'loupBlanc.webp',
  thief:      'voleur.webp',
};

/**
 * Get the image filename for a role key (used as thumbnail).
 * @param {string} roleKey
 * @returns {string|null}
 */
function getRoleKeyImage(roleKey) {
  return ROLE_KEY_IMAGES[roleKey] || null;
}

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
  const ROLES_L = require('./roles');
  const { getWolfMajority } = require('./wolfVoteEngine');

  const wolves = (game.players || []).filter(
    p => (p.role === ROLES_L.WEREWOLF || p.role === ROLES_L.WHITE_WOLF) && p.alive
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

  // ── Dynamic vote tracking embed section ──
  const voteState = game.wolvesVoteState;
  if (voteState && isRoleTurn(game, 'wolves') && !voteState.resolved) {
    const totalWolves = wolves.length;
    const majorityNeeded = getWolfMajority(totalWolves);

    const voteLines = [];
    for (const wolf of wolves) {
      const targetId = voteState.votes instanceof Map
        ? voteState.votes.get(wolf.id)
        : (voteState.votes && voteState.votes[wolf.id]);
      if (targetId) {
        const targetPlayer = (game.players || []).find(p => p.id === targetId);
        const targetName = targetPlayer ? targetPlayer.username : targetId;
        voteLines.push(`🐺 ${wolf.username} → **${targetName}**`);
      } else {
        voteLines.push(`⏳ ${wolf.username} — ${t('role_panel.wolves_vote_waiting', {}, guildId)}`);
      }
    }

    const voteDisplay = voteLines.join('\n') || '—';
    embed.addFields({
      name: `${t('role_panel.wolves_vote_title', {}, guildId)} — Round ${voteState.round}`,
      value: `${voteDisplay}\n\n${t('role_panel.wolves_majority_label', {}, guildId)} : **${majorityNeeded}/${totalWolves}**`,
      inline: false,
    });
  }

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
  const isClassic = game.balanceMode === BalanceMode.CLASSIC;
  const hasCards = isClassic ? cards.length >= 1 : cards.length === 2;
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
    const hintKey = isClassic ? 'role_panel.thief_action_hint_classic' : 'role_panel.thief_action_hint';
    desc = buildRoleDescription(game, timerInfo, 'thief', guildId,
      (hasCards ? t(hintKey, {}, guildId) : null));
  }

  const embed = new EmbedBuilder()
    .setTitle(`🎭 ${t('role_panel.thief_title', {}, guildId)}`)
    .setDescription(desc)
    .setColor(getPhaseColor(game.phase, guildId))
    .setTimestamp();

  if (hasCards) {
    if (isClassic) {
      // CLASSIC mode: list all available roles
      const roleList = cards.map(r => `🃏 **${translateRole(r)}**`).join('\n');
      embed.addFields({
        name: t('role_panel.thief_cards_classic', {}, guildId),
        value: roleList,
        inline: false,
      });
    } else {
      // DYNAMIC mode: exactly 2 cards
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

    // All-wolves warning (works for both modes)
    const isWolf = (r) => r === ROLES.WEREWOLF || r === ROLES.WHITE_WOLF;
    const allWolves = cards.every(isWolf);
    if (allWolves && isClassic) {
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
  const embed = builder(game, timerInfo, guildId);
  // ── Thumbnail: role image in top-right corner ──
  const imageFile = getRoleKeyImage(roleKey);
  if (imageFile) {
    embed.setThumbnail(`attachment://${imageFile}`);
  }
  return embed;
}

// ─── Thief Buttons (Action Row) ────────────────────────────────────

/**
 * Build the ActionRow with thief action buttons/select menu.
 * Returns an array of components (0–2 ActionRows).
 *
 * DYNAMIC mode (exactly 2 cards):
 *   Single row with 2 card buttons + skip button.
 *
 * CLASSIC mode (1+ cards):
 *   Row 1: StringSelectMenu with all available roles.
 *   Row 2: Skip button.
 *
 * Components are shown ONLY when:
 *   - It is NIGHT phase
 *   - subPhase === VOLEUR
 *   - There is at least 1 thief card available
 *
 * The "keep role" button is disabled when ALL cards are wolves.
 *
 * @param {object} game   Game state (read-only)
 * @param {string} guildId
 * @returns {ActionRowBuilder[]}  Empty array when no buttons should be shown
 */
function buildThiefButtons(game, guildId) {
  if (game.phase !== PHASES.NIGHT) return [];
  if (game.subPhase !== PHASES.VOLEUR) return [];

  const cards = game.thiefExtraRoles || [];
  if (cards.length < 1) return [];

  const isWolf = (r) => r === ROLES.WEREWOLF || r === ROLES.WHITE_WOLF;
  const allWolves = cards.every(isWolf);
  const isClassic = game.balanceMode === BalanceMode.CLASSIC;

  if (isClassic) {
    // CLASSIC mode: select menu + skip button in separate rows
    const menu = new StringSelectMenuBuilder()
      .setCustomId('thief_steal_select')
      .setPlaceholder(t('role_panel.thief_select_ph', {}, guildId))
      .addOptions(cards.map(role => ({
        label: translateRole(role),
        value: role,
        emoji: isWolf(role) ? '🐺' : '🃏',
      })));

    const selectRow = new ActionRowBuilder().addComponents(menu);
    const skipRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('thief_skip')
        .setLabel(`⏭️ ${t('role_panel.thief_keep_btn', {}, guildId)}`)
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(allWolves),
    );
    return [selectRow, skipRow];
  }

  // DYNAMIC mode: exactly 2 card buttons + skip
  if (cards.length !== 2) return [];

  const card1Label = translateRole(cards[0]);
  const card2Label = translateRole(cards[1]);
  const bothWolves = isWolf(cards[0]) && isWolf(cards[1]);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('thief_steal:1')
      .setLabel(`🃏 ${card1Label}`)
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('thief_steal:2')
      .setLabel(`🃏 ${card2Label}`)
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('thief_skip')
      .setLabel(`⏭️ ${t('role_panel.thief_keep_btn', {}, guildId)}`)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(bothWolves),
  );

  return [row];
}

// ─── Wolves Components (Select Menu) ───────────────────────────────

/**
 * Build the ActionRow with a player select menu for wolves.
 * Shown ONLY when it is NIGHT + subPhase === LOUPS.
 * Lists alive non-wolf players.
 */
function buildWolvesComponents(game, guildId) {
  if (game.phase !== PHASES.NIGHT) return [];
  if (game.subPhase !== PHASES.LOUPS) return [];
  // Don't show select menu if vote is already resolved
  if (game.wolvesVoteState && game.wolvesVoteState.resolved) return [];

  const targets = (game.players || []).filter(
    p => p.alive && p.role !== ROLES.WEREWOLF && p.role !== ROLES.WHITE_WOLF
  );
  if (targets.length === 0) return [];

  const menu = new StringSelectMenuBuilder()
    .setCustomId('wolves_kill')
    .setPlaceholder(t('role_panel.wolves_select_ph', {}, guildId))
    .addOptions(targets.map(p => ({
      label: p.username,
      value: p.id,
    })));

  return [new ActionRowBuilder().addComponents(menu)];
}

// ─── White Wolf Components (Select Menu) ───────────────────────────

/**
 * Build the ActionRow with a player select menu for the White Wolf.
 * Shown ONLY when it is NIGHT + subPhase === LOUP_BLANC.
 * Lists alive regular werewolves (not self).
 */
function buildWhiteWolfComponents(game, guildId) {
  if (game.phase !== PHASES.NIGHT) return [];
  if (game.subPhase !== PHASES.LOUP_BLANC) return [];

  const whiteWolf = (game.players || []).find(
    p => p.role === ROLES.WHITE_WOLF && p.alive
  );
  const targets = (game.players || []).filter(
    p => p.alive && p.role === ROLES.WEREWOLF && (!whiteWolf || p.id !== whiteWolf.id)
  );

  const rows = [];

  if (targets.length > 0) {
    const menu = new StringSelectMenuBuilder()
      .setCustomId('ww_kill')
      .setPlaceholder(t('role_panel.ww_select_ph', {}, guildId))
      .addOptions(targets.map(p => ({
        label: p.username,
        value: p.id,
      })));
    rows.push(new ActionRowBuilder().addComponents(menu));
  }

  // Skip button for White Wolf
  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('ww_skip')
      .setLabel(`⏭️ ${t('role_panel.skip_btn', {}, guildId)}`)
      .setStyle(ButtonStyle.Secondary)
  ));

  return rows;
}

// ─── Seer Components (Select Menu + Skip) ──────────────────────────

/**
 * Build the ActionRows for the Seer.
 * Row 1: Select menu with all alive players.
 * Row 2: Skip button.
 */
function buildSeerComponents(game, guildId) {
  if (game.phase !== PHASES.NIGHT) return [];
  if (game.subPhase !== PHASES.VOYANTE) return [];

  const targets = (game.players || []).filter(p => p.alive);
  if (targets.length === 0) return [];

  const menu = new StringSelectMenuBuilder()
    .setCustomId('seer_see')
    .setPlaceholder(t('role_panel.seer_select_ph', {}, guildId))
    .addOptions(targets.map(p => ({
      label: p.username,
      value: p.id,
    })));

  const skipRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('seer_skip')
      .setLabel(`⏭️ ${t('role_panel.skip_btn', {}, guildId)}`)
      .setStyle(ButtonStyle.Secondary)
  );

  return [new ActionRowBuilder().addComponents(menu), skipRow];
}

// ─── Salvateur Components (Select Menu + Skip) ─────────────────────

/**
 * Build the ActionRows for the Salvateur.
 * Row 1: Select menu with alive players (exclude self + last-protected).
 * Row 2: Skip button.
 */
function buildSalvateurComponents(game, guildId) {
  if (game.phase !== PHASES.NIGHT) return [];
  if (game.subPhase !== PHASES.SALVATEUR) return [];

  const salvateurPlayer = (game.players || []).find(
    p => p.role === ROLES.SALVATEUR && p.alive
  );
  const targets = (game.players || []).filter(p => {
    if (!p.alive) return false;
    if (salvateurPlayer && p.id === salvateurPlayer.id) return false;
    if (game.lastProtectedPlayerId && p.id === game.lastProtectedPlayerId) return false;
    return true;
  });
  if (targets.length === 0) return [];

  const menu = new StringSelectMenuBuilder()
    .setCustomId('salvateur_protect')
    .setPlaceholder(t('role_panel.salvateur_select_ph', {}, guildId))
    .addOptions(targets.map(p => ({
      label: p.username,
      value: p.id,
    })));

  const skipRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('salvateur_skip')
      .setLabel(`⏭️ ${t('role_panel.skip_btn', {}, guildId)}`)
      .setStyle(ButtonStyle.Secondary)
  );

  return [new ActionRowBuilder().addComponents(menu), skipRow];
}

// ─── Witch Components (Buttons + Death Select) ─────────────────────

/**
 * Build the ActionRows for the Witch.
 * Row 1: 💚 Save (disabled if no life potion / no victim) + ⏭️ Skip
 * Row 2: Death target select (hidden if no death potion).
 */
function buildWitchComponents(game, guildId) {
  if (game.phase !== PHASES.NIGHT) return [];
  if (game.subPhase !== PHASES.SORCIERE) return [];

  const potions = game.witchPotions || { life: true, death: true };
  const canSave = potions.life && !!game.nightVictim;

  const btnRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('witch_life')
      .setLabel(`💚 ${t('role_panel.witch_save_btn', {}, guildId)}`)
      .setStyle(ButtonStyle.Success)
      .setDisabled(!canSave),
    new ButtonBuilder()
      .setCustomId('witch_skip')
      .setLabel(`⏭️ ${t('role_panel.skip_btn', {}, guildId)}`)
      .setStyle(ButtonStyle.Secondary),
  );

  const rows = [btnRow];

  if (potions.death) {
    const witchPlayer = (game.players || []).find(
      p => p.role === ROLES.WITCH && p.alive
    );
    const targets = (game.players || []).filter(
      p => p.alive && (!witchPlayer || p.id !== witchPlayer.id)
    );
    if (targets.length > 0) {
      const menu = new StringSelectMenuBuilder()
        .setCustomId('witch_death')
        .setPlaceholder(`💀 ${t('role_panel.witch_death_ph', {}, guildId)}`)
        .addOptions(targets.map(p => ({
          label: p.username,
          value: p.id,
        })));
      rows.push(new ActionRowBuilder().addComponents(menu));
    }
  }

  return rows;
}

// ─── Cupid Components (Multi-Select + Skip) ────────────────────────

/**
 * Build the ActionRows for Cupid.
 * Row 1: Multi-select menu (pick exactly 2 players).
 * Row 2: Skip button.
 */
function buildCupidComponents(game, guildId) {
  if (game.phase !== PHASES.NIGHT) return [];
  if (game.subPhase !== PHASES.CUPIDON) return [];
  if (game.lovers && game.lovers.length > 0) return [];

  const targets = (game.players || []).filter(p => p.alive);
  if (targets.length < 2) return [];

  const menu = new StringSelectMenuBuilder()
    .setCustomId('cupid_love')
    .setPlaceholder(t('role_panel.cupid_select_ph', {}, guildId))
    .addOptions(targets.map(p => ({
      label: p.username,
      value: p.id,
    })));

  // Discord select menu minValues/maxValues
  menu.setMinValues(2);
  menu.setMaxValues(2);

  const skipRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('cupid_skip')
      .setLabel(`⏭️ ${t('role_panel.skip_btn', {}, guildId)}`)
      .setStyle(ButtonStyle.Secondary)
  );

  return [new ActionRowBuilder().addComponents(menu), skipRow];
}

/**
 * Build the component rows for a given role key.
 * Returns an empty array for roles that have no interactive buttons (yet).
 *
 * @param {string} roleKey
 * @param {object} game
 * @param {string} guildId
 * @returns {ActionRowBuilder[]}
 */
function buildRolePanelComponents(roleKey, game, guildId) {
  if (roleKey === 'thief')      return buildThiefButtons(game, guildId);
  if (roleKey === 'wolves')     return buildWolvesComponents(game, guildId);
  if (roleKey === 'white_wolf') return buildWhiteWolfComponents(game, guildId);
  if (roleKey === 'seer')       return buildSeerComponents(game, guildId);
  if (roleKey === 'salvateur')  return buildSalvateurComponents(game, guildId);
  if (roleKey === 'witch')      return buildWitchComponents(game, guildId);
  if (roleKey === 'cupid')      return buildCupidComponents(game, guildId);
  return [];
}

module.exports = {
  ROLE_CHANNEL_MAP,
  ROLE_KEY_IMAGES,
  getRoleChannels,
  getRoleKeyImage,
  buildRolePanel,
  buildRolePanelComponents,
  buildThiefButtons,
  buildWolvesComponents,
  buildWhiteWolfComponents,
  buildSeerComponents,
  buildSalvateurComponents,
  buildWitchComponents,
  buildCupidComponents,
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
