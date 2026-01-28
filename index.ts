import type { MoltbotPluginApi } from "moltbot/plugin-sdk";
import { emptyPluginConfigSchema } from "moltbot/plugin-sdk";

import { dingtalkDock, dingtalkPlugin } from "./src/channel.js";
import { handleDingTalkWebhookRequest } from "./src/monitor.js";
import { setDingTalkRuntime } from "./src/runtime.js";

const plugin = {
  id: "dingtalk",
  name: "DingTalk",
  description: "DingTalk channel plugin (Bot API)",
  configSchema: emptyPluginConfigSchema(),
  register(api: MoltbotPluginApi) {
    setDingTalkRuntime(api.runtime);
    api.registerChannel({ plugin: dingtalkPlugin, dock: dingtalkDock });
    api.registerHttpHandler(handleDingTalkWebhookRequest);
  },
};

export default plugin;
export * from "./src/auth.js";
export * from "./src/accounts.js";
export * from "./src/send.js";
export * from "./src/monitor.js";