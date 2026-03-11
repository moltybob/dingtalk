import { EventAck, TOPIC_ROBOT, DWClient } from 'dingtalk-stream';
import type { OpenClawConfig, InboundMessage } from 'openclaw/plugin-sdk';
import type { ResolvedDingTalkAccount } from './accounts.js';
import { getDingTalkRuntime } from './runtime.js';

interface MonitorContext {
  appKey: string; // This is actually the clientId
  appSecret: string; // This is actually the clientSecret
  account: ResolvedDingTalkAccount;
  config: OpenClawConfig;
  runtime: any;
  abortSignal: AbortSignal;
  useWebhook?: boolean;
  webhookUrl?: string;
  webhookSecret?: string;
  webhookPath?: string;
  statusSink: (patch: any) => void;
  // Add the dispatch method for routing messages to the core system
  dispatchMessage?: (message: InboundMessage) => Promise<void>;
}

// Interface for different types of messages that DingTalk can send
interface BaseRobotMessage {
  conversationId: string;
  conversationType: string; // 1: single chat, 2: group chat
  chatbotCorpId: string;
  chatbotUserId: string;
  msgId: string;
  senderId: string;
  senderNick: string;
  senderStaffId?: string;
  createAt: number;
  robotCode: string;
  isAdmin: boolean;
  isInAtList: boolean;
  sessionWebhook: string;
}

// Text message type
interface TextRobotMessage extends BaseRobotMessage {
  msgtype: 'text';
  text: {
    content: string;
  };
}

// Image message type - following DingTalk official specification
interface ImageRobotMessage extends BaseRobotMessage {
  msgtype: 'picture' | 'image';
  // For image messages received from robots, the content typically contains download codes
  content: {
    downloadCode: string; // Used to download the actual image content
    pictureHeight?: string;
    pictureWidth?: string;
    pictureURL?: string; // Optional preview URL
  };
  text?: {
    content: string; // Optional text content with the image
  };
}

// Voice message type - following DingTalk official specification
interface VoiceRobotMessage extends BaseRobotMessage {
  msgtype: 'voice';
  content: {
    downloadCode: string;
    duration: number;
    fileSize?: string;
  };
  text?: { content: string };
}

// Audio message type (same structure as voice; doc uses msgtype "audio" with content.recognition for ASR text)
interface AudioRobotMessage extends BaseRobotMessage {
  msgtype: 'audio';
  content: {
    downloadCode: string;
    duration?: number;
    recognition?: string;
  };
  text?: { content: string };
}

// File message type - following DingTalk official specification
interface FileRobotMessage extends BaseRobotMessage {
  msgtype: 'file';
  content: {
    downloadCode: string;  // Used to download the actual file content
    fileName: string;      // Name of the file
    fileSize: string;      // Size of the file in bytes
  };
  text?: {
    content: string; // Optional text content with the file
  };
}

// Link message type
interface LinkRobotMessage extends BaseRobotMessage {
  msgtype: 'link';
  link: {
    title: string;
    text: string;
    messageUrl: string;
    picUrl?: string;
  };
}

// Markdown message type
interface MarkdownRobotMessage extends BaseRobotMessage {
  msgtype: 'markdown';
  markdown: {
    title: string;
    text: string;
  };
}

// Rich text message type - text and/or inline images (see https://open.dingtalk.com/document/development/receive-message)
interface RichTextRobotMessage extends BaseRobotMessage {
  msgtype: 'richText';
  content: {
    richText: Array<
      | { text: string }
      | { downloadCode: string; type: string }
    >;
  };
}

// Video message type (receive-message doc)
interface VideoRobotMessage extends BaseRobotMessage {
  msgtype: 'video';
  content?: {
    downloadCode: string;
    videoType?: string;
    duration?: number;
  };
}

type RobotMessage = TextRobotMessage | ImageRobotMessage | VoiceRobotMessage | AudioRobotMessage | FileRobotMessage | LinkRobotMessage | MarkdownRobotMessage | RichTextRobotMessage | VideoRobotMessage;

// Directly handle the inbound message using the runtime channel system
// This follows the same pattern as other channel extensions (Matrix, etc.)
async function processInboundMessage(message: RobotMessage, config: OpenClawConfig, runtime: any, appKey?: string, appSecret?: string): Promise<void> {
  // Extract common message information
  const { senderId, senderNick, conversationType, conversationId, msgId, createAt } = message;

  console.debug(`[dingtalk] Processing inbound message:`);
  console.debug(`[dingtalk] Sender: ${senderNick} (${senderId.substring(0, 8)}...${senderId.substring(senderId.length - 4)})`);
  console.debug(`[dingtalk] Conversation: ${conversationId.substring(0, 8)}...${conversationId.substring(conversationId.length - 4)} (Type: ${conversationType})`);
  console.debug(`[dingtalk] Message type: ${message.msgtype}`);
  console.debug(`[dingtalk] Timestamp: ${new Date(createAt).toISOString()}`);
  console.debug(`[dingtalk] Is admin: ${message.isAdmin}`);
  console.debug(`[dingtalk] Is in AT list: ${message.isInAtList}`);
  console.debug(`[dingtalk] Robot code: ${message.robotCode.substring(0, 8)}...${message.robotCode.substring(message.robotCode.length - 4)}`);
  console.debug(`[dingtalk] Session webhook: ${message.sessionWebhook ? message.sessionWebhook.substring(0, 20) + '...' : 'not available'}`);

  try {
    // Get the proper runtime using getDingTalkRuntime
    const dingtalkRuntime = getDingTalkRuntime();
    
    // Use the runtime to access core functionality similar to other channels
    const route = dingtalkRuntime.channel.routing.resolveAgentRoute({
      cfg: config,
      channel: "dingtalk",
      peer: {
        kind: conversationType === "1" ? "dm" : "group",
        id: conversationType === "1" ? senderId : conversationId,
      },
    });

    // Import the HTTP client to handle media downloads
    const { DingTalkHttpClient } = await import('./dingtalk-client.js');
    const httpClient = new DingTalkHttpClient(appKey || '', appSecret || '');
    
    // Helper function to download media from DingTalk using mediaId or downloadCode
    const downloadDingTalkMedia = async (identifier: string, mediaType: 'image' | 'voice' | 'file'): Promise<{ path?: string; contentType?: string; error?: string } | null> => {
      console.log(`[dingtalk:monitor] Attempting to download ${mediaType} with identifier: ${identifier.substring(0, 10)}...`);
      try {
        // First, try to download directly using the identifier (could be mediaId or downloadCode)
        // Pass the robotCode from the message if available
        const result = await httpClient.downloadMedia(identifier, message.robotCode);

        if (result.ok) {
          const contentType = result.contentType || '';
          if (contentType.includes('application/json')) {
            console.warn(`[dingtalk:monitor] Rejecting download: response is JSON (likely API error), not binary. contentType=${contentType}`);
            return { error: 'Download returned JSON instead of binary (check API/identifier)' };
          }
          console.log(`[dingtalk:monitor] ${mediaType.charAt(0).toUpperCase() + mediaType.slice(1)} download successful, size: ${result.data?.length || 0} bytes, contentType: ${contentType}`);

          // Save under os.tmpdir() so path is NOT under OpenClaw getMediaDir(). Then stageSandboxMedia()
          // does not copy/rewrite MediaPath to a relative path; we keep an absolute path. OpenClaw's
          // attachment cache resolveLocalPath() uses path.resolve() for relative paths (vs process.cwd()),
          // so relative paths after staging point to the wrong place; keeping absolute avoids that.
          const fs = (await import('fs')).default;
          const path = (await import('path')).default;
          const os = (await import('os')).default;
          const mediaInboundDir = path.join(os.tmpdir(), 'dingtalk-media');
          if (!fs.existsSync(mediaInboundDir)) {
            fs.mkdirSync(mediaInboundDir, { recursive: true });
          }

          // Use actual contentType so saved file has correct extension (e.g. .png for image/png); avoids readers treating PNG as corrupt
          const ct = (result.contentType || '').toLowerCase().split(';')[0].trim();
          const extByContentType: Record<string, string> = {
            'image/png': '.png',
            'image/jpeg': '.jpg',
            'image/jpg': '.jpg',
            'image/gif': '.gif',
            'image/webp': '.webp',
            'audio/mpeg': '.mp3',
            'audio/mp3': '.mp3',
            'audio/mp4': '.m4a',
            'audio/wav': '.wav',
          };
          const fileExtension = extByContentType[ct] ?? (mediaType === 'image' ? '.png' : mediaType === 'voice' ? '.mp3' : '.dat');
          const fileName = `dingtalk_media_${Date.now()}_${Math.random().toString(36).substring(2, 10)}${fileExtension}`;
          const filePath = path.join(mediaInboundDir, fileName);

          // Write the buffer to file
          fs.writeFileSync(filePath, result.data!);

          return { path: filePath, contentType: result.contentType }; // Return path and content type
        } else {
          console.warn(`[dingtalk:monitor] Failed to download ${mediaType}:`, result.error);
          return { error: result.error || `Failed to download ${mediaType}` };
        }
      } catch (downloadError) {
        console.error(`[dingtalk:monitor] Error downloading ${mediaType} with identifier ${identifier.substring(0, 10)}...:`, downloadError);
        return { error: `Error downloading ${mediaType}: ${String(downloadError)}` };
      }
    };

    // Process message based on its type
    let textContent = '';
    let mediaPath: string | undefined;
    let mediaType: string | undefined;
    let rawContent: any;

    console.log(`[dingtalk:monitor] Processing message of type: ${message.msgtype}`);
    switch (message.msgtype) {
      case 'text':
        textContent = message.text.content;
        rawContent = message.text;
        console.debug(`[dingtalk] Message content: ${textContent.substring(0, 100)}${textContent.length > 100 ? '...' : ''}`);
        break;

      case 'image':
      case 'picture':
        console.log(`[dingtalk:monitor] Processing image message`);
        textContent = message.text?.content || '';
        // According to DingTalk documentation, image messages contain download codes in the content
        if (message.content && message.content.downloadCode) {
          const downloadCode = message.content.downloadCode;

          console.log(`[dingtalk:monitor] Image message with downloadCode: ${downloadCode.substring(0, 10)}...`);

          // Use the download code to retrieve the actual image content
          // This follows the official DingTalk specification for downloading media
          try {
            // For image messages, we need to use the downloadCode to get the actual image
            // First, we need to exchange the downloadCode for a mediaId
            console.log(`[dingtalk:monitor] Attempting to download image using downloadCode: ${downloadCode.substring(0, 10)}...`);

            // In DingTalk's system, we typically need to first get the media ID using the download code
            // Then download the actual media file
            const mediaResult = await downloadDingTalkMedia(downloadCode, 'image');
            if (mediaResult && !mediaResult.error) {
              mediaPath = mediaResult.path;
              mediaType = mediaResult.contentType;
              console.log(`[dingtalk:monitor] Image downloaded via downloadCode, path: ${mediaPath}, type: ${mediaType}`);
            } else {
              console.warn(`[dingtalk:monitor] Failed to download image via downloadCode:`, mediaResult?.error);
            }
          } catch (downloadError) {
            console.error(`[dingtalk:monitor] Error downloading image using downloadCode:`, downloadError);
          }
        } else {
          console.warn(`[dingtalk:monitor] Image message with missing content data:`, message.content);
        }
        rawContent = message.content;
        break;

      case 'voice':
      case 'audio': {
        console.log(`[dingtalk:monitor] Processing voice/audio message`);
        const voiceMsg = message as VoiceRobotMessage | AudioRobotMessage;
        textContent = voiceMsg.text?.content || (voiceMsg as AudioRobotMessage).content?.recognition || '';
        if (voiceMsg.content && voiceMsg.content.downloadCode) {
          const downloadCode = voiceMsg.content.downloadCode;
          const duration = (voiceMsg.content as { duration?: number }).duration;

          console.debug(`[dingtalk] Voice message with downloadCode: ${downloadCode.substring(0, 10)}..., duration: ${duration}s`);

          console.log(`[dingtalk:monitor] Attempting to download voice message using downloadCode: ${downloadCode.substring(0, 10)}...`);
          const mediaResult = await downloadDingTalkMedia(downloadCode, 'voice');
          if (mediaResult && !mediaResult.error) {
            mediaPath = mediaResult.path;
            mediaType = mediaResult.contentType;
            console.log(`[dingtalk:monitor] Voice message downloaded, path: ${mediaPath}, type: ${mediaType}`);
          } else {
            console.warn(`[dingtalk:monitor] Failed to download voice message:`, mediaResult?.error);
          }
        } else {
          console.debug(`[dingtalk] Voice message with missing content data`);
        }
        console.debug(`[dingtalk] Optional text content: ${textContent.substring(0, 100)}${textContent.length > 100 ? '...' : ''}`);
        rawContent = voiceMsg.content;
        break;
      }

      case 'file':
        console.log(`[dingtalk:monitor] Processing file message`);
        textContent = message.text?.content || '';
        if (message.content && message.content.downloadCode) {
          const downloadCode = message.content.downloadCode;
          const fileName = message.content.fileName;
          const fileSize = message.content.fileSize;

          console.debug(`[dingtalk] File message with downloadCode: ${downloadCode.substring(0, 10)}..., fileName: ${fileName}, fileSize: ${fileSize} bytes`);

          // Download the file using the download code
          console.log(`[dingtalk:monitor] Attempting to download file with downloadCode: ${downloadCode.substring(0, 10)}...`);
          const mediaResult = await downloadDingTalkMedia(downloadCode, 'file');
          if (mediaResult && !mediaResult.error) {
            mediaPath = mediaResult.path;
            mediaType = mediaResult.contentType;
            console.log(`[dingtalk:monitor] File downloaded, path: ${mediaPath}, type: ${mediaType}`);
          } else {
            console.warn(`[dingtalk:monitor] Failed to download file:`, mediaResult?.error);
          }
        } else {
          console.debug(`[dingtalk] File message with missing content data`);
        }
        console.debug(`[dingtalk] Optional text content: ${textContent.substring(0, 100)}${textContent.length > 100 ? '...' : ''}`);
        rawContent = message.content;
        break;

      case 'video': {
        console.log(`[dingtalk:monitor] Processing video message`);
        const videoMsg = message as VideoRobotMessage;
        textContent = '';
        if (videoMsg.content?.downloadCode) {
          const mediaResult = await downloadDingTalkMedia(videoMsg.content.downloadCode, 'file');
          if (mediaResult && !mediaResult.error) {
            mediaPath = mediaResult.path;
            mediaType = mediaResult.contentType || 'video/mp4';
            console.log(`[dingtalk:monitor] Video downloaded, path: ${mediaPath}`);
          }
        }
        rawContent = videoMsg.content;
        break;
      }

      case 'link':
        textContent = `${message.link.title}\n${message.link.text}\n${message.link.messageUrl}`;
        console.debug(`[dingtalk] Link message: ${message.link.title}`);
        console.debug(`[dingtalk] Link text: ${message.link.text.substring(0, 100)}${message.link.text.length > 100 ? '...' : ''}`);
        rawContent = message.link;
        break;

      case 'markdown':
        textContent = `${message.markdown.title}\n${message.markdown.text}`;
        console.debug(`[dingtalk] Markdown message: ${message.markdown.title}`);
        console.debug(`[dingtalk] Markdown content: ${message.markdown.text.substring(0, 100)}${message.markdown.text.length > 100 ? '...' : ''}`);
        rawContent = message.markdown;
        break;

      case 'richText': {
        // content.richText: array of { text } or { downloadCode, type: 'picture' } (see receive-message doc)
        console.log(`[dingtalk:monitor] Processing richText message`);
        const richText = (message as RichTextRobotMessage).content?.richText;
        const textParts: string[] = [];
        if (Array.isArray(richText)) {
          for (const el of richText) {
            if (el && 'text' in el && typeof el.text === 'string') {
              // Avoid duplicate consecutive text (e.g. same phrase twice from client)
              if (textParts[textParts.length - 1] !== el.text) textParts.push(el.text);
            } else if (el && 'downloadCode' in el && el.type === 'picture') {
              if (!mediaPath) {
                try {
                  const mediaResult = await downloadDingTalkMedia(el.downloadCode, 'image');
                  if (mediaResult && !mediaResult.error) {
                    mediaPath = mediaResult.path;
                    mediaType = mediaResult.contentType;
                    console.log(`[dingtalk:monitor] RichText inline image downloaded, path: ${mediaPath}`);
                  }
                } catch (e) {
                  console.warn(`[dingtalk:monitor] Failed to download richText image:`, e);
                }
              }
              textParts.push('[Image]');
            }
          }
        }
        textContent = textParts.join(' ').trim() || '';
        rawContent = (message as RichTextRobotMessage).content;
        break;
      }

      default:
        // Handle unknown message types as text (e.g. audio/video if not explicitly handled)
        console.warn(`[dingtalk] Unknown message type: ${message.msgtype}, treating as text`);
        textContent = JSON.stringify(message);
        rawContent = message;
    }

    // When user sends only media (e.g. image with no caption), provide a short body so the AI doesn't respond "no text"
    const hasText = Boolean(textContent && String(textContent).trim());
    const mediaPlaceholder = mediaPath
      ? (mediaType?.startsWith('image') ? '[User sent an image]' : mediaType?.startsWith('audio') || mediaType?.includes('voice') ? '[User sent a voice message]' : mediaType?.startsWith('video') ? '[User sent a video]' : '[User sent a file]')
      : '';
    const effectiveBody = hasText ? textContent : mediaPlaceholder;

    // OpenClaw inbound contract: MsgContext uses MediaPath (absolute path so staging does not rewrite; attachment cache reads from path), MediaType, optional MediaUrl. normalizeAttachments(ctx) builds from these.

    // Format as a message context that OpenClaw can process
    const ctxPayload = {
      Body: effectiveBody,                                   // Main message body (never empty when media present)
      RawBody: effectiveBody,                                // Raw message content
      CommandBody: effectiveBody,                            // Command body
      From: `dingtalk:${senderId}`,                          // Format sender as channel:id
      To: `dingtalk:${message.chatbotUserId}`,               // Format recipient as channel:id
      SessionKey: route.sessionKey,                          // Use resolved session key from route
      AccountId: route.accountId,                            // Use resolved account ID from route
      ChatType: conversationType === "1" ? "direct" : "group", // Convert conversation type
      ConversationLabel: conversationType === "1" ? senderNick : `Group ${conversationId.substring(0, 8)}...`,
      SenderName: senderNick,
      SenderId: senderId,
      Provider: "dingtalk" as const,
      Surface: "dingtalk" as const,
      MessageSid: msgId,                                     // Use message ID
      Timestamp: createAt,                                   // Use creation timestamp
      CommandAuthorized: true,                                // For now, assume authorized
      OriginatingChannel: "dingtalk" as const,
      OriginatingTo: `dingtalk:${conversationId}`,           // Route back to same conversation
      // Additional fields
      isAdmin: message.isAdmin,
      isInAtList: message.isInAtList,
      robotCode: message.robotCode,
      sessionWebhook: message.sessionWebhook,
      // Media: absolute path (saved under os.tmpdir() so staging does not rewrite); MediaType for normalizeAttachments
      MediaPath: mediaPath,
      MediaType: mediaType,
      MediaUrl: mediaPath,
      // Raw message data
      RawMessageData: rawContent,
      RawMessageType: message.msgtype,
    };

    if (mediaPath) {
      console.log(`[dingtalk:monitor] Passing MediaPath to OpenClaw: ${mediaPath} (absolute: ${mediaPath.startsWith('/')})`);
    }
    console.debug(`[dingtalk] Formatted inbound message context for processing`);

    // Record the inbound session
    const storePath = dingtalkRuntime.channel.session.resolveStorePath(config.session?.store, {
      agentId: route.agentId,
    });
    
    await dingtalkRuntime.channel.session.recordInboundSession({
      storePath,
      sessionKey: ctxPayload.SessionKey ?? route.sessionKey,
      ctx: ctxPayload,
      onRecordError: (err) => {
        console.error(`[dingtalk] Error recording session:`, err);
      },
    });

    // Dispatch using the runtime's core functionality
    // This follows the pattern from other channels like Matrix
    await dingtalkRuntime.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
      ctx: ctxPayload,
      cfg: config,
      dispatcherOptions: {
        responsePrefix: "",
        deliver: async (payload) => {
          // This handles delivering the response back to DingTalk
          // Import and use the sendMessageDingTalk function to send the reply
          const { sendMessageDingTalk } = await import('./send.js');
          const sessionWebhook = ctxPayload.sessionWebhook; // Use session webhook for replies
          
          // Send the reply back to DingTalk
          const result = await sendMessageDingTalk(
            conversationId, // Send back to the same conversation
            payload.text || '', // The reply text from AI
            {
              appKey: appKey || '', // Use provided appKey or empty string
              appSecret: appSecret || '', // Use provided appSecret or empty string
              agentId: 'openclaw',
              sessionWebhook, // Use the session webhook for this conversation
            }
          );
          
          if (!result.ok) {
            console.error(`[dingtalk] Failed to send reply:`, result.error);
          } else {
            console.debug(`[dingtalk] Reply sent successfully, message ID:`, result.messageId);
          }
        },
        onError: (err, info) => {
          console.error(`[dingtalk] Reply error:`, err, info);
        }
      },
    });

    console.debug(`[dingtalk] Message dispatched successfully via runtime`);
    
    console.log(`[dingtalk] Received ${message.msgtype} message from ${senderNick}: ${String(effectiveBody).substring(0, 50)}${String(effectiveBody).length > 50 ? '...' : ''}`);
  } catch (error) {
    console.error(`[dingtalk] Error accessing DingTalk runtime or processing message:`, error);
    // Fallback: try using the passed runtime if DingTalk runtime is not available
    console.warn(`[dingtalk] Using fallback message processing`);
  }
}

export async function monitorDingTalkProvider(ctx: MonitorContext) {
  console.debug('[dingtalk] Monitor context received:');
  console.debug(`[dingtalk] Has dispatchMessage: ${!!ctx.dispatchMessage}`);
  console.debug(`[dingtalk] dispatchMessage type: ${typeof ctx.dispatchMessage}`);

  console.debug('[dingtalk] Starting DingTalk provider with config:');
  console.debug(`[dingtalk] App Key: ${ctx.appKey ? '***masked***' : 'not provided'}`);
  console.debug(`[dingtalk] App Secret: ${ctx.appSecret ? '***masked***' : 'not provided'}`);
  console.debug(`[dingtalk] Use Webhook: ${ctx.useWebhook}`);
  console.debug(`[dingtalk] Webhook URL: ${ctx.webhookUrl || 'not set'}`);

  if (ctx.useWebhook) {
    // For now, focus on Stream API implementation
    console.warn('[dingtalk] Webhook mode not fully implemented for DingTalk, using Stream API');
  }

  let connection: any = null;
  let reconnectAttempts = 0;
  let clientInstance: any = null;
  const maxReconnectAttempts = 10;
  const initialReconnectDelay = 1000; // 1 second
  const maxReconnectDelay = 60000; // 60 seconds

  // Function to establish connection with retry logic
  const connectWithRetry = async () => {
    const attemptConnection = async () => {
      try {
        const client = new DWClient({
          clientId: ctx.appKey,
          clientSecret: ctx.appSecret,
        });

        // Register the callback listener for robot messages
        client.registerCallbackListener(TOPIC_ROBOT, async (res) => {
          try {
            const payload = JSON.parse(res.data) as RobotMessage;
            const { senderId, senderNick, conversationType, conversationId, msgtype } = payload;

            // Log received message based on its type
            let logContent = '';
            switch (msgtype) {
              case 'text':
                logContent = payload.text?.content || '';
                break;
              case 'image':
              case 'picture':
                logContent = (payload as ImageRobotMessage).text?.content || `Image`;
                break;
              case 'voice':
              case 'audio':
                logContent = (payload as VoiceRobotMessage).text?.content || (payload as { content?: { recognition?: string } }).content?.recognition || 'Voice message';
                break;
              case 'file':
                logContent = (payload as FileRobotMessage).text?.content || `File: ${(payload as FileRobotMessage).content?.fileName || ''}`;
                break;
              case 'link':
                logContent = (payload as LinkRobotMessage).link?.title || (payload as LinkRobotMessage).link?.text || 'Link message';
                break;
              case 'markdown':
                logContent = (payload as MarkdownRobotMessage).markdown?.title || (payload as MarkdownRobotMessage).markdown?.text || 'Markdown message';
                break;
              case 'richText': {
                const rt = (payload as RichTextRobotMessage).content?.richText;
                const first = Array.isArray(rt) ? rt.find((e: any) => e?.text) : null;
                logContent = first && 'text' in first ? first.text : 'Rich text';
                break;
              }
              case 'video':
                logContent = 'Video message';
                break;
              default:
                logContent = JSON.stringify(payload);
            }

            // Log received message
            console.log(`[dingtalk] Received ${msgtype} message from ${senderNick} (${senderId}): ${logContent.substring(0, 100)}${logContent.length > 100 ? '...' : ''}`);
            console.log(`[dingtalk] Conversation: ${conversationId}, Type: ${conversationType}`);

            // Update status to indicate message received
            ctx.statusSink({ lastInboundAt: new Date().toISOString() });

            // Process the inbound message - pass the runtime and credentials
            await processInboundMessage(payload, ctx.config, ctx.runtime, ctx.appKey, ctx.appSecret);

            // Acknowledge the message to prevent re-delivery
            client.socketCallBackResponse(res.headers.messageId, { success: true });

            return EventAck.SUCCESS;
          } catch (error) {
            console.error('[dingtalk] Error processing DingTalk message:', error);
            console.error('[dingtalk] Error stack:', error instanceof Error ? error.stack : 'No stack available');
            ctx.statusSink({
              lastError: error instanceof Error ? error.message : String(error)
            });
            return EventAck.FAILED;
          }
        });

        console.debug('[dingtalk] Attempting to connect to DingTalk stream...');
        
        // Connect to the stream
        const conn = await client.connect();
        console.log('[dingtalk] Successfully connected to DingTalk stream');

        // Reset reconnect attempts on successful connection
        reconnectAttempts = 0;

        // Update status to running
        ctx.statusSink({
          running: true,
          lastStartAt: new Date().toISOString(),
          lastError: null
        });

        return { client, connection: conn };
      } catch (error) {
        console.error('[dingtalk] Failed to connect to DingTalk stream:', error);
        console.error('[dingtalk] Error details:', error instanceof Error ? error.message : String(error));
        console.error('[dingtalk] Error code:', (error as any).code || 'no code');
        console.error('[dingtalk] Error stack:', error instanceof Error ? error.stack : 'No stack available');
        
        // Additional debugging for Axios errors (the specific error mentioned in the issue)
        if ((error as any).config) {
          console.error('[dingtalk] Axios request config:', {
            url: (error as any).config.url,
            method: (error as any).config.method,
            headers: (error as any).config.headers ? Object.keys((error as any).config.headers) : 'no headers',
            data: (error as any).config.data ? 'data present' : 'no data'
          });
        }
        
        if ((error as any).response) {
          console.error('[dingtalk] Axios response details:', {
            status: (error as any).response.status,
            statusText: (error as any).response.statusText,
            headers: (error as any).response.headers,
            data: (error as any).response.data
          });
        }
        
        // Update status with error
        ctx.statusSink({
          running: false,
          lastError: error instanceof Error ? error.message : String(error),
          lastStartAt: new Date().toISOString()
        });
        
        throw error; // Re-throw to trigger retry logic
      }
    };

    // Exponential backoff retry loop
    while (!ctx.abortSignal.aborted) {
      try {
        return await attemptConnection();
      } catch (error) {
        if (ctx.abortSignal.aborted) {
          console.debug('[dingtalk] Abort signal received, stopping reconnection attempts');
          throw new Error('DingTalk monitor aborted');
        }

        reconnectAttempts++;
        if (reconnectAttempts >= maxReconnectAttempts) {
          console.error(`[dingtalk] Maximum reconnection attempts (${maxReconnectAttempts}) reached. Giving up.`);
          throw new Error(`Failed to reconnect after ${maxReconnectAttempts} attempts`);
        }

        // Calculate delay with exponential backoff (with jitter to prevent thundering herd)
        const baseDelay = Math.min(initialReconnectDelay * Math.pow(2, reconnectAttempts - 1), maxReconnectDelay);
        const jitter = Math.random() * 0.1 * baseDelay; // Add 10% jitter
        const delay = baseDelay + jitter;

        console.warn(`[dingtalk] Connection attempt ${reconnectAttempts}/${maxReconnectAttempts} failed. Retrying in ${Math.round(delay / 1000)}s...`);
        console.error('[dingtalk] Reconnection error:', error instanceof Error ? error.message : String(error));

        // Wait for the calculated delay or until abort signal
        await new Promise((resolve) => {
          const timeout = setTimeout(() => {
            resolve(null);
          }, delay);
          
          const onAbort = () => {
            clearTimeout(timeout);
            resolve(null);
          };
          
          // Only add abort listener if it doesn't already exist
          ctx.abortSignal.addEventListener('abort', onAbort, { once: true });
        });

        if (ctx.abortSignal.aborted) {
          console.debug('[dingtalk] Abort signal received during reconnection delay');
          throw new Error('DingTalk monitor aborted');
        }
      }
    }
  };

  // Establish initial connection
  let clientConnection;
  try {
    clientConnection = await connectWithRetry();
  } catch (error) {
    console.error('[dingtalk] Failed to establish initial connection after retries:', error);
    throw error;
  }

  const { client, connection: conn } = clientConnection;
  connection = conn;
  clientInstance = client;

  // Handle connection errors and disconnections for automatic reconnection
  const handleDisconnection = async () => {
    console.warn('[dingtalk] Connection lost, attempting to reconnect...');
    
    // Update status to reflect disconnection
    ctx.statusSink({
      running: false,
      lastError: 'Connection lost, attempting to reconnect...'
    });

    // Disconnect the current client
    try {
      if (connection && typeof connection.close === 'function') {
        connection.close();
      }
    } catch (closeError) {
      console.error('[dingtalk] Error closing connection:', closeError);
    }

    // Attempt to reconnect
    try {
      const newConnection = await connectWithRetry();
      clientInstance = newConnection.client;
      connection = newConnection.connection;
      
      console.log('[dingtalk] Successfully reconnected to DingTalk stream');
    } catch (reconnectError) {
      console.error('[dingtalk] Failed to reconnect to DingTalk stream:', reconnectError);
      // At this point, the error has already been handled by connectWithRetry
    }
  };

  // Listen for connection errors (like TLS socket disconnections)
  // The exact event names depend on the dingtalk-stream library implementation
  // We'll handle potential error events that might occur
  if (clientInstance && clientInstance.connection) {
    // Add error listeners to handle disconnections
    // Note: These may not exist in all versions of dingtalk-stream
    if (typeof clientInstance.connection.on === 'function') {
      clientInstance.connection.on('error', async (error) => {
        console.error('[dingtalk] Connection error occurred:', error);
        await handleDisconnection();
      });

      clientInstance.connection.on('close', async () => {
        console.warn('[dingtalk] Connection closed, attempting to reconnect...');
        await handleDisconnection();
      });

      clientInstance.connection.on('disconnect', async () => {
        console.warn('[dingtalk] Connection disconnected, attempting to reconnect...');
        await handleDisconnection();
      });
    }
  }

  // Additionally, we need to handle the specific TLS socket error mentioned in the issue
  // We'll add a general error handler to the client itself
  if (clientInstance) {
    // This is a general error handler that should catch various connection issues
    if (typeof clientInstance.on === 'function') {
      clientInstance.on('error', async (error) => {
        console.error('[dingtalk] General client error occurred:', error);
        await handleDisconnection();
      });
    }
  }

  console.log('[dingtalk] DingTalk provider started successfully');
  
  // Handle abort signal for graceful shutdown
  const cleanup = () => {
    console.debug('[dingtalk] Stopping DingTalk provider');
    if (connection && typeof connection.close === 'function') {
      connection.close();
    }
  };

  // Listen for abort signal to properly clean up
  ctx.abortSignal.addEventListener('abort', cleanup);

  // Wait for abort signal to keep Promise pending (prevent health-monitor restart loop)
  await new Promise<void>((resolve) => {
    ctx.abortSignal.addEventListener('abort', () => {
      resolve();
    }, { once: true });
  });

  console.log('[dingtalk] DingTalk provider exiting (abort signal received)');

  // Return cleanup function
  return {
    stop: async () => {
      console.debug('[dingtalk] Stopping DingTalk provider...');
      cleanup();
      ctx.statusSink({
        running: false,
        lastStopAt: new Date().toISOString(),
        lastError: null
      });
      console.debug('[dingtalk] DingTalk provider stopped');
    }
  };
}

// HTTP Handler for Webhook Requests
export async function handleDingTalkWebhookRequest(
  req: import('node:http').IncomingMessage, 
  res: import('node:http').ServerResponse
): Promise<boolean> {
  console.log(`[dingtalk] HTTP request received: ${req.method} ${req.url}`);
  console.log(`[dingtalk] Headers:`, req.headers);
  
  return new Promise((resolve, _reject) => {
    try {
      let body = '';
      
      req.on('data', chunk => {
        body += chunk.toString();
      });
      
      req.on('end', async () => {
        try {
          console.log(`[dingtalk] Request body length: ${body.length}`);
          if (body) {
            console.log(`[dingtalk] Raw request body: ${body.substring(0, 500)}${body.length > 500 ? '...' : ''}`);
            const parsedBody = JSON.parse(body);
            console.log(`[dingtalk] Parsed request body:`, JSON.stringify(parsedBody, null, 2));
            
            // Check if this is a callback challenge (DingTalk's way of verifying webhooks)
            if (parsedBody.challenge) {
              console.log(`[dingtalk] Processing webhook verification challenge: ${parsedBody.challenge}`);
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ challenge: parsedBody.challenge }));
              console.log(`[dingtalk] Sent webhook verification response`);
              resolve(true);
              return;
            }
            
            // Check if this is a robot message event
            if (parsedBody.header && parsedBody.header.topic === TOPIC_ROBOT) {
              console.log(`[dingtalk] Processing robot message event`);
              const eventData = parsedBody.data;
              if (eventData) {
                const payload = JSON.parse(eventData) as RobotMessage;
                // Prepare log content based on message type
                let logText = '';
                switch (payload.msgtype) {
                  case 'text':
                    logText = payload.text?.content || '';
                    break;
                  case 'image':
                  case 'picture':
                    logText = (payload as ImageRobotMessage).text?.content || 'Image';
                    break;
                  case 'voice':
                  case 'audio':
                    logText = (payload as VoiceRobotMessage).text?.content || (payload as { content?: { recognition?: string } }).content?.recognition || 'Voice message';
                    break;
                  case 'file':
                    logText = (payload as FileRobotMessage).text?.content || `File: ${(payload as FileRobotMessage).content?.fileName || ''}`;
                    break;
                  case 'link':
                    logText = `${(payload as LinkRobotMessage).link?.title} - ${(payload as LinkRobotMessage).link?.text}`;
                    break;
                  case 'markdown':
                    logText = `${(payload as MarkdownRobotMessage).markdown?.title} - ${(payload as MarkdownRobotMessage).markdown?.text}`;
                    break;
                  case 'richText': {
                    const rt = (payload as RichTextRobotMessage).content?.richText;
                    const first = Array.isArray(rt) ? rt.find((e: any) => e?.text) : null;
                    logText = first && 'text' in first ? first.text : 'Rich text';
                    break;
                  }
                  case 'video':
                    logText = 'Video message';
                    break;
                  default:
                    logText = JSON.stringify(payload);
                }
                
                console.log(`[dingtalk] Processing robot message payload:`, JSON.stringify({
                  conversationId: payload.conversationId,
                  senderId: payload.senderId,
                  senderNick: payload.senderNick,
                  msgtype: payload.msgtype,
                  text: logText.substring(0, 100) + '...'
                }, null, 2));
                
         // Process the inbound message
         // For webhook mode, we'll handle media differently since we may not have credentials here
         // For now, we'll skip media download in webhook mode to avoid credential issues
         // In production, you would need to implement a mechanism to securely retrieve credentials
         await processInboundMessage(payload, {} as OpenClawConfig, null, undefined, undefined);
                console.log(`[dingtalk] Completed processing robot message`);
              } else {
                console.log(`[dingtalk] No event data found in robot message`);
              }
            } else {
              console.log(`[dingtalk] Topic mismatch. Expected: ${TOPIC_ROBOT}, Got: ${parsedBody.header?.topic || 'none'}`);
            }
          }
          
          // Send success response
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
          console.log(`[dingtalk] Sent success response for webhook`);
          resolve(true);
        } catch (parseError) {
          console.error('[dingtalk] Error parsing DingTalk webhook:', parseError);
          console.error('[dingtalk] Error stack:', parseError instanceof Error ? parseError.stack : 'No stack available');
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON', details: parseError instanceof Error ? parseError.message : String(parseError) }));
          console.error(`[dingtalk] Sent error response for invalid JSON`);
          resolve(false);
        }
      });
      
      req.on('error', (err) => {
        console.error('[dingtalk] Error receiving DingTalk webhook:', err);
        console.error('[dingtalk] Error details:', err instanceof Error ? err.message : String(err));
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Request error', details: err instanceof Error ? err.message : String(err) }));
        }
        resolve(false);
      });
    } catch (error) {
      console.error('[dingtalk] Error setting up DingTalk webhook handler:', error);
      console.error('[dingtalk] Error details:', error instanceof Error ? error.message : String(error));
      console.error('[dingtalk] Error stack:', error instanceof Error ? error.stack : 'No stack available');
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Handler setup error', details: error instanceof Error ? error.message : String(error) }));
      }
      resolve(false);
    }
  });
}