const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require("discord.js");
const GameDatabase = require("../database/db");
const { safeReply } = require("../utils/interaction");
const { t } = require('../utils/i18n');
const { getColor } = require('../utils/theme');

module.exports = {
  data: new SlashCommandBuilder()
    .setName("history")
    .setDescription("Voir l'historique des dernières parties / View recent game history")
    .addIntegerOption(opt =>
      opt.setName("limit")
        .setDescription("Nombre de parties à afficher (défaut: 5)")
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(15)
    ),

  async execute(interaction) {
    const limit = interaction.options.getInteger("limit") || 5;
    const guildId = interaction.guildId;

    const db = new GameDatabase();
    const history = db.getGuildHistory(guildId, limit);

    if (history.length === 0) {
      await safeReply(interaction, {
        content: t('history.no_data'),
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const winnerEmojis = {
      'village': '🏡',
      'wolves': '🐺',
      'lovers': '💘',
      'draw': '🤝'
    };

    const lines = history.map((g, i) => {
      const emoji = winnerEmojis[g.winner] || '❓';
      const winner = g.winner ? t(`game.victory_${g.winner}_display`) : '?';
      const duration = g.duration_seconds > 0 ? `${Math.round(g.duration_seconds / 60)}min` : '?';
      const date = g.ended_at ? `<t:${g.ended_at}:R>` : '?';
      const players = g.player_count || '?';
      const days = g.day_count || 0;
      
      return `**${i + 1}.** ${emoji} ${winner} · 👥 ${players} · ☀️ ${days}j · ⏱️ ${duration} · ${date}`;
    });

    const embed = new EmbedBuilder()
      .setTitle(t('history.title'))
      .setDescription(lines.join('\n'))
      .setColor(getColor(guildId, 'blurple'))
      .setFooter({ text: t('history.footer', { count: history.length }) })
      .setTimestamp();

    // Show players of the most recent game
    if (history[0] && history[0].players_json) {
      try {
        const recentPlayers = JSON.parse(history[0].players_json);
        const playerLines = recentPlayers.map(p => {
          const status = p.alive ? '✅' : '💀';
          const role = p.role ? t(`role.${p.role === 'Loup-Garou' ? 'werewolf' : p.role === 'Villageois' ? 'villager' : p.role === 'Voyante' ? 'seer' : p.role === 'Sorcière' ? 'witch' : p.role === 'Chasseur' ? 'hunter' : p.role === 'Petite Fille' ? 'petite_fille' : p.role === 'Cupidon' ? 'cupid' : p.role === 'Salvateur' ? 'salvateur' : p.role === 'Ancien' ? 'ancien' : p.role === 'Idiot du Village' ? 'idiot' : 'unknown'}`) : '?';
          return `${status} ${p.username} — ${role}`;
        }).join('\n');
        
        if (playerLines.length > 0) {
          embed.addFields({
            name: t('history.latest_game'),
            value: playerLines.slice(0, 1024),
            inline: false
          });
        }
      } catch (e) { /* ignore parse errors */ }
    }

    await safeReply(interaction, { embeds: [embed] });
  }
};
