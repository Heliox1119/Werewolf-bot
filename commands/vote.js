const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const gameManager = require("../game/gameManager");
const PHASES = require("../game/phases");
const { safeReply } = require("../utils/interaction");
const { isInGameCategory } = require("../utils/validators");

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
    if (!await isInGameCategory(interaction)) {
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

    // Vérifier que c'est le jour
    if (game.phase !== PHASES.DAY) {
      await safeReply(interaction, { content: "❌ Les votes ne sont possibles que pendant le jour !", flags: MessageFlags.Ephemeral });
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

    // --- Départage capitaine ---
    if (game._captainTiebreak && Array.isArray(game._captainTiebreak)) {
      if (interaction.user.id !== game.captainId) {
        await safeReply(interaction, { content: "⚖️ Seul le capitaine peut départager l'égalité.", flags: MessageFlags.Ephemeral });
        return;
      }
      if (!game._captainTiebreak.includes(target.id)) {
        const tiedNames = game._captainTiebreak.map(id => {
          const p = game.players.find(pl => pl.id === id);
          return p ? p.username : id;
        }).join(', ');
        await safeReply(interaction, { content: `❌ Tu dois choisir parmi les ex-aequo : ${tiedNames}`, flags: MessageFlags.Ephemeral });
        return;
      }

      // Capitaine a choisi — éliminer la cible
      const villageChannel = game.villageChannelId
        ? await interaction.guild.channels.fetch(game.villageChannelId)
        : await interaction.guild.channels.fetch(game.mainChannelId);

      if (game.voiceChannelId) {
        gameManager.playAmbience(game.voiceChannelId, 'death.mp3');
      }
      await villageChannel.send(`⚖️🔨 Le capitaine a tranché : **${targetPlayer.username}** est éliminé !`);
      const collateral = gameManager.kill(game.mainChannelId, target.id);
      gameManager.logAction(game, `Départage capitaine: ${targetPlayer.username} éliminé`);

      for (const dead of collateral) {
        await villageChannel.send(`💔 **${dead.username}** meurt de chagrin... (amoureux)`);
        gameManager.logAction(game, `Mort d'amour: ${dead.username}`);
      }

      // Vérifier chasseur
      if (targetPlayer.role === require('../game/roles').HUNTER) {
        game._hunterMustShoot = targetPlayer.id;
        await villageChannel.send(`🏹 **${targetPlayer.username}** était le Chasseur ! Il doit tirer avec \`/shoot @joueur\` !`);
        gameManager.startHunterTimeout(interaction.guild, game, targetPlayer.id);
      }

      game._captainTiebreak = null;
      await safeReply(interaction, { content: `✅ Tu as départagé en faveur de **${target.username}**`, flags: MessageFlags.Ephemeral });

      // Vérifier victoire puis passer à la nuit
      const victory = gameManager.checkWinner(game);
      if (victory) {
        await gameManager.announceVictoryIfAny(interaction.guild, game);
      } else {
        await gameManager.transitionToNight(interaction.guild, game);
      }
      return;
    }

    if (!game.voteVoters) {
      game.voteVoters = new Map();
    }

    const aliveReal = game.players.filter(p => p.alive && gameManager.isRealPlayerId(p.id));
    if (aliveReal.length <= 1) {
      await safeReply(interaction, { content: "⚠️ Il ne reste qu'un seul joueur vivant. Fin de partie automatique.", flags: MessageFlags.Ephemeral });
      await gameManager.announceVictoryIfAny(interaction.guild, game);
      return;
    }

    // Si le votant est le capitaine, son vote compte double
    const isCaptain = game.captainId && game.captainId === interaction.user.id;
    const increment = isCaptain ? 2 : 1;

    // Remove previous vote if exists
    const previousTarget = game.voteVoters.get(interaction.user.id);
    if (previousTarget) {
      // Utiliser l'incrément d'origine du vote précédent
      if (!game._voteIncrements) game._voteIncrements = new Map();
      const prevIncrement = game._voteIncrements.get(interaction.user.id) || 1;
      const prevCount = (game.votes.get(previousTarget) || 0) - prevIncrement;
      if (prevCount <= 0) {
        game.votes.delete(previousTarget);
      } else {
        game.votes.set(previousTarget, prevCount);
      }
    }

    // Tracker l'incrément utilisé pour ce vote
    if (!game._voteIncrements) game._voteIncrements = new Map();
    game._voteIncrements.set(interaction.user.id, increment);

    // Add new vote
    game.voteVoters.set(interaction.user.id, target.id);
    game.votes.set(target.id, (game.votes.get(target.id) || 0) + increment);

    const note = increment === 2 ? " (capitaine : voix x2)" : "";
    await safeReply(interaction, { content: `✅ Tu as voté pour **${target.username}** (${game.votes.get(target.id)} votes)${note}`, flags: MessageFlags.Ephemeral });
    gameManager.logAction(game, `${interaction.user.username} vote contre ${target.username}${note}`);

    // Annonce publique dans le village
    try {
      const villageChannel = game.villageChannelId
        ? await interaction.guild.channels.fetch(game.villageChannelId)
        : await interaction.guild.channels.fetch(game.mainChannelId);
      const votedRealSoFar = aliveReal.filter(p => game.voteVoters.has(p.id)).length;
      await villageChannel.send(`🗳️ **${interaction.user.username}** a voté. (${votedRealSoFar}/${aliveReal.length})`);
    } catch (e) { /* ignore */ }

    // Sync vote to DB
    try { gameManager.db.addVote(game.mainChannelId, interaction.user.id, target.id, 'village', game.dayCount || 0); } catch (e) { /* ignore */ }

    const votedRealCount = aliveReal.filter(p => game.voteVoters.has(p.id)).length;
    if (aliveReal.length > 0 && votedRealCount >= aliveReal.length) {
      await gameManager.transitionToNight(interaction.guild, game);
    }
  }
};
