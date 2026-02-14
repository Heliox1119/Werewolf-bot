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
   * Change la langue et persiste en DB
   */
  setLocale(locale, configDb = null) {
    if (!this.locales[locale]) {
      return false;
    }
    this.locale = locale;

    // Persister dans la config
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
   * Traduit une clé avec interpolation de variables
   * @param {string} key - La clé de traduction (ex: 'error.no_game')
   * @param {Object} params - Les variables à interpoler (ex: { name: 'Alice' })
   * @returns {string} La chaîne traduite
   */
  t(key, params = {}) {
    const localeData = this.locales[this.locale] || this.locales.fr;
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
  'Villageois': 'villager',
  'Voyante': 'seer',
  'Sorcière': 'witch',
  'Chasseur': 'hunter',
  'Petite Fille': 'petite_fille',
  'Cupidon': 'cupid',
  'Salvateur': 'salvateur',
  'Ancien': 'ancien',
  'Idiot du Village': 'idiot',
};

// Mapping des constantes internes (phases.js) vers les clés i18n
const PHASE_KEY_MAP = {
  'Nuit': 'night',
  'Jour': 'day',
  'Terminé': 'ended',
  'Cupidon': 'cupidon',
  'Salvateur': 'salvateur',
  'Loups': 'loups',
  'Sorcière': 'sorciere',
  'Voyante': 'voyante',
  'Réveil': 'reveil',
  'Vote Capitaine': 'vote_capitaine',
  'Délibération': 'deliberation',
  'Vote': 'vote',
};

/**
 * Fonction raccourci globale
 */
function t(key, params = {}) {
  return instance.t(key, params);
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
  setLocale: (locale, configDb) => instance.setLocale(locale, configDb),
  getLocale: () => instance.getLocale(),
  getAvailableLocales: () => instance.getAvailableLocales()
};
