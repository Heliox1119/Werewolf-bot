const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const gameManager = require("../game/gameManager");
const ROLES = require("../game/roles");
const PHASES = require("../game/phases");
const { safeReply } = require("../utils/interaction");
const { isInGameCategory } = require("../utils/validators");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("kill")
    .setDescription("Loups-garous : choisir une victime")
    .addUserOption(option =>
      option
        .setName("target")
        .setDescription("La victime")
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

    // Vérifier que c'est le channel des loups
    if (interaction.channelId !== game.wolvesChannelId) {
      await safeReply(interaction, { content: "❌ Cette commande ne peut être utilisée que dans le channel des loups", flags: MessageFlags.Ephemeral });
      return;
    }

    // Vérifier que c'est la nuit ET la sous-phase des loups
    if (game.phase !== PHASES.NIGHT) {
      await safeReply(interaction, { content: "❌ Les loups ne chassent que la nuit !", flags: MessageFlags.Ephemeral });
      return;
    }
    if (game.subPhase !== PHASES.LOUPS) {
      await safeReply(interaction, { content: "❌ Ce n'est pas le tour des loups", flags: MessageFlags.Ephemeral });
      return;
    }

    // Vérifier que c'est un loup vivant
    const player = game.players.find(p => p.id === interaction.user.id);
    if (!player || player.role !== ROLES.WEREWOLF) {
      await safeReply(interaction, { content: "❌ Tu n'es pas un loup-garou", flags: MessageFlags.Ephemeral });
      return;
    }
    if (!player.alive) {
      await safeReply(interaction, { content: "❌ Tu es mort", flags: MessageFlags.Ephemeral });
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

    if (targetPlayer.role === ROLES.WEREWOLF) {
      await safeReply(interaction, { content: "❌ Tu ne peux pas tuer un autre loup-garou !", flags: MessageFlags.Ephemeral });
      return;
    }

    // --- Consensus loup : vote de meute ---
    if (!game.wolfVotes) game.wolfVotes = new Map(); // wolfId -> targetId
    game.wolfVotes.set(interaction.user.id, target.id);

    const aliveWolves = game.players.filter(p => p.role === ROLES.WEREWOLF && p.alive && gameManager.isRealPlayerId(p.id));
    const totalWolves = aliveWolves.length;
    const votesForTarget = [...game.wolfVotes.values()].filter(v => v === target.id).length;
    const majorityNeeded = Math.ceil(totalWolves / 2);

    // Notifier les autres loups du vote dans le channel
    const wolvesChannel = await interaction.guild.channels.fetch(game.wolvesChannelId);
    await wolvesChannel.send(`🐺 **${interaction.user.username}** vote pour dévorer **${target.username}** (${votesForTarget}/${majorityNeeded} nécessaires)`);

    if (votesForTarget >= majorityNeeded) {
      // Consensus atteint
      game.nightVictim = target.id;
      game.wolfVotes = null; // Reset
      gameManager.clearNightAfkTimeout(game);
      gameManager.logAction(game, `Loups choisissent: ${target.username} (consensus ${votesForTarget}/${totalWolves})`);
      await safeReply(interaction, { content: `✅ Consensus atteint ! ${target.username} sera la victime cette nuit.`, flags: MessageFlags.Ephemeral });

      // Auto-chain to next night role or day
      if (gameManager.hasAliveRealRole(game, ROLES.WITCH)) {
        game.subPhase = PHASES.SORCIERE;
        // Informer la sorcière de la victime dans son channel privé
        if (game.witchChannelId) {
          try {
            const witchChannel = await interaction.guild.channels.fetch(game.witchChannelId);
            await witchChannel.send(
              `🐺 **Les loups ont attaqué __${target.username}__ cette nuit.**\n` +
              `Souhaites-tu utiliser ta potion de vie ? → \`/potion type:Vie\`\n` +
              `Ou empoisonner quelqu'un ? → \`/potion type:Mort target:@joueur\`\n` +
              `Sinon, ne fais rien (le tour passe automatiquement).`
            );
          } catch (e) { /* ignore */ }
        }
        await gameManager.announcePhase(interaction.guild, game, "La sorcière se réveille...");
        gameManager.startNightAfkTimeout(interaction.guild, game);
        return;
      }

      if (gameManager.hasAliveRealRole(game, ROLES.SEER)) {
        game.subPhase = PHASES.VOYANTE;
        await gameManager.announcePhase(interaction.guild, game, "La voyante se réveille...");
        gameManager.startNightAfkTimeout(interaction.guild, game);
        return;
      }

      await gameManager.transitionToDay(interaction.guild, game);
    } else {
      // Pas encore consensus
      const allVoted = aliveWolves.every(w => game.wolfVotes.has(w.id));
      if (allVoted) {
        // Tous ont voté mais pas de majorité — le plus voté gagne
        const voteCounts = new Map();
        for (const targetId of game.wolfVotes.values()) {
          voteCounts.set(targetId, (voteCounts.get(targetId) || 0) + 1);
        }
        const sorted = [...voteCounts.entries()].sort((a, b) => b[1] - a[1]);
        const winnerId = sorted[0][0];
        const winnerPlayer = game.players.find(p => p.id === winnerId);

        game.nightVictim = winnerId;
        game.wolfVotes = null;
        gameManager.clearNightAfkTimeout(game);
        gameManager.logAction(game, `Loups choisissent: ${winnerPlayer.username} (pluralité)`);
        await wolvesChannel.send(`🐺 La meute a choisi **${winnerPlayer.username}** comme victime !`);
        await safeReply(interaction, { content: `✅ Tous les loups ont voté. ${winnerPlayer.username} sera la victime.`, flags: MessageFlags.Ephemeral });

        if (gameManager.hasAliveRealRole(game, ROLES.WITCH)) {
          game.subPhase = PHASES.SORCIERE;
          if (game.witchChannelId) {
            try {
              const witchChannel2 = await interaction.guild.channels.fetch(game.witchChannelId);
              await witchChannel2.send(
                `🐺 **Les loups ont attaqué __${winnerPlayer.username}__ cette nuit.**\n` +
                `Souhaites-tu utiliser ta potion de vie ? → \`/potion type:Vie\`\n` +
                `Ou empoisonner quelqu'un ? → \`/potion type:Mort target:@joueur\`\n` +
                `Sinon, ne fais rien (le tour passe automatiquement).`
              );
            } catch (e) { /* ignore */ }
          }
          await gameManager.announcePhase(interaction.guild, game, "La sorcière se réveille...");
          gameManager.startNightAfkTimeout(interaction.guild, game);
          return;
        }

        if (gameManager.hasAliveRealRole(game, ROLES.SEER)) {
          game.subPhase = PHASES.VOYANTE;
          await gameManager.announcePhase(interaction.guild, game, "La voyante se réveille...");
          gameManager.startNightAfkTimeout(interaction.guild, game);
          return;
        }

        await gameManager.transitionToDay(interaction.guild, game);
      } else {
        await safeReply(interaction, { content: `✅ Vote enregistré pour **${target.username}** (${votesForTarget}/${majorityNeeded}). En attente des autres loups...`, flags: MessageFlags.Ephemeral });
      }
    }
  }
};
