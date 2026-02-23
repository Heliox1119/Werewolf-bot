const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require("discord.js");
const GameDatabase = require("../database/db");
const { safeReply } = require("../utils/interaction");
const { t } = require('../utils/i18n');
const { getColor } = require('../utils/theme');

module.exports = {
  data: new SlashCommandBuilder()
    .setName("stats")
    .setDescription("Voir les statistiques d'un joueur")
    .addUserOption(opt =>
      opt.setName("joueur")
        .setDescription("Le joueur à consulter (vous par défaut)")
        .setRequired(false)
    ),

  async execute(interaction) {
    const target = interaction.options.getUser("joueur") || interaction.user;

    const db = new GameDatabase();
    const stats = db.getPlayerStats(target.id);

    if (!stats) {
      await safeReply(interaction, {
        content: t('game.stats_no_data'),
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const winrate = stats.games_played > 0
      ? Math.round((stats.games_won / stats.games_played) * 100)
      : 0;

    const gameManager = require("../game/gameManager");
    const { AchievementEngine, ACHIEVEMENTS } = require("../game/achievements");

    const embed = new EmbedBuilder()
      .setTitle(t('game.stats_title', { name: target.username }))
      .setColor(getColor(interaction.guildId, 'blurple'))
      .setThumbnail(target.displayAvatarURL({ size: 64 }))
      .addFields(
        { name: t('game.stats_games_played'), value: `${stats.games_played}`, inline: true },
        { name: t('game.stats_games_won'), value: `${stats.games_won}`, inline: true },
        { name: t('game.stats_winrate'), value: `${winrate}%`, inline: true },
        { name: t('game.stats_kills'), value: `${stats.times_killed}`, inline: true },
        { name: t('game.stats_survived'), value: `${stats.times_survived}`, inline: true }
      );

    // ELO & Rank
    if (gameManager.achievements) {
      try {
        const extStats = gameManager.achievements.getExtendedStats(target.id);
        const rank = gameManager.achievements.getPlayerRank(target.id);
        const tier = AchievementEngine.getEloTier(extStats.elo_rating);
        
        embed.addFields(
          { name: '🏅 ELO', value: `${tier.emoji} **${extStats.elo_rating}** (${tier.name})`, inline: true },
          { name: `📊 ${t('stats.rank')}`, value: rank ? `#${rank}` : '—', inline: true },
          { name: `⚡ ${t('stats.peak')}`, value: `${extStats.elo_peak}`, inline: true }
        );

        // Extended stats
        const extLines = [];
        if (extStats.wolf_wins > 0) extLines.push(`🐺 ${t('stats.wolf_wins')}: ${extStats.wolf_wins}`);
        if (extStats.village_wins > 0) extLines.push(`🏡 ${t('stats.village_wins')}: ${extStats.village_wins}`);
        if (extStats.best_win_streak > 0) extLines.push(`🔥 ${t('stats.best_streak')}: ${extStats.best_win_streak}`);
        if (extStats.seer_correct > 0) extLines.push(`🔮 ${t('stats.seer_correct')}: ${extStats.seer_correct}`);
        if (extStats.salvateur_saves > 0) extLines.push(`🛡️ ${t('stats.salvateur_saves')}: ${extStats.salvateur_saves}`);
        if (extStats.witch_saves > 0) extLines.push(`🧪 ${t('stats.witch_saves')}: ${extStats.witch_saves}`);

        if (extLines.length > 0) {
          embed.addFields({
            name: `📈 ${t('stats.detailed')}`,
            value: extLines.join('\n'),
            inline: false
          });
        }

        // Achievements
        const playerAchs = gameManager.achievements.getPlayerAchievements(target.id);
        if (playerAchs.length > 0) {
          const achDisplay = playerAchs.slice(0, 12).map(a => {
            const def = ACHIEVEMENTS[a.achievement_id];
            return def ? `${def.emoji} ${t(`achievement.${a.achievement_id}`)}` : null;
          }).filter(Boolean).join('\n');

          if (achDisplay) {
            embed.addFields({
              name: `🏅 ${t('stats.achievements')} (${playerAchs.length})`,
              value: achDisplay.slice(0, 1024),
              inline: false
            });
          }
        }
      } catch (e) {
        // Achievements not available, skip
      }
    }

    embed.setTimestamp();
    await safeReply(interaction, { embeds: [embed] });
  }
};
