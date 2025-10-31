const fs = require('fs');
const path = require('path');
const openai = require('./openaiClient');
const { getConfig } = require('./config');
const { modelSupportsCustomTemperature, parseTemperature } = require('./model-utils');
const { setStatus } = require('./deliveryLog');
const state = require('./state');

// Defer requiring messaging to avoid circular dependency
function sendAutoMsg(chat, content, options) {
  const { sendAuto } = require('./messaging');
  return options === undefined
    ? sendAuto(chat, content)
    : sendAuto(chat, content, options);
}

const DATA_DIR = getConfig('SESSION_DIR', __dirname);
const OTP_FILE = path.join(DATA_DIR, 'otps.json');
const MAP_FILE = path.join(DATA_DIR, 'tracking-map.json');
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_RETENTION_DAYS = 14;

function readJson(file, def) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return def;
  }
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data));
}

function getRetentionMs() {
  const raw = getConfig('DATA_RETENTION_DAYS', DEFAULT_RETENTION_DAYS);
  const numeric = typeof raw === 'string' ? Number.parseFloat(raw) : Number(raw);
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric * DAY_MS;
  }
  return DEFAULT_RETENTION_DAYS * DAY_MS;
}

function cleanupExpired() {
  const otps = readJson(OTP_FILE, {});
  const map = readJson(MAP_FILE, {});
  const retentionMs = getRetentionMs();
  const now = Date.now();
  let otpsChanged = false;
  for (const [t, info] of Object.entries(otps)) {
    const timestamp = Number(info?.timestamp);
    if (!Number.isFinite(timestamp) || now - timestamp > retentionMs) {
      delete otps[t];
      otpsChanged = true;
    }
  }

  let mapChanged = false;
  const validTrackings = new Set(Object.keys(otps));
  for (const [phone, trackings] of Object.entries(map)) {
    if (!Array.isArray(trackings)) {
      delete map[phone];
      mapChanged = true;
      continue;
    }
    const filtered = trackings.filter(t => validTrackings.has(t));
    if (filtered.length !== trackings.length) {
      if (filtered.length) {
        map[phone] = filtered;
      } else {
        delete map[phone];
      }
      mapChanged = true;
    }
  }

  if (otpsChanged) {
    writeJson(OTP_FILE, otps);
  }
  if (mapChanged) {
    writeJson(MAP_FILE, map);
  }
  if (otpsChanged || mapChanged) {
    state.emit('update');
  }
}

function saveOtp(tracking, otp) {
  const otps = readJson(OTP_FILE, {});
  otps[tracking] = { otp, timestamp: Date.now() };
  writeJson(OTP_FILE, otps);
  cleanupExpired();
  setStatus(tracking, 'expected soon');
  state.emit('update');
}

function associateTracking(phone, tracking) {
  const map = readJson(MAP_FILE, {});
  if (!map[phone]) map[phone] = [];
  if (!map[phone].includes(tracking)) map[phone].push(tracking);
  writeJson(MAP_FILE, map);
  cleanupExpired();
  setStatus(tracking, 'out for delivery', phone);
  state.emit('update');
}

function getOtp(tracking) {
  cleanupExpired();
  const otps = readJson(OTP_FILE, {});
  return otps[tracking]?.otp;
}

function removeOtp(tracking) {
  const otps = readJson(OTP_FILE, {});
  if (otps[tracking]) {
    delete otps[tracking];
    writeJson(OTP_FILE, otps);
    cleanupExpired();
    state.emit('update');
  }
}

function removeTrackingForPhone(phone, tracking) {
  const map = readJson(MAP_FILE, {});
  if (map[phone]) {
    map[phone] = map[phone].filter(t => t !== tracking);
    if (!map[phone].length) delete map[phone];
    writeJson(MAP_FILE, map);
    state.emit('update');
  }
}

function clearTracking(tracking) {
  if (!tracking) return false;

  const otps = readJson(OTP_FILE, {});
  let otpChanged = false;
  if (Object.prototype.hasOwnProperty.call(otps, tracking)) {
    delete otps[tracking];
    writeJson(OTP_FILE, otps);
    otpChanged = true;
  }

  const map = readJson(MAP_FILE, {});
  let mapChanged = false;
  for (const [phone, trackings] of Object.entries(map)) {
    if (!Array.isArray(trackings)) {
      delete map[phone];
      mapChanged = true;
      continue;
    }
    const filtered = trackings.filter(t => t !== tracking);
    if (filtered.length !== trackings.length) {
      if (filtered.length) {
        map[phone] = filtered;
      } else {
        delete map[phone];
      }
      mapChanged = true;
    }
  }

  if (mapChanged) {
    writeJson(MAP_FILE, map);
  }

  if (otpChanged || mapChanged) {
    state.emit('update');
  }

  return otpChanged || mapChanged;
}

function getTrackingsForPhone(phone) {
  cleanupExpired();
  const map = readJson(MAP_FILE, {});
  return map[phone] || [];
}

function getAllOtpData() {
  cleanupExpired();
  return readJson(OTP_FILE, {});
}

function getTrackingMap() {
  cleanupExpired();
  return readJson(MAP_FILE, {});
}

function listUnpairedTrackings() {
  cleanupExpired();
  const otps = readJson(OTP_FILE, {});
  const map = readJson(MAP_FILE, {});
  const paired = new Set(Object.values(map).flat());
  return Object.keys(otps).filter(t => !paired.has(t));
}

async function processOtpMessage(message) {
  const body = (message.body || '').trim();
  if (!body) return;
  const model = getConfig('CHATGPT_MODEL', 'gpt-4.1');

  const request = {
    model,
    messages: [
      {
        role: 'system',
        content:
          'Extract the tracking number and OTP from the message. If found, call save_tracking_otp. Do not reply to the user.'
      },
      { role: 'user', content: [{ type: 'text', text: body }] }
    ],
    tools: [
      {
        type: 'function',
        function: {
          name: 'save_tracking_otp',
          description: 'Persist tracking number and OTP for later retrieval',
          parameters: {
            type: 'object',
            properties: {
              tracking_number: { type: 'string' },
              otp: { type: 'string' }
            },
            required: ['tracking_number', 'otp']
          }
        }
      }
    ],
    tool_choice: 'auto',
    parallel_tool_calls: true
  };

  const configuredTemperature = parseTemperature(
    getConfig('CHATGPT_TEMPERATURE'),
    undefined
  );

  if (modelSupportsCustomTemperature(model)) {
    if (configuredTemperature !== undefined) {
      request.temperature = configuredTemperature;
    }
  } else if (
    configuredTemperature !== undefined &&
    Math.abs(configuredTemperature - 1) > Number.EPSILON
  ) {
    console.warn(
      `⚠️  Model "${model}" only supports the default temperature. Using the built-in value instead.`
    );
  }

  const response = await openai.chat.completions.create(request);

  const msg = response.choices[0].message;
  if (Array.isArray(msg.tool_calls)) {
    for (const call of msg.tool_calls) {
      if (call.function?.name === 'save_tracking_otp') {
        try {
          const args = JSON.parse(call.function.arguments || '{}');
          if (args.tracking_number && args.otp) {
            saveOtp(args.tracking_number, args.otp);
          }
        } catch {}
      }
    }
  }
}

async function resolveOtp(chat) {
  cleanupExpired();
  const phone = chat.id._serialized;
  const otps = readJson(OTP_FILE, {});
  const allTrackings = Object.keys(otps);
  if (!allTrackings.length) {
    await sendAutoMsg(chat, 'Sorry, no OTP numbers available.');
    return;
  }
  if (allTrackings.length === 1) {
    await sendOtp(chat, allTrackings[0]);
    return;
  }
  const map = readJson(MAP_FILE, {});
  const associated = (map[phone] || []).filter(t => otps[t]);
  if (associated.length) {
    await sendOtp(chat, associated[0], phone);
    return;
  }
  let trackings = getTrackingsForPhone(phone).filter(t => otps[t]);
  if (!trackings.length) trackings = listUnpairedTrackings();
  if (!trackings.length) {
    await sendAutoMsg(chat, 'Sorry, no OTP numbers available.');
    return;
  }
  const list = trackings.map((t, i) => `${i + 1}. ${t}`).join('\n');
  const header = 'Please select a tracking number, reply with the tracking number or line number:\n';
  await sendAutoMsg(chat, `${header}${list}`);
}

async function sendOtp(chat, tracking, phone) {
  cleanupExpired();
  const otp = getOtp(tracking);
  if (!otp) {
    await sendAutoMsg(chat, 'Sorry, OTP not found.');
    return;
  }
  await sendAutoMsg(chat, otp);
  removeOtp(tracking);
}

cleanupExpired();

module.exports = {
  processOtpMessage,
  associateTracking,
  resolveOtp,
  sendOtp,
  getOtp,
  getTrackingsForPhone,
  getAllOtpData,
  getTrackingMap,
  removeTrackingForPhone,
  clearTracking
};
