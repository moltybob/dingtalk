import OpenApi from '@alicloud/openapi-client';
import Util from '@alicloud/tea-util';
import * as $tea from '@alicloud/tea-typescript';
import { getDingTalkAccessToken } from './auth.js';

export interface MediaDownloadResult {
  ok: boolean;
  path?: string;
  contentType?: string;
  error?: string;
  data?: Buffer;
}

export class DingTalkHttpClient {
  private appKey: string;
  private appSecret: string;

  constructor(appKey: string, appSecret: string) {
    this.appKey = appKey;
    this.appSecret = appSecret;
  }

  /**
   * Get access token for API calls
   */
  private async getAccessToken(): Promise<string> {
    console.log(`[dingtalk:client] Requesting access token for appKey: ${this.appKey.substring(0, 8)}...`);
    const token = await getDingTalkAccessToken(this.appKey, this.appSecret);
    console.log(`[dingtalk:client] Access token retrieved successfully`);
    return token;
  }

  /**
   * Generic API call method
   */
  async callApi<T = any>(endpoint: string, params?: Record<string, any>): Promise<T> {
    const token = await this.getAccessToken();
    const config = new OpenApi.default.Config({
      accessKeyId: this.appKey,
      accessKeySecret: this.appSecret,
    });
    config.protocol = "https";
    config.endpoint = "oapi.dingtalk.com";
    config.regionId = "cn-hangzhou";

    // Create a common request object
    const request = new OpenApi.default.OpenApiRequest({
      protocol: "https",
      method: "GET",
      pathname: endpoint,
      headers: {
        "Content-Type": "application/json",
      },
      query: {
        access_token: token,
        ...params,
      },
    });

    // Create the client
    const client = new OpenApi.default.Client(config);

    try {
      const response = await client.callApi(request);
      return response.body as T;
    } catch (error: any) {
      throw new Error(`API call failed: ${error.message}`);
    }
  }

  /**
   * Download media file by mediaId or downloadCode
   * Reference: https://open.dingtalk.com/document/development/download-the-file-content-of-the-robot-receiving-message
   */
  async downloadMedia(identifier: string): Promise<MediaDownloadResult> {
    console.log(`[dingtalk:client] Starting download using identifier: ${identifier.substring(0, 10)}...`);
    try {
      // For media download, we still need to use direct HTTP request
      // since the Tea SDK might not handle binary data properly
      const axios = (await import('axios')).default;
      const token = await this.getAccessToken();

      // According to DingTalk documentation, we use the getMediaFileByDownloadCode API
      // to download media content using the download code received in robot messages
      console.log(`[dingtalk:client] Sending download request using identifier: ${identifier.substring(0, 10)}...`);
      const response = await axios.post('https://oapi.dingtalk.com/v1.0/im/files/download', {
        downloadCode: identifier
      }, {
        params: {
          access_token: token,
        },
        responseType: 'arraybuffer', // Get as binary data
      });

      if (response.status === 200) {
        console.log(`[dingtalk:client] Download successful, content-type: ${response.headers['content-type']}, size: ${response.data.length} bytes`);
        // In a real implementation, we'd save this to the media store
        // For now, we return the data buffer
        return {
          ok: true,
          data: Buffer.from(response.data),
          contentType: response.headers['content-type'],
        };
      } else {
        console.warn(`[dingtalk:client] Download failed with HTTP ${response.status}: ${response.statusText}`);
        return {
          ok: false,
          error: `HTTP ${response.status}: ${response.statusText}`,
        };
      }
    } catch (error: any) {
      console.error(`[dingtalk:client] Download error using identifier ${identifier.substring(0, 10)}...:`, error.message || 'Unknown error');
      // If the new API fails, try the legacy media/get API as fallback
      try {
        console.log(`[dingtalk:client] Trying legacy media/get API as fallback`);
        const axios = (await import('axios')).default;
        const token = await this.getAccessToken();

        const response = await axios.get('https://oapi.dingtalk.com/media/get', {
          params: {
            access_token: token,
            media_id: identifier,
          },
          responseType: 'arraybuffer', // Get as binary data
        });

        if (response.status === 200) {
          console.log(`[dingtalk:client] Legacy download successful, content-type: ${response.headers['content-type']}, size: ${response.data.length} bytes`);
          return {
            ok: true,
            data: Buffer.from(response.data),
            contentType: response.headers['content-type'],
          };
        } else {
          console.warn(`[dingtalk:client] Legacy download failed with HTTP ${response.status}: ${response.statusText}`);
          return {
            ok: false,
            error: `HTTP ${response.status}: ${response.statusText}`,
          };
        }
      } catch (fallbackError: any) {
        console.error(`[dingtalk:client] Both download methods failed:`, fallbackError.message || 'Unknown error');
        return {
          ok: false,
          error: error.message || fallbackError.message || 'Unknown error downloading media',
        };
      }
    }
  }

  /**
   * Upload media file
   * NOTE: For multipart uploads, we still need to use axios temporarily
   * as the Tea SDK doesn't handle multipart forms well
   */
  async uploadMedia(mediaPath: string, mediaType: 'image' | 'voice' | 'file'): Promise<any> {
    try {
      const token = await this.getAccessToken();

      // For media upload, we still need to use the REST API directly
      // since multipart form data handling is complex with the SDK
      const axios = (await import('axios')).default;
      const FormData = (await import('form-data')).default;
      const fs = (await import('fs')).default;

      const formData = new FormData();
      formData.append('media', fs.createReadStream(mediaPath));
      formData.append('type', mediaType);

      const response = await axios.post('https://oapi.dingtalk.com/media/upload', formData, {
        params: {
          access_token: token,
        },
        headers: {
          ...formData.getHeaders(),
        },
      });

      return response.data;
    } catch (error: any) {
      throw new Error(`Failed to upload media: ${error.message}`);
    }
  }

  /**
   * Send message to user using Tea SDK
   */
  async sendToUser(userId: string, message: any): Promise<any> {
    try {
      const token = await this.getAccessToken();

      // Create config for API call
      const config = new OpenApi.default.Config({
        accessKeyId: this.appKey,
        accessKeySecret: this.appSecret,
      });
      config.protocol = "https";
      config.endpoint = "oapi.dingtalk.com";
      config.regionId = "cn-hangzhou";

      // Create a common request object for sending message to user
      const request = new OpenApi.default.OpenApiRequest({
        protocol: "https",
        method: "POST",
        pathname: "/topapi/message/corpconversation/asyncsend_v2",
        headers: {
          "Content-Type": "application/json",
        },
        query: {
          access_token: token,
        },
        body: Util.toMap({
          agent_id: 'openclaw', // This should come from config
          userid_list: userId,
          msg: message,
        })
      });

      // Create the client
      const client = new OpenApi.default.Client(config);

      try {
        const response = await client.callApi(request);
        return response.body;
      } catch (error: any) {
        if (!$tea.isUnretryableError(error)) {
          throw error;
        }
        throw new Error(`Failed to send message to user: ${error.message || 'Unknown error'}`);
      }
    } catch (error: any) {
      throw new Error(`Failed to send message to user: ${error.message}`);
    }
  }

  /**
   * Send message to chat/conversation using Tea SDK
   */
  async sendToChat(chatId: string, message: any): Promise<any> {
    try {
      const token = await this.getAccessToken();

      // Create config for API call
      const config = new OpenApi.default.Config({
        accessKeyId: this.appKey,
        accessKeySecret: this.appSecret,
      });
      config.protocol = "https";
      config.endpoint = "oapi.dingtalk.com";
      config.regionId = "cn-hangzhou";

      // Create a common request object for sending message to chat
      const request = new OpenApi.default.OpenApiRequest({
        protocol: "https",
        method: "POST",
        pathname: "/chat/send",
        headers: {
          "Content-Type": "application/json",
        },
        query: {
          access_token: token,
        },
        body: Util.toMap({
          chatid: chatId,
          msg: message,
        })
      });

      // Create the client
      const client = new OpenApi.default.Client(config);

      try {
        const response = await client.callApi(request);
        return response.body;
      } catch (error: any) {
        if (!$tea.isUnretryableError(error)) {
          throw error;
        }
        throw new Error(`Failed to send message to chat: ${error.message || 'Unknown error'}`);
      }
    } catch (error: any) {
      throw new Error(`Failed to send message to chat: ${error.message}`);
    }
  }

  /**
   * Get user information using Tea SDK
   */
  async getUserInfo(userId: string): Promise<any> {
    try {
      const token = await this.getAccessToken();

      // Create config for API call
      const config = new OpenApi.default.Config({
        accessKeyId: this.appKey,
        accessKeySecret: this.appSecret,
      });
      config.protocol = "https";
      config.endpoint = "oapi.dingtalk.com";
      config.regionId = "cn-hangzhou";

      // Create a common request object for getting user info
      const request = new OpenApi.default.OpenApiRequest({
        protocol: "https",
        method: "GET",
        pathname: "/topapi/v2/user/get",
        headers: {
          "Content-Type": "application/json",
        },
        query: {
          access_token: token,
          userid: userId,
        },
      });

      // Create the client
      const client = new OpenApi.default.Client(config);

      try {
        const response = await client.callApi(request);
        return response.body;
      } catch (error: any) {
        if (!$tea.isUnretryableError(error)) {
          throw error;
        }
        throw new Error(`Failed to get user info: ${error.message || 'Unknown error'}`);
      }
    } catch (error: any) {
      throw new Error(`Failed to get user info: ${error.message}`);
    }
  }

  /**
   * Get department list using Tea SDK
   */
  async getDepartmentList(deptId?: string): Promise<any> {
    try {
      const token = await this.getAccessToken();

      // Create config for API call
      const config = new OpenApi.default.Config({
        accessKeyId: this.appKey,
        accessKeySecret: this.appSecret,
      });
      config.protocol = "https";
      config.endpoint = "oapi.dingtalk.com";
      config.regionId = "cn-hangzhou";

      // Create a common request object for getting department list
      const request = new OpenApi.default.OpenApiRequest({
        protocol: "https",
        method: "GET",
        pathname: "/department/list",
        headers: {
          "Content-Type": "application/json",
        },
        query: {
          access_token: token,
          id: deptId || '1', // Root department by default
        },
      });

      // Create the client
      const client = new OpenApi.default.Client(config);

      try {
        const response = await client.callApi(request);
        return response.body;
      } catch (error: any) {
        if (!$tea.isUnretryableError(error)) {
          throw error;
        }
        throw new Error(`Failed to get department list: ${error.message || 'Unknown error'}`);
      }
    } catch (error: any) {
      throw new Error(`Failed to get department list: ${error.message}`);
    }
  }
}