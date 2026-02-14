const { SlashCommandBuilder, EmbedBuilder, MessageFlags, PermissionFlagsBits } = require("discord.js");
const gameManager = require("../game/gameManager");
const { t } = require('../utils/i18n');
const { getColor } = require('../utils/theme');

module.exports = {
  data: new SlashCommandBuilder()
    .setName("debug-info")
    .setDescription("🐛 [DEBUG] Afficher l'état de la partie")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    if (!interaction.member.permissions.has('Administrator')) {
      await interaction.reply({ content: t('error.admin_only'), flags: MessageFlags.Ephemeral });
      return;
    }

    const game = gameManager.getGameByChannelId(interaction.channelId);
    if (!game) {
      await interaction.reply({ content: t('error.no_game'), flags: MessageFlags.Ephemeral });
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle(t('cmd.debug_info.title'))
      .setColor(getColor(interaction.guildId, 'success'))
      .addFields(
        {
          name: t('cmd.debug_info.phase'),
          value: game.phase,
          inline: true
        },
        {
          name: t('cmd.debug_info.day_number'),
          value: (game.dayCount || 0).toString(),
          inline: true
        },
        {
          name: t('cmd.debug_info.players'),
          value: game.players.length.toString(),
          inline: true
        },
        {
          name: t('cmd.debug_info.dead'),
          value: game.dead.length.toString(),
          inline: true
        },
        {
          name: t('cmd.debug_info.captain'),
          value: game.captainId ? `<@${game.captainId}>` : t('cmd.debug_info.none'),
          inline: true
        },
        {
          name: t('cmd.debug_info.couples'),
          value: game.lovers.length > 0 ? game.lovers.map(p => `${p[0].slice(0, 4)}...`).join(", ") : t('cmd.debug_info.none'),
          inline: true
        }
      );

    const playersList = game.players
      .map(p => `• \`${p.username}\` — **${p.role}** ${p.alive ? "✅" : "💀"}`)
      .join("\n");

    embed.addFields({ name: t('cmd.debug_info.player_list'), value: playersList || t('cmd.debug_info.empty'), inline: false });

    const votesList = Array.from(game.votes.entries())
      .map(([id, count]) => {
        const voter = game.players.find(p => p.id === id);
        return `• \`${voter?.username || id}\` : ${count} votes`;
      })
      .join("\n");

    if (votesList) {
      embed.addFields({ name: t('cmd.debug_info.votes'), value: votesList, inline: false });
    }

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }
};
