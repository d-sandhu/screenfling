const { spawnSync } = require("node:child_process");

let packageScript;
if (process.platform === "darwin") {
  packageScript = "package:mac";
} else if (process.platform === "win32") {
  packageScript = "package:win";
} else {
  throw new Error("Packaged checks currently require a Tier 1 macOS or Windows host.");
}

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const result = spawnSync(npmCommand, ["run", packageScript], { stdio: "inherit" });

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
