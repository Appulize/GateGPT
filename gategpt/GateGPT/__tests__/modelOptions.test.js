/** @jest-environment node */

describe('getModelRequestOptions', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    jest.resetModules();
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, originalEnv);
  });

  test('returns empty object for non GPT-5 models', async () => {
    jest.resetModules();
    const { getModelRequestOptions } = require('../modelOptions');
    expect(getModelRequestOptions('gpt-4.1')).toEqual({});
  });

  test('normalizes configured values for GPT-5 models', async () => {
    process.env.CHATGPT_EFFORT = 'HIGH';
    process.env.CHATGPT_VERBOSITY = 'low';

    jest.resetModules();
    const { getModelRequestOptions } = require('../modelOptions');
    const opts = getModelRequestOptions('gpt-5-mini');

    expect(opts).toEqual({
      reasoning_effort: 'high',
      verbosity: 'low'
    });
  });

  test('falls back to defaults when invalid values are provided', async () => {
    process.env.CHATGPT_EFFORT = 'invalid';
    process.env.CHATGPT_VERBOSITY = 'extra';

    jest.resetModules();
    const { getModelRequestOptions } = require('../modelOptions');
    const opts = getModelRequestOptions('gpt-5-preview');

    expect(opts).toEqual({
      reasoning_effort: 'low',
      verbosity: 'low'
    });
  });
});
