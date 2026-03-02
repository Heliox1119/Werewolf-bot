const fs = require('fs');
const path = require('path');
const { db: logger } = require('../utils/logger');

/**
 * SQLite automatic backup system
 * Creates hourly backups with rotation (keeps last 24)
 */
class BackupManager {
  constructor() {
    this.db = null;
    this.backupDir = path.join(__dirname, '..', 'data', 'backups');
    this.interval = null;
    this.maxBackups = 24; // Keep last 24 backups (= 24h)
    this.backupIntervalMs = 60 * 60 * 1000; // 1 hour
  }

  /**
   * Initialize the backup manager
   * @param {object} database - GameDatabase instance
   */
  initialize(database) {
    this.db = database;

    // Ensure backup directory exists
    if (!fs.existsSync(this.backupDir)) {
      fs.mkdirSync(this.backupDir, { recursive: true });
    }

    logger.info('BACKUP_MANAGER_INITIALIZED', { backupDir: this.backupDir, maxBackups: this.maxBackups });
  }

  /**
   * Start automatic hourly backups
   */
  startAutoBackup() {
    if (this.interval) {
      logger.warn('AUTO_BACKUP_ALREADY_RUNNING');
      return;
    }

    // Run first backup 5 minutes after start (let DB settle)
    setTimeout(() => {
      this.performBackup().catch(err => 
        logger.error('INITIAL_BACKUP_FAILED', { error: err.message })
      );
    }, 5 * 60 * 1000);

    // Then every hour
    this.interval = setInterval(() => {
      this.performBackup().catch(err => 
        logger.error('SCHEDULED_BACKUP_FAILED', { error: err.message })
      );
    }, this.backupIntervalMs);

    logger.info('AUTO_BACKUP_STARTED', { interval: '1h', maxBackups: this.maxBackups });
  }

  /**
   * Stop automatic backups
   */
  stopAutoBackup() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
      logger.info('AUTO_BACKUP_STOPPED');
    }
  }

  /**
   * Perform a backup now
   * @returns {string|null} Backup file path or null on failure
   */
  async performBackup() {
    if (!this.db || !this.db.db) {
      logger.error('BACKUP_DB_NOT_INITIALIZED');
      return null;
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const backupFile = path.join(this.backupDir, `werewolf-${timestamp}.db`);

    try {
      // Use better-sqlite3's built-in backup API
      await this.db.backup(backupFile);

      const stats = fs.statSync(backupFile);
      const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);

      logger.info('BACKUP_CREATED', { file: path.basename(backupFile), size: `${sizeMB} MB` });

      // Rotate old backups
      this.rotateBackups();

      return backupFile;
    } catch (err) {
      logger.error('BACKUP_FAILED', { error: err.message, file: backupFile });
      // Clean up partial backup
      try { if (fs.existsSync(backupFile)) fs.unlinkSync(backupFile); } catch (e) { /* ignore */ }
      return null;
    }
  }

  /**
   * Rotate backups: keep only the last N
   */
  rotateBackups() {
    try {
      const files = fs.readdirSync(this.backupDir)
        .filter(f => f.startsWith('werewolf-') && f.endsWith('.db'))
        .sort() // Sorted by timestamp (oldest first)
        .map(f => path.join(this.backupDir, f));

      const toDelete = files.length - this.maxBackups;
      if (toDelete <= 0) return;

      for (let i = 0; i < toDelete; i++) {
        try {
          fs.unlinkSync(files[i]);
          logger.debug('OLD_BACKUP_DELETED', { file: path.basename(files[i]) });
        } catch (e) {
          logger.error('OLD_BACKUP_DELETE_FAILED', { file: files[i], error: e.message });
        }
      }

      logger.info('BACKUP_ROTATION_COMPLETE', { deleted: toDelete, remaining: this.maxBackups });
    } catch (err) {
      logger.error('BACKUP_ROTATION_FAILED', { error: err.message });
    }
  }

  /**
   * List available backups
   * @returns {Array<{file: string, size: string, date: Date}>}
   */
  listBackups() {
    try {
      if (!fs.existsSync(this.backupDir)) return [];

      return fs.readdirSync(this.backupDir)
        .filter(f => f.startsWith('werewolf-') && f.endsWith('.db'))
        .sort()
        .reverse()
        .map(f => {
          const fullPath = path.join(this.backupDir, f);
          const stats = fs.statSync(fullPath);
          const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
          // Parse date from filename: werewolf-YYYY-MM-DDTHH-MM-SS.db
          const dateStr = f.replace('werewolf-', '').replace('.db', '').replace(/T/, 'T').replace(/-(\d{2})-(\d{2})$/, ':$1:$2');
          return {
            file: f,
            path: fullPath,
            size: `${sizeMB} MB`,
            date: new Date(dateStr)
          };
        });
    } catch (err) {
      logger.error('BACKUP_LIST_FAILED', { error: err.message });
      return [];
    }
  }

  /**
   * Restore from a backup file
   * @param {string} backupFile - Full path to backup file
   */
  async restoreFromBackup(backupFile) {
    if (!fs.existsSync(backupFile)) {
      throw new Error(`Backup file not found: ${backupFile}`);
    }

    const dbPath = this.db.dbPath;
    
    // Create a safety backup before restore
    const safetyBackup = path.join(this.backupDir, `pre-restore-${Date.now()}.db`);
    try {
      await this.db.backup(safetyBackup);
      logger.info('SAFETY_BACKUP_CREATED', { file: path.basename(safetyBackup) });
    } catch (e) {
      logger.warn('SAFETY_BACKUP_FAILED', { error: e.message });
    }

    // Close current DB, copy backup over, reopen
    this.db.close();
    fs.copyFileSync(backupFile, dbPath);
    
    logger.info('DB_RESTORED_FROM_BACKUP', { file: path.basename(backupFile) });
    return true;
  }
}

// Singleton
let instance = null;

module.exports = {
  initialize: (database) => {
    if (!instance) {
      instance = new BackupManager();
    }
    instance.initialize(database);
    return instance;
  },

  getInstance: () => {
    if (!instance) {
      instance = new BackupManager();
    }
    return instance;
  }
};
