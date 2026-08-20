const { appendFileSync, closeSync, openSync, writeFileSync } = require("node:fs");

const [outputPath, readyPath] = process.argv.slice(2);

if (outputPath === undefined || readyPath === undefined) {
  process.exitCode = 2;
} else {
  closeSync(openSync(outputPath, "w", 0o600));
  process.stdout.write("\u001b]0;screenfling-gate-b\u0007");
  writeFileSync(readyPath, "ready", { mode: 0o600 });
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }
  process.stdin.on("data", (chunk) => appendFileSync(outputPath, chunk));
  process.stdin.resume();
}
