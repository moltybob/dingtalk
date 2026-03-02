import type { 
  OpenClawConfig, 
  ChannelOnboardingAdapter, 
  ChannelOnboardingDmPolicy,
  WizardPrompter,
} from "openclaw/plugin-sdk";
import type { DmPolicy } from "openclaw/plugin-sdk";

import { 
  listDingTalkAccountIds, 
  resolveDefaultDingTalkAccountId, 
  resolveDingTalkAccount 
} from "./accounts.js";
import { DEFAULT_ACCOUNT_ID, normalizeAccountId } from "openclaw/plugin-sdk";
import { formatDocsLink } from "openclaw/plugin-sdk";
import { promptChannelAccessConfig } from "openclaw/plugin-sdk";
import { addWildcardAllowFrom } from "openclaw/plugin-sdk";
import { promptAccountId } from "openclaw/plugin-sdk";

const channel = "dingtalk" as const;

function setDingTalkDmPolicy(cfg: OpenClawConfig, dmPolicy: DmPolicy) {
  const allowFrom =
    dmPolicy === "open" ? addWildcardAllowFrom(cfg.channels?.dingtalk?.allowFrom) : undefined;
  return {
    ...cfg,
    channels: {
      ...cfg.channels,
      dingtalk: {
        ...cfg.channels?.dingtalk,
        enabled: cfg.channels?.dingtalk?.enabled ?? true,
        dmPolicy,
        ...(allowFrom ? { allowFrom } : {}),
      },
    },
  };
}

async function noteDingTalkCredentialsHelp(prompter: WizardPrompter): Promise<void> {
  await prompter.note(
    [
      "如何获取钉钉机器人凭证:",
      "1) 登录钉钉开发者后台 (open-dev.dingtalk.com)",
      "2) 创建应用 → 选择「企业内部开发」→ 「H5微应用」",
      "3) 在应用详情页找到「App Key」和「App Secret」",
      "4) 设置回调URL（如果使用webhook模式）",
      `文档: ${formatDocsLink("/channels/dingtalk", "钉钉集成文档")}`,
    ].join("\n"),
    "钉钉机器人凭证",
  );
}

function setDingTalkGroupPolicy(
  cfg: OpenClawConfig,
  accountId: string,
  groupPolicy: "open" | "allowlist" | "disabled",
): OpenClawConfig {
  if (accountId === DEFAULT_ACCOUNT_ID) {
    return {
      ...cfg,
      channels: {
        ...cfg.channels,
        dingtalk: {
          ...cfg.channels?.dingtalk,
          enabled: true,
          groupPolicy,
        },
      },
    };
  }
  return {
    ...cfg,
    channels: {
      ...cfg.channels,
      dingtalk: {
        ...cfg.channels?.dingtalk,
        enabled: true,
        accounts: {
          ...cfg.channels?.dingtalk?.accounts,
          [accountId]: {
            ...cfg.channels?.dingtalk?.accounts?.[accountId],
            enabled: cfg.channels?.dingtalk?.accounts?.[accountId]?.enabled ?? true,
            groupPolicy,
          },
        },
      },
    },
  };
}

function parseDingTalkAllowFromInput(raw: string): string[] {
  return raw
    .split(/[\n,;]+/g)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

async function promptDingTalkAllowFrom(params: {
  cfg: OpenClawConfig;
  prompter: WizardPrompter;
  accountId?: string;
}): Promise<OpenClawConfig> {
  const accountId =
    params.accountId && normalizeAccountId(params.accountId)
      ? (normalizeAccountId(params.accountId) ?? DEFAULT_ACCOUNT_ID)
      : resolveDefaultDingTalkAccountId(params.cfg);
  const _resolved = resolveDingTalkAccount({ cfg: params.cfg, accountId });
  const allowFromValue = params.cfg.channels?.dingtalk?.allowFrom;
  const existing = Array.isArray(allowFromValue) ? allowFromValue : [];
  await params.prompter.note(
    [
      "通过用户ID设置钉钉私信白名单。",
      "示例:",
      "- userId123",
      "- userId456",
      "多个条目: 逗号分隔。",
      `文档: ${formatDocsLink("/channels/dingtalk", "钉钉集成文档")}`,
    ].join("\n"),
    "钉钉白名单",
  );

  const parseInputs = (value: string) => parseDingTalkAllowFromInput(value);

  while (true) {
    const entry = await params.prompter.text({
      message: "钉钉 allowFrom (用户ID)",
      placeholder: "userId123, userId456",
      initialValue: existing[0] ? String(existing[0]) : undefined,
      validate: (value) => (String(value ?? "").trim() ? undefined : "必填项"),
    });
    const parts = parseInputs(String(entry));
    
    const unique = [...new Set([...existing.map((v) => String(v).trim()), ...parts])].filter(
      Boolean,
    );
    return {
      ...params.cfg,
      channels: {
        ...params.cfg.channels,
        dingtalk: {
          ...params.cfg.channels?.dingtalk,
          allowFrom: unique,
        },
      },
    };
  }
}

const dmPolicy: ChannelOnboardingDmPolicy = {
  label: "DingTalk",
  channel,
  policyKey: "channels.dingtalk.dmPolicy",
  allowFromKey: "channels.dingtalk.allowFrom",
  getCurrent: (cfg) => cfg.channels?.dingtalk?.dmPolicy ?? "pairing",
  setPolicy: (cfg, policy) => setDingTalkDmPolicy(cfg, policy),
  promptAllowFrom: promptDingTalkAllowFrom,
};

export const dingtalkOnboardingAdapter: ChannelOnboardingAdapter = {
  channel,
  quickstartHint: "DingTalk bot with clientId and clientSecret",
  quickstartFlags: ["--client-id", "--client-secret"],
  credentialEnvVars: ["DINGTALK_CLIENT_ID", "DINGTALK_CLIENT_SECRET"],
  credentialFlags: ["--client-id", "--client-secret"],
  credentialInputs: [
    {
      id: "clientId",
      label: "Client ID",
      placeholder: "Enter your DingTalk client ID",
      help: "Your DingTalk client ID from the developer console",
      required: true,
    },
    {
      id: "clientSecret",
      label: "Client Secret",
      placeholder: "Enter your DingTalk client secret",
      help: "Your DingTalk client secret from the developer console",
      required: true,
      secret: true,
    },
    {
      id: "agentId",
      label: "Agent ID",
      placeholder: "Enter your DingTalk agent ID",
      help: "Your DingTalk agent ID for sending messages",
      required: false,
    },
  ],
  getStatus: async ({ cfg }) => {
    const configured = listDingTalkAccountIds(cfg).some((accountId) =>
      Boolean(resolveDingTalkAccount({ cfg, accountId }).clientId && resolveDingTalkAccount({ cfg, accountId }).clientSecret),
    );
    return {
      channel,
      configured,
      statusLines: [`DingTalk: ${configured ? "已配置" : "需要凭证"}`],
      selectionHint: configured ? "已配置" : "需要凭证",
      quickstartScore: configured ? 2 : 1,
    };
  },
  configure: async ({ cfg, prompter, accountOverrides, shouldPromptAccountIds, forceAllowFrom }) => {
    const dingTalkOverride = accountOverrides.dingtalk?.trim();
    const defaultDingTalkAccountId = resolveDefaultDingTalkAccountId(cfg);
    let dingTalkAccountId = dingTalkOverride
      ? normalizeAccountId(dingTalkOverride)
      : defaultDingTalkAccountId;
    if (shouldPromptAccountIds && !dingTalkOverride) {
      dingTalkAccountId = await promptAccountId({
        cfg,
        prompter,
        label: "DingTalk",
        currentId: dingTalkAccountId,
        listAccountIds: listDingTalkAccountIds,
        defaultAccountId: defaultDingTalkAccountId,
      });
    }

    let next = cfg;
    const resolvedAccount = resolveDingTalkAccount({
      cfg: next,
      accountId: dingTalkAccountId,
    });
    const accountConfigured = Boolean(resolvedAccount.clientId && resolvedAccount.clientSecret);
    const allowEnv = dingTalkAccountId === DEFAULT_ACCOUNT_ID;
    const canUseEnv = allowEnv && Boolean(process.env.DINGTALK_CLIENT_ID?.trim() && process.env.DINGTALK_CLIENT_SECRET?.trim());
    const hasConfigCredentials = Boolean(resolvedAccount.config.clientId && resolvedAccount.config.clientSecret);

    let clientId: string | null = null;
    let clientSecret: string | null = null;
    let agentId: string | null = null;
    
    if (!accountConfigured) {
      await noteDingTalkCredentialsHelp(prompter);
    }
    
    if (canUseEnv && !hasConfigCredentials) {
      const keepEnv = await prompter.confirm({
        message: "检测到 DINGTALK_CLIENT_ID 和 DINGTALK_CLIENT_SECRET。使用环境变量？",
        initialValue: true,
      });
      if (!keepEnv) {
        clientId = String(
          await prompter.text({
            message: "输入钉钉 Client ID",
            validate: (value) => (value?.trim() ? undefined : "必填项"),
          }),
        ).trim();
        
        clientSecret = String(
          await prompter.text({
            message: "输入钉钉 Client Secret",
            validate: (value) => (value?.trim() ? undefined : "必填项"),
          }),
        ).trim();
        
        const agentIdInput = await prompter.text({
          message: "输入钉钉 Agent ID (可选)",
          placeholder: "留空则使用默认值",
        });
        
        if (agentIdInput?.trim()) {
          agentId = String(agentIdInput).trim();
        }
      }
    } else if (hasConfigCredentials) {
      const keep = await prompter.confirm({
        message: "钉钉凭证已配置。保留当前配置？",
        initialValue: true,
      });
      if (!keep) {
        clientId = String(
          await prompter.text({
            message: "输入钉钉 Client ID",
            validate: (value) => (value?.trim() ? undefined : "必填项"),
          }),
        ).trim();
        
        clientSecret = String(
          await prompter.text({
            message: "输入钉钉 Client Secret",
            validate: (value) => (value?.trim() ? undefined : "必填项"),
          }),
        ).trim();
        
        const agentIdInput = await prompter.text({
          message: "输入钉钉 Agent ID (可选)",
          placeholder: "留空则使用默认值",
        });
        
        if (agentIdInput?.trim()) {
          agentId = String(agentIdInput).trim();
        }
      }
    } else {
      clientId = String(
        await prompter.text({
          message: "输入钉钉 Client ID",
          validate: (value) => (value?.trim() ? undefined : "必填项"),
        }),
      ).trim();
      
      clientSecret = String(
        await prompter.text({
          message: "输入钉钉 Client Secret",
          validate: (value) => (value?.trim() ? undefined : "必填项"),
        }),
      ).trim();
      
      const agentIdInput = await prompter.text({
        message: "输入钉钉 Agent ID (可选)",
        placeholder: "留空则使用默认值",
      });
      
      if (agentIdInput?.trim()) {
        agentId = String(agentIdInput).trim();
      }
    }

    // 应用配置
    if (clientId && clientSecret) {
      if (dingTalkAccountId === DEFAULT_ACCOUNT_ID) {
        next = {
          ...next,
          channels: {
            ...next.channels,
            dingtalk: { 
              ...next.channels?.dingtalk, 
              enabled: true, 
              clientId,
              clientSecret,
              ...(agentId ? { agentId } : {}),
            },
          },
        };
      } else {
        next = {
          ...next,
          channels: {
            ...next.channels,
            dingtalk: {
              ...next.channels?.dingtalk,
              enabled: true,
              accounts: {
                ...next.channels?.dingtalk?.accounts,
                [dingTalkAccountId]: {
                  ...next.channels?.dingtalk?.accounts?.[dingTalkAccountId],
                  enabled: next.channels?.dingtalk?.accounts?.[dingTalkAccountId]?.enabled ?? true,
                  clientId,
                  clientSecret,
                  ...(agentId ? { agentId } : {}),
                },
              },
            },
          },
        };
      }
    }

    // 配置访问控制
    const allowFromValue = resolvedAccount.config.allowFrom;
    const currentEntries = Array.isArray(allowFromValue) ? allowFromValue : [];
    const accessConfig = await promptChannelAccessConfig({
      prompter,
      label: "DingTalk 访问控制",
      currentPolicy: resolvedAccount.config.groupPolicy ?? "allowlist",
      currentEntries: currentEntries.map(String),
      placeholder: "userId123, userId456",
      updatePrompt: Boolean(Array.isArray(allowFromValue) && allowFromValue.length > 0),
    });
    
    if (accessConfig) {
      if (accessConfig.policy !== "allowlist") {
        next = setDingTalkGroupPolicy(next, dingTalkAccountId, accessConfig.policy);
      } else {
        // 对于钉钉，我们只设置允许列表策略
        next = setDingTalkGroupPolicy(next, dingTalkAccountId, "allowlist");
        
        // 更新允许列表（多账号时写入对应 account 下）
        if (accessConfig.entries.length > 0) {
          if (dingTalkAccountId === DEFAULT_ACCOUNT_ID) {
            next = {
              ...next,
              channels: {
                ...next.channels,
                dingtalk: {
                  ...next.channels?.dingtalk,
                  allowFrom: accessConfig.entries,
                },
              },
            };
          } else {
            next = {
              ...next,
              channels: {
                ...next.channels,
                dingtalk: {
                  ...next.channels?.dingtalk,
                  accounts: {
                    ...next.channels?.dingtalk?.accounts,
                    [dingTalkAccountId]: {
                      ...next.channels?.dingtalk?.accounts?.[dingTalkAccountId],
                      allowFrom: accessConfig.entries,
                    },
                  },
                },
              },
            };
          }
        }
      }
    }

    // 如果强制设置允许列表（例如快速入门），则添加通配符
    if (forceAllowFrom) {
      next = addWildcardAllowFrom(next, "dingtalk");
    }

    return { cfg: next, accountId: dingTalkAccountId };
  },
  dmPolicy,
  disable: (cfg) => ({
    ...cfg,
    channels: {
      ...cfg.channels,
      dingtalk: { ...cfg.channels?.dingtalk, enabled: false },
    },
  }),
};