import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { DEFAULT_SHORTCUT_CONFIGURATION } from "../shared/shortcut";
import { NodeShortcutPreferenceFiles, ShortcutPreferenceStore } from "./shortcut-preference-store";

import type { ShortcutPreferenceFiles } from "./shortcut-preference-store";

class MemoryFiles implements ShortcutPreferenceFiles {
  readonly calls: string[] = [];
  readonly contents = new Map<string, string>();
  failWrite = false;

  async makeDirectory(path: string): Promise<void> {
    this.calls.push(`mkdir:${path}`);
  }

  async move(source: string, destination: string): Promise<void> {
    this.calls.push(`move:${source}:${destination}`);
    const contents = this.contents.get(source);
    if (contents === undefined) throw new Error("missing source");
    this.contents.set(destination, contents);
    this.contents.delete(source);
  }

  async readText(path: string): Promise<string | null> {
    this.calls.push(`read:${path}`);
    return this.contents.get(path) ?? null;
  }

  async remove(path: string): Promise<void> {
    this.calls.push(`remove:${path}`);
    this.contents.delete(path);
  }

  async writePrivateText(path: string, contents: string): Promise<void> {
    this.calls.push(`write:${path}`);
    if (this.failWrite) throw new Error("write failed");
    this.contents.set(path, contents);
  }
}

describe("shortcut preference store", () => {
  it("distinguishes a missing preference from invalid persisted data", async () => {
    const files = new MemoryFiles();
    const store = new ShortcutPreferenceStore("/profile/shortcut.json", files, () => "test-token");

    await expect(store.load()).resolves.toEqual({ kind: "missing" });
    files.contents.set("/profile/shortcut.json", '{"version":2}');
    await expect(store.load()).resolves.toEqual({ kind: "invalid" });
  });

  it("loads one strict versioned configuration", async () => {
    const files = new MemoryFiles();
    files.contents.set(
      "/profile/shortcut.json",
      JSON.stringify({ configuration: DEFAULT_SHORTCUT_CONFIGURATION, version: 1 }),
    );
    const store = new ShortcutPreferenceStore("/profile/shortcut.json", files, () => "test-token");

    await expect(store.load()).resolves.toEqual({
      configuration: DEFAULT_SHORTCUT_CONFIGURATION,
      kind: "loaded",
    });
  });

  it("writes a private temporary sibling before replacing the preference", async () => {
    const files = new MemoryFiles();
    const store = new ShortcutPreferenceStore("/profile/shortcut.json", files, () => "test-token");

    await store.save(DEFAULT_SHORTCUT_CONFIGURATION);

    expect(files.calls).toEqual([
      "mkdir:/profile",
      "write:/profile/shortcut.json.test-token.tmp",
      "move:/profile/shortcut.json.test-token.tmp:/profile/shortcut.json",
    ]);
    expect(JSON.parse(files.contents.get("/profile/shortcut.json") ?? "")).toEqual({
      configuration: DEFAULT_SHORTCUT_CONFIGURATION,
      version: 1,
    });
  });

  it("removes its exact temporary file when replacement fails", async () => {
    const files = new MemoryFiles();
    files.failWrite = true;
    const store = new ShortcutPreferenceStore("/profile/shortcut.json", files, () => "test-token");

    await expect(store.save(DEFAULT_SHORTCUT_CONFIGURATION)).rejects.toThrow("write failed");
    expect(files.calls).toEqual([
      "mkdir:/profile",
      "write:/profile/shortcut.json.test-token.tmp",
      "remove:/profile/shortcut.json.test-token.tmp",
    ]);
  });

  it("round-trips through the production Node filesystem adapter", async () => {
    const directory = await mkdtemp(join(tmpdir(), "screenfling-shortcut-"));
    try {
      const store = new ShortcutPreferenceStore(
        join(directory, "shortcut.json"),
        new NodeShortcutPreferenceFiles(),
        () => "integration-token",
      );

      await store.save({ key: "J", modifiers: "CommandOrControl+Alt" });
      await store.save({ key: "K", modifiers: "CommandOrControl+Alt+Shift" });

      await expect(store.load()).resolves.toEqual({
        configuration: { key: "K", modifiers: "CommandOrControl+Alt+Shift" },
        kind: "loaded",
      });
      await expect(readdir(directory)).resolves.toEqual(["shortcut.json"]);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});
