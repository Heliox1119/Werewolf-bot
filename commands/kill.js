const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const gameManager = require("../game/gameManager");
const ROLES = require("../game/roles");
const PHASES = require("../game/phases");
const { safeReply } = require("../utils/interaction");
const { isInGameCategory } = require("../utils/validators");
const { t } = require("../utils/i18n");

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
      await safeReply(interaction, { content: t('error.action_forbidden'), flags: MessageFlags.Ephemeral });
      return;
    }
    const game = gameManager.getGameByChannelId(interaction.channelId);
    if (!game) {
      await safeReply(interaction, { content: t('error.no_game'), flags: MessageFlags.Ephemeral });
      return;
    }

    // Vérifier que c'est le channel des loups
    if (interaction.channelId !== game.wolvesChannelId) {
      await safeReply(interaction, { content: t('error.only_wolves_channel'), flags: MessageFlags.Ephemeral });
      return;
    }

    // Vérifier que c'est la nuit ET la sous-phase des loups
    if (game.phase !== PHASES.NIGHT) {
      await safeReply(interaction, { content: t('error.wolves_only_at_night'), flags: MessageFlags.Ephemeral });
      return;
    }
    if (game.subPhase !== PHASES.LOUPS) {
      await safeReply(interaction, { content: t('error.not_wolves_turn'), flags: MessageFlags.Ephemeral });
      return;
    }

    // Vérifier que c'est un loup vivant
    const player = game.players.find(p => p.id === interaction.user.id);
    if (!player || player.role !== ROLES.WEREWOLF) {
      await safeReply(interaction, { content: t('error.not_werewolf'), flags: MessageFlags.Ephemeral });
      return;
    }
    if (!player.alive) {
      await safeReply(interaction, { content: t('error.you_are_dead'), flags: MessageFlags.Ephemeral });
      return;
    }

    const target = interaction.options.getUser("target");
    const targetPlayer = game.players.find(p => p.id === target.id);

    if (!targetPlayer) {
      await safeReply(interaction, { content: t('error.player_not_found'), flags: MessageFlags.Ephemeral });
      return;
    }

    if (!targetPlayer.alive) {
      await safeReply(interaction, { content: t('error.player_already_dead'), flags: MessageFlags.Ephemeral });
      return;
    }

    if (targetPlayer.role === ROLES.WEREWOLF) {
      await safeReply(interaction, { content: t('error.cannot_kill_wolf'), flags: MessageFlags.Ephemeral });
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
    await wolvesChannel.send(t('cmd.kill.wolf_vote', { name: interaction.user.username, target: target.username, n: votesForTarget, m: majorityNeeded }));

    if (votesForTarget >= majorityNeeded) {
      // Consensus atteint
      game.nightVictim = target.id;
      game.wolfVotes = null; // Reset
      gameManager.clearNightAfkTimeout(game);
      gameManager.logAction(game, `Loups choisissent: ${target.username} (consensus ${votesForTarget}/${totalWolves})`);
      try { gameManager.db.addNightAction(game.mainChannelId, game.dayCount || 0, 'kill', interaction.user.id, target.id); } catch (e) { /* ignore */ }
      await safeReply(interaction, { content: t('cmd.kill.consensus', { name: target.username }), flags: MessageFlags.Ephemeral });

      // Auto-chain to next night role or day
      if (gameManager.hasAliveRealRole(game, ROLES.WITCH)) {
        game.subPhase = PHASES.SORCIERE;
        // Informer la sorcière de la victime dans son channel privé
        if (game.witchChannelId) {
          try {
            const witchChannel = await interaction.guild.channels.fetch(game.witchChannelId);
            await witchChannel.send(t('cmd.kill.witch_notify', { name: target.username }));
          } catch (e) { /* ignore */ }
        }
        await gameManager.announcePhase(interaction.guild, game, t('phase.witch_wakes'));
        gameManager.startNightAfkTimeout(interaction.guild, game);
        return;
      }

      if (gameManager.hasAliveRealRole(game, ROLES.SEER)) {
        game.subPhase = PHASES.VOYANTE;
        await gameManager.announcePhase(interaction.guild, game, t('phase.seer_wakes'));
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
        try { gameManager.db.addNightAction(game.mainChannelId, game.dayCount || 0, 'kill', interaction.user.id, winnerId); } catch (e) { /* ignore */ }
        await wolvesChannel.send(t('cmd.kill.pack_chose', { name: winnerPlayer.username }));
        await safeReply(interaction, { content: t('cmd.kill.all_voted', { name: winnerPlayer.username }), flags: MessageFlags.Ephemeral });

        if (gameManager.hasAliveRealRole(game, ROLES.WITCH)) {
          game.subPhase = PHASES.SORCIERE;
          if (game.witchChannelId) {
            try {
              const witchChannel2 = await interaction.guild.channels.fetch(game.witchChannelId);
              await witchChannel2.send(t('cmd.kill.witch_notify', { name: winnerPlayer.username }));
            } catch (e) { /* ignore */ }
          }
          await gameManager.announcePhase(interaction.guild, game, t('phase.witch_wakes'));
          gameManager.startNightAfkTimeout(interaction.guild, game);
          return;
        }

        if (gameManager.hasAliveRealRole(game, ROLES.SEER)) {
          game.subPhase = PHASES.VOYANTE;
          await gameManager.announcePhase(interaction.guild, game, t('phase.seer_wakes'));
          gameManager.startNightAfkTimeout(interaction.guild, game);
          return;
        }

        await gameManager.transitionToDay(interaction.guild, game);
      } else {
        await safeReply(interaction, { content: t('cmd.kill.vote_pending', { name: target.username, n: votesForTarget, m: majorityNeeded }), flags: MessageFlags.Ephemeral });
      }
    }
  }
};
