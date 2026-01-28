import { getDingTalkAccessToken } from './auth.js';

interface ProbeResult {
  ok: boolean;
  error?: string;
  elapsedMs: number;
  bot?: {
    id?: string;
    name?: string;
  };
}

export async function probeDingTalk(
  clientId: string,
  clientSecret: string,
  timeoutMs: number = 5000
): Promise<ProbeResult> {
  const startTime = Date.now();

  try {
    // Attempt to get an access token as a basic connectivity test
    await Promise.race([
      getDingTalkAccessToken(clientId, clientSecret),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Timeout')), timeoutMs)
      )
    ]);

    // If we successfully got a token, the credentials are valid
    return {
      ok: true,
      elapsedMs: Date.now() - startTime,
      bot: {
        id: clientId, // Using clientId as bot ID for now
        name: "DingTalk Bot" // Could fetch actual bot name if available
      }
    };
  } catch (error: any) {
    return {
      ok: false,
      error: error.message || 'Unknown error during probe',
      elapsedMs: Date.now() - startTime
    };
  }
}