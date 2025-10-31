/** @jest-environment node */

const fs = require('fs');
const os = require('os');
const path = require('path');

const DAY_MS = 24 * 60 * 60 * 1000;

function setupEnv(dir) {
  process.env.SESSION_DIR = dir;
  process.env.DATA_RETENTION_DAYS = '1';
}

describe('data retention', () => {
  let sessionDir;

  beforeEach(() => {
    jest.resetModules();
    sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gategpt-retain-'));
    setupEnv(sessionDir);
  });

  afterEach(() => {
    fs.rmSync(sessionDir, { recursive: true, force: true });
    delete process.env.SESSION_DIR;
    delete process.env.DATA_RETENTION_DAYS;
  });

  test('delivery log purges delivered entries beyond retention window', () => {
    const deliveryLog = require('../deliveryLog');
    const filePath = path.join(sessionDir, 'deliveries.json');
    const stale = Date.now() - 3 * DAY_MS;
    const fresh = Date.now() - 0.25 * DAY_MS;
    const active = Date.now() - 10 * DAY_MS;
    fs.writeFileSync(
      filePath,
      JSON.stringify([
        { tracking: 'OLD', status: 'delivered', updated: stale },
        { tracking: 'FRESH', status: 'delivered', updated: fresh },
        { tracking: 'ACTIVE', status: 'out for delivery', updated: active }
      ])
    );

    const persisted = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    expect(persisted.find(d => d.tracking === 'OLD')).toBeUndefined();
    expect(persisted.find(d => d.tracking === 'FRESH')).toBeDefined();
    expect(persisted.find(d => d.tracking === 'ACTIVE')).toBeDefined();

    const deliveries = deliveryLog.listDeliveries();
    expect(deliveries.find(d => d.tracking === 'OLD')).toBeUndefined();
    expect(deliveries.find(d => d.tracking === 'FRESH')).toBeDefined();
    expect(deliveries.find(d => d.tracking === 'ACTIVE')).toBeDefined();
  });

  test('OTP cleanup removes expired codes and tracking references', () => {
    const otpFile = path.join(sessionDir, 'otps.json');
    const mapFile = path.join(sessionDir, 'tracking-map.json');
    const oldTimestamp = Date.now() - 2 * DAY_MS;
    const freshTimestamp = Date.now();
    fs.writeFileSync(
      otpFile,
      JSON.stringify({
        OLD: { otp: '1111', timestamp: oldTimestamp },
        FRESH: { otp: '2222', timestamp: freshTimestamp }
      })
    );
    fs.writeFileSync(
      mapFile,
      JSON.stringify({
        '1@c.us': ['OLD', 'FRESH'],
        '2@c.us': ['OLD']
      })
    );

    require('../otp');

    const otpsPersisted = JSON.parse(fs.readFileSync(otpFile, 'utf8'));
    expect(otpsPersisted.OLD).toBeUndefined();
    expect(otpsPersisted.FRESH.otp).toBe('2222');

    const mapPersisted = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
    expect(mapPersisted['1@c.us']).toEqual(['FRESH']);
    expect(mapPersisted['2@c.us']).toBeUndefined();

    const otpModule = require('../otp');
    const data = otpModule.getAllOtpData();
    expect(data.OLD).toBeUndefined();
    expect(data.FRESH.otp).toBe('2222');

    const map = otpModule.getTrackingMap();
    expect(map['1@c.us']).toEqual(['FRESH']);
    expect(map['2@c.us']).toBeUndefined();
  });
});

