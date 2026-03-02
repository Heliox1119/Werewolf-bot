const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const gameManager = require("../game/gameManager");
const { commands: logger } = require("../utils/logger");
const { t } = require('../utils/i18n');

module.exports = {
  data: new SlashCommandBuilder()
    .setName("force-end")
    .setDescription("🛠️ [ADMIN] Terminer une partie de force (bypass interaction)")
    .addStringOption(option =>
      option.setName('channel-id')
        .setDescription('ID du channel de la partie à terminer')
        .setRequired(false)
    ),

  async execute(interaction) {
    // Check admin
    if (!interaction.member.permissions.has('Administrator')) {
      await interaction.reply({ 
        content: t('error.admin_permission_required'), 
        flags: MessageFlags.Ephemeral 
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const targetChannelId = interaction.options.getString('channel-id') || interaction.channelId;

    logger.info('FORCE_END_COMMAND_CALLED', { 
      channelId: targetChannelId,
      user: interaction.user.username,
      gamesCount: gameManager.games.size
    });

    const game = gameManager.games.get(targetChannelId);
    
    if (!game || game.guildId !== interaction.guildId) {
      const allGames = Array.from(gameManager.games.entries())
        .filter(([, g]) => g.guildId === interaction.guildId)
        .map(([id]) => id);
      let message = t('cleanup.force_end_no_game', { id: targetChannelId }) + `\n\n`;
      
      if (allGames.length > 0) {
        message += t('cleanup.active_games_list');
        for (const channelId of allGames) {
          message += `• <#${channelId}> (\`${channelId}\`)\n`;
        }
        message += `\n` + t('cleanup.force_end_hint');
      } else {
        message += t('cleanup.force_end_no_active');
      }
      
      await interaction.editReply(message);
      return;
    }

    logger.info('FORCE_ENDING_GAME', { 
      channelId: targetChannelId,
      playerCount: game.players.length,
      phase: game.phase
    });

    // Nettoyer les channels
    let deleted = 0;
    try {
      deleted = await gameManager.cleanupChannels(interaction.guild, game);
      logger.info('CHANNELS_CLEANED_UP', { deletedCount: deleted });
    } catch (error) {
      logger.error('CHANNEL_CLEANUP_FAILED', error);
    }

    // Déconnecter le bot du channel vocal
    if (game.voiceChannelId) {
      try {
        gameManager.disconnectVoice(game.voiceChannelId);
        logger.debug('VOICE_DISCONNECTED');
      } catch (e) {
        logger.warn('VOICE_DISCONNECT_FAILED', { error: e.message });
      }
    }

    // Supprimer la partie de la mémoire et de la base de données
    gameManager.purgeGame(targetChannelId, game);

    logger.info('GAME_FORCE_ENDED', { 
      channelId: targetChannelId,
      deletedChannels: deleted 
    });

    await interaction.editReply(
      t('cleanup.force_end_success', { id: targetChannelId, n: deleted, m: gameManager.games.size })
    );
  }
};
