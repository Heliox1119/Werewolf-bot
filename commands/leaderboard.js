const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require("discord.js");
const GameDatabase = require("../database/db");
const { safeReply } = require("../utils/interaction");
const { t } = require('../utils/i18n');
const { getColor } = require('../utils/theme');

module.exports = {
  data: new SlashCommandBuilder()
    .setName("leaderboard")
    .setDescription("Afficher le classement des meilleurs joueurs / Show top players")
    .addIntegerOption(opt =>
      opt.setName("top")
        .setDescription("Nombre de joueurs à afficher (défaut: 10)")
        .setRequired(false)
        .setMinValue(3)
        .setMaxValue(25)
    ),

  async execute(interaction) {
    const limit = interaction.options.getInteger("top") || 10;
    const guildId = interaction.guildId;

    const db = new GameDatabase();
    const gameManager = require("../game/gameManager");
    
    let leaderboard = [];
    if (gameManager.achievements) {
      leaderboard = gameManager.achievements.getLeaderboard(limit, guildId);
    } else {
      // Fallback: basic stats only
      try {
        leaderboard = db.db.prepare(`
          SELECT player_id, username, games_played, games_won
          FROM player_stats
          WHERE games_played > 0
          ORDER BY games_won DESC, games_played ASC
          LIMIT ?
        `).all(limit);
      } catch (e) {
        leaderboard = [];
      }
    }

    if (leaderboard.length === 0) {
      await safeReply(interaction, {
        content: t('leaderboard.no_data'),
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const { AchievementEngine } = require("../game/achievements");

    const medals = ['🥇', '🥈', '🥉'];
    const lines = leaderboard.map((p, i) => {
      const medal = i < 3 ? medals[i] : `**${i + 1}.**`;
      const winrate = p.games_played > 0 ? Math.round((p.games_won / p.games_played) * 100) : 0;
      const elo = p.elo_rating || 1000;
      const tier = AchievementEngine.getEloTier(elo);
      
      return `${medal} ${tier.emoji} **${p.username}** — ${elo} ELO · ${winrate}% WR · ${p.games_played} ${t('leaderboard.games')}`;
    });

    const embed = new EmbedBuilder()
      .setTitle(t('leaderboard.title'))
      .setDescription(lines.join('\n'))
      .setColor(getColor(guildId, 'special'))
      .setFooter({ text: t('leaderboard.footer') })
      .setTimestamp();

    // Add global stats
    const globalStats = db.getGlobalStats();
    if (globalStats && globalStats.total_games > 0) {
      const villageWR = globalStats.total_games > 0 ? Math.round((globalStats.village_wins / globalStats.total_games) * 100) : 0;
      const wolvesWR = globalStats.total_games > 0 ? Math.round((globalStats.wolves_wins / globalStats.total_games) * 100) : 0;
      
      embed.addFields({
        name: t('leaderboard.global_stats'),
        value: [
          `🎮 ${globalStats.total_games} ${t('leaderboard.total_games')}`,
          `🏡 ${t('leaderboard.village_wr')}: ${villageWR}%`,
          `🐺 ${t('leaderboard.wolves_wr')}: ${wolvesWR}%`,
          `⏱️ ${t('leaderboard.avg_duration')}: ${Math.round((globalStats.avg_duration || 0) / 60)}min`
        ].join(' · '),
        inline: false
      });
    }

    await safeReply(interaction, { embeds: [embed] });
  }
};
