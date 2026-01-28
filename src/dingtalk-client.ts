import OpenApi from '@alicloud/openapi-client';
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
    return await getDingTalkAccessToken(this.appKey, this.appSecret);
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
   * Download media file by mediaId
   * Reference: https://open.dingtalk.com/document/isvapp/api-overview
   */
  async downloadMedia(mediaId: string): Promise<MediaDownloadResult> {
    try {
      // For media download, we still need to use the REST API directly
      // since the SDK might not handle binary downloads properly
      const axios = (await import('axios')).default;
      const token = await this.getAccessToken();

      const response = await axios.get('https://oapi.dingtalk.com/media/get', {
        params: {
          access_token: token,
          media_id: mediaId,
        },
        responseType: 'arraybuffer', // Get as binary data
      });

      if (response.status === 200) {
        // In a real implementation, we'd save this to the media store
        // For now, we return the data buffer
        return {
          ok: true,
          data: Buffer.from(response.data),
          contentType: response.headers['content-type'],
        };
      } else {
        return {
          ok: false,
          error: `HTTP ${response.status}: ${response.statusText}`,
        };
      }
    } catch (error: any) {
      return {
        ok: false,
        error: error.message || 'Unknown error downloading media',
      };
    }
  }

  /**
   * Upload media file
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
   * Send message to user
   */
  async sendToUser(userId: string, message: any): Promise<any> {
    try {
      const token = await this.getAccessToken();
      
      // Use axios for this API call since it involves complex data structures
      const axios = (await import('axios')).default;
      
      const response = await axios.post('https://oapi.dingtalk.com/topapi/message/corpconversation/asyncsend_v2', {
        agent_id: 'clawdbot', // This should come from config
        userid_list: userId,
        msg: message,
      }, {
        params: {
          access_token: token,
        },
      });

      return response.data;
    } catch (error: any) {
      throw new Error(`Failed to send message to user: ${error.message}`);
    }
  }

  /**
   * Send message to chat/conversation
   */
  async sendToChat(chatId: string, message: any): Promise<any> {
    try {
      const token = await this.getAccessToken();
      
      // Use axios for this API call since it involves complex data structures
      const axios = (await import('axios')).default;
      
      const response = await axios.post('https://oapi.dingtalk.com/chat/send', {
        chatid: chatId,
        msg: message,
      }, {
        params: {
          access_token: token,
        },
      });

      return response.data;
    } catch (error: any) {
      throw new Error(`Failed to send message to chat: ${error.message}`);
    }
  }

  /**
   * Get user information
   */
  async getUserInfo(userId: string): Promise<any> {
    try {
      const token = await this.getAccessToken();
      
      // Use axios for this API call since it involves complex data structures
      const axios = (await import('axios')).default;
      
      const response = await axios.get('https://oapi.dingtalk.com/topapi/v2/user/get', {
        params: {
          access_token: token,
          userid: userId,
        },
      });

      return response.data;
    } catch (error: any) {
      throw new Error(`Failed to get user info: ${error.message}`);
    }
  }

  /**
   * Get department list
   */
  async getDepartmentList(deptId?: string): Promise<any> {
    try {
      const token = await this.getAccessToken();
      
      // Use axios for this API call since it involves complex data structures
      const axios = (await import('axios')).default;
      
      const response = await axios.get('https://oapi.dingtalk.com/department/list', {
        params: {
          access_token: token,
          id: deptId || '1', // Root department by default
        },
      });

      return response.data;
    } catch (error: any) {
      throw new Error(`Failed to get department list: ${error.message}`);
    }
  }
}