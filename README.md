# @moltybob/dingtalk

DingTalk channel plugin for OpenClaw (Bot API).

## Overview

This extension enables OpenClaw to integrate with DingTalk, allowing bidirectional messaging between OpenClaw and DingTalk users/groups. The extension supports both streaming and webhook modes, with full security and access control features.

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
  channels: {
    dingtalk: {
      enabled: true,
      clientId: "your-dingtalk-app-key",
      clientSecret: "your-dingtalk-app-secret",
      agentId: "your-agent-id",           // Optional but recommended for sending messages
      dmPolicy: "pairing",                // Options: "open", "pairing", "allowlist"
      allowFrom: ["userId123", "userId456"], // Optional allowlist when using "allowlist" policy
      proxy: "http://proxy.local:8080"    // Optional proxy configuration
    }
  }
}
```

### Webhook Mode
```json5
{
  channels: {
    dingtalk: {
      enabled: true,
      webhookUrl: "https://your-domain.com/dingtalk-webhook",
      webhookSecret: "your-secret-8-plus-chars", // At least 8 characters
      webhookPath: "/dingtalk-webhook",
      clientId: "your-dingtalk-app-key",         // Still needed for sending messages
      clientSecret: "your-dingtalk-app-secret"
    }
  }
}
```

If `webhookPath` is omitted, the plugin uses the webhook URL path.

## Media Messages Support

The plugin now supports rich media messages including:

- **Images**: Send and receive image files (JPG, PNG, GIF, etc.)
- **Files**: Share documents, PDFs, and other file types
- **Audio**: Send and receive voice messages and audio files
- **Video**: Share video content
- **Links**: Rich link previews with titles and descriptions

To send media messages programmatically, use the new media client:

```typescript
import { DingTalkMediaClient } from '@moltybob/dingtalk';

const mediaClient = new DingTalkMediaClient(clientId, clientSecret);

// Upload and send an image
const uploadResult = await mediaClient.uploadMedia('/path/to/image.jpg', 'image');
if (uploadResult.ok) {
  await mediaClient.sendImageMessage(conversationId, uploadResult.mediaId!);
}
```

## Network Configuration for China Users

If your development environment uses network proxies, domestic network traffic doesn't need to go through the proxy. Set the following environment variable to ensure proper connectivity to DingTalk services:

```bash
export NO_PROXY="dingtalk.com,.dingtalk.com,api.dingtalk.com,wss-open-connection.dingtalk.com"
```

This tells the system not to use proxy for DingTalk-related domains, ensuring proper communication with DingTalk APIs.

Restart the gateway after config changes.

## Development and Testing

For complete development guide, testing strategies, and integration details, see [DINGTALK_DEVELOPMENT_GUIDE.md](./DINGTALK_DEVELOPMENT_GUIDE.md).

## Features

- ✅ Bidirectional messaging (send and receive)
- ✅ Direct and group chat support
- ✅ Media message support (images, files, audio, video)
- ✅ Multiple account support
- ✅ Security controls (pairing, allowlists)
- ✅ Webhook and streaming modes
- ✅ Proxy support
- ✅ Comprehensive error handling
- ✅ Full integration with OpenClaw ecosystem