const fs = require('fs');
const path = require('path');
const openai = require('./openaiClient');
const { getConfig } = require('./config');
const { sendAuto } = require('./messaging');

const DATA_DIR = getConfig('SESSION_DIR', __dirname);
const OTP_FILE = path.join(DATA_DIR, 'otps.json');
const MAP_FILE = path.join(DATA_DIR, 'tracking-map.json');

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

function cleanupExpired() {
  const otps = readJson(OTP_FILE, {});
  const week = 7 * 24 * 60 * 60 * 1000;
  const now = Date.now();
  let changed = false;
  for (const [t, info] of Object.entries(otps)) {
    if (now - info.timestamp > week) {
      delete otps[t];
      changed = true;
    }
  }
  if (changed) writeJson(OTP_FILE, otps);
  const map = readJson(MAP_FILE, {});
  for (const phone of Object.keys(map)) {
    map[phone] = map[phone].filter(t => otps[t]);
    if (!map[phone].length) delete map[phone];
  }
  writeJson(MAP_FILE, map);
}

function saveOtp(tracking, otp) {
  const otps = readJson(OTP_FILE, {});
  otps[tracking] = { otp, timestamp: Date.now() };
  writeJson(OTP_FILE, otps);
  cleanupExpired();
}

function associateTracking(phone, tracking) {
  const map = readJson(MAP_FILE, {});
  if (!map[phone]) map[phone] = [];
  if (!map[phone].includes(tracking)) map[phone].push(tracking);
  writeJson(MAP_FILE, map);
  cleanupExpired();
}

function getOtp(tracking) {
  const otps = readJson(OTP_FILE, {});
  return otps[tracking]?.otp;
}

function removeTracking(tracking) {
  const otps = readJson(OTP_FILE, {});
  delete otps[tracking];
  writeJson(OTP_FILE, otps);
  const map = readJson(MAP_FILE, {});
  for (const phone of Object.keys(map)) {
    map[phone] = map[phone].filter(t => t !== tracking);
    if (!map[phone].length) delete map[phone];
  }
  writeJson(MAP_FILE, map);
}

function removeTrackingForPhone(phone, tracking) {
  const otps = readJson(OTP_FILE, {});
  delete otps[tracking];
  writeJson(OTP_FILE, otps);
  const map = readJson(MAP_FILE, {});
  if (map[phone]) {
    map[phone] = map[phone].filter(t => t !== tracking);
    if (!map[phone].length) delete map[phone];
  }
  writeJson(MAP_FILE, map);
}

function getTrackingsForPhone(phone) {
  const map = readJson(MAP_FILE, {});
  return map[phone] || [];
}

function listUnpairedTrackings() {
  const otps = readJson(OTP_FILE, {});
  const map = readJson(MAP_FILE, {});
  const paired = new Set(Object.values(map).flat());
  return Object.keys(otps).filter(t => !paired.has(t));
}

async function processOtpMessage(message) {
  const body = (message.body || '').trim();
  if (!body) return;
  const response = await openai.chat.completions.create({
    model: getConfig('CHATGPT_MODEL', 'gpt-4.1'),
    temperature: 0,
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
  });

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
    await sendAuto(chat, 'Sorry, no OTP numbers available.');
    return;
  }
  if (allTrackings.length === 1) {
    await sendOtp(chat, allTrackings[0]);
    return;
  }
  const map = readJson(MAP_FILE, {});
  const associated = map[phone] || [];
  if (associated.length) {
    await sendOtp(chat, associated[0], phone);
    return;
  }
  let trackings = getTrackingsForPhone(phone);
  if (!trackings.length) trackings = listUnpairedTrackings();
  if (!trackings.length) {
    await sendAuto(chat, 'Sorry, no OTP numbers available.');
    return;
  }
  const list = trackings.map((t, i) => `${i + 1}. ${t}`).join('\n');
  const header = 'Please select a tracking number, reply with the tracking number or line number:\n';
  await sendAuto(chat, `${header}${list}`);
}

async function sendOtp(chat, tracking, phone) {
  cleanupExpired();
  const otp = getOtp(tracking);
  if (!otp) {
    await sendAuto(chat, 'Sorry, OTP not found.');
    return;
  }
  await sendAuto(chat, otp);
  if (phone) removeTrackingForPhone(phone, tracking);
  else removeTracking(tracking);
}

module.exports = {
  processOtpMessage,
  associateTracking,
  resolveOtp,
  sendOtp,
  getOtp
};
