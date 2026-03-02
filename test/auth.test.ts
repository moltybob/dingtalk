import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import {
  getDingTalkAccessToken,
  __testingClearTokenCache,
} from '../src/auth.js';

describe('getDingTalkAccessToken', () => {
  beforeEach(() => {
    __testingClearTokenCache();
  });

  it('should throw when credentials are invalid (no cache hit)', async () => {
    await assert.rejects(
      async () => getDingTalkAccessToken('invalid_key', 'invalid_secret'),
      /Failed to get access token/,
    );
  });

  it('concurrent calls with same clientId both reject (dedup avoids duplicate request in production)', async () => {
    const p1 = getDingTalkAccessToken('same_key', 'same_secret');
    const p2 = getDingTalkAccessToken('same_key', 'same_secret');
    await assert.rejects(p1, /Failed to get access token/);
    await assert.rejects(p2, /Failed to get access token/);
  });

  it('should not cache failed response', async () => {
    await assert.rejects(
      async () => getDingTalkAccessToken('bad', 'bad'),
      /Failed to get access token/,
    );
    await assert.rejects(
      async () => getDingTalkAccessToken('bad', 'bad'),
      /Failed to get access token/,
    );
  });
});
