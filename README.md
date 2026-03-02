# @moltybob/dingtalk

DingTalk channel plugin for OpenClaw (Bot API).

## Overview

This extension enables OpenClaw to integrate with DingTalk, allowing bidirectional messaging between OpenClaw and DingTalk users/groups. It supports both streaming and webhook modes, with security and access control (dmPolicy, groupPolicy, allowFrom). Access tokens are cached in memory by `clientId` and reused until near expiry (refresh 5 minutes before), with concurrent request deduplication to avoid hitting DingTalk token rate limits.

## Installation

### NPM Package

```bash
openclaw plugins install @moltybob/dingtalk
```

Onboarding: select DingTalk and confirm the install prompt to fetch the plugin automatically.

## Configuration

### Basic Configuration

```json5
{
  "channels": {
    "dingtalk": {
      "enabled": true,
      "clientId": "your-dingtalk-app-key",
      "clientSecret": "your-dingtalk-app-secret",
      "agentId": "your-agent-id",
      "dmPolicy": "pairing",
      "groupPolicy": "allowlist",
      "allowFrom": ["userId123", "userId456"],
      "proxy": "http://proxy.local:8080"
    }
  }
}
```

- **dmPolicy**: `"open"` | `"pairing"` | `"allowlist"` — who can send messages (DM/session level).
- **groupPolicy**: `"open"` | `"allowlist"` | `"disabled"` — group chat access (used by onboarding; actual enforcement may depend on OpenClaw core).
- **allowFrom**: list of DingTalk user IDs allowed when using allowlist; optional for open/pairing.

### Multi-Account

Per-account settings live under `channels.dingtalk.accounts.<accountId>` (e.g. `clientId`, `clientSecret`, `dmPolicy`, `groupPolicy`, `allowFrom`). The default account uses top-level `channels.dingtalk` keys.

### Webhook Mode

```json5
{
  "channels": {
    "dingtalk": {
      "enabled": true,
      "webhookUrl": "https://your-domain.com/dingtalk-webhook",
      "webhookSecret": "your-secret-8-plus-chars",
      "webhookPath": "/dingtalk-webhook",
      "clientId": "your-dingtalk-app-key",
      "clientSecret": "your-dingtalk-app-secret"
    }
  }
}
```

If `webhookPath` is omitted, the plugin uses the webhook URL path. `clientId` / `clientSecret` are still required for sending messages.

## Access Control

- **Onboarding**: When you choose to configure “DingTalk 访问控制”, you can set policy and allowlist (user IDs). For multiple accounts, allowFrom is written to the corresponding account config.
- **Manual**: Set `dmPolicy`, `groupPolicy`, and `allowFrom` in config as in the examples above. Access checks are applied by OpenClaw using the plugin’s `security.resolveDmPolicy` (dmPolicy + allowFrom).

## Media Messages

The plugin supports rich media: images, files, audio/voice, video, and link previews. Sending uses the same cached access token to avoid extra token requests.

Programmatic usage:

```typescript
import { DingTalkMediaClient } from '@moltybob/dingtalk';

const mediaClient = new DingTalkMediaClient(clientId, clientSecret);

const uploadResult = await mediaClient.uploadMedia('/path/to/image.jpg', 'image');
if (uploadResult.ok && uploadResult.mediaId) {
  await mediaClient.sendImageMessage(conversationId, uploadResult.mediaId);
}
```

Supported upload types: `'image'` | `'voice'` | `'file'` | `'video'`.

## Network (e.g. China)

If you use a proxy and DingTalk traffic should not go through it:

```bash
export NO_PROXY="dingtalk.com,.dingtalk.com,api.dingtalk.com,wss-open-connection.dingtalk.com"
```

Restart the gateway after config changes.

## Development and Testing

- **Run tests**: `npm test` (uses `tsx`; runs `test/auth.test.ts` and `test/media.test.ts`).
- For more on development and integration, see [DINGTALK_DEVELOPMENT_GUIDE.md](./DINGTALK_DEVELOPMENT_GUIDE.md) if present.

## Exports

The package exports the plugin default plus: `getDingTalkAccessToken`, `DingTalkMediaClient`, `resolveDingTalkAccount`, and other channel/send/monitor helpers from the plugin modules.

## Features

- Bidirectional messaging (send and receive)
- Direct and group chat
- Media messages (images, files, audio, video, links)
- Multiple account support
- Access control (dmPolicy, groupPolicy, allowFrom)
- **Access token caching** (per clientId, refresh before expiry, concurrent dedup)
- Webhook and streaming modes
- Proxy support
- Error handling and OpenClaw integration
