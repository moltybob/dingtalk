import OpenApi from '@alicloud/openapi-client';
import Util from '@alicloud/tea-util';
import * as $tea from '@alicloud/tea-typescript';
import dingtalkim_1_0 from '@alicloud/dingtalk/im_1_0';
import { getDingTalkAccessToken } from './auth.js';

/**
 * Interface for media upload result
 */
export interface MediaUploadResult {
  ok: boolean;
  mediaId?: string;
  error?: string;
  type?: string;
  createdAt?: number;
  downloadTimes?: number;
}

/**
 * Interface for media download result
 */
export interface MediaDownloadResult {
  ok: boolean;
  data?: Buffer;
  contentType?: string;
  error?: string;
}

/**
 * Class to handle media operations in DingTalk
 */
export class DingTalkMediaClient {
  private clientId: string;
  private clientSecret: string;

  constructor(clientId: string, clientSecret: string) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
  }

  /**
   * Upload media file to DingTalk
   * Reference: https://open.dingtalk.com/document/development/upload-media-files
   */
  async uploadMedia(filePath: string, type: 'image' | 'voice' | 'file' | 'video'): Promise<MediaUploadResult> {
    console.log(`[dingtalk:media] Starting upload of file: ${filePath}, type: ${type}`);

    try {
      // Get access token
      const token = await getDingTalkAccessToken(this.clientId, this.clientSecret);
      console.log(`[dingtalk:media] Retrieved access token successfully`);

      // For multipart upload, we still need to use direct HTTP request
      // since the Tea SDK doesn't handle multipart uploads well
      const axios = (await import('axios')).default;
      const FormData = (await import('form-data')).default;
      const fs = (await import('fs')).default;

      console.log(`[dingtalk:media] Creating form data for file: ${filePath}`);
      const formData = new FormData();
      formData.append('media', fs.createReadStream(filePath));
      formData.append('type', type);

      console.log(`[dingtalk:media] Sending upload request to DingTalk API`);
      const response = await axios.post('https://oapi.dingtalk.com/media/upload', formData, {
        params: {
          access_token: token,
        },
        headers: {
          ...formData.getHeaders(),
        },
      });

      const result = response.data;
      console.log(`[dingtalk:media] Upload response received: errcode=${result.errcode}`);

      if (result.errcode === 0 && result.media_id) {
        console.log(`[dingtalk:media] Upload successful, media_id: ${result.media_id}`);
        return {
          ok: true,
          mediaId: result.media_id,
          type: result.type,
          createdAt: result.created_at,
          downloadTimes: result.download_times
        };
      } else {
        console.warn(`[dingtalk:media] Upload failed: ${result.errmsg || `errcode: ${result.errcode}`}`);
        return {
          ok: false,
          error: result.errmsg || `Upload failed with errcode: ${result.errcode}`
        };
      }
    } catch (error: any) {
      console.error(`[dingtalk:media] Upload error:`, error.message || 'Unknown error');
      return {
        ok: false,
        error: error.message || 'Unknown error during media upload'
      };
    }
  }

  /**
   * Download media file from DingTalk by mediaId or downloadCode
   * Reference: https://open.dingtalk.com/document/development/download-the-file-content-of-the-robot-receiving-message
   */
  async downloadMedia(identifier: string): Promise<MediaDownloadResult> {
    console.log(`[dingtalk:media] Starting download using identifier: ${identifier.substring(0, 10)}...`);

    try {
      // Get access token
      const token = await getDingTalkAccessToken(this.clientId, this.clientSecret);
      console.log(`[dingtalk:media] Retrieved access token for download`);

      // For binary downloads, we still need to use direct HTTP request
      // since the Tea SDK might not handle binary data properly
      const axios = (await import('axios')).default;

      // According to DingTalk documentation, we use the getMediaFileByDownloadCode API
      // to download media content using the download code received in robot messages
      console.log(`[dingtalk:media] Sending download request using identifier: ${identifier.substring(0, 10)}...`);
      const response = await axios.post('https://oapi.dingtalk.com/v1.0/im/files/download', {
        downloadCode: identifier
      }, {
        params: {
          access_token: token,
        },
        responseType: 'arraybuffer', // Get as binary data
      });

      if (response.status === 200) {
        console.log(`[dingtalk:media] Download successful, content-type: ${response.headers['content-type']}, size: ${response.data.length} bytes`);
        return {
          ok: true,
          data: Buffer.from(response.data),
          contentType: response.headers['content-type'],
        };
      } else {
        console.warn(`[dingtalk:media] Download failed with HTTP ${response.status}: ${response.statusText}`);
        return {
          ok: false,
          error: `HTTP ${response.status}: ${response.statusText}`,
        };
      }
    } catch (error: any) {
      console.error(`[dingtalk:media] Download error using identifier ${identifier.substring(0, 10)}...:`, error.message || 'Unknown error');
      // If the new API fails, try the legacy media/get API as fallback
      try {
        console.log(`[dingtalk:media] Trying legacy media/get API as fallback`);
        const axios = (await import('axios')).default;
        const token = await getDingTalkAccessToken(this.clientId, this.clientSecret);

        const response = await axios.get('https://oapi.dingtalk.com/media/get', {
          params: {
            access_token: token,
            media_id: identifier,
          },
          responseType: 'arraybuffer', // Get as binary data
        });

        if (response.status === 200) {
          console.log(`[dingtalk:media] Legacy download successful, content-type: ${response.headers['content-type']}, size: ${response.data.length} bytes`);
          return {
            ok: true,
            data: Buffer.from(response.data),
            contentType: response.headers['content-type'],
          };
        } else {
          console.warn(`[dingtalk:media] Legacy download failed with HTTP ${response.status}: ${response.statusText}`);
          return {
            ok: false,
            error: `HTTP ${response.status}: ${response.statusText}`,
          };
        }
      } catch (fallbackError: any) {
        console.error(`[dingtalk:media] Both download methods failed:`, fallbackError.message || 'Unknown error');
        return {
          ok: false,
          error: error.message || fallbackError.message || 'Unknown error downloading media',
        };
      }
    }
  }

  /**
   * Send image message using DingTalk IM SDK
   */
  async sendImageMessage(
    toConversationId: string,
    mediaId: string,
    options?: {
      atMobiles?: string[];
      atUserIds?: string[];
      isAtAll?: boolean;
    }
  ): Promise<{ ok: boolean; error?: string }> {
    try {
      // Get access token
      const token = await getDingTalkAccessToken(this.clientId, this.clientSecret);

      // Create config for the IM client
      const config = new OpenApi.default.Config({
        accessToken: token,
      });
      config.protocol = "https";
      config.endpoint = "api.dingtalk.com";
      config.regionId = "cn-hangzhou";

      // Create the IM client
      const client = new dingtalkim_1_0.default(config);

      // Create the message body for image
      const messageBody = {
        msgParam: JSON.stringify({
          mediaId: mediaId
        }),
        msgtype: "image"
      };

      // Create the send message request
      const sendMessageRequest = new dingtalkim_1_0.SendOTOMessageRequest({
        body: messageBody,
        // Note: This is for one-to-one messages; for group messages, we'd use a different endpoint
        // For now, we'll implement the group version too
      });

      // For group chat, use different API
      const axios = (await import('axios')).default;
      const response = await axios.post('https://oapi.dingtalk.com/topapi/message/corpconversation/asyncsend_v2', {
        agent_id: 'openclaw', // This should come from config
        userid_list: '', // For group chat, this would be empty or different
        dept_id_list: '',
        to_all_user: false,
        msg: {
          msgtype: "image",
          image: {
            media_id: mediaId
          }
        }
      }, {
        params: {
          access_token: token
        },
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (response.data.errcode !== 0) {
        return {
          ok: false,
          error: `Failed to send image message: ${response.data.errmsg} (errcode: ${response.data.errcode})`
        };
      }

      return {
        ok: true
      };
    } catch (error: any) {
      return {
        ok: false,
        error: error.message || 'Unknown error sending image message'
      };
    }
  }

  /**
   * Send file message using DingTalk API
   */
  async sendFileMessage(
    toConversationId: string,
    mediaId: string,
    fileName: string,
    options?: {
      atMobiles?: string[];
      atUserIds?: string[];
      isAtAll?: boolean;
    }
  ): Promise<{ ok: boolean; error?: string }> {
    try {
      const token = await getDingTalkAccessToken(this.clientId, this.clientSecret);

      // Create file message payload
      const messagePayload = {
        msgtype: "file",
        file: {
          media_id: mediaId
        },
        at: {
          atMobiles: options?.atMobiles || [],
          atUserIds: options?.atUserIds || [],
          isAtAll: options?.isAtAll || false
        }
      };

      // Send the message using axios for now
      const axios = (await import('axios')).default;
      const response = await axios.post('https://oapi.dingtalk.com/chat/send', {
        chatid: toConversationId,
        msg: messagePayload
      }, {
        params: {
          access_token: token
        },
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (response.data.errcode !== 0) {
        return {
          ok: false,
          error: `Failed to send file message: ${response.data.errmsg} (errcode: ${response.data.errcode})`
        };
      }

      return {
        ok: true
      };
    } catch (error: any) {
      return {
        ok: false,
        error: error.message || 'Unknown error sending file message'
      };
    }
  }

  /**
   * Send voice message using DingTalk API
   */
  async sendVoiceMessage(
    toConversationId: string,
    mediaId: string,
    duration: number,
    options?: {
      atMobiles?: string[];
      atUserIds?: string[];
      isAtAll?: boolean;
    }
  ): Promise<{ ok: boolean; error?: string }> {
    try {
      const token = await getDingTalkAccessToken(this.clientId, this.clientSecret);

      // Create voice message payload
      const messagePayload = {
        msgtype: "voice",
        voice: {
          media_id: mediaId,
          duration: duration
        },
        at: {
          atMobiles: options?.atMobiles || [],
          atUserIds: options?.atUserIds || [],
          isAtAll: options?.isAtAll || false
        }
      };

      // Send the message using axios for now
      const axios = (await import('axios')).default;
      const response = await axios.post('https://oapi.dingtalk.com/chat/send', {
        chatid: toConversationId,
        msg: messagePayload
      }, {
        params: {
          access_token: token
        },
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (response.data.errcode !== 0) {
        return {
          ok: false,
          error: `Failed to send voice message: ${response.data.errmsg} (errcode: ${response.data.errcode})`
        };
      }

      return {
        ok: true
      };
    } catch (error: any) {
      return {
        ok: false,
        error: error.message || 'Unknown error sending voice message'
      };
    }
  }

  /**
   * Send video message using DingTalk API
   */
  async sendVideoMessage(
    toConversationId: string,
    mediaId: string,
    options?: {
      title?: string;
      description?: string;
      atMobiles?: string[];
      atUserIds?: string[];
      isAtAll?: boolean;
    }
  ): Promise<{ ok: boolean; error?: string }> {
    try {
      const token = await getDingTalkAccessToken(this.clientId, this.clientSecret);

      // Create video message payload
      const messagePayload = {
        msgtype: "video",
        video: {
          media_id: mediaId,
          title: options?.title || '',
          description: options?.description || ''
        },
        at: {
          atMobiles: options?.atMobiles || [],
          atUserIds: options?.atUserIds || [],
          isAtAll: options?.isAtAll || false
        }
      };

      // Send the message using axios for now
      const axios = (await import('axios')).default;
      const response = await axios.post('https://oapi.dingtalk.com/chat/send', {
        chatid: toConversationId,
        msg: messagePayload
      }, {
        params: {
          access_token: token
        },
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (response.data.errcode !== 0) {
        return {
          ok: false,
          error: `Failed to send video message: ${response.data.errmsg} (errcode: ${response.data.errcode})`
        };
      }

      return {
        ok: true
      };
    } catch (error: any) {
      return {
        ok: false,
        error: error.message || 'Unknown error sending video message'
      };
    }
  }
}