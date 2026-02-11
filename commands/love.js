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

    game.lovers.push([a.id, b.id]);
    gameManager.logAction(game, `Cupidon lie ${a.username} et ${b.username}`);

    try {
      await a.send(`💘 Tu as été lié.e par Cupidon avec **${b.username}**. Si l'un de vous meurt, l'autre mourra de chagrin.`);
      await b.send(`💘 Tu as été lié.e par Cupidon avec **${a.username}**. Si l'un de vous meurt, l'autre mourra de chagrin.`);
    } catch (err) {
      // DM failures are non-critical
    }

    await interaction.reply({ content: `✅ ${a.username} et ${b.username} sont désormais amoureux.`, flags: MessageFlags.Ephemeral });

    if (game.phase === PHASES.NIGHT) {
      if (gameManager.hasAliveRealRole(game, ROLES.WEREWOLF)) {
        game.subPhase = PHASES.LOUPS;
        await gameManager.announcePhase(interaction.guild, game, "Les loups se réveillent...");
      } else if (gameManager.hasAliveRealRole(game, ROLES.WITCH)) {
        game.subPhase = PHASES.SORCIERE;
        await gameManager.announcePhase(interaction.guild, game, "La sorcière se réveille...");
      } else if (gameManager.hasAliveRealRole(game, ROLES.SEER)) {
        game.subPhase = PHASES.VOYANTE;
        await gameManager.announcePhase(interaction.guild, game, "La voyante se réveille...");
      } else {
        await gameManager.transitionToDay(interaction.guild, game);
      }
    }
  }
};
