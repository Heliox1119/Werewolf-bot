const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const gameManager = require("../game/gameManager");
const PHASES = require("../game/phases");
const { safeReply } = require("../utils/interaction");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("vote")
    .setDescription("Voter pour éliminer quelqu'un (jour seulement)")
    .addUserOption(option =>
      option
        .setName("target")
        .setDescription("La personne à éliminer")
        .setRequired(true)
    ),

  async execute(interaction) {
    // Vérification catégorie
    const channel = await interaction.guild.channels.fetch(interaction.channelId);
    if (channel.parentId !== '1469976287790633146') {
      await safeReply(interaction, { content: "❌ Action interdite ici. Utilisez cette commande dans la catégorie dédiée au jeu.", flags: MessageFlags.Ephemeral });
      return;
    }
    const game = gameManager.getGameByChannelId(interaction.channelId);
    if (!game) {
      await safeReply(interaction, { content: "❌ Aucune partie ici", flags: MessageFlags.Ephemeral });
      return;
    }

    const allowedChannels = [game.mainChannelId, game.villageChannelId].filter(Boolean);
    if (!allowedChannels.includes(interaction.channelId)) {
      await safeReply(interaction, { content: "❌ Cette commande ne peut être utilisée que dans le channel principal ou village", flags: MessageFlags.Ephemeral });
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

    const target = interaction.options.getUser("target");
    const targetPlayer = game.players.find(p => p.id === target.id);

    if (!targetPlayer) {
      await safeReply(interaction, { content: "❌ Joueur non trouvé", flags: MessageFlags.Ephemeral });
      return;
    }

    if (!targetPlayer.alive) {
      await safeReply(interaction, { content: "❌ Ce joueur est déjà mort", flags: MessageFlags.Ephemeral });
      return;
    }

    if (!game.voteVoters) {
      game.voteVoters = new Map();
    }

    const aliveReal = game.players.filter(p => p.alive && gameManager.isRealPlayerId(p.id));
    if (game.phase === PHASES.DAY && aliveReal.length <= 1) {
      await safeReply(interaction, { content: "⚠️ Il ne reste qu'un seul joueur vivant. Fin de partie automatique.", flags: MessageFlags.Ephemeral });
      await gameManager.announceVictoryIfAny(interaction.guild, game);
      return;
    }

    // Si le votant est le capitaine, son vote compte double
    const increment = game.captainId && game.captainId === interaction.user.id ? 2 : 1;

    // Remove previous vote if exists
    const previousTarget = game.voteVoters.get(interaction.user.id);
    if (previousTarget) {
      const prevCount = (game.votes.get(previousTarget) || 0) - increment;
      if (prevCount <= 0) {
        game.votes.delete(previousTarget);
      } else {
        game.votes.set(previousTarget, prevCount);
      }
    }

    // Add new vote
    game.voteVoters.set(interaction.user.id, target.id);
    game.votes.set(target.id, (game.votes.get(target.id) || 0) + increment);

    const note = increment === 2 ? " (capitaine : voix x2)" : "";
    await safeReply(interaction, { content: `✅ Tu as voté pour **${target.username}** (${game.votes.get(target.id)} votes)${note}`, flags: MessageFlags.Ephemeral });
    gameManager.logAction(game, `${interaction.user.username} vote contre ${target.username}${note}`);

    if (game.phase === PHASES.DAY) {
      const votedRealCount = aliveReal.filter(p => game.voteVoters.has(p.id)).length;

      if (aliveReal.length > 0 && votedRealCount >= aliveReal.length) {
        await gameManager.transitionToNight(interaction.guild, game);
      }
    }
  }
};
