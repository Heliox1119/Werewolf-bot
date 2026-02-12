const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const gameManager = require("../game/gameManager");
const { commands: logger } = require("../utils/logger");

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
        content: "❌ Cette commande nécessite les permissions d'administrateur.", 
        flags: MessageFlags.Ephemeral 
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const targetChannelId = interaction.options.getString('channel-id') || interaction.channelId;

    logger.info('Force-end command called', { 
      channelId: targetChannelId,
      user: interaction.user.username,
      gamesCount: gameManager.games.size
    });

    const game = gameManager.games.get(targetChannelId);
    
    if (!game) {
      const allGames = Array.from(gameManager.games.keys());
      let message = `❌ Aucune partie trouvée dans <#${targetChannelId}>\n\n`;
      
      if (allGames.length > 0) {
        message += `📊 **Parties actives** :\n`;
        for (const channelId of allGames) {
          message += `• <#${channelId}> (\`${channelId}\`)\n`;
        }
        message += `\n💡 Utilise \`/force-end channel-id:<id>\` pour terminer une partie spécifique.`;
      } else {
        message += "Aucune partie active sur le serveur.";
      }
      
      await interaction.editReply(message);
      return;
    }

    logger.info('Force ending game', { 
      channelId: targetChannelId,
      playerCount: game.players.length,
      phase: game.phase
    });

    // Nettoyer les channels
    let deleted = 0;
    try {
      deleted = await gameManager.cleanupChannels(interaction.guild, game);
      logger.success('Channels cleaned up', { deletedCount: deleted });
    } catch (error) {
      logger.error('Failed to cleanup channels', error);
    }

    // Déconnecter le bot du channel vocal
    if (game.voiceChannelId) {
      try {
        gameManager.disconnectVoice(game.voiceChannelId);
        logger.debug('Disconnected from voice');
      } catch (e) {
        logger.warn('Failed to disconnect from voice', { error: e.message });
      }
    }

    // Supprimer la partie de la mémoire et de la base de données
    try { gameManager.db.deleteGame(targetChannelId); } catch (e) { logger.warn('Failed to delete game from DB', { error: e.message }); }
    gameManager.games.delete(targetChannelId);
    gameManager.saveState();

    logger.success('Game force-ended successfully', { 
      channelId: targetChannelId,
      deletedChannels: deleted 
    });

    await interaction.editReply(
      `✅ **Partie terminée de force**\n\n` +
      `📺 Channel: <#${targetChannelId}>\n` +
      `🗑️ ${deleted} channel(s) supprimé(s)\n` +
      `📊 Parties restantes: ${gameManager.games.size}`
    );
  }
};
