const fs = require('fs');
const path = require('path');
const { getConfig } = require('./config');
const state = require('./state');

const DATA_DIR = getConfig('SESSION_DIR', __dirname);
const FILE = path.join(DATA_DIR, 'deliveries.json');
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_RETENTION_DAYS = 14;

function getRetentionMs() {
  const raw = getConfig('DATA_RETENTION_DAYS', DEFAULT_RETENTION_DAYS);
  const numeric = typeof raw === 'string' ? Number.parseFloat(raw) : Number(raw);
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric * DAY_MS;
  }
  return DEFAULT_RETENTION_DAYS * DAY_MS;
}

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
  const retentionMs = getRetentionMs();
  const cleaned = list.filter(
    d => !(d.status === 'delivered' && now - d.updated > retentionMs)
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

cleanup();

module.exports = { setStatus, listDeliveries };
