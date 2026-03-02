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
      logger.warn('DUPLICATE_END_IGNORED');
      return;
    }

    logger.info('END_COMMAND_CALLED', { 
      channelId: interaction.channelId,
      user: interaction.user.username,
      gamesCount: gameManager.games.size,
      interactionAge: Date.now() - interaction.createdTimestamp
    });
    
    // Defer sans vérification de catégorie (end doit marcher depuis le channel de création)
    const deferSuccess = await safeDefer(interaction);
    if (!deferSuccess) {
      logger.warn('END_DEFER_FAILED');
    }
    
    logger.debug('GAME_CHANNEL_CHECK', { channelId: interaction.channelId });
    
    // Log all active games for debugging (guild-scoped)
    const allGames = Array.from(gameManager.games.entries())
      .filter(([, g]) => g.guildId === interaction.guildId)
      .map(([id]) => id);
    logger.debug('ACTIVE_GAMES', { games: allGames });
    
    const game = gameManager.getGameByChannelId(interaction.channelId);
    if (!game) {
      // Reconciler already purged any zombie DB row via getGameByChannel.
      // Double-check: purge DB row for this channel as a safety net.
      try { gameManager.db.deleteGame(interaction.channelId); } catch (e) { /* ignore */ }

      logger.warn('NO_GAME_IN_CHANNEL', { 
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
          logger.warn('NO_GAME_REPLY_SEND_FAILED', { error: e.message });
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

    logger.info('GAME_CLEANUP_STARTED', { 
      channelId: interaction.channelId,
      playerCount: game.players.length,
      phase: game.phase
    });

    // 1) Annuler TOUS les timers en cours (AFK nuit, chasseur, capitaine, lobby)
    // (handled by purgeGame below)

    // 2) Émettre l'événement gameEnded pour le dashboard web AVANT suppression
    gameManager._emitGameEvent(game, 'gameEnded', {
      victor: null,
      reason: 'manual',
      players: game.players.map(p => ({ id: p.id, username: p.username, role: p.role, alive: p.alive })),
      dayCount: game.dayCount
    });

    // 3) Déconnecter le bot du channel vocal
    if (game.voiceChannelId) {
      try { 
        gameManager.disconnectVoice(game.voiceChannelId);
        logger.debug('VOICE_DISCONNECTED');
      } catch (e) { 
        logger.warn('VOICE_DISCONNECT_FAILED', { error: e.message });
      }
    }

    // 4) Purge: single source of truth — clears memory + DB + timers
    gameManager.purgeGame(interaction.channelId, game);

    // 5) Répondre à l'interaction AVANT de supprimer les channels
    //    (car le channel de l'interaction sera supprimé avec les autres)
    if (deferSuccess) {
      try {
        await interaction.editReply({ content: t('game.ended', { deleted: game.channels ? game.channels.length : '?' }) });
      } catch (e) {
        logger.warn('SUCCESS_MESSAGE_SEND_FAILED', { error: e.message });
      }
    }

    // 6) Nettoyer les channels (suppression Discord — fait en dernier)
    const deleted = await gameManager.cleanupChannels(interaction.guild, game);
    
    logger.info('GAME_ENDED', { 
      channelId: interaction.channelId,
      deletedChannels: deleted 
    });
  }
};
