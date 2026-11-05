/** @jest-environment node */
const fs = require('fs');
const os = require('os');
const path = require('path');

describe('incoming OTP extraction with Terra', () => {
  const originalEnv = { ...process.env };
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gategpt-otp-test-'));
    Object.assign(process.env, { SESSION_DIR: dir, CHATGPT_MODEL: 'gpt-5.6-terra', CHATGPT_EFFORT: 'medium' });
    jest.resetModules();
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    fs.rmSync(dir, { recursive: true, force: true });
    jest.resetModules();
  });
  test('persists parsed tracking/OTP through Responses, never Chat Completions', async () => {
    const mock = { responses: { create: jest.fn().mockResolvedValue({ status: 'completed', output: [
      { type: 'function_call', call_id: 'c1', name: 'save_tracking_otp', arguments: '{"tracking_number":"TEST123","otp":"012345"}' }
    ] }) }, chat: { completions: { create: jest.fn() } } };
    jest.doMock('../openaiClient', () => mock);
    const { processOtpMessage, getOtp } = require('../otp');
    await processOtpMessage({ body: 'Test tracking TEST123, OTP 012345' });
    expect(mock.chat.completions.create).not.toHaveBeenCalled();
    const request = mock.responses.create.mock.calls[0][0];
    expect(request.reasoning).toEqual({ effort: 'medium' });
    expect(request.tools[0].name).toBe('save_tracking_otp');
    expect(getOtp('TEST123')).toBe('012345');
  });
  test('incomplete extraction never persists partial tool output', async () => {
    jest.doMock('../openaiClient', () => ({ responses: { create: jest.fn().mockResolvedValue({
      status: 'incomplete', output: [{ type: 'function_call', name: 'save_tracking_otp', arguments: '{"tracking_number":"TEST123","otp":"012345"}' }]
    }) } }));
    const { processOtpMessage, getOtp } = require('../otp');
    await expect(processOtpMessage({ body: 'Test OTP message' })).rejects.toThrow('not completed');
    expect(getOtp('TEST123')).toBeUndefined();
  });
});
