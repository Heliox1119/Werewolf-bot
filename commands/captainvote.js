const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const gameManager = require('../game/gameManager');
const { isInGameCategory } = require('../utils/validators');
const { safeReply } = require('../utils/interaction');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('captainvote')
    .setDescription('Voter pour le capitaine (premier jour uniquement, dans le salon village)')
    .addUserOption(opt => opt.setName('target').setDescription('La personne à élire').setRequired(true)),

  async execute(interaction) {
    // Vérification catégorie
    if (!await isInGameCategory(interaction)) {
      return safeReply(interaction, { content: '❌ Action interdite ici. Utilisez cette commande dans la catégorie dédiée au jeu.', flags: MessageFlags.Ephemeral });
    }
    const game = gameManager.getGameByChannelId(interaction.channelId);
    if (!game) return safeReply(interaction, { content: '❌ Aucune partie ici', flags: MessageFlags.Ephemeral });
    if (interaction.channelId !== game.villageChannelId) {
      return safeReply(interaction, { content: '❌ Cette commande ne peut être utilisée que dans le salon village', flags: MessageFlags.Ephemeral });
    }

    const target = interaction.options.getUser('target');
    const res = gameManager.voteCaptain(interaction.channelId, interaction.user.id, target.id);

    if (!res.ok) {
      let msg = '❌ Impossible de voter.';
      switch (res.reason) {
        case 'not_day': msg = '❌ Ce n\'est pas le jour.'; break;
        case 'not_first_day': msg = '❌ Le vote pour capitaine n\'a lieu que le premier jour.'; break;
        case 'captain_already': msg = '❌ Le capitaine a déjà été élu.'; break;
        case 'not_in_game': msg = '❌ Tu ne fais pas partie de la partie.'; break;
        case 'voter_dead': msg = '❌ Les morts ne peuvent pas voter.'; break;
        case 'target_not_found': msg = '❌ Cible invalide.'; break;
        case 'target_dead': msg = '❌ La cible est morte.'; break;
      }
      return safeReply(interaction, { content: msg, flags: MessageFlags.Ephemeral });
    }

    return safeReply(interaction, { content: `✅ Vote enregistré pour **${target.username}**`, flags: MessageFlags.Ephemeral });
  }
};
