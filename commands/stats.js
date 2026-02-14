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
      )
      .setTimestamp();

    await safeReply(interaction, { embeds: [embed] });
  }
};
