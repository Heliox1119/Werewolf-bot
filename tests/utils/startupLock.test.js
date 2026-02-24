const fs = require('fs');
const os = require('os');
const path = require('path');
const { StartupLock } = require('../../utils/startupLock');

describe('StartupLock', () => {
  let lockFilePath;

  beforeEach(() => {
    const uniq = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    lockFilePath = path.join(os.tmpdir(), `werewolf-startup-lock-${uniq}.lock`);
  });

  afterEach(() => {
    try { if (fs.existsSync(lockFilePath)) fs.unlinkSync(lockFilePath); } catch (_) { /* noop */ }
  });

  test('acquires and releases lock file', () => {
    const lock = new StartupLock({ lockFilePath });

    const acquired = lock.acquire();
    expect(acquired.ok).toBe(true);
    expect(fs.existsSync(lockFilePath)).toBe(true);
    expect(lock.isOwned()).toBe(true);

    lock.release();
    expect(lock.isOwned()).toBe(false);
    expect(fs.existsSync(lockFilePath)).toBe(false);
  });

  test('refuses second instance while first lock is held', () => {
    const lock1 = new StartupLock({ lockFilePath });
    const lock2 = new StartupLock({ lockFilePath });

    expect(lock1.acquire().ok).toBe(true);

    const secondAttempt = lock2.acquire();
    expect(secondAttempt.ok).toBe(false);
    expect(secondAttempt.reason).toBe('locked');

    lock1.release();
  });

  test('reclaims stale lock when owner pid is not alive', () => {
    fs.mkdirSync(path.dirname(lockFilePath), { recursive: true });
    fs.writeFileSync(lockFilePath, JSON.stringify({ pid: -999, startedAt: '1970-01-01T00:00:00.000Z' }));

    const lock = new StartupLock({ lockFilePath });
    const result = lock.acquire();

    expect(result.ok).toBe(true);
    expect(lock.isOwned()).toBe(true);
    lock.release();
  });
});
