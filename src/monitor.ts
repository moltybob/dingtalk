import { EventAck, TOPIC_ROBOT, DWClient } from 'dingtalk-stream';
import type { ClawdbotConfig, InboundMessage } from 'clawdbot/plugin-sdk';
import type { ResolvedDingTalkAccount } from './accounts.js';
import { getDingTalkRuntime } from './runtime.js';

interface MonitorContext {
  appKey: string; // This is actually the clientId
  appSecret: string; // This is actually the clientSecret
  account: ResolvedDingTalkAccount;
  config: ClawdbotConfig;
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

// Image message type
interface ImageRobotMessage extends BaseRobotMessage {
  msgtype: 'picture' | 'image';
  photo?: {
    photoURL: string;
  };
  content?: {
    pictureDownloadCode?: string;
    downloadCode?: string;
    fileId?: string;
    fileName?: string;
    spaceId?: string;
  };
  text?: {
    content: string; // Optional text content with the image
  };
}

// Voice message type
interface VoiceRobotMessage extends BaseRobotMessage {
  msgtype: 'voice';
  voice: {
    mediaId: string;
    duration: number;
  };
  text?: {
    content: string; // Optional text content with the voice message
  };
}

// File message type
interface FileRobotMessage extends BaseRobotMessage {
  msgtype: 'file';
  content: {
    spaceId: string;
    fileName: string;
    downloadCode: string;
    fileId: string;
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

type RobotMessage = TextRobotMessage | ImageRobotMessage | VoiceRobotMessage | FileRobotMessage | LinkRobotMessage | MarkdownRobotMessage;

// Directly handle the inbound message using the runtime channel system
// This follows the same pattern as other channel extensions (Matrix, etc.)
async function processInboundMessage(message: RobotMessage, config: ClawdbotConfig, runtime: any, appKey?: string, appSecret?: string): Promise<void> {
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
    
    // Helper function to download media from DingTalk using mediaId
    const downloadDingTalkMedia = async (mediaId: string, mediaType: 'image' | 'voice' | 'file'): Promise<{ path?: string; contentType?: string; error?: string } | null> => {
      try {
        const result = await httpClient.downloadMedia(mediaId);
        
        if (result.ok) {
          console.debug(`[dingtalk] ${mediaType.charAt(0).toUpperCase() + mediaType.slice(1)} download successful for mediaId: ${mediaId}`);
          return { path: result.path, contentType: result.contentType }; // Return path and content type
        } else {
          console.warn(`[dingtalk] Failed to download ${mediaType}:`, result.error);
          return { error: result.error || `Failed to download ${mediaType}` };
        }
      } catch (downloadError) {
        console.error(`[dingtalk] Error downloading ${mediaType}:`, downloadError);
        return { error: `Error downloading ${mediaType}: ${String(downloadError)}` };
      }
    };

    // Process message based on its type
    let textContent = '';
    let mediaPath: string | undefined;
    let mediaType: string | undefined;
    let rawContent: any;

    switch (message.msgtype) {
      case 'text':
        textContent = message.text.content;
        rawContent = message.text;
        console.debug(`[dingtalk] Message content: ${textContent.substring(0, 100)}${textContent.length > 100 ? '...' : ''}`);
        break;
        
      case 'image':
      case 'picture':
        textContent = message.text?.content || '';
        // For image messages, we'll handle the image URL or download code
        if (message.photo && message.photo.photoURL) {
          const imageUrl = message.photo.photoURL;
          console.debug(`[dingtalk] Image message with URL: ${imageUrl}`);
          console.debug(`[dingtalk] Optional text content: ${textContent.substring(0, 100)}${textContent.length > 100 ? '...' : ''}`);
          
          // Download the image and store it for processing
          try {
            const { loadWebMedia } = await import('clawdbot/plugin-sdk');
            const mediaResult = await loadWebMedia(imageUrl);
            if (mediaResult.ok) {
              mediaPath = mediaResult.path;
              mediaType = mediaResult.contentType;
              console.debug(`[dingtalk] Image downloaded and stored at: ${mediaPath}`);
            } else {
              console.warn(`[dingtalk] Failed to download image:`, mediaResult.error);
            }
          } catch (downloadError) {
            console.error(`[dingtalk] Error downloading image:`, downloadError);
          }
        } else if (message.content && (message.content.fileId || message.content.pictureDownloadCode || message.content.downloadCode)) {
          // If photo is not available but we have content with download codes (new format), use the DingTalk API
          const fileId = message.content.fileId || message.content.pictureDownloadCode;
          const downloadCode = message.content.downloadCode || message.content.pictureDownloadCode;
          
          console.debug(`[dingtalk] Image message with downloadCode: ${downloadCode ? 'available' : 'not available'}, fileId: ${fileId || 'not available'}`);
          if (fileId) {
            const mediaResult = await downloadDingTalkMedia(fileId, 'image');
            if (mediaResult && !mediaResult.error) {
              mediaPath = mediaResult.path;
              mediaType = mediaResult.contentType;
            }
          } else if (downloadCode) {
            // Handle download code directly
            console.debug(`[dingtalk] Using downloadCode to retrieve image`);
            // This would require a specific implementation to handle download codes
          }
        } else {
          console.warn(`[dingtalk] Image message with missing photo/content data:`, message.photo || message.content);
        }
        rawContent = message.photo || message.content;
        break;
        
      case 'voice':
        textContent = message.text?.content || '';
        if (message.voice) {
          console.debug(`[dingtalk] Voice message with mediaId: ${message.voice.mediaId}, duration: ${message.voice.duration}s`);
          
          // Download the voice file and store it for processing
          const mediaResult = await downloadDingTalkMedia(message.voice.mediaId, 'voice');
          if (mediaResult && !mediaResult.error) {
            mediaPath = mediaResult.path;
            mediaType = mediaResult.contentType;
          }
        } else {
          console.debug(`[dingtalk] Voice message with undefined voice data`);
        }
        console.debug(`[dingtalk] Optional text content: ${textContent.substring(0, 100)}${textContent.length > 100 ? '...' : ''}`);
        rawContent = message.voice;
        break;
        
      case 'file':
        textContent = message.text?.content || '';
        if (message.content) {
          console.debug(`[dingtalk] File message with fileId: ${message.content.fileId}, fileName: ${message.content.fileName}`);
          
          // Download the file and store it for processing
          // Use the fileId as the mediaId for the download function
          const mediaResult = await downloadDingTalkMedia(message.content.fileId, 'file');
          if (mediaResult && !mediaResult.error) {
            mediaPath = mediaResult.path;
            mediaType = mediaResult.contentType;
          }
        } else {
          console.debug(`[dingtalk] File message with undefined content data`);
        }
        console.debug(`[dingtalk] Optional text content: ${textContent.substring(0, 100)}${textContent.length > 100 ? '...' : ''}`);
        rawContent = message.content;
        break;
        
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
        
      default:
        // Handle unknown message types as text
        console.warn(`[dingtalk] Unknown message type: ${message.msgtype}, treating as text`);
        textContent = JSON.stringify(message);
        rawContent = message;
    }

    // Format as a message context that Clawdbot can process
    const ctxPayload = {
      Body: textContent,                                    // Main message body
      RawBody: textContent,                                 // Raw message content
      CommandBody: textContent,                             // Command body
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
      CommandAuthorized: true,                               // For now, assume authorized
      OriginatingChannel: "dingtalk" as const,
      OriginatingTo: `dingtalk:${conversationId}`,          // Route back to same conversation
      // Additional fields
      isAdmin: message.isAdmin,
      isInAtList: message.isInAtList,
      robotCode: message.robotCode,
      sessionWebhook: message.sessionWebhook,
      // Media fields for non-text messages
      MediaPath: mediaPath,
      MediaType: mediaType,
      MediaUrl: mediaPath, // Use the stored path as media URL
      // Raw message data
      RawMessageData: rawContent,
      RawMessageType: message.msgtype,
    };

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
              agentId: 'clawdbot',
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
    
    console.log(`[dingtalk] Received ${message.msgtype} message from ${senderNick}: ${textContent.substring(0, 50)}${textContent.length > 50 ? '...' : ''}`);
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

  try {
    const client = new DWClient({
      clientId: ctx.appKey,
      clientSecret: ctx.appSecret,
    });

    // Register the callback listener for robot messages
    client.registerCallbackListener(TOPIC_ROBOT, async (res) => {
      try {
        // console.debug(`[dingtalk] Received raw callback: ${JSON.stringify(res.data)}`);
        const payload = JSON.parse(res.data) as RobotMessage;
        const { senderId, senderNick, conversationType, conversationId, msgtype } = payload;

        // Log received message based on its type
        let logContent = '';
        switch (msgtype) {
          case 'text':
            logContent = payload.text?.content || '';
            break;
          case 'image':
            logContent = payload.text?.content || `Image: ${payload.photo?.photoURL}`;
            break;
          case 'voice':
            logContent = payload.text?.content || `Voice message`;
            break;
          case 'file':
            logContent = payload.text?.content || `File: ${payload.file?.fileName}`;
            break;
          case 'link':
            logContent = payload.link?.title || payload.link?.text || 'Link message';
            break;
          case 'markdown':
            logContent = payload.markdown?.title || payload.markdown?.text || 'Markdown message';
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
    const connection = await client.connect();
    console.log('[dingtalk] Successfully connected to DingTalk stream');

    // Handle connection lifecycle
    const cleanup = () => {
      console.debug('[dingtalk] Stopping DingTalk provider');
      connection.close();
    };

    // Listen for abort signal to properly clean up
    ctx.abortSignal.addEventListener('abort', cleanup);

    // Update status to running
    ctx.statusSink({
      running: true,
      lastStartAt: new Date().toISOString()
    });

    console.log('[dingtalk] DingTalk provider started successfully');
    
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
  } catch (error) {
    console.error('[dingtalk] Failed to initialize DingTalk provider:', error);
    console.error('[dingtalk] Error details:', error instanceof Error ? error.message : String(error));
    console.error('[dingtalk] Error code:', (error as any).code || 'no code');
    console.error('[dingtalk] Error stack:', error instanceof Error ? error.stack : 'No stack available');
    
    // Additional debugging for Axios errors
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
    
    throw error; // Re-throw to let the caller handle the error
  }
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
                    logText = payload.text?.content || `Image: ${payload.photo?.photoURL}`;
                    break;
                  case 'voice':
                    logText = payload.text?.content || `Voice: ${payload.voice?.mediaId}`;
                    break;
                  case 'file':
                    logText = payload.text?.content || `File: ${payload.file?.fileName}`;
                    break;
                  case 'link':
                    logText = `${payload.link?.title} - ${payload.link?.text}`;
                    break;
                  case 'markdown':
                    logText = `${payload.markdown?.title} - ${payload.markdown?.text}`;
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
                
                // Process the inbound message - in a real implementation, 
                // you'd need access to the full config and context
                // For webhook mode, we need to handle the message differently
                // For now, we'll pass an empty config and null runtime
                await processInboundMessage(payload, {} as any, null, undefined, undefined);
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