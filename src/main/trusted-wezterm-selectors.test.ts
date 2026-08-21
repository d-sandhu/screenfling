import { chmod, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  UntrustedWezTermSelectorError,
  readTrustedWezTermSelectorEvidence,
} from "./trusted-wezterm-selectors";

type SelectorPaths = {
  readonly executable: string;
  readonly configFile: string;
  readonly socketPath: string;
};

async function withSelectorFixture(
  action: (selectors: SelectorPaths, root: string) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "screenfling-wezterm-selectors-"));
  const selectors = {
    executable: join(root, "wezterm"),
    configFile: join(root, "wezterm.lua"),
    socketPath: join(root, "wezterm.sock"),
  };
  const server = createServer();

  try {
    await Promise.all([
      writeFile(selectors.executable, "executable fixture"),
      writeFile(selectors.configFile, "return {}"),
    ]);
    await Promise.all([chmod(selectors.executable, 0o700), chmod(selectors.configFile, 0o600)]);
    await new Promise<void>((resolveListen, rejectListen) => {
      server.once("error", rejectListen);
      server.listen(selectors.socketPath, resolveListen);
    });
    await chmod(selectors.socketPath, 0o600);
    await action(selectors, root);
  } finally {
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    await rm(root, { force: true, recursive: true });
  }
}

describe.skipIf(process.platform !== "darwin")("trusted WezTerm selectors", () => {
  it("rejects a regular file masquerading as the configured mux socket", async () => {
    const root = await mkdtemp(join(tmpdir(), "screenfling-wezterm-selectors-"));
    const selectors = {
      executable: join(root, "wezterm"),
      configFile: join(root, "wezterm.lua"),
      socketPath: join(root, "wezterm.sock"),
    };

    try {
      await Promise.all([
        writeFile(selectors.executable, "executable fixture"),
        writeFile(selectors.configFile, "return {}"),
        writeFile(selectors.socketPath, "not a socket"),
      ]);
      await chmod(selectors.executable, 0o700);

      await expect(readTrustedWezTermSelectorEvidence(selectors)).rejects.toBeInstanceOf(
        UntrustedWezTermSelectorError,
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("returns opaque evidence for current-user selectors in a private tree", async () => {
    await withSelectorFixture(async (selectors) => {
      const evidence = await readTrustedWezTermSelectorEvidence(selectors);

      expect(evidence).toHaveLength(3);
      expect(evidence.every((item) => item.length > 0)).toBe(true);
    });
  });

  it("rejects a selector leaf writable by the group", async () => {
    await withSelectorFixture(async (selectors) => {
      await chmod(selectors.configFile, 0o620);

      await expect(readTrustedWezTermSelectorEvidence(selectors)).rejects.toBeInstanceOf(
        UntrustedWezTermSelectorError,
      );
    });
  });

  it("rejects selectors beneath a group-writable ancestor", async () => {
    await withSelectorFixture(async (selectors, root) => {
      await chmod(root, 0o720);

      await expect(readTrustedWezTermSelectorEvidence(selectors)).rejects.toBeInstanceOf(
        UntrustedWezTermSelectorError,
      );
    });
  });

  it("rejects a writable ancestor hidden by a lexical symlink", async () => {
    await withSelectorFixture(async (_selectors, root) => {
      const lexicalRoot = await mkdtemp(join(tmpdir(), "screenfling-wezterm-link-"));
      const link = join(lexicalRoot, "trusted-target");
      try {
        await symlink(root, link);
        await chmod(lexicalRoot, 0o720);
        const linkedSelectors = {
          executable: join(link, "wezterm"),
          configFile: join(link, "wezterm.lua"),
          socketPath: join(link, "wezterm.sock"),
        };

        await expect(readTrustedWezTermSelectorEvidence(linkedSelectors)).rejects.toBeInstanceOf(
          UntrustedWezTermSelectorError,
        );
      } finally {
        await rm(lexicalRoot, { force: true, recursive: true });
      }
    });
  });

  it("rejects selectors not owned by the expected user", async () => {
    const getuid = process.getuid;
    if (getuid === undefined) throw new Error("Expected a Unix user identity.");

    await withSelectorFixture(async (selectors) => {
      await expect(
        readTrustedWezTermSelectorEvidence(selectors, BigInt(getuid()) + 1n),
      ).rejects.toBeInstanceOf(UntrustedWezTermSelectorError);
    });
  });

  it("rejects a socket whose parent directory is not private", async () => {
    await withSelectorFixture(async (selectors, root) => {
      await chmod(root, 0o750);

      await expect(readTrustedWezTermSelectorEvidence(selectors)).rejects.toBeInstanceOf(
        UntrustedWezTermSelectorError,
      );
    });
  });

  it("rejects an executable selector without execute access", async () => {
    await withSelectorFixture(async (selectors) => {
      await chmod(selectors.executable, 0o600);

      await expect(readTrustedWezTermSelectorEvidence(selectors)).rejects.toBeInstanceOf(
        UntrustedWezTermSelectorError,
      );
    });
  });

  it("rejects a config selector without read access", async () => {
    await withSelectorFixture(async (selectors) => {
      await chmod(selectors.configFile, 0o000);

      await expect(readTrustedWezTermSelectorEvidence(selectors)).rejects.toBeInstanceOf(
        UntrustedWezTermSelectorError,
      );
    });
  });
});
