const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const gameManager = require("../game/gameManager");
const { safeReply } = require("../utils/interaction");
const { isInGameCategory } = require("../utils/validators");
const { commands: logger } = require("../utils/logger");
const { t } = require('../utils/i18n');

module.exports = {
  data: new SlashCommandBuilder()
    .setName("vote-end")
    .setDescription("Voter pour arrêter la partie en cours"),

  async execute(interaction) {
    // Vérification catégorie
    if (!await isInGameCategory(interaction)) {
      await safeReply(interaction, { content: t('error.action_forbidden'), flags: MessageFlags.Ephemeral });
      return;
    }
    const game = gameManager.getGameByChannelId(interaction.channelId);
    if (!game) {
      await safeReply(interaction, { content: t('error.no_game_running'), flags: MessageFlags.Ephemeral });
      return;
    }

    if (!game.startedAt) {
      await safeReply(interaction, { content: t('error.game_not_started'), flags: MessageFlags.Ephemeral });
      return;
    }

    const player = game.players.find(p => p.id === interaction.user.id);
    if (!player) {
      await safeReply(interaction, { content: t('error.player_not_in_game'), flags: MessageFlags.Ephemeral });
      return;
    }

    if (!player.alive) {
      await safeReply(interaction, { content: t('error.dead_cannot_vote'), flags: MessageFlags.Ephemeral });
      return;
    }

    // Initialiser le Set de votes si nécessaire
    if (!game.endVotes) {
      game.endVotes = new Set();
    }

    // Vérifier si le joueur a déjà voté
    if (game.endVotes.has(interaction.user.id)) {
      await safeReply(interaction, { content: t('error.already_voted_end'), flags: MessageFlags.Ephemeral });
      return;
    }

    // Ajouter le vote
    game.endVotes.add(interaction.user.id);

    const alivePlayers = game.players.filter(p => p.alive);
    const votesNeeded = Math.ceil(alivePlayers.length / 2);
    // Ne compter que les votes de joueurs encore vivants
    const currentVotes = [...game.endVotes].filter(id => alivePlayers.some(p => p.id === id)).length;

    logger.info('Vote-end received', {
      channelId: interaction.channelId,
      user: interaction.user.username,
      votes: currentVotes,
      needed: votesNeeded,
      alivePlayers: alivePlayers.length
    });

    gameManager.logAction(game, `${interaction.user.username} a voté pour arrêter la partie (${currentVotes}/${votesNeeded})`);

    // Majorité atteinte ?
    if (currentVotes >= votesNeeded) {
      logger.info('Vote-end majority reached, ending game', { channelId: game.mainChannelId });

      // 1) Annuler tous les timers
      gameManager.clearGameTimers(game);
      gameManager.clearLobbyTimeout(game.mainChannelId);

      // 2) Émettre gameEnded pour le dashboard web
      gameManager._emitGameEvent(game, 'gameEnded', {
        victor: null,
        reason: 'vote',
        players: game.players.map(p => ({ id: p.id, username: p.username, role: p.role, alive: p.alive })),
        dayCount: game.dayCount
      });

      // 3) Annoncer dans le village si possible
      try {
        const villageChannelId = game.villageChannelId || game.mainChannelId;
        const guild = interaction.guild;
        const channel = await guild.channels.fetch(villageChannelId).catch(() => null);
        if (channel) {
          await channel.send(
            t('cmd.vote_end.adopted', { n: currentVotes, total: alivePlayers.length })
          );
        }
      } catch (e) { /* ignore */ }

      // 4) Déconnecter le bot du channel vocal
      if (game.voiceChannelId) {
        try { gameManager.disconnectVoice(game.voiceChannelId); } catch (e) { /* ignore */ }
      }

      // 5) Supprimer la partie de la mémoire et DB
      try { gameManager.db.deleteGame(game.mainChannelId); } catch (e) { /* ignore */ }
      gameManager.games.delete(game.mainChannelId);
      gameManager.saveState();

      // 6) Répondre AVANT de supprimer les channels
      await safeReply(interaction, {
        content: t('cmd.vote_end.success', { n: currentVotes, total: alivePlayers.length, deleted: game.channels ? game.channels.length : '?' })
      });

      // 7) Nettoyer les channels (suppression Discord — en dernier)
      const deleted = await gameManager.cleanupChannels(interaction.guild, game);

      logger.success('Game ended by vote', { channelId: game.mainChannelId, deletedChannels: deleted });
    } else {
      await safeReply(interaction, {
        content: t('cmd.vote_end.cast', { name: interaction.user.username, n: currentVotes, m: votesNeeded })
      });
    }
  }
};
