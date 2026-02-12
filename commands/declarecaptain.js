const { SlashCommandBuilder, MessageFlags, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const path = require('path');
const gameManager = require('../game/gameManager');
const { isInGameCategory } = require('../utils/validators');
const { safeReply } = require('../utils/interaction');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('declarecaptain')
    .setDescription('Déclarer le capitaine élu (calcul des votes, utilisé sur le salon village)')
    ,

  async execute(interaction) {
    // Vérification catégorie
    if (!await isInGameCategory(interaction)) {
      return safeReply(interaction, { content: '❌ Action interdite ici. Utilisez cette commande dans la catégorie dédiée au jeu.', flags: MessageFlags.Ephemeral });
    }
    const game = gameManager.getGameByChannelId(interaction.channelId);
    if (!game) return safeReply(interaction, { content: '❌ Aucune partie ici', flags: MessageFlags.Ephemeral });
    if (interaction.channelId !== game.villageChannelId) {
      return safeReply(interaction, { content: '❌ Cette commande doit être utilisée dans le salon village', flags: MessageFlags.Ephemeral });
    }

    const res = gameManager.declareCaptain(game.mainChannelId);
    if (!res.ok) {
      if (res.reason === 'no_votes') return safeReply(interaction, { content: '❌ Aucun vote enregistré pour le capitaine.', flags: MessageFlags.Ephemeral });
      if (res.reason === 'tie') {
        const names = res.tied.map(id => {
          const p = game.players.find(x => x.id === id);
          return p ? p.username : id;
        }).join(', ');
        return safeReply(interaction, { content: `⚠️ Égalité entre : ${names}. Aucune élection.` });
      }
      return safeReply(interaction, { content: '❌ Impossible de déclarer le capitaine.', flags: MessageFlags.Ephemeral });
    }

    await safeReply(interaction, { content: `🏅 **${res.username}** est élu·e capitaine !` });

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
