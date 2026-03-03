const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const gameManager = require("../game/gameManager");
const { sendTemporaryMessage } = require("../utils/commands");
const { safeDefer } = require("../utils/interaction");
const { isAdmin } = require("../utils/validators");
const { game: logger } = require("../utils/logger");
const { t } = require('../utils/i18n');

module.exports = {
  data: new SlashCommandBuilder()
    .setName("clear")
    .setDescription("🧹 Nettoyer les channels résiduels du jeu (admin)"),

  async execute(interaction) {
    // Defer sans vérification de catégorie (clear doit marcher partout)
    await safeDefer(interaction);
    
    // Vérifier les permissions admin
    if (!isAdmin(interaction)) {
      await interaction.editReply({ content: t('error.admin_required'), flags: MessageFlags.Ephemeral });
      return;
    }

    try {
      const guild = interaction.guild;
      
      // 100% DB-based channel deletion: only delete channels tracked in game_channels table
      const deletedCount = await gameManager.cleanupAllGameChannels(guild);

      // Nettoyer les games de CE serveur uniquement
      const guildId = interaction.guildId;
      const guildGames = Array.from(gameManager.games.entries()).filter(([, g]) => g.guildId === guildId);
      const gamesCount = guildGames.length;
      // Émettre gameEnded + déconnecter voix + purge (memory + DB + timers)
      for (const [channelId, game] of guildGames) {
        // Émettre gameEnded pour le dashboard web
        gameManager._emitGameEvent(game, 'gameEnded', {
          victor: null,
          reason: 'clear',
          players: game.players ? game.players.map(p => ({ id: p.id, username: p.username, role: p.role, alive: p.alive })) : []
        });

        // Déconnecter le bot du channel vocal (voice channels already deleted by cleanupAllGameChannels above)
        if (game.voiceChannelId) {
          try { gameManager.disconnectVoice(game.voiceChannelId); } catch (e) { /* ignore */ }
        }

        // Single source of truth: purge memory + DB + timers in one call
        gameManager.purgeGame(channelId, game);
      }

      // Also clean orphaned DB games for THIS guild (zombie rows not in memory)
      const zombiesPurged = gameManager.purgeGuildZombies(guildId);
      if (zombiesPurged > 0) {
        logger.warn('ZOMBIE_DB_ROWS_PURGED', { count: zombiesPurged, guildId });
      }

      // Envoyer message temporaire avec nettoyage auto
      await sendTemporaryMessage(
        interaction,
        t('cleanup.success', { channels: deletedCount, games: gamesCount + zombiesPurged }),
        2000
      );

    } catch (error) {
      logger.error('CLEAR_ERROR', { error: error.message });
      await interaction.editReply(t('error.cleanup_error'));
    }
  }
};
