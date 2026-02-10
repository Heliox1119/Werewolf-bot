const { SlashCommandBuilder, MessageFlags, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const path = require('path');
const gameManager = require('../game/gameManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('declarecaptain')
    .setDescription('Déclarer le capitaine élu (calcul des votes, utilisé sur le salon village)')
    ,

  async execute(interaction) {
    // Vérification catégorie
    const channel = await interaction.guild.channels.fetch(interaction.channelId);
    if (channel.parentId !== '1469976287790633146') {
      return interaction.reply({ content: '❌ Action interdite ici. Utilisez cette commande dans la catégorie dédiée au jeu.', flags: 64 });
    }
    const game = gameManager.getGameByChannelId(interaction.channelId);
    if (!game) return interaction.reply({ content: '❌ Aucune partie ici', flags: MessageFlags.Ephemeral });
    if (interaction.channelId !== game.villageChannelId) {
      return interaction.reply({ content: '❌ Cette commande doit être utilisée dans le salon village', flags: MessageFlags.Ephemeral });
    }

    const res = gameManager.declareCaptain(interaction.channelId);
    if (!res.ok) {
      if (res.reason === 'no_votes') return interaction.reply({ content: '❌ Aucun vote enregistré pour le capitaine.', flags: MessageFlags.Ephemeral });
      if (res.reason === 'tie') {
        const names = res.tied.map(id => {
          const p = game.players.find(x => x.id === id);
          return p ? p.username : id;
        }).join(', ');
        return interaction.reply({ content: `⚠️ Égalité entre : ${names}. Aucune élection.`, ephemeral: false });
      }
      return interaction.reply({ content: '❌ Impossible de déclarer le capitaine.', flags: MessageFlags.Ephemeral });
    }

    await interaction.reply(`🏅 **${res.username}** est élu·e capitaine !`);

    try {
      const user = await interaction.client.users.fetch(res.winnerId);
      const imageName = 'capitaine.webp';
      const imagePath = path.join(__dirname, '..', 'img', imageName);
      const embed = new EmbedBuilder()
        .setTitle('Vous etes elu Capitaine')
        .setDescription('Votre vote compte double. Vous pouvez lancer le vote quand le village est pret.')
        .setColor(0xFFD166)
        .setImage(`attachment://${imageName}`);

      await user.send({ embeds: [embed], files: [new AttachmentBuilder(imagePath, { name: imageName })] });
    } catch (err) {
      // Ignore DM failures
    }
  }
};
