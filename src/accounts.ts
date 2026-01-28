import type { MoltbotConfig } from "moltbot/plugin-sdk";
import { DEFAULT_ACCOUNT_ID, normalizeAccountId } from "moltbot/plugin-sdk";

export interface ResolvedDingTalkAccount {
  accountId: string;
  name?: string;
  enabled: boolean;
  configured: boolean;
  clientId?: string;
  clientSecret?: string;
  tokenSource?: string;
  config: {
    agentId?: string;
    dmPolicy?: string;
    allowFrom?: (string | number)[];
    webhookUrl?: string;
    webhookSecret?: string;
    webhookPath?: string;
    proxy?: string;
  };
}

export function resolveDingTalkAccount({
  cfg,
  accountId,
}: {
  cfg: MoltbotConfig;
  accountId?: string;
}): ResolvedDingTalkAccount {
  const resolvedAccountId = normalizeAccountId(accountId) ?? DEFAULT_ACCOUNT_ID;
  
  // Check if we're using account-specific config
  const useAccountPath = Boolean(
    resolvedAccountId !== DEFAULT_ACCOUNT_ID &&
    cfg.channels?.dingtalk?.accounts?.[resolvedAccountId]
  );
  
  if (useAccountPath) {
    const accountConfig = cfg.channels?.dingtalk?.accounts?.[resolvedAccountId];
    return {
      accountId: resolvedAccountId,
      name: accountConfig?.name,
      enabled: accountConfig?.enabled !== false,
      configured: Boolean(accountConfig?.clientId && accountConfig?.clientSecret),
      clientId: accountConfig?.clientId,
      clientSecret: accountConfig?.clientSecret,
      tokenSource: accountConfig?.clientId ? "config" : undefined,
      config: {
        agentId: accountConfig?.agentId,
        dmPolicy: accountConfig?.dmPolicy,
        allowFrom: accountConfig?.allowFrom,
        webhookUrl: accountConfig?.webhookUrl,
        webhookSecret: accountConfig?.webhookSecret,
        webhookPath: accountConfig?.webhookPath,
        proxy: accountConfig?.proxy,
      },
    };
  } else {
    // Use base config
    return {
      accountId: resolvedAccountId,
      name: cfg.channels?.dingtalk?.name,
      enabled: cfg.channels?.dingtalk?.enabled !== false,
      configured: Boolean(cfg.channels?.dingtalk?.clientId && cfg.channels?.dingtalk?.clientSecret),
      clientId: cfg.channels?.dingtalk?.clientId,
      clientSecret: cfg.channels?.dingtalk?.clientSecret,
      tokenSource: cfg.channels?.dingtalk?.clientId ? "config" : undefined,
      config: {
        agentId: cfg.channels?.dingtalk?.agentId,
        dmPolicy: cfg.channels?.dingtalk?.dmPolicy,
        allowFrom: cfg.channels?.dingtalk?.allowFrom,
        webhookUrl: cfg.channels?.dingtalk?.webhookUrl,
        webhookSecret: cfg.channels?.dingtalk?.webhookSecret,
        webhookPath: cfg.channels?.dingtalk?.webhookPath,
        proxy: cfg.channels?.dingtalk?.proxy,
      },
    };
  }
}

export function resolveDefaultDingTalkAccountId(cfg: MoltbotConfig): string {
  // Check if there's a named account that should be default
  if (cfg.channels?.dingtalk?.accounts) {
    const accounts = Object.keys(cfg.channels.dingtalk.accounts);
    if (accounts.length === 1) {
      return accounts[0];
    }
    // If there's a "default" account, use it
    if (cfg.channels.dingtalk.accounts.default) {
      return "default";
    }
  }
  return DEFAULT_ACCOUNT_ID;
}

export function listDingTalkAccountIds(cfg: MoltbotConfig): string[] {
  if (cfg.channels?.dingtalk?.accounts) {
    return [...Object.keys(cfg.channels.dingtalk.accounts), DEFAULT_ACCOUNT_ID];
  }
  return [DEFAULT_ACCOUNT_ID];
}