import { execFile } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { readTrustedWezTermSelectorEvidence } from "./trusted-wezterm-selectors";

const execute = promisify(execFile);

describe.skipIf(process.platform !== "darwin")("native ACL checks in selector discovery", () => {
  it.each(["executable", "configFile", "socketPath", "ancestor"] as const)(
    "rejects an extended grant on the %s without changing selector mode bits",
    async (field) => {
      const root = await mkdtemp(join(tmpdir(), "sf-acl-"));
      const selectors = {
        executable: join(root, "executable"),
        configFile: join(root, "config"),
        socketPath: join(root, "mux.sock"),
      };
      const server = createServer();
      const subject = field === "ancestor" ? root : selectors[field];
      try {
        await writeFile(selectors.executable, "synthetic", { mode: 0o700 });
        await writeFile(selectors.configFile, "synthetic", { mode: 0o600 });
        await new Promise<void>((resolveListen, rejectListen) => {
          server.once("error", rejectListen);
          server.listen(selectors.socketPath, resolveListen);
        });
        await chmod(selectors.socketPath, 0o600);
        const original = await readTrustedWezTermSelectorEvidence(selectors);
        await writeFile(join(root, "unrelated"), "synthetic");
        expect(await readTrustedWezTermSelectorEvidence(selectors)).toEqual(original);
        await execute("/bin/chmod", ["+a", "everyone allow write", subject]);
        await expect(readTrustedWezTermSelectorEvidence(selectors)).rejects.toMatchObject({
          message: "The configured WezTerm selector is not trusted.",
        });
      } finally {
        await execute("/bin/chmod", ["-N", subject]).catch(() => undefined);
        await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
        await rm(root, { recursive: true, force: true });
      }
    },
  );
});
