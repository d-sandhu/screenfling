import { contextBridge } from "electron";

import { BRIDGE_VERSION } from "../shared/bridge";

import type { ScreenFlingBridge } from "../shared/bridge";

const bridge: ScreenFlingBridge = Object.freeze({
  apiVersion: BRIDGE_VERSION,
});

contextBridge.exposeInMainWorld("screenFling", bridge);
