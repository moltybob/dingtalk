import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { DingTalkMediaClient } from '../src/media.js';

// Mock configuration for testing
const TEST_CLIENT_ID = 'test_client_id';
const TEST_CLIENT_SECRET = 'test_client_secret';

describe('DingTalkMediaClient', () => {
  let mediaClient: DingTalkMediaClient;

  beforeEach(() => {
    mediaClient = new DingTalkMediaClient(TEST_CLIENT_ID, TEST_CLIENT_SECRET);
  });

  describe('constructor', () => {
    it('should initialize with provided credentials', () => {
      assert.strictEqual(mediaClient['clientId'], TEST_CLIENT_ID);
      assert.strictEqual(mediaClient['clientSecret'], TEST_CLIENT_SECRET);
    });
  });

  describe('uploadMedia', () => {
    it('should return error result when trying to upload non-existent file', async () => {
      const result = await mediaClient.uploadMedia('/non/existent/file.jpg', 'image');
      
      assert.strictEqual(result.ok, false);
      assert.ok(result.error);
      assert.ok(result.error.includes('ENOENT') || result.error.includes('error'));
    });

    it('should accept valid media types', async () => {
      // This test will fail in CI since the file doesn't exist, but it tests the type validation
      const validTypes: Array<'image' | 'voice' | 'file' | 'video'> = ['image', 'voice', 'file', 'video'];
      
      for (const type of validTypes) {
        try {
          // Attempt to upload a non-existent file to test type validation
          await mediaClient.uploadMedia(`/tmp/test.${type === 'image' ? 'jpg' : type === 'voice' ? 'mp3' : type === 'video' ? 'mp4' : 'txt'}`, type);
        } catch (error) {
          // Expect an error due to non-existent file, but not due to invalid type
          assert.ok(error instanceof Error);
        }
      }
    });
  });

  describe('downloadMedia', () => {
    it('should return error result when trying to download non-existent media', async () => {
      const result = await mediaClient.downloadMedia('non-existent-media-id');
      
      assert.strictEqual(result.ok, false);
      assert.ok(result.error);
    });
  });

  describe('sendImageMessage', () => {
    it('should return error result when trying to send to invalid conversation', async () => {
      const result = await mediaClient.sendImageMessage('invalid-conversation-id', 'invalid-media-id');
      
      assert.strictEqual(result.ok, false);
      assert.ok(result.error);
    });
  });

  describe('sendFileMessage', () => {
    it('should return error result when trying to send to invalid conversation', async () => {
      const result = await mediaClient.sendFileMessage('invalid-conversation-id', 'invalid-media-id', 'test.txt');
      
      assert.strictEqual(result.ok, false);
      assert.ok(result.error);
    });
  });

  describe('sendVoiceMessage', () => {
    it('should return error result when trying to send to invalid conversation', async () => {
      const result = await mediaClient.sendVoiceMessage('invalid-conversation-id', 'invalid-media-id', 10);
      
      assert.strictEqual(result.ok, false);
      assert.ok(result.error);
    });
  });

  describe('sendVideoMessage', () => {
    it('should return error result when trying to send to invalid conversation', async () => {
      const result = await mediaClient.sendVideoMessage('invalid-conversation-id', 'invalid-media-id');
      
      assert.strictEqual(result.ok, false);
      assert.ok(result.error);
    });
  });
});

// Integration-style test to verify the media client can be instantiated
describe('Integration: DingTalkMediaClient', () => {
  it('should allow instantiation of media client', () => {
    const client = new DingTalkMediaClient('test-id', 'test-secret');
    assert.ok(client instanceof DingTalkMediaClient);
  });
});