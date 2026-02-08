import OpenApi, * as $OpenApi from '@alicloud/openapi-client';
import Util, { RuntimeOptions } from '@alicloud/tea-util';
import * as $tea from '@alicloud/tea-typescript';
import * as robot_1_0 from '@alicloud/dingtalk/robot_1_0';
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
    const config = new $OpenApi.Config({
      accessKeyId: this.appKey,
      accessKeySecret: this.appSecret,
    });
    config.protocol = "https";
    config.endpoint = "oapi.dingtalk.com";
    config.regionId = "cn-hangzhou";

    // Create a common request object
    const request = new $OpenApi.OpenApiRequest({
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
    const client = new OpenApi(config);

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
  async downloadMedia(identifier: string, robotCode?: string): Promise<MediaDownloadResult> {
    console.log(`[dingtalk:client] Starting download using identifier: ${identifier.substring(0, 10)}..., robotCode: ${(robotCode || this.appKey).substring(0, 10)}...`);
    try {
      // Use the official DingTalk robot SDK: POST /v1.0/robot/messageFiles/download returns downloadUrl, then we GET that URL for binary
      const RobotClient = (robot_1_0 as { default?: new (c: any) => any; RobotMessageFileDownloadHeaders?: new (o: any) => any; RobotMessageFileDownloadRequest?: new (o: any) => any }).default;
      const RobotMessageFileDownloadHeaders = robot_1_0.RobotMessageFileDownloadHeaders;
      const RobotMessageFileDownloadRequest = robot_1_0.RobotMessageFileDownloadRequest;
      if (!RobotClient || !RobotMessageFileDownloadHeaders || !RobotMessageFileDownloadRequest) {
        console.error(`[dingtalk:client] SDK exports missing: RobotClient=${!!RobotClient}, Headers=${!!RobotMessageFileDownloadHeaders}, Request=${!!RobotMessageFileDownloadRequest}`);
        throw new Error('DingTalk robot SDK exports not available');
      }
      const config = new $OpenApi.Config({});
      config.protocol = 'https';
      config.regionId = 'central';
      const client = new RobotClient(config);

      const token = await this.getAccessToken();
      const headers = new RobotMessageFileDownloadHeaders({});
      headers.xAcsDingtalkAccessToken = token;

      const request = new RobotMessageFileDownloadRequest({
        robotCode: robotCode || this.appKey,
        downloadCode: identifier,
      });

      console.log(`[dingtalk:client] Calling robot messageFiles/download API...`);
      const runtimeOptions = new RuntimeOptions({});
      const response = await client.robotMessageFileDownloadWithOptions(request, headers, runtimeOptions);

      // API returns { body: { downloadUrl: "..." } }, not binary; we must GET the URL to get file content
      const body = response?.body as { downloadUrl?: string } | undefined;
      if (!body?.downloadUrl) {
        console.warn(`[dingtalk:client] API response missing downloadUrl:`, JSON.stringify(body || response).substring(0, 300));
        return {
          ok: false,
          error: 'API response missing downloadUrl',
        };
      }
      console.log(`[dingtalk:client] Got downloadUrl, fetching file content...`);
      const axios = (await import('axios')).default;
      const fileResponse = await axios.get(body.downloadUrl, {
        responseType: 'arraybuffer',
        maxRedirects: 5,
      });
      if (fileResponse.status !== 200) {
        return {
          ok: false,
          error: `Download URL returned HTTP ${fileResponse.status}`,
        };
      }
      const data = Buffer.from(fileResponse.data);
      const contentType = (fileResponse.headers['content-type'] as string) || 'application/octet-stream';
      console.log(`[dingtalk:client] Download successful via downloadUrl, size: ${data.length} bytes, contentType: ${contentType}`);
      return {
        ok: true,
        data,
        contentType,
      };
    } catch (error: any) {
      console.error(`[dingtalk:client] Download error using identifier ${identifier.substring(0, 10)}...:`, error.message || 'Unknown error');
      if (error.errCode) console.error(`[dingtalk:client] Error code: ${error.errCode}`);
      if (error.errMsg) console.error(`[dingtalk:client] Error message: ${error.errMsg}`);

      // Fallback: legacy media/get only works with media_id (uploaded media), not downloadCode; skip if identifier looks like downloadCode (long base64-like)
      const looksLikeDownloadCode = identifier.length > 50 && !/^[a-zA-Z0-9_-]{20,40}$/.test(identifier);
      if (looksLikeDownloadCode) {
        console.log(`[dingtalk:client] Skipping legacy media/get fallback (identifier looks like downloadCode, media/get expects media_id)`);
        return {
          ok: false,
          error: error.message || 'Robot file download failed (use downloadCode with robot API only)',
        };
      }
      try {
        console.log(`[dingtalk:client] Trying legacy media/get API as fallback (media_id)`);
        const axios = (await import('axios')).default;
        const token = await this.getAccessToken();

        const response = await axios.get('https://oapi.dingtalk.com/media/get', {
          params: { access_token: token, media_id: identifier },
          responseType: 'arraybuffer',
        });

        if (response.status !== 200) {
          return {
            ok: false,
            error: `HTTP ${response.status}: ${response.statusText}`,
          };
        }
        const contentType = (response.headers['content-type'] as string) || '';
        // Legacy API may return JSON error body with content-type application/json
        if (contentType.includes('application/json')) {
          const raw = Buffer.from(response.data).toString('utf8');
          let json: { errcode?: number; errmsg?: string };
          try {
            json = JSON.parse(raw);
          } catch {
            return { ok: false, error: 'Legacy API returned invalid JSON' };
          }
          if (json.errcode != null && json.errcode !== 0) {
            console.warn(`[dingtalk:client] Legacy media/get error response: errcode=${json.errcode}, errmsg=${json.errmsg}`);
            return {
              ok: false,
              error: json.errmsg || `errcode ${json.errcode}`,
            };
          }
        }
        const data = Buffer.from(response.data);
        console.log(`[dingtalk:client] Legacy download successful, content-type: ${contentType}, size: ${data.length} bytes`);
        return {
          ok: true,
          data,
          contentType,
        };
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
      const config = new $OpenApi.Config({
        accessKeyId: this.appKey,
        accessKeySecret: this.appSecret,
      });
      config.protocol = "https";
      config.endpoint = "oapi.dingtalk.com";
      config.regionId = "cn-hangzhou";

      // Create a common request object for sending message to user
      const request = new $OpenApi.OpenApiRequest({
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
      const client = new OpenApi(config);

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
      const config = new $OpenApi.Config({
        accessKeyId: this.appKey,
        accessKeySecret: this.appSecret,
      });
      config.protocol = "https";
      config.endpoint = "oapi.dingtalk.com";
      config.regionId = "cn-hangzhou";

      // Create a common request object for sending message to chat
      const request = new $OpenApi.OpenApiRequest({
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
      const client = new OpenApi(config);

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
      const config = new $OpenApi.Config({
        accessKeyId: this.appKey,
        accessKeySecret: this.appSecret,
      });
      config.protocol = "https";
      config.endpoint = "oapi.dingtalk.com";
      config.regionId = "cn-hangzhou";

      // Create a common request object for getting user info
      const request = new $OpenApi.OpenApiRequest({
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
      const client = new OpenApi(config);

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
      const config = new $OpenApi.Config({
        accessKeyId: this.appKey,
        accessKeySecret: this.appSecret,
      });
      config.protocol = "https";
      config.endpoint = "oapi.dingtalk.com";
      config.regionId = "cn-hangzhou";

      // Create a common request object for getting department list
      const request = new $OpenApi.OpenApiRequest({
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
      const client = new OpenApi(config);

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