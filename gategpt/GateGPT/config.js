const fs = require('fs');
const path = require('path');

/* ─────────────── 🏠  Home-Assistant options → ENV  ─────────────── */
try {
  const HA_OPTIONS_PATH = '/data/options.json';
  if (fs.existsSync(HA_OPTIONS_PATH)) {
    const opts = JSON.parse(fs.readFileSync(HA_OPTIONS_PATH, 'utf8'));

    Object.entries(opts).forEach(([k, v]) => {
      const key = String(k).toUpperCase();
      if (process.env[key] === undefined) {
        process.env[key] = typeof v === 'object' ? JSON.stringify(v) : String(v);
      }
    });

    console.log(
      `🔧  Loaded ${Object.keys(opts).length} HA option(s) into env vars`
    );
  }
} catch (err) {
  console.warn('⚠️  Failed to read /data/options.json:', err.message);
}

const CONFIG_PATH = path.resolve(__dirname, 'config.json');
const SAMPLE_CONFIG_PATH = path.resolve(__dirname, 'config.sample.json');

// Ensure a config file exists
if (!fs.existsSync(CONFIG_PATH)) {
  try {
    fs.copyFileSync(SAMPLE_CONFIG_PATH, CONFIG_PATH);
    console.warn('⚠️  config.json missing – copied default settings from config.sample.json');
  } catch (err) {
    console.error('❌ Failed to create config.json from sample:', err.message);
  }
}

let CONFIG = require(CONFIG_PATH);

function getConfig(key, defaultValue = undefined) {
  const fromEnv = process.env[key];

  if (fromEnv !== undefined) {
    if (key === 'TRIGGER_KEYWORDS' || key === 'OTP_TRIGGER_KEYWORDS') {
      return fromEnv
        .split(/[,]+/)
        .map(s => s.trim())
        .filter(Boolean);
    }
    return fromEnv;
  }

  return CONFIG[key] ?? defaultValue;
}

function reloadConfig() {
  delete require.cache[require.resolve(CONFIG_PATH)];
  CONFIG = require(CONFIG_PATH);
}

module.exports = {
  getConfig,
  reloadConfig,
  CONFIG_PATH
};

