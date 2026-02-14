const { SlashCommandBuilder, MessageFlags, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const path = require('path');
const gameManager = require('../game/gameManager');
const { isInGameCategory } = require('../utils/validators');
const { safeReply } = require('../utils/interaction');
const { t } = require('../utils/i18n');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('declarecaptain')
    .setDescription('Déclarer le capitaine élu (calcul des votes, utilisé sur le salon village)')
    ,

  async execute(interaction) {
    // Vérification catégorie
    if (!await isInGameCategory(interaction)) {
      return safeReply(interaction, { content: t('error.action_forbidden'), flags: MessageFlags.Ephemeral });
    }
    const game = gameManager.getGameByChannelId(interaction.channelId);
    if (!game) return safeReply(interaction, { content: t('error.no_game'), flags: MessageFlags.Ephemeral });
    if (interaction.channelId !== game.villageChannelId) {
      return safeReply(interaction, { content: t('error.only_village_channel_2'), flags: MessageFlags.Ephemeral });
    }

    const res = gameManager.declareCaptain(game.mainChannelId);
    if (!res.ok) {
      if (res.reason === 'no_votes') return safeReply(interaction, { content: t('error.no_captain_votes'), flags: MessageFlags.Ephemeral });
      if (res.reason === 'tie') {
        const names = res.tied.map(id => {
          const p = game.players.find(x => x.id === id);
          return p ? p.username : id;
        }).join(', ');
        return safeReply(interaction, { content: t('cmd.captain.tie', { names }) });
      }
      return safeReply(interaction, { content: t('error.cannot_declare_captain'), flags: MessageFlags.Ephemeral });
    }

    await safeReply(interaction, { content: t('cmd.captain.elected', { name: res.username }) });

    try {
      const user = await interaction.client.users.fetch(res.winnerId);
      const imageName = 'capitaine.webp';
      const imagePath = path.join(__dirname, '..', 'img', imageName);
      const embed = new EmbedBuilder()
        .setTitle(t('cmd.captain.dm_title'))
        .setDescription(t('cmd.captain.dm_desc'))
        .setColor(0xFFD166)
        .setImage(`attachment://${imageName}`);

      await user.send({ embeds: [embed], files: [new AttachmentBuilder(imagePath, { name: imageName })] });
    } catch (err) {
      // Ignore DM failures
    }
  }
};
