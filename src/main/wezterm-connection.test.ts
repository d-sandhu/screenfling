import { resolve } from "node:path";

import { expect, it } from "vitest";

import { SUPPORTED_WEZTERM_VERSION, WezTermAdapter } from "./wezterm-adapter";
import type { BoundedProcessRequest } from "./bounded-process";

it("diagnoses read-only connection failures without sending input or exposing output", async () => {
  const requests: BoundedProcessRequest[] = [];
  let version = `wezterm ${SUPPORTED_WEZTERM_VERSION}`;
  let list = JSON.stringify([{ pane_id: 7, window_id: 1, tab_id: 1, workspace: "default", cwd: null, title: "synthetic", size: { rows: 30, cols: 80 } }]);
  let binaryFailed = false;
  let selectorsRejected = false;
  const adapter = new WezTermAdapter({
    executable: resolve("synthetic/wezterm"),
    configFile: resolve("synthetic/config.lua"),
    socketPath: resolve("synthetic/mux"),
    imagePasteInput: Uint8Array.from([22]),
  }, {
    now: () => new Date(),
    readGeneration: async () => {
      if (selectorsRejected) throw new Error("synthetic-private-path");
      return "a".repeat(64);
    },
    runProcess: async (request) => {
      requests.push(request);
      if (binaryFailed) return { status: "failed", reason: "spawn" };
      return { status: "success", stdout: new TextEncoder().encode(request.arguments.includes("--version") ? version : list) };
    },
  });
  expect(await adapter.checkConnection()).toBe("ready");
  list = "[]";
  expect(await adapter.checkConnection()).toBe("no-panes");
  list = "unusable-private-response";
  expect(await adapter.checkConnection()).toBe("instance-unavailable");
  version = "unsupported-private-version";
  expect(await adapter.checkConnection()).toBe("unsupported-version");
  binaryFailed = true;
  expect(await adapter.checkConnection()).toBe("executable-unavailable");
  selectorsRejected = true;
  expect(await adapter.checkConnection()).toBe("selectors-rejected");
  expect(requests.every((request) => request.input === null)).toBe(true);
  expect(requests.every((request) => !request.arguments.includes("send-text") && !request.arguments.includes("activate-pane"))).toBe(true);
});
