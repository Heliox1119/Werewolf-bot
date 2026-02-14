const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const gameManager = require("../game/gameManager");
const { sendTemporaryMessage } = require("../utils/commands");
const { safeDefer } = require("../utils/interaction");
const { commands: logger } = require("../utils/logger");
const { t, translateRole } = require('../utils/i18n');

module.exports = {
  data: new SlashCommandBuilder()
    .setName("end")
    .setDescription("Terminer et nettoyer la partie"),

  async execute(interaction) {
    // FIRST: Check for duplicate command (Discord auto-retry protection)
    if (gameManager.isRecentDuplicate('end', interaction.channelId, interaction.user.id)) {
      logger.warn('Ignoring duplicate /end (Discord retry)');
      return;
    }

    logger.info('End command called', { 
      channelId: interaction.channelId,
      user: interaction.user.username,
      gamesCount: gameManager.games.size,
      interactionAge: Date.now() - interaction.createdTimestamp
    });
    
    // Defer sans vérification de catégorie (end doit marcher depuis le channel de création)
    const deferSuccess = await safeDefer(interaction);
    if (!deferSuccess) {
      logger.warn('Failed to defer /end - continuing anyway to cleanup');
    }
    
    logger.debug('Checking for game in channel', { channelId: interaction.channelId });
    
    // Log all active games for debugging
    const allGames = Array.from(gameManager.games.keys());
    logger.debug('Active games', { games: allGames });
    
    const game = gameManager.getGameByChannelId(interaction.channelId);
    if (!game) {
      logger.warn('No game found in this channel', { 
        channelId: interaction.channelId,
        activeGames: allGames 
      });
      
      let message = t('error.no_game_in_channel') + "\n\n";
      
      if (allGames.length > 0) {
        message += t('cleanup.end_other_hint', { n: allGames.length });
      } else {
        message += t('cleanup.end_no_games');
      }
      
      // Try to reply, but don't fail if we can't
      if (deferSuccess) {
        try {
          await interaction.editReply({ content: message, flags: MessageFlags.Ephemeral });
        } catch (e) {
          logger.warn('Failed to send no-game reply', { error: e.message });
        }
      }
      return;
    }

    // Vérifier que l'utilisateur est admin ou host de la partie
    const isAdmin = interaction.member?.permissions?.has('Administrator') ?? false;
    const isHost = game.lobbyHostId === interaction.user.id;
    if (!isAdmin && !isHost) {
      if (deferSuccess) {
        try {
          await interaction.editReply({ content: t('error.host_or_admin_only'), flags: MessageFlags.Ephemeral });
        } catch (e) { /* ignore */ }
      }
      return;
    }

    logger.info('Game found, starting cleanup', { 
      channelId: interaction.channelId,
      playerCount: game.players.length,
      phase: game.phase
    });

    // Nettoyer les channels (retourne le nombre supprimé)
    const deleted = await gameManager.cleanupChannels(interaction.guild, game);
    
    logger.info('Channels cleaned up', { deletedCount: deleted });

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
    try { gameManager.db.deleteGame(interaction.channelId); } catch (e) { logger.warn('Failed to delete game from DB', { error: e.message }); }
    gameManager.games.delete(interaction.channelId);
    gameManager.saveState();

    logger.success('Game ended successfully', { 
      channelId: interaction.channelId,
      deletedChannels: deleted 
    });

    // Envoyer message temporaire avec nettoyage auto (si possible)
    if (deferSuccess) {
      try {
        await sendTemporaryMessage(
          interaction,
          t('game.ended', { deleted: deleted }),
          2000
        );
      } catch (e) {
        logger.warn('Failed to send success message', { error: e.message });
      }
    } else {
      logger.info('Cleanup completed but cannot reply (interaction expired)');
    }
  }
};
