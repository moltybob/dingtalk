import type { PluginRuntime } from "openclaw/plugin-sdk";

let runtime: any = null;

export function setDingTalkRuntime(rt: PluginRuntime) {
  runtime = rt;
}

export function getDingTalkRuntime(): PluginRuntime {
  if (!runtime) {
    throw new Error("DingTalk runtime not initialized. Make sure to call setDingTalkRuntime first.");
  }
  return runtime;
}

export { runtime as dingTalkRuntime };