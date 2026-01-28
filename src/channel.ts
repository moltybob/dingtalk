import type {
  ChannelAccountSnapshot,
  ChannelDock,
  ChannelPlugin,
  ClawdbotConfig,
} from "clawdbot/plugin-sdk";
import {
  applyAccountNameToChannelSection,
  buildChannelConfigSchema,
  DEFAULT_ACCOUNT_ID,
  deleteAccountFromConfigSection,
  formatPairingApproveHint,
  migrateBaseNameToDefaultAccount,
  normalizeAccountId,
  PAIRING_APPROVED_MESSAGE,
  setAccountEnabledInConfigSection,
} from "clawdbot/plugin-sdk";

import { listDingTalkAccountIds, resolveDefaultDingTalkAccountId, resolveDingTalkAccount, type ResolvedDingTalkAccount } from "./accounts.js";
import { dingtalkMessageActions } from "./actions.js";
import { DingTalkConfigSchema } from "./config-schema.js";
import { dingtalkOnboardingAdapter } from "./onboarding.js";
import { probeDingTalk } from "./probe.js";
import { sendMessageDingTalk } from "./send.js";
import { collectDingTalkStatusIssues } from "./status-issues.js";
import {
  listDingTalkDirectoryPeersLive,
  listDingTalkDirectoryGroupsLive,
} from "./directory-live.js";

const meta = {
  id: "dingtalk",
  label: "DingTalk",
  selectionLabel: "DingTalk (Bot API)",
  docsPath: "/channels/dingtalk",
  docsLabel: "dingtalk",
  blurb: "Chinese messaging and collaboration platform with Bot API.",
  aliases: ["dt"],
  order: 85,
  quickstartAllowFrom: true,
};

function normalizeDingTalkMessagingTarget(raw: string): string | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) return undefined;
  return trimmed.replace(/^(dingtalk|dt):/i, "");
}

export const dingtalkDock: ChannelDock = {
  id: "dingtalk",
  capabilities: {
    chatTypes: ["direct", "group"],
    media: true,
    blockStreaming: false,
  },
  outbound: { textChunkLimit: 2000 },
  config: {
    resolveAllowFrom: ({ cfg, accountId }) =>
      (resolveDingTalkAccount({ cfg: cfg as ClawdbotConfig, accountId }).config.allowFrom ?? []).map(
        (entry) => String(entry),
      ),
    formatAllowFrom: ({ allowFrom }) =>
      allowFrom
        .map((entry) => String(entry).trim())
        .filter(Boolean)
        .map((entry) => entry.replace(/^(dingtalk|dt):/i, ""))
        .map((entry) => entry.toLowerCase()),
  },
  groups: {
    resolveRequireMention: () => true,
  },
  threading: {
    resolveReplyToMode: () => "off",
  },
};

export const dingtalkPlugin: ChannelPlugin<ResolvedDingTalkAccount> = {
  id: "dingtalk",
  meta,
  onboarding: dingtalkOnboardingAdapter,
  capabilities: {
    chatTypes: ["direct", "group"],
    media: true,
    reactions: false,
    threads: false,
    polls: false,
    nativeCommands: false,
    blockStreaming: false,
  },
  reload: { configPrefixes: ["channels.dingtalk"] },
  configSchema: buildChannelConfigSchema(DingTalkConfigSchema),
  config: {
      listAccountIds: (cfg) => listDingTalkAccountIds(cfg as ClawdbotConfig),
      resolveAccount: (cfg, accountId) => resolveDingTalkAccount({ cfg: cfg as ClawdbotConfig, accountId }),
      defaultAccountId: (cfg) => resolveDefaultDingTalkAccountId(cfg as ClawdbotConfig),
    setAccountEnabled: ({ cfg, accountId, enabled }) =>
      setAccountEnabledInConfigSection({
        cfg: cfg as ClawdbotConfig,
        sectionKey: "dingtalk",
        accountId,
        enabled,
        allowTopLevel: true,
      }),
    deleteAccount: ({ cfg, accountId }) =>
      deleteAccountFromConfigSection({
        cfg: cfg as ClawdbotConfig,
        sectionKey: "dingtalk",
        accountId,
        clearBaseFields: ["clientId", "clientSecret", "name"],
      }),
    isConfigured: (account) => Boolean(account.clientId?.trim() && account.clientSecret?.trim()),
    describeAccount: (account): ChannelAccountSnapshot => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: Boolean(account.clientId?.trim() && account.clientSecret?.trim()),
      tokenSource: account.tokenSource,
    }),
    resolveAllowFrom: ({ cfg, accountId }) =>
      (resolveDingTalkAccount({ cfg: cfg as ClawdbotConfig, accountId }).config.allowFrom ?? []).map(
        (entry) => String(entry),
      ),
    formatAllowFrom: ({ allowFrom }) =>
      allowFrom
        .map((entry) => String(entry).trim())
        .filter(Boolean)
        .map((entry) => entry.replace(/^(dingtalk|dt):/i, ""))
        .map((entry) => entry.toLowerCase()),
  },
  security: {
    resolveDmPolicy: ({ cfg, accountId, account }) => {
      const resolvedAccountId = accountId ?? account.accountId ?? DEFAULT_ACCOUNT_ID;
      const useAccountPath = Boolean(
        (cfg as ClawdbotConfig).channels?.dingtalk?.accounts?.[resolvedAccountId],
      );
      const basePath = useAccountPath
        ? `channels.dingtalk.accounts.${resolvedAccountId}.`
        : "channels.dingtalk.";
      return {
        policy: account.config.dmPolicy ?? "pairing",
        allowFrom: account.config.allowFrom ?? [],
        policyPath: `${basePath}dmPolicy`,
        allowFromPath: basePath,
        approveHint: formatPairingApproveHint("dingtalk"),
        normalizeEntry: (raw) => raw.replace(/^(dingtalk|dt):/i, ""),
      };
    },
  },
  groups: {
    resolveRequireMention: () => true,
  },
  threading: {
    resolveReplyToMode: () => "off",
  },
  actions: dingtalkMessageActions,
  messaging: {
    normalizeTarget: normalizeDingTalkMessagingTarget,
    targetResolver: {
      looksLikeId: (raw) => {
        const trimmed = raw.trim();
        if (!trimmed) return false;
        // DingTalk user IDs are typically alphanumeric strings
        return /^[a-zA-Z0-9_-]{10,}$/.test(trimmed);
      },
      hint: "<userId|conversationId>",
    },
  },
  directory: {
    self: async () => null,
    listPeers: async ({ cfg, accountId, query, limit }) => {
      const account = resolveDingTalkAccount({ cfg: cfg as ClawdbotConfig, accountId });
      const q = query?.trim().toLowerCase() || "";
      const peers = Array.from(
        new Set(
          (account.config.allowFrom ?? [])
            .map((entry) => String(entry).trim())
            .filter((entry) => Boolean(entry) && entry !== "*")
            .map((entry) => entry.replace(/^(dingtalk|dt):/i, "")),
        ),
      )
        .filter((id) => (q ? id.toLowerCase().includes(q) : true))
        .slice(0, limit && limit > 0 ? limit : undefined)
        .map((id) => ({ kind: "user", id }) as const);
      return peers;
    },
    listGroups: async () => [],
    listPeersLive: async ({ cfg, query, limit }) =>
      listDingTalkDirectoryPeersLive({ cfg, query, limit }),
    listGroupsLive: async ({ cfg, query, limit }) =>
      listDingTalkDirectoryGroupsLive({ cfg, query, limit }),
  },
  setup: {
    resolveAccountId: ({ accountId }) => normalizeAccountId(accountId),
    applyAccountName: ({ cfg, accountId, name }) =>
      applyAccountNameToChannelSection({
        cfg: cfg as ClawdbotConfig,
        channelKey: "dingtalk",
        accountId,
        name,
      }),
    validateInput: ({ accountId, input }) => {
      if (input.useEnv && accountId !== DEFAULT_ACCOUNT_ID) {
        return "DINGTALK_CLIENT_ID and DINGTALK_CLIENT_SECRET can only be used for the default account.";
      }
      if (!input.useEnv && !input.clientId && !input.clientSecret) {
        return "DingTalk requires clientId and clientSecret (or --use-env).";
      }
      return null;
    },
    applyAccountConfig: ({ cfg, accountId, input }) => {
      const namedConfig = applyAccountNameToChannelSection({
        cfg: cfg as ClawdbotConfig,
        channelKey: "dingtalk",
        accountId,
        name: input.name,
      });
      const next =
        accountId !== DEFAULT_ACCOUNT_ID
          ? migrateBaseNameToDefaultAccount({
              cfg: namedConfig,
              channelKey: "dingtalk",
            })
          : namedConfig;
      if (accountId === DEFAULT_ACCOUNT_ID) {
        return {
          ...next,
          channels: {
            ...next.channels,
            dingtalk: {
              ...next.channels?.dingtalk,
              enabled: true,
              ...(input.useEnv
                ? {}
                : input.clientId && input.clientSecret
                  ? {
                      clientId: input.clientId,
                      clientSecret: input.clientSecret
                    }
                  : {}),
            },
          },
        } as ClawdbotConfig;
      }
      return {
        ...next,
        channels: {
          ...next.channels,
          dingtalk: {
            ...next.channels?.dingtalk,
            enabled: true,
            accounts: {
              ...next.channels?.dingtalk?.accounts,
              [accountId]: {
                ...next.channels?.dingtalk?.accounts?.[accountId],
                enabled: true,
                ...(input.clientId && input.clientSecret
                  ? {
                      clientId: input.clientId,
                      clientSecret: input.clientSecret,
                      ...(input.agentId ? { agentId: input.agentId } : {})
                    }
                  : {}),
              },
            },
          },
        },
      } as ClawdbotConfig;
    },
  },
  pairing: {
    idLabel: "dingtalkUserId",
    normalizeAllowEntry: (entry) => entry.replace(/^(dingtalk|dt):/i, ""),
    notifyApproval: async ({ cfg, id }) => {
      const account = resolveDingTalkAccount({ cfg: cfg as ClawdbotConfig });
      if (!account.clientId || !account.clientSecret) throw new Error("DingTalk credentials not configured");
      await sendMessageDingTalk(id, PAIRING_APPROVED_MESSAGE, {
        appKey: account.clientId,
        appSecret: account.clientSecret,
        agentId: account.config.agentId || "clawdbot" // Use configured agentId or default
      });
    },
  },
  outbound: {
    deliveryMode: "direct",
    chunker: (text, limit) => {
      if (!text) return [];
      if (limit <= 0 || text.length <= limit) return [text];
      const chunks: string[] = [];
      let remaining = text;
      while (remaining.length > limit) {
        const window = remaining.slice(0, limit);
        const lastNewline = window.lastIndexOf("\n");
        const lastSpace = window.lastIndexOf(" ");
        let breakIdx = lastNewline > 0 ? lastNewline : lastSpace;
        if (breakIdx <= 0) breakIdx = limit;
        const rawChunk = remaining.slice(0, breakIdx);
        const chunk = rawChunk.trimEnd();
        if (chunk.length > 0) chunks.push(chunk);
        const brokeOnSeparator = breakIdx < remaining.length && /\s/.test(remaining[breakIdx]);
        const nextStart = Math.min(remaining.length, breakIdx + (brokeOnSeparator ? 1 : 0));
        remaining = remaining.slice(nextStart).trimStart();
      }
      if (remaining.length) chunks.push(remaining);
      return chunks;
    },
    chunkerMode: "text",
    textChunkLimit: 2000,
    sendText: async ({ to, text, accountId, cfg, context }) => {
      const account = resolveDingTalkAccount({ cfg: cfg as ClawdbotConfig, accountId });
      const sessionWebhook = context?.metadata?.sessionWebhook; // Get session webhook from context if available
      const result = await sendMessageDingTalk(to, text, {
        appKey: account.clientId,
        appSecret: account.clientSecret,
        agentId: account.config.agentId || "clawdbot",
        sessionWebhook, // Pass session webhook for replies
      });
      return {
        channel: "dingtalk",
        ok: result.ok,
        messageId: result.messageId ?? "",
        error: result.error ? new Error(result.error) : undefined,
      };
    },
    sendMedia: async ({ to, text, mediaUrl, accountId, cfg, context }) => {
      const account = resolveDingTalkAccount({ cfg: cfg as ClawdbotConfig, accountId });
      const sessionWebhook = context?.metadata?.sessionWebhook; // Get session webhook from context if available
      const result = await sendMessageDingTalk(to, text, {
        appKey: account.clientId,
        appSecret: account.clientSecret,
        agentId: account.config.agentId || "clawdbot",
        mediaUrl,
        sessionWebhook, // Pass session webhook for replies
      });
      return {
        channel: "dingtalk",
        ok: result.ok,
        messageId: result.messageId ?? "",
        error: result.error ? new Error(result.error) : undefined,
      };
    },
  },
  status: {
    defaultRuntime: {
      accountId: DEFAULT_ACCOUNT_ID,
      running: false,
      lastStartAt: null,
      lastStopAt: null,
      lastError: null,
    },
    collectStatusIssues: collectDingTalkStatusIssues,
    buildChannelSummary: ({ snapshot }) => ({
      configured: snapshot.configured ?? false,
      tokenSource: snapshot.tokenSource ?? "none",
      running: snapshot.running ?? false,
      mode: snapshot.mode ?? null,
      lastStartAt: snapshot.lastStartAt ?? null,
      lastStopAt: snapshot.lastStopAt ?? null,
      lastError: snapshot.lastError ?? null,
      probe: snapshot.probe,
      lastProbeAt: snapshot.lastProbeAt ?? null,
    }),
    probeAccount: async ({ account, timeoutMs }) =>
      probeDingTalk(account.clientId, account.clientSecret, timeoutMs),
    buildAccountSnapshot: ({ account, runtime }) => {
      const configured = Boolean(account.clientId?.trim() && account.clientSecret?.trim());
      return {
        accountId: account.accountId,
        name: account.name,
        enabled: account.enabled,
        configured,
        tokenSource: account.tokenSource,
        running: runtime?.running ?? false,
        lastStartAt: runtime?.lastStartAt ?? null,
        lastStopAt: runtime?.lastStopAt ?? null,
        lastError: runtime?.lastError ?? null,
        mode: account.config.webhookUrl ? "webhook" : "stream",
        lastInboundAt: runtime?.lastInboundAt ?? null,
        lastOutboundAt: runtime?.lastOutboundAt ?? null,
        dmPolicy: account.config.dmPolicy ?? "pairing",
      };
    },
  },
  resolver: {
    resolveTargets: async ({ _cfg, inputs, kind, _runtime }) => {
      // For DingTalk, we can resolve user IDs and conversation IDs
      // This is a simplified implementation - in a real scenario, you'd query DingTalk APIs
      return inputs.map(input => {
        const trimmed = String(input).trim();
        if (!trimmed) {
          return { input, resolved: false };
        }
        
        // Remove channel prefixes
        const cleanInput = trimmed.replace(/^(dingtalk|dt):/i, "");
        
        // Validate if it looks like a DingTalk ID (alphanumeric with possible special chars)
        const isValidDingTalkId = /^[a-zA-Z0-9_\-+=]{10,}$/.test(cleanInput);
        
        if (isValidDingTalkId) {
          return {
            input,
            resolved: true,
            id: cleanInput,
            kind: kind || "user", // Could be "user" or "group"
            label: `DingTalk ${kind || "user"}: ${cleanInput.substring(0, 10)}...`,
          };
        }
        
        return { input, resolved: false };
      });
    },
  },
  gateway: {
    startAccount: async (ctx) => {
      const account = ctx.account;
      const appKey = account.clientId.trim();
      const appSecret = account.clientSecret.trim();

      ctx.log?.info(`[${account.accountId}] starting DingTalk provider`);

      // Import the monitor dynamically to avoid initialization issues
      const { monitorDingTalkProvider } = await import("./monitor.js");
      return monitorDingTalkProvider({
        appKey,
        appSecret,
        account,
        config: ctx.cfg as ClawdbotConfig,
        runtime: ctx.runtime,
        abortSignal: ctx.abortSignal,
        useWebhook: Boolean(account.config.webhookUrl),
        webhookUrl: account.config.webhookUrl,
        webhookSecret: account.config.webhookSecret,
        webhookPath: account.config.webhookPath,
        statusSink: (patch) => ctx.setStatus({ accountId: ctx.accountId, ...patch }),
        dispatchMessage: ctx.dispatchMessage,
      });
    },
  },
};