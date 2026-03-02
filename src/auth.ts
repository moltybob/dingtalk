import dingtalkoauth2_1_0, * as $dingtalkoauth2_1_0 from '@alicloud/dingtalk/oauth2_1_0';
import * as $OpenApi from '@alicloud/openapi-client';

/** 默认 token 有效期（秒），钉钉一般为 7200，提前 5 分钟刷新 */
const DEFAULT_EXPIRE_IN_SEC = 7200;
const REFRESH_BEFORE_SEC = 300;

interface CachedToken {
  token: string;
  expiresAt: number;
}

const tokenCache = new Map<string, CachedToken>();
const inFlight = new Map<string, Promise<string>>();

function cacheKey(clientId: string): string {
  return clientId;
}

/**
 * Get access token from DingTalk API for internal applications.
 * Tokens are cached in memory by clientId and reused until they expire (or 5 min before);
 * concurrent calls for the same clientId share a single request.
 *
 * Reference: https://open.dingtalk.com/document/development/obtain-the-access-token-of-an-internal-app
 *
 * @param clientId - The appKey of your DingTalk application
 * @param clientSecret - The appSecret of your DingTalk application
 * @returns Promise<string> - The access token string
 * @throws Error if the API call fails
 */
export async function getDingTalkAccessToken(clientId: string, clientSecret: string): Promise<string> {
  const key = cacheKey(clientId);
  const now = Date.now();

  const cached = tokenCache.get(key);
  if (cached && now < cached.expiresAt - REFRESH_BEFORE_SEC * 1000) {
    return cached.token;
  }

  let promise = inFlight.get(key);
  if (promise) {
    return promise;
  }

  // 用 deferred 先暴露 promise 再跑异步逻辑，保证并发调用能复用到同一 promise
  let resolveOut: (value: string) => void;
  let rejectOut: (reason: Error) => void;
  promise = new Promise<string>((resolve, reject) => {
    resolveOut = resolve;
    rejectOut = reject;
  });
  inFlight.set(key, promise);
  queueMicrotask(() => {
    (async () => {
      try {
        const token = await fetchAndCacheToken(clientId, clientSecret, key);
        console.log(`[dingtalk:auth] Access token retrieved successfully`);
        resolveOut!(token);
      } catch (err: any) {
        const hasCode = err?.code != null && String(err.code) !== '';
        const hasMessage = err?.message != null && String(err.message) !== '';
        if (hasCode && hasMessage) {
          console.error(`[dingtalk:auth] getDingTalkAccessToken Error message:`, err.message);
          console.error(`[dingtalk:auth] getDingTalkAccessToken Error code:`, err.code);
          rejectOut!(new Error(`Failed to get access token: ${err.message} (code: ${err.code})`));
        } else {
          console.error(`[dingtalk:auth] getDingTalkAccessToken Error:`, err?.message ?? 'Unknown error');
          rejectOut!(new Error(`Failed to get access token: ${err?.message ?? 'Unknown error'}`));
        }
      } finally {
        inFlight.delete(key);
      }
    })();
  });
  return promise;
}

async function fetchAndCacheToken(clientId: string, clientSecret: string, key: string): Promise<string> {
  const config = new $OpenApi.Config({});
  config.protocol = "https";
  config.regionId = "central";
  const client = new dingtalkoauth2_1_0(config);
  const request = new $dingtalkoauth2_1_0.GetAccessTokenRequest({
    appKey: clientId,
    appSecret: clientSecret,
  });

  const response = await client.getAccessToken(request);

  if (!response?.body?.accessToken) {
    const errmsg = (response?.body as { errmsg?: string })?.errmsg || 'Unknown error';
    console.error(`[dingtalk:auth] Failed to get access token: ${errmsg}`);
    throw new Error(`Failed to get access token: ${errmsg}`);
  }

  const rawExpire = (response.body as { expireIn?: number }).expireIn;
  const expireInSec =
    typeof rawExpire === 'number' && rawExpire > 0
      ? Math.min(rawExpire, DEFAULT_EXPIRE_IN_SEC)
      : DEFAULT_EXPIRE_IN_SEC;
  const expiresAt = Date.now() + expireInSec * 1000;
  tokenCache.set(key, { token: response.body.accessToken, expiresAt });
  return response.body.accessToken;
}

/**
 * 仅用于测试：清空 token 缓存与进行中的请求，便于单测隔离。
 * @internal
 */
export function __testingClearTokenCache(): void {
  tokenCache.clear();
  inFlight.clear();
}