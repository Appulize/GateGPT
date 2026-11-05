const fs = require('fs');

const MINUTE = 60 * 1000;
const RETRY_AT = [MINUTE, 3 * MINUTE, 7 * MINUTE];
const ALERT_AFTER = 10 * MINUTE;
const STABLE_FOR = 5 * MINUTE;
const BACKOFF = 15 * MINUTE;

// A timeout bounds the caller, not the operation. Lifecycle code must still
// confirm the old browser and initializer have stopped before replacing them.
async function withTimeout(operation, ms = 15000) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('WhatsApp operation timed out')), ms);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function createConnectionRecovery({ file, probe, restart, notify }) {
  let incident = null;
  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (saved && Number.isFinite(saved.since) && Number.isInteger(saved.attempts) &&
        saved.attempts >= 0 && Number.isFinite(saved.nextRetry) &&
        Number.isFinite(saved.nextNotice) && typeof saved.notified === 'boolean') {
      incident = saved;
    }
  } catch (err) {
    if (err.code !== 'ENOENT') console.warn('⚠️ Cannot read WhatsApp recovery state:', err.message);
  }
  let connected = false;
  let stableSince = null;
  let lastOfflineAt = Date.now();
  let reason = 'WhatsApp has not become ready';
  let needsQr = false;
  let stopped = false;
  let busy = false;

  function save() {
    try {
      fs.writeFileSync(`${file}.tmp`, JSON.stringify(incident));
      fs.renameSync(`${file}.tmp`, file);
    } catch (err) {
      console.error('❌ Cannot persist WhatsApp recovery state:', err.message);
    }
  }

  function offline(detail, qr = false) {
    if (stopped) return;
    if (connected) lastOfflineAt = Date.now();
    connected = false;
    stableSince = null;
    reason = detail;
    needsQr = qr;
    if (!incident) {
      incident = {
        since: Date.now(), attempts: 0, nextRetry: Date.now() + RETRY_AT[0],
        notified: false, nextNotice: 0
      };
      save();
    }
  }

  function online() {
    if (stopped) return;
    connected = true;
    needsQr = false;
    if (stableSince === null) stableSince = Date.now();
  }

  async function tick() {
    if (busy || stopped) return;
    busy = true;
    try {
      if (await withTimeout(probe)) online();
      else if (connected) offline('WhatsApp connection is no longer healthy');
    } catch {
      offline('WhatsApp browser is unresponsive');
    }
    try {
      if (stopped || !incident) return;
      if (connected) {
        if (Date.now() - stableSince < STABLE_FOR) return;
        if (incident.notified) {
          if (Date.now() < incident.nextNotice) return;
          incident.nextNotice = Date.now() + BACKOFF;
          save();
          const stableAtSend = stableSince;
          if (!await notify('GateGPT — WhatsApp recovered', 'WhatsApp is connected again and has been stable for 5 minutes.')) return;
          if (stopped) return;
          if (!connected || stableSince !== stableAtSend) {
            // A new failure during delivery must not be erased by its late result.
            incident = {
              since: lastOfflineAt, attempts: 0, nextRetry: lastOfflineAt + RETRY_AT[0],
              notified: false, nextNotice: 0
            };
            save();
            return;
          }
        }
        incident = null;
        save();
        return;
      }
      if (Date.now() >= incident.nextRetry && !(needsQr && incident.attempts >= RETRY_AT.length)) {
        incident.attempts++;
        incident.nextRetry = incident.attempts < RETRY_AT.length
          ? Math.max(Date.now() + MINUTE, incident.since + RETRY_AT[incident.attempts])
          : Date.now() + BACKOFF;
        save();
        console.warn(`⚠️ WhatsApp recovery attempt ${incident.attempts}`);
        try {
          needsQr = false;
          await restart();
        } catch (err) {
          console.warn('⚠️ WhatsApp recovery could not restart:', err.message);
        }
      }
      if (stopped || connected || incident.notified ||
          Date.now() - incident.since < ALERT_AFTER || Date.now() < incident.nextNotice) return;
      incident.nextNotice = Date.now() + BACKOFF;
      save();
      const action = needsQr
        ? 'Open Home Assistant → GateGPT → Open web UI → Login and scan the QR code.'
        : 'Automatic recovery continues every 15 minutes. Check GateGPT’s Login tab and logs.';
      const sent = await notify('GateGPT — WhatsApp offline',
        `WhatsApp has been unavailable for ${Math.floor((Date.now() - incident.since) / MINUTE)} minutes despite ${incident.attempts} recovery attempts. ${reason}. ${action}`);
      if (sent) {
        incident.notified = true;
        incident.nextNotice = 0;
        save();
      }
    } catch (err) {
      console.error('❌ WhatsApp recovery monitor failed:', err.message);
    } finally {
      busy = false;
    }
  }

  offline(reason);
  const timer = setInterval(tick, 30000);
  timer.unref?.();
  return { offline, online, tick, stop() { stopped = true; clearInterval(timer); } };
}

module.exports = { createConnectionRecovery, withTimeout };
