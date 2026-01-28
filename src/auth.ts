import dingtalkoauth2_1_0 from '@alicloud/dingtalk/oauth2_1_0';
import OpenApi from '@alicloud/openapi-client';

/**
 * Get access token from DingTalk API for internal applications
 * Reference: https://open.dingtalk.com/document/development/obtain-the-access-token-of-an-internal-app
 */
export async function getDingTalkAccessToken(clientId: string, clientSecret: string): Promise<string> {
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
      throw new Error(`Failed to get access token: ${response?.body?.errmsg || 'Unknown error'}`);
    }

    return response.body.accessToken;
  } catch (err: any) {
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
  // For stream connection, we still need to use the REST API directly
  // since the stream SDK handles the connection after getting the endpoint and ticket
  const axios = (await import('axios')).default;

  const response = await axios.post('https://api.dingtalk.com/v1.0/gateway/connections/open', {
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
  }, {
    timeout: 5000
  });

  if (response.data.errcode !== 0) {
    throw new Error(`Failed to register stream connection: ${response.data.errmsg} (errcode: ${response.data.errcode})`);
  }

  return {
    endpoint: response.data.endpoint,
    ticket: response.data.ticket
  };
}