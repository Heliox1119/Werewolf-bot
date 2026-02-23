/**
 * Web Interface — Client-side i18n (FR / EN)
 * Uses data-i18n attributes and localStorage for persistence.
 */
(function() {
  'use strict';

  const translations = {
    fr: {
      // Nav
      'nav.dashboard': 'Tableau de bord',
      'nav.roles': 'Rôles',
      'nav.moderation': 'Modération',
      'nav.monitoring': 'Monitoring',
      'nav.logout': 'Déconnexion',
      'nav.login': 'Connexion',

      // Dashboard
      'dash.title': 'Werewolf Dashboard',
      'dash.subtitle': 'Surveillance temps réel de toutes les parties sur vos serveurs',
      'dash.active_games': 'Parties actives',
      'dash.active_players': 'Joueurs en jeu',
      'dash.servers': 'Serveurs',
      'dash.total_games': 'Total parties',
      'dash.live_games': 'Parties en direct',
      'dash.no_games': 'Aucune partie en cours',
      'dash.no_games_hint': 'Les parties apparaîtront ici en temps réel',
      'dash.watch_live': '👁 Regarder en direct',
      'dash.recent_activity': 'Activité récente',
      'dash.waiting': 'En attente d\'événements...',
      'dash.quick_access': '⚡ Accès rapide',

      // Monitoring
      'mon.title': '📊 Monitoring',
      'mon.subtitle': 'Surveillance en temps réel du bot — Métriques système, Discord et jeu',
      'mon.health': 'Santé',
      'mon.uptime': 'Uptime',
      'mon.memory': 'Mémoire (RSS)',
      'mon.latency': 'Latence Discord',
      'mon.system': '🖥 Système',
      'mon.cpu': 'CPU',
      'mon.heap': 'Heap V8',
      'mon.ram_free': 'RAM libre',
      'mon.ram_total': 'RAM totale',
      'mon.process_uptime': 'Uptime process',
      'mon.discord': '🤖 Discord',
      'mon.guilds': 'Serveurs',
      'mon.users_cached': 'Utilisateurs (cache)',
      'mon.channels': 'Channels',
      'mon.ws_status': 'Statut WebSocket',
      'mon.ws_latency': 'Latence WS',
      'mon.game': '🎮 Jeu',
      'mon.active_games': 'Parties actives',
      'mon.total_players': 'Joueurs en jeu',
      'mon.games_24h': 'Parties créées (24h)',
      'mon.completed_24h': 'Parties terminées (24h)',
      'mon.commands': '⚡ Commandes',
      'mon.cmd_total': 'Total exécutées',
      'mon.cmd_errors': 'Erreurs',
      'mon.cmd_ratelimited': 'Rate limited',
      'mon.cmd_avg': 'Temps moyen',
      'mon.errors': '⚠ Erreurs',
      'mon.err_total': 'Total',
      'mon.err_critical': 'Critiques',
      'mon.err_warnings': 'Avertissements',
      'mon.err_24h': 'Dernières 24h',
      'mon.history': '📈 Historique (24h)',
      'mon.auto_refresh': 'Actualisation auto toutes les 30s',
      'mon.refresh': 'Actualiser',
      'mon.connecting': 'Connexion...',

      // Moderation
      'mod.title': '🛡 Modération',
      'mod.subtitle': 'Gérer les parties actives — voir les rôles, contrôler les phases, modérer les joueurs',
      'mod.no_games': 'Aucune partie active sur vos serveurs',
      'mod.no_games_hint': 'Les parties que vous pouvez modérer apparaîtront ici en temps réel',
      'mod.skip_phase': '⏩ Skip Phase',
      'mod.force_end': '⏹ Forcer la fin',
      'mod.players': '👥 Joueurs',
      'mod.log': '📜 Journal',
      'mod.game_info': '⚙ Infos partie',
      'mod.alive': 'vivants',

      // Footer
      'footer.connected': 'Connecté',
      'footer.disconnected': 'Déconnecté',

      // Roles Page
      'roles.title': 'Rôles',
      'roles.subtitle': 'Tous les rôles du jeu — intégrés et personnalisés',
      'roles.builtin': 'Rôles intégrés',
      'roles.custom': 'Rôles personnalisés',
      'roles.no_custom': 'Aucun rôle personnalisé créé',
      'roles.create_hint': 'Utilisez le formulaire ci-dessous pour en créer un',
      'roles.login_hint': 'Connectez-vous en tant qu\'administrateur pour créer des rôles',
      'roles.create_title': 'Créer un rôle personnalisé',
      'roles.form_name': 'Nom',
      'roles.form_name_ph': 'ex. Forgeron',
      'roles.form_emoji': 'Emoji',
      'roles.form_camp': 'Camp',
      'roles.form_power': 'Pouvoir',
      'roles.form_desc': 'Description',
      'roles.form_desc_ph': 'Décrivez les capacités du rôle...',
      'roles.form_guild': 'ID du serveur',
      'roles.form_guild_ph': 'ID du serveur',
      'roles.create_btn': 'Créer le rôle',
      'roles.power_none': 'Aucun (Passif)',
      'roles.power_see': 'Voir (comme Voyante)',
      'roles.power_protect': 'Protéger (comme Salvateur)',
      'roles.power_kill': 'Tuer (comme Chasseur)',
      'roles.power_heal': 'Soigner (comme Sorcière)',
      'roles.power_custom': 'Personnalisé',
      // Role names
      'role.name.WEREWOLF': 'Loup-Garou',
      'role.name.SEER': 'Voyante',
      'role.name.WITCH': 'Sorcière',
      'role.name.HUNTER': 'Chasseur',
      'role.name.CUPID': 'Cupidon',
      'role.name.PETITE_FILLE': 'Petite Fille',
      'role.name.VILLAGER': 'Villageois',
      'role.name.IDIOT': 'Idiot du Village',
      'role.name.SALVATEUR': 'Salvateur',
      'role.name.ANCIEN': 'Ancien',
      'role.name.WHITE_WOLF': 'Loup Blanc',
      'role.name.THIEF': 'Voleur',
      // Role camps
      'role.camp.wolves': 'Loups',
      'role.camp.village': 'Village',
      'role.camp.solo': 'Solo',
      // Role descriptions
      'role.desc.WEREWOLF': 'Chaque nuit, les loups-garous se réunissent pour dévorer un villageois.',
      'role.desc.SEER': 'Chaque nuit, la voyante peut découvrir le rôle d\'un joueur.',
      'role.desc.WITCH': 'Possède une potion de vie et une potion de mort, utilisable une fois chacune.',
      'role.desc.HUNTER': 'En mourant, le chasseur peut emporter un autre joueur avec lui.',
      'role.desc.CUPID': 'Désigne deux amoureux au début de la partie. Si l\'un meurt, l\'autre aussi.',
      'role.desc.PETITE_FILLE': 'Peut espionner les loups-garous pendant la nuit, au risque de se faire repérer.',
      'role.desc.VILLAGER': 'Un simple villageois sans pouvoir spécial. Il doit démasquer les loups.',
      'role.desc.IDIOT': 'S\'il est voté par le village, il est révélé mais perd son droit de vote.',
      'role.desc.SALVATEUR': 'Chaque nuit, il protège un joueur de l\'attaque des loups-garous.',
      'role.desc.ANCIEN': 'Résiste à la première attaque des loups-garous grâce à sa robustesse.',
      'role.desc.WHITE_WOLF': 'Joue en solitaire. Chasse avec la meute mais peut dévorer un loup une nuit sur deux. Gagne s\'il est le dernier.',
      'role.desc.THIEF': 'Découvre 2 cartes au début et peut échanger son rôle. Si les deux sont des loups, il doit en prendre une.',
    },
    en: {
      // Nav
      'nav.dashboard': 'Dashboard',
      'nav.roles': 'Roles',
      'nav.moderation': 'Moderation',
      'nav.monitoring': 'Monitoring',
      'nav.logout': 'Logout',
      'nav.login': 'Login',

      // Dashboard
      'dash.title': 'Werewolf Dashboard',
      'dash.subtitle': 'Real-time monitoring of all games on your servers',
      'dash.active_games': 'Active games',
      'dash.active_players': 'Players in game',
      'dash.servers': 'Servers',
      'dash.total_games': 'Total games',
      'dash.live_games': 'Live games',
      'dash.no_games': 'No active games',
      'dash.no_games_hint': 'Games will appear here in real-time',
      'dash.watch_live': '👁 Watch live',
      'dash.recent_activity': 'Recent activity',
      'dash.waiting': 'Waiting for events...',
      'dash.quick_access': '⚡ Quick access',

      // Monitoring
      'mon.title': '📊 Monitoring',
      'mon.subtitle': 'Real-time bot monitoring — System, Discord and game metrics',
      'mon.health': 'Health',
      'mon.uptime': 'Uptime',
      'mon.memory': 'Memory (RSS)',
      'mon.latency': 'Discord Latency',
      'mon.system': '🖥 System',
      'mon.cpu': 'CPU',
      'mon.heap': 'V8 Heap',
      'mon.ram_free': 'Free RAM',
      'mon.ram_total': 'Total RAM',
      'mon.process_uptime': 'Process uptime',
      'mon.discord': '🤖 Discord',
      'mon.guilds': 'Guilds',
      'mon.users_cached': 'Users (cached)',
      'mon.channels': 'Channels',
      'mon.ws_status': 'WebSocket status',
      'mon.ws_latency': 'WS Latency',
      'mon.game': '🎮 Game',
      'mon.active_games': 'Active games',
      'mon.total_players': 'Players in game',
      'mon.games_24h': 'Games created (24h)',
      'mon.completed_24h': 'Games completed (24h)',
      'mon.commands': '⚡ Commands',
      'mon.cmd_total': 'Total executed',
      'mon.cmd_errors': 'Errors',
      'mon.cmd_ratelimited': 'Rate limited',
      'mon.cmd_avg': 'Avg response',
      'mon.errors': '⚠ Errors',
      'mon.err_total': 'Total',
      'mon.err_critical': 'Critical',
      'mon.err_warnings': 'Warnings',
      'mon.err_24h': 'Last 24h',
      'mon.history': '📈 History (24h)',
      'mon.auto_refresh': 'Auto-refresh every 30s',
      'mon.refresh': 'Refresh',
      'mon.connecting': 'Connecting...',

      // Moderation
      'mod.title': '🛡 Moderation',
      'mod.subtitle': 'Manage active games — view roles, control phases, moderate players',
      'mod.no_games': 'No active games on your servers',
      'mod.no_games_hint': 'Games you can moderate will appear here in real-time',
      'mod.skip_phase': '⏩ Skip Phase',
      'mod.force_end': '⏹ Force End',
      'mod.players': '👥 Players',
      'mod.log': '📜 Log',
      'mod.game_info': '⚙ Game info',
      'mod.alive': 'alive',

      // Footer
      'footer.connected': 'Connected',
      'footer.disconnected': 'Disconnected',

      // Roles Page
      'roles.title': 'Roles',
      'roles.subtitle': 'All game roles — built-in and custom',
      'roles.builtin': 'Built-in Roles',
      'roles.custom': 'Custom Roles',
      'roles.no_custom': 'No custom roles created yet',
      'roles.create_hint': 'Use the form below to create one',
      'roles.login_hint': 'Login as a server admin to create custom roles',
      'roles.create_title': 'Create Custom Role',
      'roles.form_name': 'Name',
      'roles.form_name_ph': 'e.g. Blacksmith',
      'roles.form_emoji': 'Emoji',
      'roles.form_camp': 'Camp',
      'roles.form_power': 'Power',
      'roles.form_desc': 'Description',
      'roles.form_desc_ph': 'Describe the role\'s abilities...',
      'roles.form_guild': 'Guild ID',
      'roles.form_guild_ph': 'Server ID',
      'roles.create_btn': 'Create Role',
      'roles.power_none': 'None (Passive)',
      'roles.power_see': 'See (like Seer)',
      'roles.power_protect': 'Protect (like Guard)',
      'roles.power_kill': 'Kill (like Hunter)',
      'roles.power_heal': 'Heal (like Witch)',
      'roles.power_custom': 'Custom',
      // Role names
      'role.name.WEREWOLF': 'Werewolf',
      'role.name.SEER': 'Seer',
      'role.name.WITCH': 'Witch',
      'role.name.HUNTER': 'Hunter',
      'role.name.CUPID': 'Cupid',
      'role.name.PETITE_FILLE': 'Little Girl',
      'role.name.VILLAGER': 'Villager',
      'role.name.IDIOT': 'Village Idiot',
      'role.name.SALVATEUR': 'Guardian',
      'role.name.ANCIEN': 'Elder',
      'role.name.WHITE_WOLF': 'White Wolf',
      'role.name.THIEF': 'Thief',
      // Role camps
      'role.camp.wolves': 'Wolves',
      'role.camp.village': 'Village',
      'role.camp.solo': 'Solo',
      // Role descriptions
      'role.desc.WEREWOLF': 'Each night, the werewolves gather to devour a villager.',
      'role.desc.SEER': 'Each night, the seer can discover a player\'s role.',
      'role.desc.WITCH': 'Has a life potion and a death potion, each usable once.',
      'role.desc.HUNTER': 'When dying, the hunter can take another player down.',
      'role.desc.CUPID': 'Chooses two lovers at the start. If one dies, so does the other.',
      'role.desc.PETITE_FILLE': 'Can spy on the werewolves at night, at the risk of being caught.',
      'role.desc.VILLAGER': 'A simple villager with no special power. Must unmask the wolves.',
      'role.desc.IDIOT': 'If voted out by the village, he is revealed but loses his voting rights.',
      'role.desc.SALVATEUR': 'Each night, protects a player from the werewolves\' attack.',
      'role.desc.ANCIEN': 'Survives the first werewolf attack thanks to his resilience.',
      'role.desc.WHITE_WOLF': 'Plays solo. Hunts with the pack but can devour a wolf every other night. Wins if last standing.',
      'role.desc.THIEF': 'Discovers 2 cards at the start and can swap his role. If both are wolves, he must take one.',
    }
  };

  // Get/set language
  function getLang() {
    return localStorage.getItem('werewolf-lang') || 'fr';
  }

  function setLang(lang) {
    localStorage.setItem('werewolf-lang', lang);
    applyTranslations(lang);
    updateLangButton(lang);
  }

  function t(key) {
    const lang = getLang();
    return (translations[lang] && translations[lang][key]) || (translations.fr[key]) || key;
  }

  // Apply translations to all elements with data-i18n
  function applyTranslations(lang) {
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      const val = (translations[lang] && translations[lang][key]) || (translations.fr[key]);
      if (val) el.textContent = val;
    });
    // Also update placeholders
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      const key = el.getAttribute('data-i18n-placeholder');
      const val = (translations[lang] && translations[lang][key]) || (translations.fr[key]);
      if (val) el.placeholder = val;
    });
    // Update title attributes
    document.querySelectorAll('[data-i18n-title]').forEach(el => {
      const key = el.getAttribute('data-i18n-title');
      const val = (translations[lang] && translations[lang][key]) || (translations.fr[key]);
      if (val) el.title = val;
    });
  }

  function updateLangButton(lang) {
    const flag = document.getElementById('lang-flag');
    const label = document.getElementById('lang-label');
    const btn = document.getElementById('lang-toggle');
    if (flag) flag.textContent = lang === 'fr' ? '🇬🇧' : '🇫🇷';
    if (label) label.textContent = lang === 'fr' ? 'EN' : 'FR';
    if (btn) btn.title = lang === 'fr' ? 'Switch to English' : 'Passer en français';
  }

  // Init on DOM ready
  function init() {
    const lang = getLang();
    applyTranslations(lang);
    updateLangButton(lang);

    // Language toggle button
    document.addEventListener('click', (e) => {
      if (e.target.id === 'lang-toggle' || e.target.closest('#lang-toggle')) {
        const current = getLang();
        setLang(current === 'fr' ? 'en' : 'fr');
      }
    });
  }

  // Export for other scripts
  window.webI18n = { t, getLang, setLang, applyTranslations };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
