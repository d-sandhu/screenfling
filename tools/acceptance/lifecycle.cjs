const assert = require("node:assert/strict");
const { execFile, execFileSync, spawn } = require("node:child_process");
const { existsSync } = require("node:fs");
const { mkdir, mkdtemp, readFile, rm, stat, writeFile } = require("node:fs/promises");
const { promisify } = require("node:util");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

const { chromium } = require("playwright");
const { z } = require("zod");

const { readArtifactEvidence, readDiagnostics } = require("./capture.cjs");

// Exercise the actual packaged app, preload, and process lifecycle. No capture,
// clipboard write, permission change, or destination action is requested.
const children = [];
let profileScope = null;
const environment = { ...process.env };
for (const key of Object.keys(environment)) {
  if (key.startsWith("SCREENFLING_EXPERIMENTAL_WEZTERM_") || key === "ELECTRON_RENDERER_URL") {
    delete environment[key];
  }
}

// A relaunch is not a child of this runner. Cleanup matches only this run's
// unique profile and the exact tested application executable, never a user's app.
function stopProfileInstances() {
  if (profileScope === null) return;
  try {
    const listing = execFileSync("/bin/ps", ["-axo", "pid=,command="], {
      encoding: "utf8", timeout: 1_000, maxBuffer: 1024 * 1024,
    });
    for (const line of listing.split("\n")) {
      const match = /^\s*(\d+)\s+(.+)$/u.exec(line);
      if (match === null || !match[2].startsWith(`${profileScope.executable} `)) continue;
      const flag = `--user-data-dir=${profileScope.profile}`;
      if (!match[2].endsWith(flag) && !match[2].includes(`${flag} `)) continue;
      try { process.kill(Number(match[1]), "SIGKILL"); } catch { /* Already exited. */ }
    }
  } catch { /* Tracked children are still stopped by the normal cleanup. */ }
}
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

function launch(executable, arguments_ = [], options = {}) {
  const child = spawn(executable, arguments_, { stdio: "ignore", env: environment, ...options });
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
  const parsed = z.object({ port: z.number().int().min(1).max(65535) }).safeParse(address);
  if (!parsed.success) throw new Error("devtools-unavailable");
  return parsed.data.port;
}

async function connect(port, child) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (child !== undefined && exited(child)) throw new Error("application-exited");
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
  if (/^[a-f0-9]{40}$/u.test(process.env.GITHUB_SHA ?? "")) {
    await page.getByTitle(`Build ${process.env.GITHUB_SHA}`, { exact: true }).waitFor();
  }
  const boundary = await page.evaluate(async () => ({
    snapshot: await window.screenFling.getSnapshot(),
    requireAbsent: window.require === undefined,
    processAbsent: window.process === undefined,
    captureBridgeAbsent: window.captureOverlay === undefined,
  }));
  assert.equal(boundary.snapshot.phase, "idle");
  assert.equal(boundary.requireAbsent, true);
  assert.equal(boundary.processAbsent, true);
  assert.equal(boundary.captureBridgeAbsent, true);
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

async function mainPage(browser) {
  const context = browser.contexts()[0];
  assert.ok(context);
  await waitUntil(() => context.pages().length === 1, "main-window-unavailable");
  const page = context.pages()[0];
  await verifyIdle(page);
  return page;
}

async function restartFromSetup(browser, page, port) {
  const disconnected = new Promise((resolve) => browser.once("disconnected", resolve));
  await page.locator(".connection-setup").getByRole("button", { name: "Restart ScreenFling", exact: true }).click();
  let timer;
  try {
    await Promise.race([disconnected, new Promise((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("restart-timeout")), 10_000);
    })]);
  } finally { clearTimeout(timer); }
  const restarted = await connect(port);
  return { browser: restarted, page: await mainPage(restarted) };
}

async function verifySettingsLifecycle(browser, page, port, directory) {
  const cli = process.env.SCREENFLING_TEST_WEZTERM_EXECUTABLE;
  const server = process.env.SCREENFLING_TEST_WEZTERM_MUX_SERVER;
  if (cli === undefined || server === undefined) {
    if (process.env.CI === "true") throw new Error("missing-headless-fixture");
    return { browser, checked: false };
  }
  const socket = path.join(directory, "mux");
  const config = path.join(directory, "fixture.lua");
  const received = path.join(directory, "received");
  await writeFile(config,
    `return { automatically_reload_config = false, unix_domains = {{ name = "synthetic", socket_path = ${JSON.stringify(socket)} }} }`,
    { mode: 0o600 });
  const receiver = `const fs = require('node:fs'); process.stdin.setRawMode(true);
    process.stdin.on('data', bytes => fs.appendFileSync(process.argv[1], bytes));
    fs.writeFileSync(process.argv[1], '', { mode: 0o600 }); process.stdin.resume();`;
  launch(server, ["--config-file", config, "--", process.execPath, "-e", receiver, received], {
    cwd: directory,
    env: { HOME: directory, XDG_CONFIG_HOME: directory, XDG_DATA_HOME: directory,
      XDG_CACHE_HOME: directory, PATH: "/usr/bin:/bin", LANG: "en_US.UTF-8", WEZTERM_UNIX_SOCKET: socket },
  });
  await waitUntil(() => existsSync(received), "headless-fixture-unavailable");
  const configuration = { executable: cli, configFile: config, socketPath: socket, imageInputHex: "16" };
  const preference = path.join(profileScope.profile, "connections", "wezterm.json");
  const original = await readFile(preference, "utf8");
  checkpoint = "settings-check";
  const before = await page.evaluate(() => window.screenFling.getWezTermSetup());
  assert.equal(before.source, "invalid");
  assert.equal(before.activeConfiguration, null);
  assert.equal(await page.evaluate((value) => window.screenFling.checkWezTermSetup(value), configuration), "ready");
  assert.deepEqual(await page.evaluate(() => window.screenFling.getWezTermSetup()), before);
  assert.equal(await readFile(preference, "utf8"), original);

  checkpoint = "settings-open-form";
  await page.getByText("Connect WezTerm · optional", { exact: true }).click();
  for (const [key, value] of Object.entries(configuration)) {
    checkpoint = `settings-field-${key}`;
    await page.locator(`#connection-${key}`).fill(value);
  }
  checkpoint = "settings-confirm-binding";
  // Synthetic receiver, not an actual agent acceptance claim. Save checks no binding.
  await page.locator(".connection-confirm input").check();
  checkpoint = "settings-save-request";
  await page.getByRole("button", { name: "Save connection", exact: true }).click();
  checkpoint = "settings-save-settled";
  await waitUntil(() => page.evaluate(async () => (await window.screenFling.getWezTermSetup()).restartRequired), "settings-save-timeout");
  checkpoint = "settings-save-mode";
  assert.equal((await stat(preference)).mode & 0o777, 0o600);
  checkpoint = "settings-save-file";
  assert.deepEqual(JSON.parse(await readFile(preference, "utf8")).configuration, configuration);
  checkpoint = "settings-save-active";
  assert.equal((await page.evaluate(() => window.screenFling.getWezTermSetup())).activeConfiguration, null);

  checkpoint = "settings-restart";
  let next = await restartFromSetup(browser, page, port);
  assert.deepEqual((await next.page.evaluate(() => window.screenFling.getWezTermSetup())).activeConfiguration, configuration);
  assert.equal((await next.page.evaluate(() => window.screenFling.getWezTermSetup())).restartRequired, false);
  checkpoint = "settings-disconnect";
  await next.page.getByText("Connect WezTerm · optional", { exact: true }).click();
  await next.page.getByRole("button", { name: "Disconnect after restart", exact: true }).click();
  await waitUntil(() => next.page.evaluate(async () => (await window.screenFling.getWezTermSetup()).restartRequired), "settings-disconnect-timeout");
  assert.deepEqual((await next.page.evaluate(() => window.screenFling.getWezTermSetup())).activeConfiguration, configuration);
  checkpoint = "settings-disconnect-restart";
  next = await restartFromSetup(next.browser, next.page, port);
  const disconnected = await next.page.evaluate(() => window.screenFling.getWezTermSetup());
  assert.equal(disconnected.configuration, null);
  assert.equal(disconnected.activeConfiguration, null);
  assert.equal(disconnected.restartRequired, false);
  assert.equal(JSON.parse(await readFile(preference, "utf8")).configuration, null);
  assert.equal((await readFile(received)).length, 0);
  return { browser: next.browser, checked: true };
}

async function verifyUnresponsiveRecovery(browser, page) {
  const context = browser.contexts()[0];
  const session = await context.newCDPSession(page);
  // Deliberately hang this disposable idle renderer during close. The native
  // BrowserWindow unresponsive event must recover it; do not fake the event.
  await page.evaluate(() => {
    window.addEventListener("beforeunload", () => {
      for (;;) { /* Deliberate test-only renderer hang. */ }
    });
  });
  const replacementPromise = context.waitForEvent("page", { timeout: 15_000 });
  void session.send("Page.close").catch(() => undefined);
  const replacement = await replacementPromise;
  await verifyIdle(replacement);
  await waitUntil(() => page.isClosed(), "unresponsive-window-retained");
  assert.equal(context.pages().length, 1);
  return replacement;
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
  const directory = await mkdtemp(path.join(os.homedir(), "sf-life-"));
  const profile = path.join(directory, "profile");
  profileScope = { executable, profile };
  await mkdir(path.join(profile, "connections"), { recursive: true, mode: 0o700 });
  await writeFile(path.join(profile, "connections", "wezterm.json"), "invalid-synthetic-settings", { mode: 0o600 });
  const profileArguments = [`--user-data-dir=${profile}`];
  const port = await reservePort();
  const launchArguments = [
    ...profileArguments,
    "--remote-debugging-address=127.0.0.1",
    `--remote-debugging-port=${port}`,
  ];
  const child = launch(executable, launchArguments);
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
    const duplicate = launch(executable, profileArguments);
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
    const reopenRequest = launch(executable, profileArguments);
    const reopened = await reopenedPromise;
    await verifyIdle(reopened);
    await waitUntil(() => exited(reopenRequest), "duplicate-instance-not-rejected");
    assert.equal(reopenRequest.exitCode, 0);
    assert.equal(context.pages().length, 1);
    assert.deepEqual(await readDiagnostics(reopened), baseline);

    checkpoint = "unresponsive-renderer-recovery";
    // Recovery is bounded to one renderer replacement per app lifetime.
    await browser.close();
    await stop(child);
    await waitUntil(() => exited(child), "cleanup-timeout");
    const freshChild = launch(executable, launchArguments);
    browser = await connect(port, freshChild);
    const recovered = await verifyUnresponsiveRecovery(browser, await mainPage(browser));
    assert.equal(exited(freshChild), false);
    assert.deepEqual(await readDiagnostics(recovered), baseline);

    checkpoint = "packaged-settings-restart";
    const settings = await verifySettingsLifecycle(browser, recovered, port, directory);
    browser = settings.browser;
    assert.deepEqual(await readDiagnostics(await mainPage(browser)), baseline);

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
          unresponsiveRendererReplacedOnce: true,
          closedWindowReopened: true,
          workflowDiagnosticsUnchanged: true,
          isolatedSettingsSaveRestartReloadDisconnect: settings.checked,
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
    stopProfileInstances();
    await rm(directory, { recursive: true, force: true });
  }
}

const watchdog = setTimeout(() => {
  for (const child of children) if (!exited(child)) child.kill("SIGKILL");
  stopProfileInstances();
  process.stderr.write(
    '{"acceptance":"packaged-lifecycle","status":"failed","reason":"runner-timeout"}\n',
  );
  process.exit(1);
}, 60_000);

main()
  .catch((cause) => {
    const kind = cause instanceof Error && ["AssertionError", "TimeoutError", "TypeError", "Error"].includes(cause.name)
      ? cause.name : "unknown";
    const cspBlocked = cause instanceof Error && /Content Security Policy|unsafe-eval/iu.test(cause.message);
    process.stderr.write(
      `${JSON.stringify({ acceptance: "packaged-lifecycle", status: "failed", reason: checkpoint, kind, cspBlocked })}\n`,
    );
    process.exitCode = 1;
  })
  .finally(() => clearTimeout(watchdog));
