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
    const btn = document.getElementById('lang-toggle');
    if (btn) {
      btn.textContent = lang === 'fr' ? '🇬🇧 EN' : '🇫🇷 FR';
      btn.title = lang === 'fr' ? 'Switch to English' : 'Passer en français';
    }
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
