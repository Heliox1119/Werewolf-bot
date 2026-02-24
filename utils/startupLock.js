const fs = require('fs');
const path = require('path');

class StartupLock {
  constructor(options = {}) {
    this.lockFilePath = options.lockFilePath || path.join(__dirname, '..', 'data', 'werewolf-bot.lock');
    this._fd = null;
    this._ownsLock = false;
  }

  _ensureDirectory() {
    const dir = path.dirname(this.lockFilePath);
    fs.mkdirSync(dir, { recursive: true });
  }

  _isPidAlive(pid) {
    if (!Number.isInteger(pid) || pid <= 0 || pid > 2147483647) {
      return false;
    }
    try {
      process.kill(pid, 0);
      return true;
    } catch (err) {
      if (err && err.code === 'ESRCH') return false;
      if (err && err.code === 'EPERM') return true;
      return false;
    }
  }

  _readExistingLock() {
    try {
      const raw = fs.readFileSync(this.lockFilePath, 'utf8');
      const parsed = JSON.parse(raw);
      return {
        pid: Number(parsed.pid),
        startedAt: parsed.startedAt || null
      };
    } catch (_) {
      return { pid: null, startedAt: null };
    }
  }

  _writeLockPayload() {
    const payload = {
      pid: process.pid,
      startedAt: new Date().toISOString()
    };
    fs.ftruncateSync(this._fd, 0);
    fs.writeSync(this._fd, JSON.stringify(payload));
    fs.fsyncSync(this._fd);
    return payload;
  }

  acquire() {
    if (this._ownsLock) {
      return { ok: true, alreadyOwned: true, pid: process.pid, lockFilePath: this.lockFilePath };
    }

    this._ensureDirectory();

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        this._fd = fs.openSync(this.lockFilePath, 'wx');
        const payload = this._writeLockPayload();
        this._ownsLock = true;
        return { ok: true, ...payload, lockFilePath: this.lockFilePath };
      } catch (err) {
        if (!err || err.code !== 'EEXIST') {
          return {
            ok: false,
            reason: 'io_error',
            error: err,
            lockFilePath: this.lockFilePath
          };
        }

        const existing = this._readExistingLock();
        const alive = this._isPidAlive(existing.pid);
        if (alive) {
          return {
            ok: false,
            reason: 'locked',
            ownerPid: existing.pid,
            ownerStartedAt: existing.startedAt,
            lockFilePath: this.lockFilePath
          };
        }

        try {
          fs.unlinkSync(this.lockFilePath);
        } catch (unlinkErr) {
          return {
            ok: false,
            reason: 'stale_lock_unlink_failed',
            ownerPid: existing.pid,
            ownerStartedAt: existing.startedAt,
            error: unlinkErr,
            lockFilePath: this.lockFilePath
          };
        }
      }
    }

    return {
      ok: false,
      reason: 'acquire_failed',
      lockFilePath: this.lockFilePath
    };
  }

  release() {
    if (!this._ownsLock) return;

    try {
      if (this._fd !== null) {
        fs.closeSync(this._fd);
      }
    } catch (_) {
      // no-op
    } finally {
      this._fd = null;
    }

    try {
      if (fs.existsSync(this.lockFilePath)) {
        fs.unlinkSync(this.lockFilePath);
      }
    } catch (_) {
      // no-op
    }

    this._ownsLock = false;
  }

  isOwned() {
    return this._ownsLock;
  }
}

const startupLock = new StartupLock();

module.exports = startupLock;
module.exports.StartupLock = StartupLock;
