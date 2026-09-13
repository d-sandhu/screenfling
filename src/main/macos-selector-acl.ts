import { isAbsolute, join, resolve } from "node:path";

import { runBoundedProcess } from "./bounded-process";

import type { BoundedProcessRunner } from "./bounded-process";

const TRUSTED_RESPONSE = "screenfling-acl-v1:trusted\n";
const PATH_CONTROL = /[\u0000-\u001f\u007f]/u;

function helperExecutable(): string {
  if (typeof process.resourcesPath === "string" && process.defaultApp !== true) {
    return join(process.resourcesPath, "screenfling-selector-acl");
  }
  return resolve("out/native/screenfling-selector-acl");
}

export async function areMacSelectorAclsTrusted(
  paths: readonly string[],
  run: BoundedProcessRunner = runBoundedProcess,
): Promise<boolean> {
  if (
    paths.length === 0 ||
    paths.length > 256 ||
    paths.some((path) => !isAbsolute(path) || path.length > 4096 || PATH_CONTROL.test(path))
  ) {
    return false;
  }
  try {
    const result = await run({
      executable: helperExecutable(),
      arguments: [...new Set(paths)].sort(),
      environment: { LANG: "C", LC_ALL: "C", PATH: "/usr/bin:/bin" },
      input: null,
      maxOutputBytes: 256,
      timeoutMs: 1_000,
    });
    return (
      result.status === "success" &&
      Buffer.from(result.stdout).equals(Buffer.from(TRUSTED_RESPONSE))
    );
  } catch {
    return false;
  }
}
