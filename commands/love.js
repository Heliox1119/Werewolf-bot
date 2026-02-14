const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const gameManager = require('../game/gameManager');
const ROLES = require('../game/roles');
const PHASES = require('../game/phases');
const { isInGameCategory } = require('../utils/validators');
const { safeReply } = require('../utils/interaction');
const { t, translateRole } = require('../utils/i18n');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('love')
    .setDescription('Cupidon : choisir deux joueurs pour les unir (dans ton channel)')
    .addUserOption(opt => opt.setName('a').setDescription('Premier joueur').setRequired(true))
    .addUserOption(opt => opt.setName('b').setDescription('Deuxième joueur').setRequired(true)),

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
    if (interaction.channelId !== game.cupidChannelId) {
      await safeReply(interaction, { content: t('error.only_cupid_channel'), flags: MessageFlags.Ephemeral });
      return;
    }

    const player = game.players.find(p => p.id === interaction.user.id);
    if (!player || player.role !== ROLES.CUPID) {
      await safeReply(interaction, { content: t('error.not_cupid'), flags: MessageFlags.Ephemeral });
      return;
    }

    // Cupidon ne peut lier qu'un seul couple
    if (game.lovers && game.lovers.length > 0) {
      await safeReply(interaction, { content: t('error.cupid_already_used'), flags: MessageFlags.Ephemeral });
      return;
    }

    const a = interaction.options.getUser('a');
    const b = interaction.options.getUser('b');

    if (a.id === b.id) {
      await safeReply(interaction, { content: t('error.same_person'), flags: MessageFlags.Ephemeral });
      return;
    }

    const pa = game.players.find(p => p.id === a.id);
    const pb = game.players.find(p => p.id === b.id);
    if (!pa || !pb) {
      await safeReply(interaction, { content: t('error.targets_must_be_players'), flags: MessageFlags.Ephemeral });
      return;
    }

    if (!pa.alive || !pb.alive) {
      await safeReply(interaction, { content: t('error.targets_must_be_alive'), flags: MessageFlags.Ephemeral });
      return;
    }

    // Cupidon ne peut agir que la nuit, pendant sa sous-phase
    if (game.phase !== PHASES.NIGHT) {
      await safeReply(interaction, { content: t('error.cupid_night_only'), flags: MessageFlags.Ephemeral });
      return;
    }
    if (game.subPhase !== PHASES.CUPIDON) {
      await safeReply(interaction, { content: t('error.cupid_wrong_time'), flags: MessageFlags.Ephemeral });
      return;
    }

    game.lovers.push([a.id, b.id]);
    gameManager.logAction(game, `Cupidon lie ${a.username} et ${b.username}`);
    try { gameManager.db.addNightAction(game.mainChannelId, game.dayCount || 0, 'love', interaction.user.id, a.id); } catch (e) { /* ignore */ }

    try {
      await a.send(t('cmd.love.dm', { name: b.username }));
      await b.send(t('cmd.love.dm', { name: a.username }));
    } catch (err) {
      // DM failures are non-critical
    }

    await safeReply(interaction, { content: t('cmd.love.success', { a: a.username, b: b.username }), flags: MessageFlags.Ephemeral });

    // Avancer la sous-phase après l'action de Cupidon
    await gameManager.advanceSubPhase(interaction.guild, game);
  }
};
