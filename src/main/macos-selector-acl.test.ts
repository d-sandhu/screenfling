import { execFile } from "node:child_process";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it, vi } from "vitest";

import { areMacSelectorAclsTrusted } from "./macos-selector-acl";

import type { BoundedProcessRequest } from "./bounded-process";

const PATH = "/synthetic/selector";
const RESPONSE = "screenfling-acl-v1:trusted\n";
const success = (output: string) => ({
  status: "success" as const,
  stdout: new TextEncoder().encode(output),
});
const execute = promisify(execFile);

describe("macOS selector ACL boundary", () => {
  it("uses the fixed local helper with bounded output, no input, and a clean environment", async () => {
    const run = vi.fn((_request: BoundedProcessRequest) => Promise.resolve(success(RESPONSE)));
    await expect(areMacSelectorAclsTrusted([PATH, PATH], run)).resolves.toBe(true);
    expect(run).toHaveBeenCalledExactlyOnceWith({
      executable: resolve("out/native/screenfling-selector-acl"),
      arguments: [PATH],
      environment: { LANG: "C", LC_ALL: "C", PATH: "/usr/bin:/bin" },
      input: null,
      maxOutputBytes: 256,
      timeoutMs: 1_000,
    });
  });

  it.each(["", "trusted", RESPONSE + RESPONSE, "screenfling-acl-v2:trusted\n"])(
    "rejects missing, malformed, or unsupported helper evidence (%#)",
    async (output) => {
      await expect(areMacSelectorAclsTrusted([PATH], async () => success(output))).resolves.toBe(
        false,
      );
    },
  );

  it.each(["exit", "spawn", "timeout", "output-limit", "input", "guard-rejected"] as const)(
    "fails closed when inspection reports %s",
    async (reason) => {
      await expect(
        areMacSelectorAclsTrusted([PATH], async () => ({ status: "failed", reason })),
      ).resolves.toBe(false);
    },
  );

  it.each([
    { paths: [] },
    { paths: ["relative"] },
    { paths: ["/line\nbreak"] },
    { paths: Array.from({ length: 257 }, () => PATH) },
  ])("rejects invalid or oversized path input before spawning (%#)", async ({ paths }) => {
    const run = vi.fn(async () => success(RESPONSE));
    await expect(areMacSelectorAclsTrusted(paths, run)).resolves.toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it("does not expose an inspection exception", async () => {
    await expect(
      areMacSelectorAclsTrusted([PATH], () => Promise.reject(new Error("synthetic-private-path"))),
    ).resolves.toBe(false);
  });
});

it.skipIf(process.platform !== "darwin")(
  "rejects an actual extended grant despite private Unix mode, and permits deny-only ACLs",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "screenfling-acl-"));
    const file = join(directory, "selector");
    try {
      await writeFile(file, "synthetic", { mode: 0o600 });
      await execute("/bin/chmod", ["-N", file]);
      expect(await areMacSelectorAclsTrusted([file])).toBe(true);
      await execute("/bin/chmod", ["+a", "everyone deny delete", file]);
      expect(await areMacSelectorAclsTrusted([file])).toBe(true);
      await execute("/bin/chmod", ["+a", "everyone allow write", file]);
      expect((await stat(file)).mode & 0o777).toBe(0o600);
      expect(await areMacSelectorAclsTrusted([file])).toBe(false);
      await execute("/bin/chmod", ["-N", file]);
      expect(await areMacSelectorAclsTrusted([file])).toBe(true);
      expect(await areMacSelectorAclsTrusted([join(directory, "missing")])).toBe(false);
    } finally {
      await execute("/bin/chmod", ["-N", file]).catch(() => undefined);
      await rm(directory, { recursive: true, force: true });
    }
  },
);

// CI-only: passwordless ownership changes apply solely to this disposable file.
// Never request elevation or change an operator's real selectors or settings.
it.skipIf(process.platform !== "darwin" || process.env.CI !== "true")(
  "rejects an ACL-read failure that ls silently reports without an ACL",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "screenfling-acl-read-failure-"));
    const file = join(directory, "selector");
    try {
      await writeFile(file, "synthetic", { mode: 0o600 });
      await execute("/bin/chmod", ["+a", "everyone deny readsecurity", file]);
      await execute("/usr/bin/sudo", ["-n", "/usr/sbin/chown", "0", file]);
      const listing = await execute("/bin/ls", ["-ldne", file]);
      expect(listing.stdout).not.toContain("deny readsecurity");
      expect(await areMacSelectorAclsTrusted([file])).toBe(false);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
