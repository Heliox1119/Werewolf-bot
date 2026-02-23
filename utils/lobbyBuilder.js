const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require('discord.js');
const path = require('path');
const { t, translateRole, tips: getTips } = require('./i18n');
const { getLobbyColor: themeLobbyColor } = require('./theme');
const ConfigManager = require('./config');

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
  const total = 12;
  const filled = Math.min(Math.round((current / max) * total), total);
  const minMark = Math.round((min / max) * total);

  let bar = '';
  for (let i = 0; i < total; i++) {
    if (i < filled) {
      bar += i < minMark ? '🟧' : '🟩';
    } else if (i === minMark) {
      bar += '🔹';
    } else {
      bar += '⬛';
    }
  }

  let status;
  if (current >= max) {
    status = t('lobby.status_complete');
  } else if (current >= min) {
    status = t('lobby.status_ready');
  } else {
    const remaining = min - current;
    status = t('lobby.status_remaining', { n: remaining });
  }

  return `${bar}\n\`${current}\` / \`${max}\` joueurs  ·  ${status}`;
}

/**
 * Build player slots with visual grid
 */
function buildPlayerList(players, max) {
  if (players.length === 0) {
    return `> ${t('lobby.no_players')}\n> \n> ${'⬜'.repeat(max)} \`0/${max}\``;
  }

  const lines = players.map((p, i) => {
    const icon = i === 0 ? '👑' : '🎮';
    const tag = i === 0 ? ` ${t('lobby.host_tag')}` : '';
    return `> ${icon} **${p.username}**${tag}`;
  });

  // Slot indicator
  const filledSlots = '🟦'.repeat(Math.min(players.length, max));
  const emptySlots = '⬜'.repeat(Math.max(0, max - players.length));
  lines.push(`> \n> ${filledSlots}${emptySlots}`);

  return lines.join('\n');
}

/**
 * Build roles grid with team grouping
 */
function buildRolesPreview(playerCount) {
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
  lines.push(`\n> ${t('lobby.roles_count', { n: uniqueRoleCount, m: playerCount })}`);

  return lines.join('\n');
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

  // Title changes with state
  let title, description;
  if (isFull) {
    title = t('lobby.title_full');
    description = t('lobby.desc_full');
  } else if (canStart) {
    title = t('lobby.title_ready');
    description = t('lobby.desc_ready');
  } else {
    title = t('lobby.title_recruiting');
    description = t('lobby.desc_recruiting', { n: min - playerCount });
  }

  // Wolf win condition (per-guild with global fallback)
  const config = ConfigManager.getInstance();
  const wolfWin = config.getWolfWinCondition(game.guildId || null);
  const wolfWinLabel = wolfWin === 'elimination' ? t('lobby.wolfwin_elimination') : t('lobby.wolfwin_majority');

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription(
      `${description}\n\n` +
      `**${t('progress.label')}**\n${buildProgressBar(playerCount, min, max)}`
    )
    .addFields(
      {
        name: t('lobby.field_players', { n: playerCount, max }),
        value: buildPlayerList(game.players, max),
        inline: false
      },
      {
        name: t('lobby.field_roles'),
        value: playerCount >= min
          ? buildRolesPreview(playerCount)
          : `> ${t('lobby.roles_hidden', { min })}\n> \n> 🐺 ×2  🔮  🧪  🏹  + ???`,
        inline: false
      },
      {
        name: t('lobby.field_info'),
        value: [
          `> ${t('lobby.info_host')} · <@${hostId}>`,
          game.voiceChannelId ? `> ${t('lobby.info_voice')} · <#${game.voiceChannelId}>` : `> ${t('lobby.info_voice')} · ${t('lobby.info_voice_waiting')}`,
          `> ${t('lobby.info_players', { min, max })}`,
          `> ${t('lobby.info_wolfwin')} · ${wolfWinLabel}`,
          `> ${t('lobby.info_created')} · <t:${Math.floor((game._lobbyCreatedAt || Date.now()) / 1000)}:R>`
        ].join('\n'),
        inline: false
      }
    )
    .setColor(themeLobbyColor(game.guildId || null, playerCount / max))
    .setImage('attachment://LG.jpg')
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

  // ─── Buttons Row 2: Settings ───
  const settingsButtons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`lobby_wolfwin:${game.mainChannelId}`)
      .setLabel(wolfWin === 'elimination' ? t('ui.btn.wolfwin_elimination') : t('ui.btn.wolfwin_majority'))
      .setEmoji('⚙️')
      .setStyle(wolfWin === 'elimination' ? ButtonStyle.Danger : ButtonStyle.Secondary)
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

module.exports = {
  buildLobbyEmbed,
  buildLobbyMessage,
  buildProgressBar,
  buildPlayerList,
  buildRolesPreview,
  getLobbyColor: themeLobbyColor,
  LOBBY_IMAGE
};
