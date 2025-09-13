const fs = require('fs');
const path = require('path');
const { getConfig } = require('./config');
const state = require('./state');

const DATA_DIR = getConfig('SESSION_DIR', __dirname);
const FILE = path.join(DATA_DIR, 'deliveries.json');
const DAY_MS = 24 * 60 * 60 * 1000;

function readAll() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    return [];
  }
}

function writeAll(data) {
  fs.writeFileSync(FILE, JSON.stringify(data));
}

function cleanup(list = readAll()) {
  const now = Date.now();
  const cleaned = list.filter(
    d => !(d.status === 'delivered' && now - d.updated > DAY_MS)
  );
  if (cleaned.length !== list.length) {
    writeAll(cleaned);
    state.emit('update');
  }
  return cleaned;
}

function setStatus(tracking, status, chatId) {
  let list = cleanup();
  const existing = list.find(d => d.tracking === tracking);
  if (existing) {
    existing.status = status;
    if (chatId) existing.chatId = chatId;
    existing.updated = Date.now();
  } else {
    list.push({ tracking, status, chatId: chatId || null, updated: Date.now() });
  }
  writeAll(list);
  state.emit('update');
}

function listDeliveries() {
  return cleanup().sort((a, b) => b.updated - a.updated);
}

module.exports = { setStatus, listDeliveries };
