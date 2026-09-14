const { spawnSync } = require("node:child_process");
const { mkdirSync } = require("node:fs");
const path = require("node:path");

if (process.platform === "darwin") {
  const arch = { arm64: "arm64", x64: "x86_64" }[process.arch];
  if (arch === undefined) throw new Error("Unsupported macOS build architecture.");
  const root = path.resolve(__dirname, "..");
  const output = path.join(root, "out/native");
  mkdirSync(output, { recursive: true });
  const result = spawnSync(
    "/usr/bin/clang",
    [
      "-std=c17",
      "-Wall",
      "-Wextra",
      "-Werror",
      "-O2",
      "-fstack-protector-strong",
      "-mmacosx-version-min=11.0",
      "-arch",
      arch,
      path.join(root, "tools/native/selector-acl.c"),
      "-o",
      path.join(output, "screenfling-selector-acl"),
    ],
    { stdio: "inherit", timeout: 30_000 },
  );
  if (result.status !== 0) process.exit(1);
}
