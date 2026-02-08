import Util from '@alicloud/tea-util';
import dingtalkoauth2_1_0, * as $dingtalkoauth2_1_0 from '@alicloud/dingtalk/oauth2_1_0';
import OpenApi, * as $OpenApi from '@alicloud/openapi-client';
import * as $tea from '@alicloud/tea-typescript';

/**
 * Get access token from DingTalk API for internal applications
 * 
 * This function implements the official DingTalk API to obtain an access token
 * for internal applications using the OAuth2.0 client_credentials grant type.
 * 
 * Reference: https://open.dingtalk.com/document/development/obtain-the-access-token-of-an-internal-app
 * 
 * Official Node.js example adapted:
 * - Uses OpenApi client configuration with accessKeyId/accessKeySecret
 * - Creates oauth2_1_0 client to call getAccessToken API
 * - Requires appKey and appSecret for authentication
 * - Returns access token to be used in subsequent API calls
 * 
 * @param clientId - The appKey of your DingTalk application
 * @param clientSecret - The appSecret of your DingTalk application
 * @returns Promise<string> - The access token string
 * @throws Error if the API call fails
 */
export async function getDingTalkAccessToken(clientId: string, clientSecret: string): Promise<string> {
  console.log(`[dingtalk:auth] Requesting access token for clientId: ${clientId.substring(0, 8)}...`);
  try {
    let config = new $OpenApi.Config({ });
    config.protocol = "https";
    config.regionId = "central";

    // Step 2: Create the DingTalk OAuth2 client
    // This client handles the authentication flow
    const client = new dingtalkoauth2_1_0(config);

    let request = new $dingtalkoauth2_1_0.GetAccessTokenRequest({
      appKey: clientId,
      appSecret: clientSecret,
    });

    // Step 4: Execute the API call to get the access token
    const response = await client.getAccessToken(request);

    // Step 5: Validate the response and extract the access token
    if (!response?.body?.accessToken) {
      console.error(`[dingtalk:auth] Failed to get access token: ${response?.body?.errmsg || 'Unknown error'}`);
      throw new Error(`Failed to get access token: ${response?.body?.errmsg || 'Unknown error'}`);
    }
    console.log(`[dingtalk:auth] Access token retrieved successfully`);
    return response.body.accessToken;
  } catch (err: any) {
    if (!Util.empty(err?.code) && !Util.empty(err?.message)) {
      console.error(`[dingtalk:auth] getDingTalkAccessToken Error message:`, err.message);
      console.error(`[dingtalk:auth] getDingTalkAccessToken Error code:`, err.code);
      throw new Error(`Failed to get access token: ${err.message} (code: ${err.code})`);
    }
    console.error(`[dingtalk:auth] getDingTalkAccessToken Error:`, err?.message || 'Unknown error');
    throw new Error(`Failed to get access token: ${err?.message || 'Unknown error'}`);
  }
}