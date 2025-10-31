function normalizeModelName(model) {
  return (model || '').toLowerCase();
}

function modelSupportsCustomTemperature(model) {
  const normalized = normalizeModelName(model);

  // gpt-5 models currently require the default temperature value (1)
  if (normalized.startsWith('gpt-5')) {
    return false;
  }

  return true;
}

function parseTemperature(value, fallback) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : fallback;
}

module.exports = { modelSupportsCustomTemperature, parseTemperature };
