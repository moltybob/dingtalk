interface AccountStatus {
  accountId: string;
  configured: boolean;
  running: boolean;
  lastError?: string | null;
}

interface StatusIssue {
  channel: string;
  accountId: string;
  kind: string;
  message: string;
}

export function collectDingTalkStatusIssues(accounts: AccountStatus[]): StatusIssue[] {
  return accounts.flatMap((account) => {
    const issues: StatusIssue[] = [];

    if (!account.configured) {
      issues.push({
        channel: "dingtalk",
        accountId: account.accountId,
        kind: "config",
        message: "DingTalk not configured (missing appKey or appSecret)",
      });
    }

    if (account.lastError) {
      issues.push({
        channel: "dingtalk",
        accountId: account.accountId,
        kind: "runtime",
        message: `Last error: ${String(account.lastError)}`,
      });
    }

    return issues;
  });
}