import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { boundedPreferenceRead, PREFERENCE_READ_TIMEOUT_MS, readPreferenceText } from "./preference-files";
import { NodeShortcutPreferenceFiles, ShortcutPreferenceStore } from "./shortcut-preference-store";
import { WezTermSetup } from "./wezterm-setup";

let directory: string;
const configuration = { executable: "/synthetic/wezterm", configFile: "/synthetic/config", socketPath: "/synthetic/mux", imageInputHex: "16" };
const execute = promisify(execFile);

beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), "sf-prefs-")); });
afterEach(async () => { vi.useRealTimers(); await rm(directory, { recursive: true, force: true }); });

it("bounds shortcut reads and refuses non-files before parsing", async () => {
  const file = join(directory, "shortcut.json");
  const files = new NodeShortcutPreferenceFiles();
  expect(await files.readText(file)).toBeNull();
  await writeFile(file, "x".repeat(4_097));
  await expect(files.readText(file)).rejects.toThrow();
  await expect(files.readText(directory)).rejects.toThrow();
});

it.skipIf(process.platform === "win32")("rejects a symlink and preserves a normal shortcut preference", async () => {
  const file = join(directory, "shortcut.json");
  const store = new ShortcutPreferenceStore(file, new NodeShortcutPreferenceFiles(), () => "fixture");
  await store.save({ key: "J", modifiers: "CommandOrControl+Alt" });
  expect((await store.load()).kind).toBe("loaded");
  const link = join(directory, "link");
  await symlink(file, link);
  await expect(readPreferenceText(link, 4_096, "regular")).rejects.toThrow();
});

it("abandons a stalled read without applying its late value or leaking timers", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  let complete: (value: string) => void = () => undefined;
  const applied = vi.fn();
  const result = boundedPreferenceRead(() => new Promise<string>((resolve) => { complete = resolve; })).then(applied);
  const rejected = expect(result).rejects.toThrow("timed out");
  await vi.advanceTimersByTimeAsync(PREFERENCE_READ_TIMEOUT_MS);
  await rejected;
  complete("late saved destination");
  await vi.runAllTimersAsync();
  expect(applied).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it.skipIf(process.platform === "win32")("refuses unsafe connection parents without changing the saved file or permissions", async () => {
  const parent = join(directory, "connections");
  await mkdir(parent, { mode: 0o700 });
  const file = join(parent, "wezterm.json");
  const original = JSON.stringify({ version: 1, configuration });
  await writeFile(file, original, { mode: 0o600 });
  await chmod(parent, 0o777);
  const setup = new WezTermSetup(file, "darwin", () => true, vi.fn(), async () => "ready");
  expect(await setup.initialize({})).toEqual({});
  expect(setup.getSnapshot().source).toBe("invalid");
  expect(await setup.save(configuration)).toBe("failed");
  expect(await readFile(file, "utf8")).toBe(original);
  await chmod(parent, 0o700);
  expect(await setup.save(configuration)).toBe("saved");
});

it.skipIf(process.platform !== "darwin")("rejects real macOS file and parent ACL grants before activating a connection", async () => {
  const parent = join(directory, "connections");
  await mkdir(parent, { mode: 0o700 });
  const file = join(parent, "wezterm.json");
  await writeFile(file, JSON.stringify({ version: 1, configuration }), { mode: 0o600 });
  const load = () => new WezTermSetup(file, "darwin", () => true, vi.fn());
  try {
    expect((await load().initialize({})).SCREENFLING_EXPERIMENTAL_WEZTERM_SOCKET).toBe(configuration.socketPath);
    await execute("/bin/chmod", ["+a", "everyone allow read", file]);
    expect(await load().initialize({})).toEqual({});
    await execute("/bin/chmod", ["-N", file]);
    await execute("/bin/chmod", ["+a", "everyone allow write", parent]);
    expect(await load().initialize({})).toEqual({});
    expect(await load().save(null)).toBe("failed");
  } finally {
    await execute("/bin/chmod", ["-N", file]);
    await execute("/bin/chmod", ["-N", parent]);
  }
  expect((await load().initialize({})).SCREENFLING_EXPERIMENTAL_WEZTERM_SOCKET).toBe(configuration.socketPath);
});
