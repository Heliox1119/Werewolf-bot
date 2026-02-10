const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const gameManager = require('../game/gameManager');
const ROLES = require('../game/roles');
const PHASES = require('../game/phases');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('love')
    .setDescription('Cupidon : choisir deux joueurs pour les unir (dans ton channel)')
    .addUserOption(opt => opt.setName('a').setDescription('Premier joueur').setRequired(true))
    .addUserOption(opt => opt.setName('b').setDescription('Deuxième joueur').setRequired(true)),

  async execute(interaction) {
    // Vérification catégorie
    const channel = await interaction.guild.channels.fetch(interaction.channelId);
    if (channel.parentId !== '1469976287790633146') {
      await interaction.reply({ content: '❌ Action interdite ici. Utilisez cette commande dans la catégorie dédiée au jeu.', flags: 64 });
      return;
    }
    const game = gameManager.getGameByChannelId(interaction.channelId);
    if (!game) {
      await interaction.reply({ content: '❌ Aucune partie ici', flags: MessageFlags.Ephemeral });
      return;
    }
    if (interaction.channelId !== game.cupidChannelId) {
      await interaction.reply({ content: '❌ Cette commande ne peut être utilisée que dans le channel de Cupidon', flags: MessageFlags.Ephemeral });
      return;
    }

    const player = game.players.find(p => p.id === interaction.user.id);
    if (!player || player.role !== 'Cupidon') {
      await interaction.reply({ content: '❌ Tu n\'es pas Cupidon dans cette partie.', flags: MessageFlags.Ephemeral });
      return;
    }

    const a = interaction.options.getUser('a');
    const b = interaction.options.getUser('b');

    if (a.id === b.id) {
      await interaction.reply({ content: '❌ Tu dois choisir deux personnes différentes.', flags: MessageFlags.Ephemeral });
      return;
    }

    const pa = game.players.find(p => p.id === a.id);
    const pb = game.players.find(p => p.id === b.id);
    if (!pa || !pb) {
      await interaction.reply({ content: '❌ Les cibles doivent être des joueurs de la partie.', flags: MessageFlags.Ephemeral });
      return;
    }

    game.lovers.push([a.id, b.id]);
    gameManager.logAction(game, `Cupidon lie ${a.username} et ${b.username}`);

    try {
      await a.send(`💘 Tu as été lié.e par Cupidon avec **${b.username}**. Si l'un de vous meurt, l'autre mourra de chagrin.`);
      await b.send(`💘 Tu as été lié.e par Cupidon avec **${a.username}**. Si l'un de vous meurt, l'autre mourra de chagrin.`);
    } catch (err) {
      console.error('Erreur DM lovers:', err);
    }

    await interaction.reply({ content: `✅ ${a.username} et ${b.username} sont désormais amoureux.`, ephemeral: false });

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
