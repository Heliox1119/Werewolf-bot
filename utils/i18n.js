const { app: logger } = require('./logger');

/**
 * Système de traduction centralisé (i18n)
 * Charge les fichiers de locale et fournit une fonction t() pour traduire
 */
class I18n {
  constructor() {
    this.locale = 'fr'; // Langue par défaut
    this.locales = {};
    this.initialized = false;
  }

  /**
   * Initialise le système i18n avec la langue stockée en config
   */
  initialize(configDb = null) {
    // Charger les fichiers de locale
    this.locales.fr = require('../locales/fr');
    this.locales.en = require('../locales/en');

    // Charger la langue depuis la config DB si disponible
    if (configDb) {
      try {
        const row = configDb.prepare('SELECT value FROM config WHERE key = ?').get('bot.locale');
        if (row && this.locales[row.value]) {
          this.locale = row.value;
        }
      } catch (e) {
        // Pas grave, on garde le défaut
      }
    }

    this.initialized = true;
    
    // Load per-guild locales
    this.loadGuildLocales(configDb);
    
    logger.info('i18n initialized', { locale: this.locale, available: Object.keys(this.locales) });
  }

  /**
   * Récupère la liste des langues disponibles
   */
  getAvailableLocales() {
    return Object.keys(this.locales);
  }

  /**
   * Récupère la langue courante
   */
  getLocale() {
    return this.locale;
  }

  /**
   * Change la langue (globale ou per-guild) et persiste en DB
   * @param {string} locale - Locale code ('fr', 'en')
   * @param {object} [configDb] - SQLite db instance
   * @param {string} [guildId] - Guild ID for per-guild locale
   */
  setLocale(locale, configDb = null, guildId = null) {
    if (!this.locales[locale]) {
      return false;
    }

    // Per-guild locale
    if (guildId && configDb) {
      try {
        const key = `guild.${guildId}.locale`;
        configDb.prepare(`
          INSERT INTO config (key, value, updated_at)
          VALUES (?, ?, strftime('%s', 'now'))
          ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
        `).run(key, locale);
        // Also update guild locale cache
        if (!this._guildLocales) this._guildLocales = new Map();
        this._guildLocales.set(guildId, locale);
        logger.info('Guild locale changed', { guildId, locale });
        return true;
      } catch (e) {
        logger.error('Failed to persist guild locale', { guildId, error: e.message });
      }
    }

    // Global locale
    this.locale = locale;
    if (configDb) {
      try {
        configDb.prepare(`
          INSERT INTO config (key, value, updated_at)
          VALUES ('bot.locale', ?, strftime('%s', 'now'))
          ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
        `).run(locale);
      } catch (e) {
        logger.error('Failed to persist locale', { error: e.message });
      }
    }

    logger.info('Locale changed', { locale });
    return true;
  }

  /**
   * Get the locale for a guild (falls back to global)
   * @param {string} [guildId] - Guild ID
   * @returns {string} Locale code
   */
  getLocaleForGuild(guildId = null) {
    if (guildId && this._guildLocales && this._guildLocales.has(guildId)) {
      return this._guildLocales.get(guildId);
    }
    return this.locale;
  }

  /**
   * Load all per-guild locales from config DB
   */
  loadGuildLocales(configDb) {
    if (!configDb) return;
    try {
      this._guildLocales = new Map();
      const rows = configDb.prepare("SELECT key, value FROM config WHERE key LIKE 'guild.%.locale'").all();
      for (const row of rows) {
        const match = row.key.match(/^guild\.(\d+)\.locale$/);
        if (match && this.locales[row.value]) {
          this._guildLocales.set(match[1], row.value);
        }
      }
      if (this._guildLocales.size > 0) {
        logger.info('Guild locales loaded', { count: this._guildLocales.size });
      }
    } catch (e) {
      logger.error('Failed to load guild locales', { error: e.message });
    }
  }

  /**
   * Traduit une clé avec interpolation de variables
   * @param {string} key - La clé de traduction (ex: 'error.no_game')
   * @param {Object} params - Les variables à interpoler (ex: { name: 'Alice' })
   * @param {string} [guildId] - Guild ID for per-guild locale resolution
   * @returns {string} La chaîne traduite
   */
  t(key, params = {}, guildId = null) {
    const locale = guildId ? this.getLocaleForGuild(guildId) : this.locale;
    const localeData = this.locales[locale] || this.locales.fr;
    let value = this._resolve(localeData, key);

    // Fallback vers le français si la clé n'existe pas dans la langue courante
    if (value === undefined && this.locale !== 'fr') {
      value = this._resolve(this.locales.fr, key);
    }

    // Si toujours pas trouvé, retourner la clé elle-même
    if (value === undefined) {
      logger.warn('Missing translation key', { key, locale: this.locale });
      return key;
    }

    // Interpolation : remplacer {{variable}} par la valeur
    if (typeof value === 'string' && params) {
      for (const [k, v] of Object.entries(params)) {
        value = value.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), v ?? '');
      }
    }

    return value;
  }

  /**
   * Résout une clé imbriquée (ex: 'error.no_game' → localeData.error.no_game)
   */
  _resolve(obj, key) {
    return key.split('.').reduce((o, k) => (o && o[k] !== undefined ? o[k] : undefined), obj);
  }
}

// Singleton
const instance = new I18n();

// Mapping des constantes internes (roles.js) vers les clés i18n
const ROLE_KEY_MAP = {
  'Loup-Garou': 'werewolf',
  'Loup Blanc': 'white_wolf',
  'Villageois': 'villager',
  'Voyante': 'seer',
  'Sorcière': 'witch',
  'Chasseur': 'hunter',
  'Petite Fille': 'petite_fille',
  'Cupidon': 'cupid',
  'Salvateur': 'salvateur',
  'Ancien': 'ancien',
  'Idiot du Village': 'idiot',
  'Voleur': 'thief',
};

// Mapping des constantes internes (phases.js) vers les clés i18n
const PHASE_KEY_MAP = {
  'Nuit': 'night',
  'Jour': 'day',
  'Terminé': 'ended',
  'Voleur': 'voleur',
  'Cupidon': 'cupidon',
  'Salvateur': 'salvateur',
  'Loups': 'loups',
  'Loup Blanc': 'loup_blanc',
  'Sorcière': 'sorciere',
  'Voyante': 'voyante',
  'Réveil': 'reveil',
  'Vote Capitaine': 'vote_capitaine',
  'Délibération': 'deliberation',
  'Vote': 'vote',
};

/**
 * Fonction raccourci globale
 * @param {string} key
 * @param {Object} [params]
 * @param {string} [guildId] - Guild ID for per-guild locale
 */
function t(key, params = {}, guildId = null) {
  return instance.t(key, params, guildId);
}

/**
 * Traduit un nom de rôle interne vers la langue courante
 * @param {string} roleConstant - La valeur de la constante (ex: "Loup-Garou")
 * @returns {string} Le nom traduit
 */
function translateRole(roleConstant) {
  const key = ROLE_KEY_MAP[roleConstant];
  if (!key) return roleConstant;
  return instance.t(`role.${key}`);
}

/**
 * Traduit un nom de phase interne vers la langue courante
 * @param {string} phaseConstant - La valeur de la constante (ex: "Nuit")
 * @returns {string} Le nom traduit
 */
function translatePhase(phaseConstant) {
  const key = PHASE_KEY_MAP[phaseConstant];
  if (!key) return phaseConstant;
  return instance.t(`phase.${key}`);
}

/**
 * Retourne la description d'un rôle traduite
 * @param {string} roleConstant - La valeur de la constante (ex: "Loup-Garou")
 * @returns {string} La description traduite
 */
function translateRoleDesc(roleConstant) {
  const key = ROLE_KEY_MAP[roleConstant];
  if (!key) return '';
  return instance.t(`role.desc.${key}`);
}

/**
 * Retourne le tableau des tips dans la langue courante
 */
function tips() {
  const locale = instance.locale || 'fr';
  const data = instance.locales[locale] || instance.locales.fr;
  return data?.tip || [];
}

module.exports = {
  I18n,
  instance,
  t,
  translateRole,
  translatePhase,
  translateRoleDesc,
  tips,
  initialize: (configDb) => instance.initialize(configDb),
  setLocale: (locale, configDb, guildId) => instance.setLocale(locale, configDb, guildId),
  getLocale: () => instance.getLocale(),
  getLocaleForGuild: (guildId) => instance.getLocaleForGuild(guildId),
  getAvailableLocales: () => instance.getAvailableLocales()
};
