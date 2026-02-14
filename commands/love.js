const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const gameManager = require('../game/gameManager');
const ROLES = require('../game/roles');
const PHASES = require('../game/phases');
const { isInGameCategory } = require('../utils/validators');
const { safeReply } = require('../utils/interaction');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('love')
    .setDescription('Cupidon : choisir deux joueurs pour les unir (dans ton channel)')
    .addUserOption(opt => opt.setName('a').setDescription('Premier joueur').setRequired(true))
    .addUserOption(opt => opt.setName('b').setDescription('Deuxième joueur').setRequired(true)),

  async execute(interaction) {
    // Vérification catégorie
    if (!await isInGameCategory(interaction)) {
      await safeReply(interaction, { content: '❌ Action interdite ici. Utilisez cette commande dans la catégorie dédiée au jeu.', flags: MessageFlags.Ephemeral });
      return;
    }
    const game = gameManager.getGameByChannelId(interaction.channelId);
    if (!game) {
      await safeReply(interaction, { content: '❌ Aucune partie ici', flags: MessageFlags.Ephemeral });
      return;
    }
    if (interaction.channelId !== game.cupidChannelId) {
      await safeReply(interaction, { content: '❌ Cette commande ne peut être utilisée que dans le channel de Cupidon', flags: MessageFlags.Ephemeral });
      return;
    }

    const player = game.players.find(p => p.id === interaction.user.id);
    if (!player || player.role !== ROLES.CUPID) {
      await safeReply(interaction, { content: '❌ Tu n\'es pas Cupidon dans cette partie.', flags: MessageFlags.Ephemeral });
      return;
    }

    // Cupidon ne peut lier qu'un seul couple
    if (game.lovers && game.lovers.length > 0) {
      await safeReply(interaction, { content: '❌ Tu as déjà utilisé ton pouvoir ! Un seul couple est autorisé.', flags: MessageFlags.Ephemeral });
      return;
    }

    const a = interaction.options.getUser('a');
    const b = interaction.options.getUser('b');

    if (a.id === b.id) {
      await safeReply(interaction, { content: '❌ Tu dois choisir deux personnes différentes.', flags: MessageFlags.Ephemeral });
      return;
    }

    const pa = game.players.find(p => p.id === a.id);
    const pb = game.players.find(p => p.id === b.id);
    if (!pa || !pb) {
      await safeReply(interaction, { content: '❌ Les cibles doivent être des joueurs de la partie.', flags: MessageFlags.Ephemeral });
      return;
    }

    if (!pa.alive || !pb.alive) {
      await safeReply(interaction, { content: '❌ Les cibles doivent être en vie.', flags: MessageFlags.Ephemeral });
      return;
    }

    // Cupidon ne peut agir que la nuit, pendant sa sous-phase
    if (game.phase !== PHASES.NIGHT) {
      await safeReply(interaction, { content: '❌ Cupidon ne peut lier les amoureux que pendant la nuit !', flags: MessageFlags.Ephemeral });
      return;
    }
    if (game.subPhase !== PHASES.CUPIDON) {
      await safeReply(interaction, { content: '❌ Ce n\'est pas le moment d\'utiliser ton pouvoir.', flags: MessageFlags.Ephemeral });
      return;
    }

    game.lovers.push([a.id, b.id]);
    gameManager.logAction(game, `Cupidon lie ${a.username} et ${b.username}`);
    try { gameManager.db.addNightAction(game.mainChannelId, game.dayCount || 0, 'love', interaction.user.id, a.id); } catch (e) { /* ignore */ }

    try {
      await a.send(`💘 Tu as été lié.e par Cupidon avec **${b.username}**. Si l'un de vous meurt, l'autre mourra de chagrin.`);
      await b.send(`💘 Tu as été lié.e par Cupidon avec **${a.username}**. Si l'un de vous meurt, l'autre mourra de chagrin.`);
    } catch (err) {
      // DM failures are non-critical
    }

    await safeReply(interaction, { content: `✅ ${a.username} et ${b.username} sont désormais amoureux.`, flags: MessageFlags.Ephemeral });

    // Avancer la sous-phase après l'action de Cupidon
    await gameManager.advanceSubPhase(interaction.guild, game);
  }
};
