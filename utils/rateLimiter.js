/**
 * Rate Limiter - Protection contre le spam et les abus
 * 
 * Implémente une stratégie de Token Bucket avec fenêtre glissante
 * pour limiter le taux d'utilisation des commandes.
 */

const { interaction: logger } = require('./logger');
const { t } = require('./i18n');

class RateLimiter {
  constructor() {
    // Structure: userId -> commandName -> { tokens, lastRefill, violations }
    this.buckets = new Map();
    
    // Structure: userId -> { bannedUntil, reason, violations }
    this.bans = new Map();
    
    // Cleanup toutes les 5 minutes
    this.cleanupInterval = setInterval(() => this.cleanup(), 5 * 60 * 1000);
  }

  /**
   * Configuration des limites par commande
   * tokens: nombre de requêtes autorisées
   * window: période en millisecondes
   * cooldown: délai minimum entre deux appels (ms)
   */
  static LIMITS = {
    // Commandes sensibles
    'create': { tokens: 3, window: 60000, cooldown: 5000 }, // 3/min, 5s entre chaque
    'start': { tokens: 5, window: 60000, cooldown: 2000 },  // 5/min, 2s entre chaque
    'end': { tokens: 3, window: 60000, cooldown: 0 },
    'force-end': { tokens: 2, window: 300000, cooldown: 5000 }, // 2/5min
    
    // Commandes fréquentes
    'join': { tokens: 10, window: 60000, cooldown: 1000 }, // 10/min, 1s entre chaque
    'vote': { tokens: 20, window: 60000, cooldown: 500 },  // 20/min, 0.5s entre chaque
    'kill': { tokens: 15, window: 60000, cooldown: 500 },
    'see': { tokens: 10, window: 60000, cooldown: 1000 },
    'potion': { tokens: 10, window: 60000, cooldown: 1000 },
    'love': { tokens: 5, window: 60000, cooldown: 2000 },
    
    // Commandes moderées
    'captainvote': { tokens: 15, window: 60000, cooldown: 1000 },
    
    // Commandes administratives
    'clear': { tokens: 10, window: 60000, cooldown: 500 },
    'setrules': { tokens: 5, window: 60000, cooldown: 2000 },
    
    // Commandes debug (très restrictives)
    'debug-reset': { tokens: 2, window: 300000, cooldown: 10000 },
    'debug-set-role': { tokens: 5, window: 60000, cooldown: 2000 },
    'debug-start-force': { tokens: 3, window: 60000, cooldown: 3000 },
    
    // Par défaut
    'default': { tokens: 30, window: 60000, cooldown: 500 }
  };

  /**
   * Vérifie si un utilisateur peut exécuter une commande
   * @returns {Object} { allowed: boolean, reason?: string, retryAfter?: number }
   */
  checkLimit(userId, commandName) {
    // Vérifier si l'utilisateur est banni
    const ban = this.bans.get(userId);
    if (ban && ban.bannedUntil > Date.now()) {
      const retryAfter = Math.ceil((ban.bannedUntil - Date.now()) / 1000);
      logger.warn('User is banned', { userId, commandName, retryAfter, reason: ban.reason });
      return {
        allowed: false,
        reason: t('error.rate_ban_message', { reason: ban.reason, seconds: retryAfter }),
        retryAfter
      };
    }

    // Nettoyer le ban expiré
    if (ban && ban.bannedUntil <= Date.now()) {
      this.bans.delete(userId);
    }

    const config = RateLimiter.LIMITS[commandName] || RateLimiter.LIMITS.default;
    const now = Date.now();

    // Obtenir ou créer le bucket de l'utilisateur
    if (!this.buckets.has(userId)) {
      this.buckets.set(userId, new Map());
    }

    const userBuckets = this.buckets.get(userId);

    if (!userBuckets.has(commandName)) {
      userBuckets.set(commandName, {
        tokens: config.tokens,
        lastRefill: now,
        lastUse: now - config.cooldown - 1000, // Permettre la première requête
        violations: 0
      });
    }

    const bucket = userBuckets.get(commandName);

    // Refill des tokens (Token Bucket algorithm)
    const timePassed = now - bucket.lastRefill;
    const tokensToAdd = Math.floor((timePassed / config.window) * config.tokens);
    
    if (tokensToAdd > 0) {
      bucket.tokens = Math.min(config.tokens, bucket.tokens + tokensToAdd);
      bucket.lastRefill = now;
    }

    // Vérifier le cooldown
    const timeSinceLastUse = now - bucket.lastUse;
    if (timeSinceLastUse < config.cooldown) {
      const retryAfter = Math.ceil((config.cooldown - timeSinceLastUse) / 1000);
      logger.debug('Cooldown active', { userId, commandName, retryAfter });
      return {
        allowed: false,
        reason: t('error.rate_cooldown', { seconds: retryAfter }),
        retryAfter
      };
    }

    // Vérifier si des tokens sont disponibles
    if (bucket.tokens < 1) {
      bucket.violations++;
      
      // Escalade des pénalités
      if (bucket.violations >= 5) {
        this.applyPenalty(userId, commandName, bucket.violations);
      }

      const timeUntilRefill = config.window - (now - bucket.lastRefill);
      const retryAfter = Math.ceil(timeUntilRefill / 1000);
      
      logger.warn('Rate limit exceeded', { 
        userId, 
        commandName, 
        violations: bucket.violations,
        retryAfter 
      });

      return {
        allowed: false,
        reason: t('error.rate_exceeded', { seconds: retryAfter }),
        retryAfter
      };
    }

    // Consommer un token
    bucket.tokens -= 1;
    bucket.lastUse = now;
    bucket.violations = Math.max(0, bucket.violations - 0.1); // Décroissance lente

    logger.debug('Rate limit check passed', { 
      userId, 
      commandName, 
      tokensRemaining: bucket.tokens 
    });

    return { allowed: true };
  }

  /**
   * Applique une pénalité à un utilisateur suite à des violations répétées
   */
  applyPenalty(userId, commandName, violations) {
    let banDuration;
    let reason;

    if (violations >= 20) {
      // Ban permanent (24h)
      banDuration = 24 * 60 * 60 * 1000;
      reason = t('error.rate_reason_severe');
    } else if (violations >= 10) {
      // Ban long (1h)
      banDuration = 60 * 60 * 1000;
      reason = t('error.rate_reason_spam');
    } else if (violations >= 5) {
      // Ban court (5 minutes)
      banDuration = 5 * 60 * 1000;
      reason = t('error.rate_reason_repeated');
    } else {
      return; // Pas de pénalité encore
    }

    const bannedUntil = Date.now() + banDuration;
    
    this.bans.set(userId, {
      bannedUntil,
      reason,
      violations
    });

    logger.error('User penalized', {
      userId,
      commandName,
      violations,
      banDurationMinutes: Math.ceil(banDuration / 60000),
      reason
    });
  }

  /**
   * Réinitialise les limites d'un utilisateur (admin uniquement)
   */
  resetUser(userId) {
    this.buckets.delete(userId);
    this.bans.delete(userId);
    logger.info('User rate limits reset', { userId });
  }

  /**
   * Bannit manuellement un utilisateur
   */
  banUser(userId, durationMs, reason = 'ban manuel') {
    this.bans.set(userId, {
      bannedUntil: Date.now() + durationMs,
      reason,
      violations: 999
    });
    logger.warn('User manually banned', { userId, durationMs, reason });
  }

  /**
   * Débannit un utilisateur
   */
  unbanUser(userId) {
    this.bans.delete(userId);
    logger.info('User unbanned', { userId });
  }

  /**
   * Nettoie les anciens buckets et bans expirés
   */
  cleanup() {
    const now = Date.now();
    let cleaned = 0;

    // Nettoyer les buckets inactifs depuis plus de 1 heure
    for (const [userId, userBuckets] of this.buckets.entries()) {
      let allInactive = true;
      
      for (const [commandName, bucket] of userBuckets.entries()) {
        if (now - bucket.lastUse < 60 * 60 * 1000) {
          allInactive = false;
        }
      }

      if (allInactive) {
        this.buckets.delete(userId);
        cleaned++;
      }
    }

    // Nettoyer les bans expirés
    for (const [userId, ban] of this.bans.entries()) {
      if (ban.bannedUntil <= now) {
        this.bans.delete(userId);
      }
    }

    if (cleaned > 0) {
      logger.debug('Rate limiter cleanup', { bucketsRemoved: cleaned });
    }
  }

  /**
   * Obtient les statistiques d'un utilisateur
   */
  getUserStats(userId) {
    const userBuckets = this.buckets.get(userId);
    const ban = this.bans.get(userId);

    const stats = {
      userId,
      banned: ban ? ban.bannedUntil > Date.now() : false,
      banInfo: ban || null,
      commands: {}
    };

    if (userBuckets) {
      for (const [commandName, bucket] of userBuckets.entries()) {
        const config = RateLimiter.LIMITS[commandName] || RateLimiter.LIMITS.default;
        stats.commands[commandName] = {
          tokensRemaining: bucket.tokens,
          maxTokens: config.tokens,
          violations: bucket.violations,
          lastUse: bucket.lastUse,
          cooldownMs: config.cooldown
        };
      }
    }

    return stats;
  }

  /**
   * Obtient des statistiques globales
   */
  getGlobalStats() {
    return {
      totalUsers: this.buckets.size,
      bannedUsers: Array.from(this.bans.values()).filter(b => b.bannedUntil > Date.now()).length,
      totalBuckets: Array.from(this.buckets.values()).reduce((sum, ub) => sum + ub.size, 0)
    };
  }

  /**
   * Arrête le nettoyage automatique
   */
  destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }
}

// Singleton
const rateLimiter = new RateLimiter();

module.exports = rateLimiter;
module.exports.RateLimiter = RateLimiter;
