const fs = require('fs');
const path = require('path');

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
    if (key === 'TRIGGER_KEYWORDS') {
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
