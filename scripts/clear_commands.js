require('dotenv').config();
const { REST, Routes } = require('discord.js');

const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

(async () => {
  try {
    console.log('🔄 Suppression des commandes guild...');
    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
      { body: [] }
    );
    console.log('✅ Commandes guild supprimées.');

    console.log('🔄 Suppression des commandes globales...');
    await rest.put(
      Routes.applicationCommands(process.env.CLIENT_ID),
      { body: [] }
    );
    console.log('✅ Commandes globales supprimées.');

    process.exit(0);
  } catch (err) {
    console.error('❌ Erreur suppression commandes :', err);
    process.exit(1);
  }
})();