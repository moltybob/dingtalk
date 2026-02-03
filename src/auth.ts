import dingtalkoauth2_1_0 from '@alicloud/dingtalk/oauth2_1_0';
import OpenApi from '@alicloud/openapi-client';
import Util from '@alicloud/tea-util';
import * as $tea from '@alicloud/tea-typescript';

/**
 * Get access token from DingTalk API for internal applications
 * Reference: https://open.dingtalk.com/document/development/obtain-the-access-token-of-an-internal-app
 */
export async function getDingTalkAccessToken(clientId: string, clientSecret: string): Promise<string> {
  console.log(`[dingtalk:auth] Requesting access token for clientId: ${clientId.substring(0, 8)}...`);
  try {
    // Create a config object with necessary parameters
    const config = new OpenApi.default.Config({
      accessKeyId: clientId,
      accessKeySecret: clientSecret,
    });
    config.protocol = "https";
    config.endpoint = "oapi.dingtalk.com";
    config.regionId = "cn-hangzhou"; // Use appropriate region

    // Create the client
    const client = new dingtalkoauth2_1_0.default(config);

    // Create the request object for getting access token
    const request = new dingtalkoauth2_1_0.default.GetAccessTokenRequest({
      appKey: clientId,
      appSecret: clientSecret,
      grantType: "client_credentials", // Standard OAuth2 grant type for getting access tokens
    });

    // Call the API to get access token
    const response = await client.getAccessToken(request);

    if (!response?.body?.accessToken) {
      console.error(`[dingtalk:auth] Failed to get access token: ${response?.body?.errmsg || 'Unknown error'}`);
      throw new Error(`Failed to get access token: ${response?.body?.errmsg || 'Unknown error'}`);
    }

    console.log(`[dingtalk:auth] Access token retrieved successfully`);
    return response.body.accessToken;
  } catch (err: any) {
    console.error(`[dingtalk:auth] Error getting access token:`, err.message || 'Unknown error');
    if (err && typeof err === 'object' && 'code' in err && 'message' in err) {
      throw new Error(`Failed to get access token: ${err.message} (code: ${err.code})`);
    } else {
      throw new Error(`Failed to get access token: ${err?.message || 'Unknown error'}`);
    }
  }
}

/**
 * Establish connection with DingTalk Stream API
 * Reference: https://github.com/open-dingtalk/dingtalk-stream-sdk-nodejs
 */
export interface StreamConnectionParams {
  clientId: string;
  clientSecret: string;
  localIp?: string;
  subscriptions?: Array<{
    topic: string;
    type: string;
  }>;
  ua?: string;
}

export interface StreamConnectionResult {
  endpoint: string;
  ticket: string;
}

export async function registerStreamConnection(params: StreamConnectionParams): Promise<StreamConnectionResult> {
  // Create config for API call using Tea SDK
  const config = new OpenApi.default.Config({
    accessKeyId: params.clientId,
    accessKeySecret: params.clientSecret,
  });
  config.protocol = "https";
  config.endpoint = "api.dingtalk.com";
  config.regionId = "cn-hangzhou";

  // Create a common request object
  const request = new OpenApi.default.OpenApiRequest({
    protocol: "https",
    method: "POST",
    pathname: "/v1.0/gateway/connections/open",
    headers: {
      "Content-Type": "application/json",
    },
    body: Util.toMap({
      clientId: params.clientId,
      clientSecret: params.clientSecret,
      localIp: params.localIp,
      subscriptions: params.subscriptions || [
        {
          topic: "*",
          type: "EVENT"
        },
        {
          topic: "/v1.0/im/bot/messages/get",
          type: "CALLBACK"
        }
      ],
      ua: params.ua
    })
  });

  // Create the client
  const client = new OpenApi.default.Client(config);

  try {
    const response = await client.callApi(request);

    const result = response.body as any;

    if (result.errcode !== 0) {
      throw new Error(`Failed to register stream connection: ${result.errmsg} (errcode: ${result.errcode})`);
    }

    return {
      endpoint: result.endpoint,
      ticket: result.ticket
    };
  } catch (error: any) {
    if (!$tea.isUnretryableError(error)) {
      throw error;
    }
    throw new Error(`Failed to register stream connection: ${error.message || 'Unknown error'}`);
  }
}