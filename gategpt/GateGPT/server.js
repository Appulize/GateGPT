const express = require('express');
const fs = require('fs');
const path = require('path');
const { getConfig } = require('./config');
const { getAllOtpData, clearTracking, updateOtp } = require('./otp');
const { listDeliveries, removeDelivery } = require('./deliveryLog');
const state = require('./state');
const { logEmitter, getLogHistory } = require('./logging');
const { getStatus } = require('./messaging');

function initServer() {
  const DATA_DIR = getConfig('SESSION_DIR', __dirname);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const QR_PNG_PATH = path.join(DATA_DIR, 'qr.png');
  const PUBLIC_DIR = path.join(__dirname, 'public');

  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use(express.static(PUBLIC_DIR));
  app.use('/bootstrap', express.static(path.join(__dirname, 'node_modules', 'bootstrap', 'dist')));
  app.use('/bootstrap-icons', express.static(path.join(__dirname, 'node_modules', 'bootstrap-icons', 'font')));
  app.get('/qr.png', (req, res) => res.sendFile(QR_PNG_PATH));

  const getState = () => ({
    ...getStatus(),
    otps: getAllOtpData(),
    deliveries: listDeliveries()
  });

  app.get('/api/state', (req, res) => {
    res.json(getState());
  });

  app.put('/api/otps/:tracking', (req, res) => {
    const tracking = (req.params.tracking || '').trim();
    if (!tracking) {
      res.status(400).json({ error: 'Tracking number is required.' });
      return;
    }

    const otpInput = typeof req.body?.otp === 'string' ? req.body.otp.trim() : '';
    if (!otpInput) {
      res.status(400).json({ error: 'OTP is required.' });
      return;
    }
    if (otpInput.length > 100) {
      res.status(400).json({ error: 'OTP is too long.' });
      return;
    }

    const deliveries = listDeliveries();
    const delivery = deliveries.find(d => d.tracking === tracking);
    if (!delivery) {
      res.status(404).json({ error: 'Delivery not found.' });
      return;
    }

    updateOtp(tracking, otpInput);
    res.json({ otp: otpInput });
  });

  const NON_DELETABLE_STATUSES = new Set(['delivered']);

  app.delete('/api/deliveries/:tracking', (req, res) => {
    const tracking = (req.params.tracking || '').trim();
    if (!tracking) {
      res.status(400).json({ error: 'Tracking number is required.' });
      return;
    }

    const deliveries = listDeliveries();
    const delivery = deliveries.find(d => d.tracking === tracking);
    if (!delivery) {
      res.status(404).json({ error: 'Delivery not found.' });
      return;
    }

    if (NON_DELETABLE_STATUSES.has(delivery.status)) {
      res
        .status(409)
        .json({ error: 'Delivered items cannot be deleted.' });
      return;
    }

    const { removed } = removeDelivery(tracking);
    if (!removed) {
      res.status(500).json({ error: 'Unable to delete delivery.' });
      return;
    }

    clearTracking(tracking);
    res.status(204).end();
  });

  app.get('/api/state-stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    if (res.flushHeaders) res.flushHeaders();
    res.write('event: streaming-works\ndata: 1\n\n');
    const send = () => res.write(`data: ${JSON.stringify(getState())}\n\n`);
    send();
    state.on('update', send);
    req.on('close', () => state.off('update', send));
  });

  app.get('/api/logs', (req, res) => {
    res.json(getLogHistory());
  });

  app.get('/api/log-stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    if (res.flushHeaders) res.flushHeaders();
    res.write('event: streaming-works\ndata: 1\n\n');
    getLogHistory().forEach(line => res.write(`data: ${line}\n\n`));
    const send = line => res.write(`data: ${line}\n\n`);
    logEmitter.on('log', send);
    req.on('close', () => logEmitter.off('log', send));
  });

  app.get('/api/settings', (req, res) => {
    const samplePath = path.join(__dirname, 'config.sample.json');
    const configPath = path.join(__dirname, 'config.json');
    let sample = {};
    let config = {};
    try {
      sample = JSON.parse(fs.readFileSync(samplePath, 'utf8'));
    } catch {}
    try {
      config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch {}
    const keys = new Set([...Object.keys(sample), ...Object.keys(config), 'SESSION_DIR']);
    const settings = {};
    keys.forEach(k => {
      const val = process.env[k] !== undefined ? process.env[k] : config[k];
      if (val !== undefined) settings[k] = val;
    });
    const redacted = {};
    for (const [k, v] of Object.entries(settings)) {
      let val = v;
      if (typeof val === 'object') val = JSON.stringify(val);
      const isSecret =
        typeof val === 'string' &&
        (/(TOKEN|SECRET|PASSWORD|PUSHOVER)/i.test(k) ||
          (/KEY$/i.test(k) && !/KEYWORDS$/i.test(k)));
      redacted[k] = isSecret
        ? `${val.slice(0, 4)}****${val.slice(-4)}`
        : val;
    }
    res.json(redacted);
  });

  app.get('/', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));
  app.listen(3000);
}

module.exports = { initServer };
