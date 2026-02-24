const { SlashCommandBuilder, EmbedBuilder, MessageFlags, PermissionFlagsBits } = require("discord.js");
const gameManager = require("../game/gameManager");
const { commands: logger } = require("../utils/logger");
const { t } = require('../utils/i18n');
const { getColor } = require('../utils/theme');

module.exports = {
  data: new SlashCommandBuilder()
    .setName("debug-games")
    .setDescription("🐛 [DEBUG] Afficher toutes les parties actives")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    if (!interaction.member.permissions.has('Administrator')) {
      await interaction.reply({ content: t('error.admin_only'), flags: MessageFlags.Ephemeral });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    logger.info('Debug-games command called', { 
      gamesCount: gameManager.games.size 
    });

    const guildId = interaction.guildId;
    const guildGames = Array.from(gameManager.games.entries()).filter(([, g]) => g.guildId === guildId);
    const gamesCount = guildGames.length;

    if (gamesCount === 0) {
      await interaction.editReply(t('cmd.debug_games.no_active'));
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle(t('cmd.debug_games.title'))
      .setColor(getColor(interaction.guildId, 'success'))
      .setDescription(t('cmd.debug_games.description', { count: gamesCount }));

    for (const [channelId, game] of guildGames) {
      const channelName = await interaction.guild.channels.fetch(channelId)
        .then(ch => ch.name)
        .catch(() => t('cmd.debug_games.unknown_channel'));

      const value = [
        `${t('cmd.debug_games.channel')}: <#${channelId}>`,
        `${t('cmd.debug_games.phase')}: ${game.phase}`,
        `${t('cmd.debug_games.players')}: ${game.players.length}`,
        `${t('cmd.debug_games.dead')}: ${game.dead.length}`,
        `${t('cmd.debug_games.host')}: ${game.lobbyHostId ? `<@${game.lobbyHostId}>` : 'N/A'}`,
        `${t('cmd.debug_games.voice')}: ${game.voiceChannelId ? `<#${game.voiceChannelId}>` : 'N/A'}`,
        `${t('cmd.debug_games.village')}: ${game.villageChannelId ? `<#${game.villageChannelId}>` : 'N/A'}`
      ].join('\n');

      embed.addFields({
        name: t('cmd.debug_games.game_title', { name: channelName }),
        value: value,
        inline: false
      });
    }

    // Add technical info
    embed.addFields({
      name: t('cmd.debug_games.tech_title'),
      value: [
        `${t('cmd.debug_games.current_channel')}: <#${interaction.channelId}>`,
        `${t('cmd.debug_games.game_ids')}: ${guildGames.map(([id]) => `\`${id}\``).join(', ')}`,
        `Map size: ${gamesCount}`
      ].join('\n'),
      inline: false
    });

    await interaction.editReply({ embeds: [embed] });
  }
};
