import Util from '@alicloud/tea-util';
import * as robot_1_0 from '@alicloud/dingtalk/robot_1_0';
import OpenApi from '@alicloud/openapi-client';
import * as $tea from '@alicloud/tea-typescript';
import { getDingTalkAccessToken } from './auth.js';
import { DingTalkMediaClient } from './media.js';

// Helper function to detect if text contains markdown syntax
function containsMarkdownSyntax(text: string): boolean {
  // Check for common markdown elements:
  // - Headers: # Header, ## Header, etc.
  // - Bold: **bold**, __bold__
  // - Italic: *italic*, _italic_
  // - Links: [text](url)
  // - Images: ![alt](url)
  // - Lists: - item, * item, 1. item
  // - Code blocks: `code`, ```code block```
  // - Blockquotes: > quote

  const markdownPatterns = [
    /^#+\s.+$/gm,           // Headers
    /\*\*.*?\*\*/g,         // Bold with **
    /__.*?__/g,             // Bold with __
    /\*.*?\*/g,             // Italic with *
    /_.*?_/g,               // Italic with _
    /\[.*?\]\(.*?\)/g,      // Links
    /!\[.*?\]\(.*?\)/g,     // Images
    /^(\s*)[-*]\s+/gm,      // Unordered lists
    /^(\s*)\d+\.\s+/gm,     // Ordered lists
    /`.*?`/g,               // Inline code
    /^```[\s\S]*?```/gm,    // Code blocks
    /^>\s.*/gm              // Blockquotes
  ];

  return markdownPatterns.some(pattern => pattern.test(text));
}

interface SendMessageOptions {
  appKey: string; // This is actually the clientId for the API call
  appSecret: string; // This is actually the clientSecret for the API call
  agentId: string; // Required for sending messages
  mediaUrl?: string;
  mediaPath?: string; // Local path to media file to upload and send
  sessionWebhook?: string; // For replying to messages using session webhook
}

interface SendMessageResult {
  ok: boolean;
  messageId?: string;
  error?: string;
}

// Define different message types according to DingTalk documentation
type MessageType = 'text' | 'image' | 'voice' | 'file' | 'link' | 'oa' | 'markdown' | 'actionCard' | 'feedCard';

interface BaseMessage {
  msgtype: MessageType;
}

interface TextMessage extends BaseMessage {
  msgtype: 'text';
  text: {
    content: string;
  };
}

interface LinkMessage extends BaseMessage {
  msgtype: 'link';
  link: {
    title: string;
    text: string;
    messageUrl: string;
    picUrl?: string;
  };
}

interface MarkdownMessage extends BaseMessage {
  msgtype: 'markdown';
  markdown: {
    title: string;
    text: string;
  };
}

// Media message interfaces - following DingTalk official specification
interface ImageMessage extends BaseMessage {
  msgtype: 'image';
  image: {
    media_id: string;
  };
}

interface VoiceMessage extends BaseMessage {
  msgtype: 'voice';
  voice: {
    media_id: string;
  };
}

interface FileMessage extends BaseMessage {
  msgtype: 'file';
  file: {
    media_id: string;
  };
}

interface VideoMessage extends BaseMessage {
  msgtype: 'video';
  video: {
    media_id: string;
    title?: string;
    content?: string;  // Changed from description to content as per DingTalk spec
  };
}

type DingTalkMessage = TextMessage | LinkMessage | MarkdownMessage | ImageMessage | VoiceMessage | FileMessage | VideoMessage;

export async function sendMessageDingTalk(
  to: string,
  text: string,
  options: SendMessageOptions
): Promise<SendMessageResult> {
  try {
    // If mediaPath is provided, we need to upload the media first and then send it
    if (options.mediaPath) {
      console.log(`[dingtalk:send] Preparing to send media file: ${options.mediaPath}`);
      const mediaClient = new DingTalkMediaClient(options.appKey, options.appSecret);

      // Determine media type based on file extension
      const ext = options.mediaPath.split('.').pop()?.toLowerCase();
      let mediaType: 'image' | 'voice' | 'file' | 'video' = 'file'; // default to file

      if (ext && ['jpg', 'jpeg', 'png', 'gif', 'bmp'].includes(ext)) {
        mediaType = 'image';
        console.log(`[dingtalk:send] Detected image file type for: ${options.mediaPath}`);
      } else if (ext && ['mp3', 'wav', 'amr', 'm4a'].includes(ext)) {
        mediaType = 'voice';
        console.log(`[dingtalk:send] Detected voice file type for: ${options.mediaPath}`);
      } else if (ext && ['mp4', 'avi', 'mov', 'wmv'].includes(ext)) {
        mediaType = 'video';
        console.log(`[dingtalk:send] Detected video file type for: ${options.mediaPath}`);
      } else {
        console.log(`[dingtalk:send] Using default file type for: ${options.mediaPath}`);
      }

      // Upload the media
      console.log(`[dingtalk:send] Uploading media file: ${options.mediaPath}`);
      const uploadResult = await mediaClient.uploadMedia(options.mediaPath, mediaType);

      if (!uploadResult.ok) {
        console.error(`[dingtalk:send] Failed to upload media: ${uploadResult.error}`);
        return {
          ok: false,
          error: `Failed to upload media: ${uploadResult.error}`
        };
      }

      console.log(`[dingtalk:send] Media uploaded successfully, media ID: ${uploadResult.mediaId}`);

      // Send the appropriate media message based on type
      switch (mediaType) {
        case 'image':
          console.log(`[dingtalk:send] Sending image message to: ${to}`);
          return await mediaClient.sendImageMessage(to, uploadResult.mediaId!, {
            atUserIds: [],
            isAtAll: false
          });
        case 'voice':
          console.log(`[dingtalk:send] Sending voice message to: ${to}`);
          // For voice, we need duration - for now, we'll use a default of 1 second
          return await mediaClient.sendVoiceMessage(to, uploadResult.mediaId!, 1, {
            atUserIds: [],
            isAtAll: false
          });
        case 'video':
          console.log(`[dingtalk:send] Sending video message to: ${to}`);
          return await mediaClient.sendVideoMessage(to, uploadResult.mediaId!, {
            title: 'Shared Video',
            description: text,
            atUserIds: [],
            isAtAll: false
          });
        case 'file':
          console.log(`[dingtalk:send] Sending file message to: ${to}`);
          return await mediaClient.sendFileMessage(to, uploadResult.mediaId!, options.mediaPath.split('/').pop() || 'file', {
            atUserIds: [],
            isAtAll: false
          });
      }
    }

    // If sessionWebhook is provided, use it to reply to the specific message
    if (options.sessionWebhook) {
      // Use the session webhook to reply to the specific conversation
      // This is the recommended way to reply to incoming messages

      // Detect if the text contains markdown and choose appropriate message type
      let messagePayload: TextMessage | MarkdownMessage;

      if (containsMarkdownSyntax(text)) {
        // Convert markdown to title and content
        const lines = text.split('\n');
        const firstLine = lines[0].replace(/^#+\s*/, ''); // Remove markdown header markers
        const content = lines.slice(1).join('\n');

        messagePayload = {
          msgtype: "markdown",
          markdown: {
            title: firstLine || 'Message',
            text: content || text
          }
        };
      } else {
        messagePayload = {
          msgtype: "text",
          text: {
            content: text
          }
        };
      }

      // Use dynamic import for axios since we only need it in this specific case
      // For webhook replies, we still need to use axios as it's the simplest approach
      const axios = (await import('axios')).default;
      const response = await axios.post(options.sessionWebhook, messagePayload, {
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (response.data.errcode !== 0) {
        return {
          ok: false,
          error: `Failed to send message via webhook: ${response.data.errmsg} (errcode: ${response.data.errcode})`
        };
      }

      return {
        ok: true,
        messageId: response.data.messageId || response.data.msgId || 'webhook_reply'
      };
    }

    // Otherwise, use the OpenAPI to send a new message
    const accessToken = await getDingTalkAccessToken(options.appKey, options.appSecret);

    // Prepare the message payload based on content type
    let messagePayload: DingTalkMessage;

    if (options.mediaUrl) {
      // If media URL is provided, send as a link message
      messagePayload = {
        msgtype: "link",
        link: {
          title: "Shared Media",
          text: text,
          messageUrl: options.mediaUrl,
          picUrl: options.mediaUrl // Use the media URL as the picture if it's an image
        }
      };
    } else if (containsMarkdownSyntax(text)) {
      // If text contains markdown syntax, send as markdown message
      const lines = text.split('\n');
      const firstLine = lines[0].replace(/^#+\s*/, ''); // Remove markdown header markers
      const content = lines.slice(1).join('\n');

      messagePayload = {
        msgtype: "markdown",
        markdown: {
          title: firstLine || 'Message',
          text: content || text
        }
      };
    } else {
      // Send as text message
      messagePayload = {
        msgtype: "text",
        text: {
          content: text
        }
      };
    }

    // Determine if 'to' refers to a user ID or conversation ID
    // In DingTalk, user IDs are typically alphanumeric strings
    // Conversation IDs often start with 'chat' or have a specific format
    const isUserId = /^[a-zA-Z0-9_-]+$/.test(to); // Basic check for user ID format

    if (isUserId) {
      // Use the official SDK to send to user (one-on-one chat)
      // Create config for the robot client
      let config = new OpenApi.Config({});
      config.protocol = "https";
      config.endpoint = "oapi.dingtalk.com";
      config.regionId = "central";
      // Add access token to header
      config.authorization = `Bearer ${accessToken}`;

      // Create the robot client (default export is Client; use type assertion for ESM/CJS interop)
      let client = new (robot_1_0 as { default: new (c: any) => any }).default(config);

      // Create the request to send message to user
      let sendByCodeRequest = new robot_1_0.OrgRobotSendMessageRequest({
        robotCode: options.agentId, // Use agentId as robot code
        userIds: [to], // Send to specific user ID
        msg: JSON.stringify(messagePayload), // Convert message to JSON string
        recvIds: undefined, // Not using recvIds for individual messages
        chatbotId: undefined,
      });

      try {
        const response = await client.orgRobotSendMessageWithOptions(sendByCodeRequest, new $tea.Request());

        if (!response.body?.success) {
          return {
            ok: false,
            error: `Failed to send message: ${response.body?.result?.errorMessage || 'Unknown error'}`
          };
        }

        return {
          ok: true,
          messageId: response.body.result?.outTrackId || 'sdk_send'
        };
      } catch (err: any) {
        if (!Util.empty(err.code) && !Util.empty(err.message)) {
          return {
            ok: false,
            error: `Failed to send message: ${err.message} (code: ${err.code})`
          };
        } else {
          return {
            ok: false,
            error: `Failed to send message: ${err.message || 'Unknown error'}`
          };
        }
      }
    } else {
      // For group chat, we still need to use the REST API directly
      // since the robot SDK might not cover all group chat scenarios
      const axios = (await import('axios')).default;

      const response = await axios.post('https://oapi.dingtalk.com/chat/send', {
        chatid: to, // Send to specific chat ID
        msg: messagePayload
      }, {
        params: {
          access_token: accessToken
        },
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (response.data.errcode !== 0) {
        return {
          ok: false,
          error: `Failed to send message: ${response.data.errmsg} (errcode: ${response.data.errcode})`
        };
      }

      // Return success with the appropriate message ID
      return {
        ok: true,
        messageId: response.data.message_id || response.data.msgId || 'unknown'
      };
    }
  } catch (error: any) {
    return {
      ok: false,
      error: error.message || 'Unknown error sending message'
    };
  }
}

/**
 * Send a message to multiple users in one-on-one chats (batch)
 * Reference: https://open.dingtalk.com/document/development/chatbots-send-one-on-one-chat-messages-in-batches
 */
export async function sendBatchToOneOnOneChats(
  userIds: string[],
  message: DingTalkMessage,
  options: Omit<SendMessageOptions, 'sessionWebhook'>
): Promise<SendMessageResult> {
  try {
    const accessToken = await getDingTalkAccessToken(options.appKey, options.appSecret);

    // Create config for the robot client
    let config = new OpenApi.Config({});
    config.protocol = "https";
    config.endpoint = "oapi.dingtalk.com";
    config.regionId = "central";
    config.authorization = `Bearer ${accessToken}`;

    // Create the robot client
    let client = new (robot_1_0 as { default: new (c: any) => any }).default(config);

    // Create the request to send message to multiple users
    let sendByCodeRequest = new robot_1_0.OrgRobotSendMessageRequest({
      robotCode: options.agentId, // Use agentId as robot code
      userIds: userIds, // Send to multiple user IDs
      msg: JSON.stringify(message), // Convert message to JSON string
      recvIds: undefined, // Not using recvIds for individual messages
      chatbotId: undefined,
    });

    const response = await client.orgRobotSendMessageWithOptions(sendByCodeRequest, new $tea.Request());

    if (!response.body?.success) {
      return {
        ok: false,
        error: `Failed to send batch message: ${response.body?.result?.errorMessage || 'Unknown error'}`
      };
    }

    return {
      ok: true,
      messageId: response.body.result?.outTrackId || 'batch_sdk_send'
    };
  } catch (error: any) {
    if (!Util.empty(error.code) && !Util.empty(error.message)) {
      return {
        ok: false,
        error: `Failed to send batch message: ${error.message} (code: ${error.code})`
      };
    } else {
      return {
        ok: false,
        error: `Failed to send batch message: ${error.message || 'Unknown error'}`
      };
    }
  }
}

/**
 * Send a message to a group chat
 * Reference: https://open.dingtalk.com/document/development/the-robot-sends-a-group-message
 */
export async function sendToGroupChat(
  chatId: string,
  message: DingTalkMessage,
  options: Omit<SendMessageOptions, 'sessionWebhook'>
): Promise<SendMessageResult> {
  try {
    const accessToken = await getDingTalkAccessToken(options.appKey, options.appSecret);

    // Use the REST API directly for group chat since it's the standard approach
    const axios = (await import('axios')).default;

    const response = await axios.post('https://oapi.dingtalk.com/chat/send', {
      chatid: chatId,
      msg: message
    }, {
      params: {
        access_token: accessToken
      },
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (response.data.errcode !== 0) {
      return {
        ok: false,
        error: `Failed to send group message: ${response.data.errmsg} (errcode: ${response.data.errcode})`
      };
    }

    return {
      ok: true,
      messageId: response.data.message_id || response.data.msgId || 'group_message'
    };
  } catch (error: any) {
    return {
      ok: false,
      error: error.message || 'Unknown error sending group message'
    };
  }
}