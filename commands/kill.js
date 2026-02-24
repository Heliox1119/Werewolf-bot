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
    if (gameManager.isRecentDuplicate('kill', interaction.channelId, interaction.user.id)) {
      return;
    }
    const game = gameManager.getGameByChannelId(interaction.channelId);
    if (!game) {
      await safeReply(interaction, { content: t('error.no_game'), flags: MessageFlags.Ephemeral });
      return;
    }

    // Vérifier que c'est la nuit
    if (game.phase !== PHASES.NIGHT) {
      await safeReply(interaction, { content: t('error.wolves_only_at_night'), flags: MessageFlags.Ephemeral });
      return;
    }

    const player = game.players.find(p => p.id === interaction.user.id);
    if (!player || !player.alive) {
      await safeReply(interaction, { content: t('error.you_are_dead'), flags: MessageFlags.Ephemeral });
      return;
    }

    // === LOUP BLANC solo kill phase ===
    if (interaction.channelId === game.whiteWolfChannelId && game.subPhase === PHASES.LOUP_BLANC) {
      return await this.handleWhiteWolfKill(interaction, game, player);
    }

    // === Regular wolves kill phase ===
    if (interaction.channelId !== game.wolvesChannelId) {
      await safeReply(interaction, { content: t('error.only_wolves_channel'), flags: MessageFlags.Ephemeral });
      return;
    }
    if (game.subPhase !== PHASES.LOUPS) {
      await safeReply(interaction, { content: t('error.not_wolves_turn'), flags: MessageFlags.Ephemeral });
      return;
    }

    // Vérifier que c'est un loup vivant (WEREWOLF ou WHITE_WOLF)
    const isWolf = player.role === ROLES.WEREWOLF || player.role === ROLES.WHITE_WOLF;
    if (!isWolf) {
      await safeReply(interaction, { content: t('error.not_werewolf'), flags: MessageFlags.Ephemeral });
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

    // Les loups ne peuvent pas tuer un autre loup (pendant la phase LOUPS)
    if (targetPlayer.role === ROLES.WEREWOLF || targetPlayer.role === ROLES.WHITE_WOLF) {
      await safeReply(interaction, { content: t('error.cannot_kill_wolf'), flags: MessageFlags.Ephemeral });
      return;
    }

    // --- Consensus loup : vote de meute ---
    if (!game.wolfVotes) game.wolfVotes = new Map(); // wolfId -> targetId
    game.wolfVotes.set(interaction.user.id, target.id);

    const aliveWolves = game.players.filter(p => (p.role === ROLES.WEREWOLF || p.role === ROLES.WHITE_WOLF) && p.alive && gameManager.isRealPlayerId(p.id));
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

      // Auto-chain to next night role
      await this.advanceFromWolves(interaction.guild, game, target.username);
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

        // Auto-chain to next night role
        await this.advanceFromWolves(interaction.guild, game, winnerPlayer.username);
      } else {
        await safeReply(interaction, { content: t('cmd.kill.vote_pending', { name: target.username, n: votesForTarget, m: majorityNeeded }), flags: MessageFlags.Ephemeral });
      }
    }
  },

  /**
   * Advance from LOUPS phase: LOUP_BLANC (odd nights) → SORCIERE → VOYANTE → REVEIL
   */
  async advanceFromWolves(guild, game, victimName) {
    // Vérifier si le Loup Blanc se réveille (nuits impaires, dayCount >= 1)
    const isOddNight = (game.dayCount || 0) % 2 === 1;
    if (isOddNight && gameManager.hasAliveRealRole(game, ROLES.WHITE_WOLF)) {
      gameManager._setSubPhase(game, PHASES.LOUP_BLANC);
      await gameManager.announcePhase(guild, game, t('phase.white_wolf_wakes'));
      gameManager.notifyTurn(guild, game, ROLES.WHITE_WOLF);
      gameManager.startNightAfkTimeout(guild, game);
      return;
    }

    if (gameManager.hasAliveRealRole(game, ROLES.WITCH)) {
      gameManager._setSubPhase(game, PHASES.SORCIERE);
      // Informer la sorcière de la victime dans son channel privé
      if (game.witchChannelId) {
        try {
          const witchChannel = await guild.channels.fetch(game.witchChannelId);
          await witchChannel.send(t('cmd.kill.witch_notify', { name: victimName }));
        } catch (e) { /* ignore */ }
      }
      await gameManager.announcePhase(guild, game, t('phase.witch_wakes'));
      gameManager.startNightAfkTimeout(guild, game);
      return;
    }

    if (gameManager.hasAliveRealRole(game, ROLES.SEER)) {
      gameManager._setSubPhase(game, PHASES.VOYANTE);
      await gameManager.announcePhase(guild, game, t('phase.seer_wakes'));
      gameManager.startNightAfkTimeout(guild, game);
      return;
    }

    await gameManager.transitionToDay(guild, game);
  },

  /**
   * Handle the White Wolf's solo kill during LOUP_BLANC phase.
   * The White Wolf can kill ONE other wolf (WEREWOLF only, not itself).
   */
  async handleWhiteWolfKill(interaction, game, player) {
    if (player.role !== ROLES.WHITE_WOLF) {
      await safeReply(interaction, { content: t('error.action_forbidden'), flags: MessageFlags.Ephemeral });
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

    // Le Loup Blanc ne peut tuer que des loups normaux (pas lui-même, pas des villageois)
    if (targetPlayer.role !== ROLES.WEREWOLF) {
      await safeReply(interaction, { content: t('error.white_wolf_target_must_be_wolf'), flags: MessageFlags.Ephemeral });
      return;
    }

    // Enregistrer la cible
    game.whiteWolfKillTarget = target.id;
    gameManager.clearNightAfkTimeout(game);
    gameManager.logAction(game, `Loup Blanc choisit de dévorer: ${target.username}`);
    try { gameManager.db.addNightAction(game.mainChannelId, game.dayCount || 0, 'white_wolf_kill', interaction.user.id, target.id); } catch (e) { /* ignore */ }

    await safeReply(interaction, { content: t('cmd.kill.white_wolf_success', { name: target.username }), flags: MessageFlags.Ephemeral });

    // Avancer vers la sous-phase suivante (SORCIERE ou VOYANTE ou jour)
    if (gameManager.hasAliveRealRole(game, ROLES.WITCH)) {
      gameManager._setSubPhase(game, PHASES.SORCIERE);
      if (game.witchChannelId && game.nightVictim) {
        try {
          const nightVictimPlayer = game.players.find(p => p.id === game.nightVictim);
          const witchChannel = await interaction.guild.channels.fetch(game.witchChannelId);
          await witchChannel.send(t('cmd.kill.witch_notify', { name: nightVictimPlayer ? nightVictimPlayer.username : '???' }));
        } catch (e) { /* ignore */ }
      }
      await gameManager.announcePhase(interaction.guild, game, t('phase.witch_wakes'));
      gameManager.startNightAfkTimeout(interaction.guild, game);
      return;
    }

    if (gameManager.hasAliveRealRole(game, ROLES.SEER)) {
      gameManager._setSubPhase(game, PHASES.VOYANTE);
      await gameManager.announcePhase(interaction.guild, game, t('phase.seer_wakes'));
      gameManager.startNightAfkTimeout(interaction.guild, game);
      return;
    }

    await gameManager.transitionToDay(interaction.guild, game);
  }
};
