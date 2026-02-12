const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require('discord.js');
const path = require('path');

// ─── Constants ───────────────────────────────────────────────────────────────
const LOBBY_IMAGE = path.join(__dirname, '..', 'img', 'LG.jpg');
const SEPARATOR = '─────────────────────────────';

const ROLE_LIST = [
  { emoji: '🐺', name: 'Loup-Garou',    count: 2, minPlayers: 5, team: 'evil'    },
  { emoji: '🔮', name: 'Voyante',       count: 1, minPlayers: 5, team: 'village'  },
  { emoji: '🧪', name: 'Sorcière',      count: 1, minPlayers: 5, team: 'village'  },
  { emoji: '🏹', name: 'Chasseur',      count: 1, minPlayers: 5, team: 'village'  },
  { emoji: '👁️', name: 'Petite Fille',  count: 1, minPlayers: 6, team: 'village'  },
  { emoji: '💘', name: 'Cupidon',       count: 1, minPlayers: 7, team: 'neutral' },
  { emoji: '🧑‍🌾', name: 'Villageois',   count: null, minPlayers: 5, team: 'village' }
];

const TIPS = [
  '💡 Le Chasseur tire en mourant — attention à qui il vise !',
  '💡 La Sorcière a 2 potions : une de vie, une de mort.',
  '💡 La Voyante peut découvrir le rôle d\'un joueur chaque nuit.',
  '💡 Le capitaine a un vote qui compte double.',
  '💡 Les amoureux de Cupidon gagnent ensemble... ou meurent ensemble.',
  '💡 La Petite Fille peut espionner les loups, mais gare à elle !',
  '💡 Discutez bien le jour — c\'est la clé de la victoire du village.',
  '💡 Les loups doivent se coordonner en secret la nuit.',
  '💡 Un vote bien ciblé peut retourner toute la partie !',
  '💡 Le village gagne quand tous les loups sont éliminés.',
];

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
    status = '🟢 **COMPLET**';
  } else if (current >= min) {
    status = '🟢 **Prêt !**';
  } else {
    const remaining = min - current;
    status = `🔴 **${remaining}** encore`;
  }

  return `${bar}\n\`${current}\` / \`${max}\` joueurs  ·  ${status}`;
}

/**
 * Build player slots with visual grid
 */
function buildPlayerList(players, max) {
  if (players.length === 0) {
    return `> 🪑 *Aucun joueur — sois le premier !*\n> \n> ${'⬜'.repeat(Math.min(max, 10))} \`0/${max}\``;
  }

  const lines = players.map((p, i) => {
    const icon = i === 0 ? '👑' : '🎮';
    const tag = i === 0 ? ' *(host)*' : '';
    return `> ${icon} **${p.username}**${tag}`;
  });

  // Slot indicator
  const filledSlots = '🟦'.repeat(Math.min(players.length, max));
  const emptySlots = '⬜'.repeat(Math.max(0, Math.min(max, 10) - players.length));
  lines.push(`> \n> ${filledSlots}${emptySlots}`);

  return lines.join('\n');
}

/**
 * Build roles grid with team grouping
 */
function buildRolesPreview(playerCount) {
  const active = ROLE_LIST.filter(r => r.minPlayers <= playerCount || r.count === null);

  // Calculate villager count
  const specialCount = ROLE_LIST
    .filter(x => x.count !== null && x.minPlayers <= playerCount)
    .reduce((sum, x) => sum + x.count, 0);
  const villagerCount = Math.max(0, playerCount - specialCount);

  const lines = [];

  // Evil team
  const wolves = active.filter(r => r.team === 'evil');
  if (wolves.length > 0) {
    const wolfLine = wolves.map(r => `${r.emoji} ${r.name} ×${r.count}`).join('  ');
    lines.push(`🔴 **Maléfiques** ─ ${wolfLine}`);
  }

  // Village team
  const village = active.filter(r => r.team === 'village' && r.count !== null);
  if (village.length > 0) {
    const villageLine = village.map(r => `${r.emoji} ${r.name}`).join('  ');
    const villagerSuffix = villagerCount > 0 ? `  🧑‍🌾 Villageois ×${villagerCount}` : '';
    lines.push(`🔵 **Village** ─ ${villageLine}${villagerSuffix}`);
  }

  // Neutral
  const neutral = active.filter(r => r.team === 'neutral');
  if (neutral.length > 0) {
    const neutralLine = neutral.map(r => `${r.emoji} ${r.name}`).join('  ');
    lines.push(`🟡 **Neutre** ─ ${neutralLine}`);
  }

  lines.push(`\n> **${active.filter(r => r.count !== null).length + (villagerCount > 0 ? 1 : 0)}** rôles différents · **${playerCount}** cartes distribuées`);

  return lines.join('\n');
}

/**
 * Get embed color based on fill percentage
 */
function getLobbyColor(current, min, max) {
  if (current >= max) return 0x2ECC71;    // Green — full
  if (current >= min) return 0x3498DB;    // Blue — ready
  if (current >= Math.ceil(min / 2)) return 0xF39C12; // Orange — halfway
  return 0x95A5A6;                        // Grey — waiting
}

/**
 * Get a rotating tip based on time
 */
function getRandomTip() {
  return TIPS[Math.floor(Math.random() * TIPS.length)];
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
    title = '🐺  Lobby complet — Prêt à jouer !';
    description = `Tous les joueurs sont réunis. Le host peut lancer la partie !`;
  } else if (canStart) {
    title = '🐺  Lobby ouvert — En attente...';
    description = `La partie peut démarrer ! D'autres joueurs peuvent encore rejoindre.`;
  } else {
    title = '🐺  Lobby ouvert — Recrutement';
    description = `Clique sur **Rejoindre** pour participer à la partie.\nEncore **${min - playerCount}** joueur(s) nécessaire(s) pour démarrer.`;
  }

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription(
      `${description}\n\n` +
      `**Progression**\n${buildProgressBar(playerCount, min, max)}`
    )
    .addFields(
      {
        name: `👥  Joueurs  ──  ${playerCount}/${max}`,
        value: buildPlayerList(game.players, max),
        inline: false
      },
      {
        name: '🎭  Rôles en jeu',
        value: playerCount >= min
          ? buildRolesPreview(playerCount)
          : `> *Les rôles seront dévoilés quand **${min}** joueurs seront réunis*\n> \n> 🐺 ×2  🔮  🧪  🏹  + ???`,
        inline: false
      },
      {
        name: `📋  Informations`,
        value: [
          `> 👑 **Host** · <@${hostId}>`,
          game.voiceChannelId ? `> 🎤 **Vocal** · <#${game.voiceChannelId}>` : `> 🎤 **Vocal** · *en attente*`,
          `> 📏 **Joueurs** · ${min} min — ${max} max`,
          `> ⏱️ **Créée** · <t:${Math.floor((game._lobbyCreatedAt || Date.now()) / 1000)}:R>`
        ].join('\n'),
        inline: false
      }
    )
    .setColor(getLobbyColor(playerCount, min, max))
    .setImage('attachment://LG.jpg')
    .setFooter({ text: getRandomTip() })
    .setTimestamp();

  // ─── Buttons Row 1: Main actions ───
  const mainButtons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`lobby_join:${game.mainChannelId}`)
      .setLabel(isFull ? 'Complet' : 'Rejoindre')
      .setEmoji(isFull ? '🚫' : '⚔️')
      .setStyle(isFull ? ButtonStyle.Secondary : ButtonStyle.Success)
      .setDisabled(isFull),
    new ButtonBuilder()
      .setCustomId(`lobby_leave:${game.mainChannelId}`)
      .setLabel('Quitter')
      .setEmoji('🚪')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`lobby_start:${game.mainChannelId}`)
      .setLabel(canStart ? '🎬 Lancer la partie !' : `Encore ${min - playerCount}...`)
      .setStyle(canStart ? ButtonStyle.Primary : ButtonStyle.Secondary)
      .setDisabled(!canStart)
  );

  return {
    embed,
    buttons: mainButtons,
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
    components: [buttons],
    files
  };
}

module.exports = {
  buildLobbyEmbed,
  buildLobbyMessage,
  buildProgressBar,
  buildPlayerList,
  buildRolesPreview,
  getLobbyColor,
  LOBBY_IMAGE
};
