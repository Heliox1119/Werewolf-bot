const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const gameManager = require("../game/gameManager");
const { safeReply } = require("../utils/interaction");
const { isInGameCategory } = require("../utils/validators");
const { commands: logger } = require("../utils/logger");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("vote-end")
    .setDescription("Voter pour arrêter la partie en cours"),

  async execute(interaction) {
    // Vérification catégorie
    if (!await isInGameCategory(interaction)) {
      await safeReply(interaction, { content: "❌ Action interdite ici. Utilisez cette commande dans la catégorie dédiée au jeu.", flags: MessageFlags.Ephemeral });
      return;
    }
    const game = gameManager.getGameByChannelId(interaction.channelId);
    if (!game) {
      await safeReply(interaction, { content: "❌ Aucune partie en cours ici", flags: MessageFlags.Ephemeral });
      return;
    }

    const player = game.players.find(p => p.id === interaction.user.id);
    if (!player) {
      await safeReply(interaction, { content: "❌ Tu n'es pas dans cette partie", flags: MessageFlags.Ephemeral });
      return;
    }

    if (!player.alive) {
      await safeReply(interaction, { content: "❌ Tu es mort, tu ne peux pas voter", flags: MessageFlags.Ephemeral });
      return;
    }

    // Initialiser le Set de votes si nécessaire
    if (!game.endVotes) {
      game.endVotes = new Set();
    }

    // Vérifier si le joueur a déjà voté
    if (game.endVotes.has(interaction.user.id)) {
      await safeReply(interaction, { content: "❌ Tu as déjà voté pour arrêter la partie", flags: MessageFlags.Ephemeral });
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

      // Annoncer dans le village si possible
      try {
        const villageChannelId = game.villageChannelId || game.mainChannelId;
        const guild = interaction.guild;
        const channel = await guild.channels.fetch(villageChannelId).catch(() => null);
        if (channel) {
          await channel.send(
            `🗳️ **Vote d'arrêt adopté** (${currentVotes}/${alivePlayers.length})\n\n` +
            `La majorité des joueurs a voté pour arrêter la partie. Fin de la partie !`
          );
        }
      } catch (e) { /* ignore */ }

      // Nettoyer les channels
      const deleted = await gameManager.cleanupChannels(interaction.guild, game);

      // Déconnecter le bot du channel vocal
      if (game.voiceChannelId) {
        try { gameManager.disconnectVoice(game.voiceChannelId); } catch (e) { /* ignore */ }
      }

      // Supprimer la partie
      try { gameManager.db.deleteGame(game.mainChannelId); } catch (e) { /* ignore */ }
      gameManager.games.delete(game.mainChannelId);
      gameManager.saveState();

      logger.success('Game ended by vote', { channelId: game.mainChannelId, deletedChannels: deleted });

      await safeReply(interaction, {
        content: `🗳️ **Partie arrêtée par vote !** (${currentVotes}/${alivePlayers.length})\n🗑️ ${deleted} channel(s) supprimé(s).`
      });
    } else {
      await safeReply(interaction, {
        content: `🗳️ **${interaction.user.username}** vote pour arrêter la partie (**${currentVotes}/${votesNeeded}** votes nécessaires)\n\n` +
          `💡 Les autres joueurs peuvent utiliser \`/vote-end\` pour voter aussi.`
      });
    }
  }
};
