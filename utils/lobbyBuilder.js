const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require('discord.js');
const path = require('path');
const { t, translateRole, tips: getTips } = require('./i18n');
const { getLobbyColor: themeLobbyColor } = require('./theme');
const ConfigManager = require('./config');
const BalanceMode = require('../game/balanceMode');
const { generateRoles } = require('../game/roleGeneration');
const ROLES = require('../game/roles');

// ─── Constants ───────────────────────────────────────────────────────────────
const LOBBY_IMAGE = path.join(__dirname, '..', 'img', 'LG.jpg');
const SEPARATOR = '─────────────────────────────';

const ROLE_LIST = [
  { emoji: '🐺', nameKey: 'werewolf',     count: 1, minPlayers: 5, team: 'evil'    },
  { emoji: '🐺', nameKey: 'werewolf',     count: 2, minPlayers: 6, team: 'evil'    },
  { emoji: '🔮', nameKey: 'seer',         count: 1, minPlayers: 5, team: 'village'  },
  { emoji: '🧪', nameKey: 'witch',         count: 1, minPlayers: 5, team: 'village'  },
  { emoji: '🏹', nameKey: 'hunter',        count: 1, minPlayers: 5, team: 'village'  },
  { emoji: '👁️', nameKey: 'petite_fille',  count: 1, minPlayers: 6, team: 'village'  },
  { emoji: '💘', nameKey: 'cupid',         count: 1, minPlayers: 7, team: 'neutral' },
  { emoji: '🎭', nameKey: 'thief',         count: 1, minPlayers: 8, team: 'village'  },
  { emoji: '🛡️', nameKey: 'salvateur',     count: 1, minPlayers: 9, team: 'village'  },
  { emoji: '🧓', nameKey: 'ancien',        count: 1, minPlayers: 10, team: 'village'  },
  { emoji: '🐺', nameKey: 'white_wolf',    count: 1, minPlayers: 11, team: 'evil'    },
  { emoji: '🤡', nameKey: 'idiot',         count: 1, minPlayers: 12, team: 'village' },
  { emoji: '🧑‍🌾', nameKey: 'villager',     count: null, minPlayers: 5, team: 'village' }
];

// Tips are now loaded from locale files via i18n

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Build a styled progress bar with segments
 */
function buildProgressBar(current, min, max) {
  const total = 16;
  const filled = Math.min(Math.round((current / max) * total), total);
  const bar = '▰'.repeat(filled) + '▱'.repeat(total - filled);

  let status;
  if (current >= max) {
    status = t('lobby.status_complete');
  } else if (current >= min) {
    status = t('lobby.status_ready');
  } else {
    status = t('lobby.status_remaining', { n: min - current });
  }

  return `\`${bar}\`  **${current}** / **${max}**  ·  ${status}`;
}

/**
 * Build player slots with visual grid
 */
function buildPlayerList(players, max) {
  if (players.length === 0) {
    return t('lobby.no_players');
  }

  const MAX_SHOW = 8;
  const display = players.slice(0, MAX_SHOW);
  const lines = display.map((p, i) => {
    const icon = i === 0 ? '👑' : '▸';
    const tag = i === 0 ? ` ${t('lobby.host_tag')}` : '';
    return `${icon} **${p.username}**${tag}`;
  });

  if (players.length > MAX_SHOW) {
    lines.push(`*+${players.length - MAX_SHOW} …*`);
  }

  return lines.join('\n');
}

// ─── Role → emoji mapping (for CLASSIC preview) ─────────────────────────────
const ROLE_EMOJI = Object.freeze({
  [ROLES.WEREWOLF]:     '🐺',
  [ROLES.WHITE_WOLF]:   '🐺',
  [ROLES.VILLAGER]:     '🧑‍🌾',
  [ROLES.SEER]:         '🔮',
  [ROLES.WITCH]:        '🧪',
  [ROLES.HUNTER]:       '🏹',
  [ROLES.PETITE_FILLE]: '👁️',
  [ROLES.CUPID]:        '💘',
  [ROLES.THIEF]:        '🎭',
  [ROLES.SALVATEUR]:    '🛡️',
  [ROLES.ANCIEN]:       '🧓',
  [ROLES.IDIOT]:        '🤡',
});

// ─── Role → i18n nameKey mapping ────────────────────────────────────────────
const ROLE_NAME_KEY = Object.freeze({
  [ROLES.WEREWOLF]:     'werewolf',
  [ROLES.WHITE_WOLF]:   'white_wolf',
  [ROLES.VILLAGER]:     'villager',
  [ROLES.SEER]:         'seer',
  [ROLES.WITCH]:        'witch',
  [ROLES.HUNTER]:       'hunter',
  [ROLES.PETITE_FILLE]: 'petite_fille',
  [ROLES.CUPID]:        'cupid',
  [ROLES.THIEF]:        'thief',
  [ROLES.SALVATEUR]:    'salvateur',
  [ROLES.ANCIEN]:       'ancien',
  [ROLES.IDIOT]:        'idiot',
});

// ─── Role → team mapping ────────────────────────────────────────────────────
const ROLE_TEAM = Object.freeze({
  [ROLES.WEREWOLF]:     'evil',
  [ROLES.WHITE_WOLF]:   'evil',
  [ROLES.VILLAGER]:     'village',
  [ROLES.SEER]:         'village',
  [ROLES.WITCH]:        'village',
  [ROLES.HUNTER]:       'village',
  [ROLES.PETITE_FILLE]: 'village',
  [ROLES.CUPID]:        'neutral',
  [ROLES.THIEF]:        'village',
  [ROLES.SALVATEUR]:    'village',
  [ROLES.ANCIEN]:       'village',
  [ROLES.IDIOT]:        'village',
});

/**
 * Build roles grid with team grouping — DYNAMIC mode (original static ROLE_LIST)
 */
function buildDynamicRolesPreview(playerCount) {
  const active = ROLE_LIST.filter(r => r.minPlayers <= playerCount || r.count === null);

  // Calculate wolf count: consolidate regular werewolf entries (highest applicable)
  const wolfEntries = active.filter(r => r.team === 'evil' && r.nameKey === 'werewolf');
  const wolfCount = wolfEntries.length > 0 ? wolfEntries[wolfEntries.length - 1].count : 0;

  // White Wolf is a separate evil role
  const hasWhiteWolf = active.some(r => r.nameKey === 'white_wolf');
  const totalEvilCount = wolfCount + (hasWhiteWolf ? 1 : 0);

  // Calculate villager count (using total evil count)
  const specialCount = active
    .filter(x => x.count !== null && x.team !== 'evil')
    .reduce((sum, x) => sum + x.count, 0) + totalEvilCount;
  const villagerCount = Math.max(0, playerCount - specialCount);

  const lines = [];

  // Evil team
  if (totalEvilCount > 0) {
    const evilParts = [];
    if (wolfCount > 0) evilParts.push(`🐺 ${t('role.werewolf')} ×${wolfCount}`);
    if (hasWhiteWolf) evilParts.push(`🐺 ${t('role.white_wolf')}`);
    lines.push(`${t('lobby.team_evil')} ─ ${evilParts.join('  ')}`);
  }

  // Village team (exclude evil entries and villager filler)
  const village = active.filter(r => r.team === 'village' && r.count !== null);
  if (village.length > 0) {
    const villageLine = village.map(r => `${r.emoji} ${t(`role.${r.nameKey}`)}`).join('  ');
    const villagerSuffix = villagerCount > 0 ? `  🧑‍🌾 ${t('role.villager')} ×${villagerCount}` : '';
    lines.push(`${t('lobby.team_village')} ─ ${villageLine}${villagerSuffix}`);
  }

  // Neutral
  const neutral = active.filter(r => r.team === 'neutral');
  if (neutral.length > 0) {
    const neutralLine = neutral.map(r => `${r.emoji} ${t(`role.${r.nameKey}`)}`).join('  ');
    lines.push(`${t('lobby.team_neutral')} ─ ${neutralLine}`);
  }

  const uniqueRoleCount = active.filter(r => r.count !== null && r.team !== 'evil').length + (wolfCount > 0 ? 1 : 0) + (hasWhiteWolf ? 1 : 0) + (villagerCount > 0 ? 1 : 0);
  lines.push(`\n${t('lobby.roles_count', { n: uniqueRoleCount, m: playerCount })}`);

  return lines.join('\n');
}

/**
 * Build roles preview from the actual generateRoles() pool — CLASSIC mode.
 * Shows the real composition that would be generated for this player count + seed.
 */
function buildPoolBasedPreview(playerCount, balanceMode, rotationSeed) {
  const pool = generateRoles(playerCount, balanceMode, { rotationSeed: rotationSeed || 0 });

  // Count occurrences of each role
  const counts = new Map();
  for (const role of pool) {
    counts.set(role, (counts.get(role) || 0) + 1);
  }

  // Remaining slots are villagers
  const totalSpecials = pool.length;
  const villagerCount = Math.max(0, playerCount - totalSpecials);
  if (villagerCount > 0) counts.set(ROLES.VILLAGER, villagerCount);

  const lines = [];

  // Evil team
  const evilRoles = [...counts.entries()].filter(([r]) => ROLE_TEAM[r] === 'evil');
  if (evilRoles.length > 0) {
    const evilParts = evilRoles.map(([r, c]) => {
      const emoji = ROLE_EMOJI[r] || '❓';
      const name = t(`role.${ROLE_NAME_KEY[r]}`);
      return c > 1 ? `${emoji} ${name} ×${c}` : `${emoji} ${name}`;
    });
    lines.push(`${t('lobby.team_evil')} ─ ${evilParts.join('  ')}`);
  }

  // Village team
  const villageRoles = [...counts.entries()].filter(([r]) => ROLE_TEAM[r] === 'village');
  if (villageRoles.length > 0) {
    const villageParts = villageRoles.map(([r, c]) => {
      const emoji = ROLE_EMOJI[r] || '❓';
      const name = t(`role.${ROLE_NAME_KEY[r]}`);
      return c > 1 ? `${emoji} ${name} ×${c}` : `${emoji} ${name}`;
    });
    lines.push(`${t('lobby.team_village')} ─ ${villageParts.join('  ')}`);
  }

  // Neutral team
  const neutralRoles = [...counts.entries()].filter(([r]) => ROLE_TEAM[r] === 'neutral');
  if (neutralRoles.length > 0) {
    const neutralParts = neutralRoles.map(([r, c]) => {
      const emoji = ROLE_EMOJI[r] || '❓';
      const name = t(`role.${ROLE_NAME_KEY[r]}`);
      return c > 1 ? `${emoji} ${name} ×${c}` : `${emoji} ${name}`;
    });
    lines.push(`${t('lobby.team_neutral')} ─ ${neutralParts.join('  ')}`);
  }

  const uniqueRoles = counts.size;
  lines.push(`\n${t('lobby.roles_count', { n: uniqueRoles, m: playerCount })}`);

  return lines.join('\n');
}

/**
 * Build roles preview — dispatches to the correct renderer based on balance mode.
 *
 * @param {number} playerCount
 * @param {string} [balanceMode='DYNAMIC']
 * @param {number} [rotationSeed=0] - Used for CLASSIC deterministic preview
 * @returns {string}
 */
function buildRolesPreview(playerCount, balanceMode, rotationSeed) {
  if (balanceMode === BalanceMode.CLASSIC) {
    return buildPoolBasedPreview(playerCount, BalanceMode.CLASSIC, rotationSeed);
  }
  return buildDynamicRolesPreview(playerCount);
}

/**
 * Get a rotating tip based on time
 */
function getRandomTip() {
  const tipList = getTips();
  return tipList[Math.floor(Math.random() * tipList.length)];
}

// ─── Main Builder ────────────────────────────────────────────────────────────

/**
 * Build the lobby embed and action rows
 */
function buildLobbyEmbed(game, hostId) {
  const min = game.rules?.minPlayers ?? 5;
  const max = game.rules?.maxPlayers ?? 10;
  const playerCount = game.players.length;
  const canStart = playerCount >= min;
  const isFull = playerCount >= max;

  // Balance mode (computed early for title suffix)
  const currentBalanceMode = game.balanceMode || BalanceMode.DYNAMIC;
  const isDynamic = currentBalanceMode === BalanceMode.DYNAMIC;
  const balanceModeIcon = isDynamic ? '🎭' : '⚖️';

  // Title changes with state
  let title, description;
  if (isFull) {
    title = `${t('lobby.title_full')}  ${balanceModeIcon}`;
    description = t('lobby.desc_full');
  } else if (canStart) {
    title = `${t('lobby.title_ready')}  ${balanceModeIcon}`;
    description = t('lobby.desc_ready');
  } else {
    title = `${t('lobby.title_recruiting')}  ${balanceModeIcon}`;
    description = t('lobby.desc_recruiting', { n: min - playerCount });
  }

  // Wolf win condition (per-guild with global fallback)
  const config = ConfigManager.getInstance();
  const wolfWin = config.getWolfWinCondition(game.guildId || null);
  const wolfWinLabel = wolfWin === 'elimination' ? t('lobby.wolfwin_elimination') : t('lobby.wolfwin_majority');
  const balanceModeLabel = isDynamic ? t('lobby.balance_dynamic') : t('lobby.balance_classic');

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription(
      `${description}\n\n${buildProgressBar(playerCount, min, max)}`
    )
    .addFields(
      {
        name: t('lobby.field_players', { n: playerCount, max }),
        value: buildPlayerList(game.players, max),
        inline: true
      },
      {
        name: t('lobby.field_info'),
        value: [
          `${t('lobby.info_host')} · <@${hostId}>`,
          game.voiceChannelId ? `${t('lobby.info_voice')} · <#${game.voiceChannelId}>` : `${t('lobby.info_voice')} · ${t('lobby.info_voice_waiting')}`,
          `${t('lobby.info_wolfwin')} · ${wolfWinLabel}`,
          `${t('lobby.info_balance')} · ${balanceModeLabel}`,
          `${t('lobby.info_created')} · <t:${Math.floor((game._lobbyCreatedAt || Date.now()) / 1000)}:R>`
        ].join('\n'),
        inline: true
      },
      {
        name: t('lobby.field_roles'),
        value: !isDynamic
          ? t('lobby.classic_roles_hidden')
          : playerCount >= min
            ? buildRolesPreview(playerCount, currentBalanceMode, game.id || 0)
            : `${t('lobby.roles_hidden', { min })}\n🐺 ×2  🔮  🧪  🏹  + ???`,
        inline: false
      }
    )
    .setColor(themeLobbyColor(game.guildId || null, playerCount / max))
    .setThumbnail('attachment://LG.jpg')
    .setFooter({ text: getRandomTip() })
    .setTimestamp();

  // ─── Buttons Row 1: Main actions ───
  const mainButtons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`lobby_join:${game.mainChannelId}`)
      .setLabel(isFull ? t('ui.btn.join_full') : t('ui.btn.join'))
      .setEmoji(isFull ? '🚫' : '⚔️')
      .setStyle(isFull ? ButtonStyle.Secondary : ButtonStyle.Success)
      .setDisabled(isFull),
    new ButtonBuilder()
      .setCustomId(`lobby_leave:${game.mainChannelId}`)
      .setLabel(t('ui.btn.leave'))
      .setEmoji('🚪')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`lobby_start:${game.mainChannelId}`)
      .setLabel(canStart ? t('ui.btn.start_ready') : t('ui.btn.start_waiting', { n: min - playerCount }))
      .setStyle(canStart ? ButtonStyle.Primary : ButtonStyle.Secondary)
      .setDisabled(!canStart)
  );

  // ─── Buttons Row 2: Settings (all Secondary — no accent colors) ───
  const settingsButtons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`lobby_wolfwin:${game.mainChannelId}`)
      .setLabel(wolfWin === 'elimination' ? t('ui.btn.wolfwin_elimination') : t('ui.btn.wolfwin_majority'))
      .setEmoji('⚙️')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`lobby_balance:${game.mainChannelId}`)
      .setLabel(isDynamic ? t('ui.btn.balance_dynamic') : t('ui.btn.balance_classic'))
      .setEmoji(isDynamic ? '🎭' : '⚖️')
      .setStyle(ButtonStyle.Secondary)
  );

  return {
    embed,
    buttons: [mainButtons, settingsButtons],
    files: [new AttachmentBuilder(LOBBY_IMAGE, { name: 'LG.jpg' })]
  };
}

/**
 * Build the message payload ready to send/edit
 */
function buildLobbyMessage(game, hostId) {
  const { embed, buttons, files } = buildLobbyEmbed(game, hostId);
  return {
    embeds: [embed],
    components: Array.isArray(buttons) ? buttons : [buttons],
    files
  };
}

/**
 * Build the expired lobby message payload.
 * Replaces the embed with a greyed-out "cancelled" state and removes all buttons.
 * Safe to call even if the game object is partially cleaned up.
 */
function buildLobbyExpiredMessage(game) {
  const playerCount = game && game.players ? game.players.length : 0;
  const hostId = game ? game.lobbyHostId : null;

  const embed = new EmbedBuilder()
    .setTitle(t('lobby.expired_title'))
    .setDescription(t('lobby.expired_description'))
    .setColor(0x2f3136) // Discord dark grey — neutral/closed
    .setFooter({ text: t('lobby.expired_footer') })
    .setTimestamp();

  // Show who was in the lobby if we still have the data
  if (playerCount > 0) {
    const names = game.players.map((p, i) => {
      const icon = i === 0 ? '👑' : '~~🎮~~';
      return `> ${icon} ~~${p.username}~~`;
    }).join('\n');
    embed.addFields({
      name: t('lobby.field_players', { n: playerCount, max: game.rules?.maxPlayers ?? '?' }),
      value: names,
      inline: false
    });
  }

  if (hostId) {
    embed.addFields({
      name: t('lobby.field_info'),
      value: `> 👑 **Host** · <@${hostId}>`,
      inline: false
    });
  }

  return {
    embeds: [embed],
    components: [],  // Remove all buttons entirely
    files: []        // No image attachment needed
    // Note: attachments: [] would strip all existing attachments on edit
  };
}

module.exports = {
  buildLobbyEmbed,
  buildLobbyMessage,
  buildLobbyExpiredMessage,
  buildProgressBar,
  buildPlayerList,
  buildRolesPreview,
  getLobbyColor: themeLobbyColor,
  LOBBY_IMAGE
};
