const assert = require("node:assert/strict");
const { execFile, spawn } = require("node:child_process");
const { existsSync } = require("node:fs");
const { mkdtemp, rm, writeFile } = require("node:fs/promises");
const { promisify } = require("node:util");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

const { chromium } = require("playwright");

const { readArtifactEvidence, readDiagnostics } = require("./capture.cjs");

// Exercise the actual packaged app, preload, and process lifecycle. No capture,
// clipboard write, permission change, or destination action is requested.
const children = [];
let checkpoint = "package-identity";
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const exited = (child) => child.exitCode !== null || child.signalCode !== null;

async function waitUntil(predicate, reason, timeoutMs = 15_000) {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    if (await predicate()) return;
    await delay(50);
  }
  throw new Error(reason);
}

function launch(executable, arguments_ = []) {
  const child = spawn(executable, arguments_, { stdio: "ignore" });
  child.on("error", () => undefined);
  children.push(child);
  if (child.pid === undefined) throw new Error("application-exited");
  return child;
}

async function stop(child) {
  if (exited(child)) return;
  child.kill("SIGTERM");
  try {
    await waitUntil(() => exited(child), "cleanup-timeout", 3_000);
  } catch {
    child.kill("SIGKILL");
  }
}

async function reservePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  await new Promise((resolve) => server.close(resolve));
  if (address === null || typeof address === "string") throw new Error("devtools-unavailable");
  return address.port;
}

async function connect(port, child) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (exited(child)) throw new Error("application-exited");
    try {
      return await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 500 });
    } catch {
      await delay(100);
    }
  }
  throw new Error("devtools-unavailable");
}

async function verifyIdle(page) {
  await page.getByRole("button", { name: "Capture region" }).waitFor({ timeout: 10_000 });
  assert.ok(page.url().startsWith("screenfling://"));
  const boundary = await page.evaluate(async () => ({
    snapshot: await window.screenFling.getSnapshot(),
    requireType: typeof window.require,
    processType: typeof window.process,
    captureBridgeType: typeof window.captureOverlay,
  }));
  assert.equal(boundary.snapshot.phase, "idle");
  assert.equal(boundary.requireType, "undefined");
  assert.equal(boundary.processType, "undefined");
  assert.equal(boundary.captureBridgeType, "undefined");
}

async function verifyPackagedAcl(executable) {
  const execute = promisify(execFile);
  const helper = path.resolve(path.dirname(executable), "../Resources/screenfling-selector-acl");
  const directory = await mkdtemp(path.join(os.tmpdir(), "sf-package-acl-"));
  const file = path.join(directory, "selector");
  const options = {
    timeout: 3_000,
    maxBuffer: 256,
    env: { LANG: "C", LC_ALL: "C", PATH: "/usr/bin:/bin" },
  };
  try {
    await writeFile(file, "synthetic", { mode: 0o600 });
    await execute("/bin/chmod", ["-N", file]);
    const accepted = await execute(helper, [file], options);
    assert.equal(accepted.stdout, "screenfling-acl-v1:trusted\n");
    assert.equal(accepted.stderr, "");
    await execute("/bin/chmod", ["+a", "everyone allow write", file]);
    await assert.rejects(
      execute(helper, [file], options),
      (error) => error.code === 1 && error.stdout === "" && error.stderr === "",
    );
  } finally {
    await execute("/bin/chmod", ["-N", file]).catch(() => undefined);
    await rm(directory, { recursive: true, force: true });
  }
}

async function main() {
  if (process.platform !== "darwin") throw new Error("unsupported-platform");
  const executable = [
    path.resolve("release/mac-arm64/ScreenFling.app/Contents/MacOS/ScreenFling"),
    path.resolve("release/mac/ScreenFling.app/Contents/MacOS/ScreenFling"),
  ].find((candidate) => existsSync(candidate));
  if (executable === undefined) throw new Error("package-not-found");
  const artifact = await readArtifactEvidence(executable);
  checkpoint = "packaged-acl";
  await verifyPackagedAcl(executable);
  checkpoint = "application-startup";
  const port = await reservePort();
  const child = launch(executable, [
    "--remote-debugging-address=127.0.0.1",
    `--remote-debugging-port=${port}`,
  ]);
  let browser;
  try {
    browser = await connect(port, child);
    const context = browser.contexts()[0];
    assert.ok(context);
    await waitUntil(() => context.pages().length === 1, "main-window-unavailable");
    const initial = context.pages()[0];
    await verifyIdle(initial);
    const baseline = await readDiagnostics(initial);

    checkpoint = "single-instance";
    const duplicate = launch(executable);
    await waitUntil(() => exited(duplicate), "duplicate-instance-not-rejected");
    assert.equal(duplicate.exitCode, 0);
    assert.equal(exited(child), false);
    assert.equal(context.pages().length, 1);
    await verifyIdle(initial);

    checkpoint = "renderer-recovery";
    const replacementPromise = context.waitForEvent("page", { timeout: 10_000 });
    const session = await context.newCDPSession(initial);
    // Crashing the page normally rejects this CDP request; replacement is the evidence.
    void session.send("Page.crash").catch(() => undefined);
    const replacement = await replacementPromise;
    await verifyIdle(replacement);
    await waitUntil(() => initial.isClosed(), "crashed-window-retained");
    assert.equal(context.pages().length, 1);
    assert.deepEqual(await readDiagnostics(replacement), baseline);

    checkpoint = "closed-window-reopen";
    await replacement.close();
    assert.equal(exited(child), false);
    const reopenedPromise = context.waitForEvent("page", { timeout: 10_000 });
    const reopenRequest = launch(executable);
    const reopened = await reopenedPromise;
    await verifyIdle(reopened);
    await waitUntil(() => exited(reopenRequest), "duplicate-instance-not-rejected");
    assert.equal(reopenRequest.exitCode, 0);
    assert.equal(context.pages().length, 1);
    assert.deepEqual(await readDiagnostics(reopened), baseline);

    process.stdout.write(
      `${JSON.stringify({
        acceptance: "packaged-lifecycle",
        status: "passed",
        host: { platform: os.platform(), arch: os.arch(), osRelease: os.release() },
        application: artifact,
        checks: {
          packagedAclGate: true,
          startupAndHardenedBridge: true,
          duplicateLaunchRejected: true,
          crashedRendererReplacedOnce: true,
          closedWindowReopened: true,
          workflowDiagnosticsUnchanged: true,
        },
        screenCaptureObserved: false,
        physicalInteractionObserved: false,
        limitations: [
          "Only idle renderer recovery is exercised in the packaged app.",
          "No Screen Recording change, screen capture, clipboard, or agent action is tested.",
          "No physical shortcut, focus, signing-trust, or notarization acceptance is inferred.",
        ],
      })}\n`,
    );
  } finally {
    await browser?.close().catch(() => undefined);
    for (const process_ of children) await stop(process_);
  }
}

const watchdog = setTimeout(() => {
  for (const child of children) if (!exited(child)) child.kill("SIGKILL");
  process.stderr.write(
    '{"acceptance":"packaged-lifecycle","status":"failed","reason":"runner-timeout"}\n',
  );
  process.exit(1);
}, 60_000);

main()
  .catch(() => {
    process.stderr.write(
      `${JSON.stringify({ acceptance: "packaged-lifecycle", status: "failed", reason: checkpoint })}\n`,
    );
    process.exitCode = 1;
  })
  .finally(() => clearTimeout(watchdog));
