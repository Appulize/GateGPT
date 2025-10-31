const { getConfig } = require('./config');

const GPT5_PREFIX = /^gpt-5/i;
const DEFAULT_EFFORT = 'low';
const DEFAULT_VERBOSITY = 'low';
const ALLOWED_EFFORT = new Set(['minimal', 'low', 'medium', 'high']);
const ALLOWED_VERBOSITY = new Set(['low', 'medium', 'high']);

let warnedInvalidEffort = false;
let warnedInvalidVerbosity = false;

function normalizeSetting(key, allowed, defaultValue) {
  const raw = getConfig(key);

  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return defaultValue;
  }

  const normalized = String(raw).trim().toLowerCase();
  if (allowed.has(normalized)) {
    return normalized;
  }

  if (key === 'CHATGPT_EFFORT' && !warnedInvalidEffort) {
    console.warn(
      `⚠️  Invalid ${key} value "${raw}" provided. Falling back to "${defaultValue}".`
    );
    warnedInvalidEffort = true;
  }

  if (key === 'CHATGPT_VERBOSITY' && !warnedInvalidVerbosity) {
    console.warn(
      `⚠️  Invalid ${key} value "${raw}" provided. Falling back to "${defaultValue}".`
    );
    warnedInvalidVerbosity = true;
  }

  return defaultValue;
}

function getModelRequestOptions(model) {
  if (typeof model !== 'string' || !GPT5_PREFIX.test(model.trim())) {
    return {};
  }

  const effort = normalizeSetting(
    'CHATGPT_EFFORT',
    ALLOWED_EFFORT,
    DEFAULT_EFFORT
  );
  const verbosity = normalizeSetting(
    'CHATGPT_VERBOSITY',
    ALLOWED_VERBOSITY,
    DEFAULT_VERBOSITY
  );

  const options = {};
  if (effort) {
    options.reasoning = { effort };
  }
  if (verbosity) {
    options.response_format = { type: 'text', verbosity };
  }
  return options;
}

module.exports = {
  getModelRequestOptions,
  _test: {
    normalizeSetting,
    DEFAULT_EFFORT,
    DEFAULT_VERBOSITY,
    ALLOWED_EFFORT,
    ALLOWED_VERBOSITY
  }
};
