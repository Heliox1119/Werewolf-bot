const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const path = require('path');

// ─── Constants ───────────────────────────────────────────────────────────────
const LOBBY_IMAGE = 'img/LG.jpg';

const ROLE_LIST = [
  { emoji: '🐺', name: 'Loup-Garou', count: 2, minPlayers: 5 },
  { emoji: '🔮', name: 'Voyante',    count: 1, minPlayers: 5 },
  { emoji: '🧪', name: 'Sorcière',   count: 1, minPlayers: 5 },
  { emoji: '🏹', name: 'Chasseur',   count: 1, minPlayers: 5 },
  { emoji: '👁️', name: 'Petite Fille', count: 1, minPlayers: 6 },
  { emoji: '💘', name: 'Cupidon',    count: 1, minPlayers: 7 },
  { emoji: '🧑‍🌾', name: 'Villageois', count: null, minPlayers: 5 }  // fill remaining
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Build a visual progress bar
 * @param {number} current 
 * @param {number} min 
 * @param {number} max 
 * @returns {string}
 */
function buildProgressBar(current, min, max) {
  const total = 10;
  const filled = Math.min(Math.round((current / max) * total), total);
  const empty = total - filled;
  
  const bar = '█'.repeat(filled) + '░'.repeat(empty);
  
  let status;
  if (current >= min) {
    status = '✅ Prêt';
  } else {
    status = `⏳ ${min - current} joueur(s) manquant(s)`;
  }
  
  return `\`${bar}\` **${current}**/${max} — ${status}`;
}

/**
 * Build the player list with numbered entries
 * @param {Array} players 
 * @returns {string}
 */
function buildPlayerList(players) {
  if (players.length === 0) {
    return '> *En attente du premier joueur...*';
  }
  
  return players.map((p, i) => {
    const crown = i === 0 ? ' 👑' : '';
    return `> **${i + 1}.** ${p.username}${crown}`;
  }).join('\n');
}

/**
 * Build the roles preview based on player count
 * @param {number} playerCount 
 * @returns {string}
 */
function buildRolesPreview(playerCount) {
  const active = ROLE_LIST.filter(r => r.minPlayers <= playerCount || r.count === null);
  
  return active.map(r => {
    if (r.count === null) {
      // Villagers fill the rest
      const specialCount = ROLE_LIST
        .filter(x => x.count !== null && x.minPlayers <= playerCount)
        .reduce((sum, x) => sum + x.count, 0);
      const villagerCount = Math.max(0, playerCount - specialCount);
      if (villagerCount === 0) return null;
      return `${r.emoji} ${r.name} ×${villagerCount}`;
    }
    return `${r.emoji} ${r.name}${r.count > 1 ? ` ×${r.count}` : ''}`;
  }).filter(Boolean).join(' **·** ');
}

/**
 * Get embed color based on fill percentage
 * @param {number} current 
 * @param {number} min 
 * @param {number} max 
 * @returns {number}
 */
function getLobbyColor(current, min, max) {
  if (current >= max) return 0x2ECC71;    // Green — full
  if (current >= min) return 0x3498DB;    // Blue — ready  
  if (current >= Math.ceil(min / 2)) return 0xF39C12; // Orange — halfway
  return 0xE74C3C;                        // Red — waiting
}

// ─── Main Builder ────────────────────────────────────────────────────────────

/**
 * Build the lobby embed and action row
 * @param {Object} game - The game object
 * @param {string} hostId - The host user ID
 * @returns {{ embed: EmbedBuilder, buttons: ActionRowBuilder, files: string[] }}
 */
function buildLobbyEmbed(game, hostId) {
  const min = game.rules?.minPlayers ?? 5;
  const max = game.rules?.maxPlayers ?? 10;
  const playerCount = game.players.length;
  const canStart = playerCount >= min;
  
  const embed = new EmbedBuilder()
    .setAuthor({ name: 'Loup-Garou — Lobby', iconURL: undefined })
    .setTitle('🐺  Une partie se prépare !')
    .setDescription(
      `Rejoins la partie en cliquant sur le bouton ci-dessous.\n` +
      `Le host peut démarrer quand ${min} joueurs minimum sont réunis.\n\n` +
      `**Progression**\n${buildProgressBar(playerCount, min, max)}`
    )
    .addFields(
      {
        name: '👥  Joueurs inscrits',
        value: buildPlayerList(game.players),
        inline: false
      },
      {
        name: '🎭  Rôles en jeu',
        value: playerCount >= min 
          ? buildRolesPreview(playerCount)
          : `*Les rôles seront dévoilés à **${min}** joueurs*`,
        inline: false
      },
      {
        name: '📋  Infos',
        value: [
          `👑 **Host** · <@${hostId}>`,
          `🎤 **Vocal** · <#${game.voiceChannelId || '—'}>`,
          `⏱️ **Créée** · <t:${Math.floor(Date.now() / 1000)}:R>`
        ].join('\n'),
        inline: false
      }
    )
    .setColor(getLobbyColor(playerCount, min, max))
    .setImage('attachment://LG.jpg')
    .setFooter({ 
      text: canStart 
        ? `✅ Prêt à démarrer ! (${min}-${max} joueurs)` 
        : `Minimum ${min} joueurs pour lancer la partie`
    })
    .setTimestamp();
  
  // Buttons
  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`lobby_join:${game.mainChannelId}`)
      .setLabel('Rejoindre')
      .setEmoji('🎮')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`lobby_leave:${game.mainChannelId}`)
      .setLabel('Quitter')
      .setEmoji('🚪')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`lobby_start:${game.mainChannelId}`)
      .setLabel(canStart ? 'Démarrer !' : `${min - playerCount} joueur(s) manquant(s)`)
      .setEmoji(canStart ? '⚔️' : '⏳')
      .setStyle(canStart ? ButtonStyle.Primary : ButtonStyle.Secondary)
      .setDisabled(!canStart)
  );
  
  return {
    embed,
    buttons,
    files: [LOBBY_IMAGE]
  };
}

/**
 * Build the message payload ready to send/edit
 * @param {Object} game 
 * @param {string} hostId 
 * @returns {{ embeds: EmbedBuilder[], components: ActionRowBuilder[], files: string[] }}
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
