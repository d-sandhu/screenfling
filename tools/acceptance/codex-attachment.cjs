const assert = require("node:assert/strict");
const { execFile, spawn } = require("node:child_process");
const { createHash } = require("node:crypto");
const { existsSync } = require("node:fs");
const { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } = require("node:fs/promises");
const net = require("node:net");
const { homedir } = require("node:os");
const path = require("node:path");
const { promisify } = require("node:util");

const { chromium } = require("playwright");
const { z } = require("zod");
const portAddress = z.object({ port: z.number().int().min(1).max(65535) });
const { allowExpectedPageClose, readArtifactEvidence, readDiagnostics, startCapture } = require("./capture.cjs");

// Hosted acceptance only. Real native capture and a real pinned Codex composer;
// no credentials, inference, Enter, application test hooks or published content.
const VERSION = "0.154.0";
const ARCHIVE = `https://github.com/openai/codex/releases/download/rust-v${VERSION}/codex-aarch64-apple-darwin.tar.gz`;
const SHA256 = "344310a0a591c1b192e04feff304321a69907c9498baaac331ca7e16ebcef9d7";
const NETWORK_DENIED = "(version 1) (allow default) (deny network*)";
const execute = promisify(execFile);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const children = [];
let checkpoint = "host";
let completed = 0;
const startup = { modelVisible: false, authPrompt: false, attachmentRejected: false,
  textLength: 0, messages: [] };
const STARTUP_MESSAGES = [
  "Welcome to", "Do you trust", "trust this", "Press Enter", "Continue", "Connecting",
  "Error", "error", "Operation not permitted", "Permission denied", "config.toml", "TOML",
  "unknown variant", "invalid value", "Failed", "failed", "cursor", "terminal",
  "app-server", "sandbox", "network", "Sign in", "directory:", "model:", "codex-cli",
  "Codex", "upgrade", "Introducing", "model", "trust", "enter", "panicked",
  "closed", "unknown", "loading", "Press", "Select", "continue", "access", "read",
  "write", "fatal", "directory", "provider", "permission", "welcome", "theme",
  "help", "initializing", "Tips", "Try", "key", "auth", "Use existing", "GPT",
];

async function waitUntil(predicate, timeoutMs = 20_000) {
  const expires = performance.now() + timeoutMs;
  while (performance.now() < expires) {
    if (await predicate()) return;
    await delay(100);
  }
  throw new Error("acceptance-timeout");
}

function launch(executable, args, env) {
  const child = spawn(executable, args, { stdio: "ignore", env });
  child.on("error", () => undefined);
  children.push(child);
  if (child.pid === undefined) throw new Error("process-unavailable");
  return child;
}

async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  try { await waitUntil(() => child.exitCode !== null || child.signalCode !== null, 3_000); }
  catch { child.kill("SIGKILL"); }
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = portAddress.parse(server.address());
  await new Promise((resolve) => server.close(resolve));
  return address.port;
}

async function prepareCodex(directory, env) {
  checkpoint = "pinned-agent-download";
  const response = await fetch(ARCHIVE, { signal: AbortSignal.timeout(60_000) });
  assert.equal(response.ok, true);
  const bytes = Buffer.from(await response.arrayBuffer());
  checkpoint = "pinned-agent-integrity";
  assert.equal(bytes.length, 88_080_735);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), SHA256);
  const archive = path.join(directory, "codex.tar.gz");
  await writeFile(archive, bytes, { mode: 0o600 });
  checkpoint = "pinned-agent-extraction";
  await execute("/usr/bin/tar", ["-xzf", archive, "-C", directory], { timeout: 15_000 });
  const executable = path.join(directory, "codex-aarch64-apple-darwin");
  await chmod(executable, 0o700);
  checkpoint = "pinned-agent-version";
  const version = await execute("/usr/bin/sandbox-exec", ["-p", NETWORK_DENIED, executable, "--version"], { env, timeout: 10_000 });
  assert.equal(version.stdout.trim(), `codex-cli ${VERSION}`);
  return executable;
}

async function verifyNetworkDenied(env) {
  checkpoint = "agent-network-denial";
  let connections = 0;
  const server = net.createServer((socket) => { connections += 1; socket.destroy(); });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const port = portAddress.parse(server.address()).port;
    const probe = `const s = require('node:net').connect(${port}, '127.0.0.1');
      s.on('connect', () => process.exit(1));
      s.on('error', e => process.exit(['EPERM','EACCES'].includes(e.code) ? 0 : 2));`;
    await execute("/usr/bin/sandbox-exec", ["-p", NETWORK_DENIED, process.execPath, "-e", probe], { env, timeout: 5_000 });
    assert.equal(connections, 0);
  } finally { await new Promise((resolve) => server.close(resolve)); }
}

async function images(directory) {
  return (await readdir(directory)).filter((name) => /^codex-clipboard-.*\.png$/u.test(name)).sort();
}

async function assertNoSubmissions(home) {
  const sessions = path.join(home, "sessions");
  if (!existsSync(sessions)) return;
  for (const name of await readdir(sessions, { recursive: true })) {
    if (!name.endsWith(".jsonl")) continue;
    const bytes = await readFile(path.join(sessions, name));
    assert.ok(bytes.length < 8 * 1024 * 1024);
    for (const line of bytes.toString("utf8").split("\n").filter(Boolean)) {
      const record = JSON.parse(line);
      assert.equal(record.type === "event_msg" && record.payload?.type === "user_message", false);
    }
  }
}

async function main() {
  assert.equal(process.platform, "darwin");
  assert.equal(process.arch, "arm64");
  assert.equal(process.env.CI, "true");
  const cli = process.env.SCREENFLING_TEST_WEZTERM_EXECUTABLE;
  const mux = process.env.SCREENFLING_TEST_WEZTERM_MUX_SERVER;
  assert.ok(cli && mux);
  const app = path.resolve("release/mac-arm64/ScreenFling.app/Contents/MacOS/ScreenFling");
  const artifact = await readArtifactEvidence(app);
  const directory = await mkdtemp(path.join(homedir(), "sf-agent-"));
  const env = { HOME: directory, TMPDIR: directory, PATH: "/usr/bin:/bin", LANG: "en_US.UTF-8", TERM: "xterm-256color" };
  const socket = path.join(directory, "mux");
  const config = path.join(directory, "wezterm.lua");
  const agents = [];
  let parentPane;
  let browser;
  const cliRun = async (args) => execute(cli, ["--config-file", config, "cli", "--no-auto-start", ...args], {
    env: { ...env, WEZTERM_UNIX_SOCKET: socket }, timeout: 5_000, maxBuffer: 1024 * 1024,
  });
  const paneText = async (id) => (await cliRun(["get-text", "--pane-id", id])).stdout;
  try {
    await verifyNetworkDenied(env);
    const codex = await prepareCodex(directory, env);
    checkpoint = "headless-mux-startup";
    await writeFile(config, `return { automatically_reload_config = false, unix_domains = {{ name = "synthetic", socket_path = ${JSON.stringify(socket)} }} }`, { mode: 0o600 });
    launch(mux, ["--config-file", config, "--", "/bin/cat"], { ...env, WEZTERM_UNIX_SOCKET: socket });
    await waitUntil(() => existsSync(socket));
    await waitUntil(async () => {
      const panes = z.array(z.object({ pane_id: z.number().int().nonnegative().safe() }))
        .parse(JSON.parse((await cliRun(["list", "--format", "json"])).stdout));
      if (panes.length === 0) return false;
      assert.equal(panes.length, 1);
      parentPane = String(panes[0].pane_id);
      return true;
    });
    for (let index = 0; index < 2; index += 1) {
      checkpoint = `agent-${index}-startup`;
      const home = path.join(directory, `agent-${index}`);
      const temp = path.join(home, "tmp");
      await mkdir(temp, { recursive: true, mode: 0o700 });
      await writeFile(path.join(home, "config.toml"), `model = "gpt-5.4"
model_provider = "screenfling-offline"
approval_policy = "never"
sandbox_mode = "read-only"
check_for_update_on_startup = false
cli_auth_credentials_store = "ephemeral"
project_doc_max_bytes = 0
[analytics]
enabled = false
[feedback]
enabled = false
[history]
persistence = "none"
[model_providers.screenfling-offline]
name = "Offline acceptance only"
base_url = "http://127.0.0.1:1/v1"
requires_openai_auth = false
wire_api = "responses"
[projects.${JSON.stringify(home)}]
trust_level = "trusted"
`, { mode: 0o600 });
      checkpoint = `agent-${index}-spawn`;
      const spawned = await cliRun(["spawn", "--pane-id", parentPane, "--cwd", home, "--", "/usr/bin/env", "-i",
        `HOME=${home}`, `CODEX_HOME=${home}`, `TMPDIR=${temp}`, "PATH=/usr/bin:/bin", "LANG=en_US.UTF-8", "TERM=xterm-256color",
        "/usr/bin/sandbox-exec", "-p", NETWORK_DENIED, codex, "--no-alt-screen"]);
      const id = spawned.stdout.trim();
      assert.match(id, /^\d+$/u);
      agents.push({ id, home, temp, count: 0 });
      let declinedUpgrade = false;
      checkpoint = `agent-${index}-composer`;
      await waitUntil(async () => {
        const text = await paneText(id);
        startup.textLength = text.trim().length;
        startup.messages = STARTUP_MESSAGES.filter((message) => text.toLowerCase().includes(message.toLowerCase()));
        startup.modelVisible = text.includes("gpt-5.4");
        startup.authPrompt = /Sign in with|Add your API key/u.test(text);
        const prompt = text.replace(/\s+/gu, " ").toLowerCase();
        if (!declinedUpgrade && prompt.includes("try new model") && prompt.includes("use existing model")) {
          // Pinned Codex's migration menu handles digit 2 as reject, without Enter.
          // This is setup of our disposable empty composer, never product delivery.
          declinedUpgrade = true;
          await cliRun(["send-text", "--no-paste", "--pane-id", id, "2"]);
          return false;
        }
        return startup.modelVisible && text.includes("directory:");
      });
      await assertNoSubmissions(home);
    }
    checkpoint = "application-startup";
    const port = await freePort();
    launch(app, ["--remote-debugging-address=127.0.0.1", `--remote-debugging-port=${port}`, `--user-data-dir=${path.join(directory, "profile")}`], {
      ...env,
      SCREENFLING_EXPERIMENTAL_WEZTERM_EXECUTABLE: cli,
      SCREENFLING_EXPERIMENTAL_WEZTERM_CONFIG_FILE: config,
      SCREENFLING_EXPERIMENTAL_WEZTERM_SOCKET: socket,
      SCREENFLING_EXPERIMENTAL_WEZTERM_IMAGE_INPUT_HEX: "16",
    });
    await waitUntil(async () => {
      try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 500 }); return true; }
      catch { return false; }
    });
    const context = browser.contexts()[0];
    await waitUntil(() => context.pages().length === 1);
    const page = context.pages()[0];
    page.setDefaultTimeout(10_000);
    await page.getByRole("button", { name: "Capture region", exact: true }).waitFor();
    assert.equal((await page.evaluate(() => window.screenFling.getScreenCaptureReadiness())).status, "granted");
    for (let trial = 0; trial < 30; trial += 1) {
      const agent = agents[trial % 2];
      const other = agents[(trial + 1) % 2];
      checkpoint = "capture-review";
      const { overlay, operationId } = await startCapture(page, context);
      const viewport = await overlay.evaluate(() => ({ width: innerWidth, height: innerHeight }));
      await overlay.mouse.move(viewport.width / 4, viewport.height / 4);
      await overlay.mouse.down();
      await overlay.mouse.move(viewport.width * 3 / 4, viewport.height * 3 / 4);
      await allowExpectedPageClose(overlay, () => overlay.mouse.up());
      await page.getByRole("heading", { name: "Ready to hand off", exact: true }).waitFor();
      const pixels = await page.evaluate(async (id) => (await window.screenFling.getCaptureDraft({ operationId: id })).pixels, operationId);
      checkpoint = "exact-agent-discovery";
      const target = page.locator(`input[type="radio"][value$=":${agent.id}"]`);
      await target.waitFor({ state: "visible" });
      assert.equal(await target.count(), 1);
      assert.equal(await target.isChecked(), false);
      await target.check();
      const targetId = await target.inputValue();
      const note = `SF${String(trial).padStart(2, "0")} `;
      await page.getByPlaceholder("What should the agent notice?").fill(note);
      const previous = await images(agent.temp);
      assert.equal(previous.length, agent.count);
      checkpoint = "actual-agent-attachment";
      await page.getByRole("button", { name: "Stage, don’t send", exact: true }).click();
      await page.getByRole("heading", { name: "Staged — unverified", exact: true }).waitFor();
      agent.count += 1;
      await waitUntil(async () => {
        const text = await paneText(agent.id);
        startup.attachmentRejected = /Failed to paste image|does not support image/u.test(text);
        return text.includes(`[Image #${agent.count}]`) && text.includes(note.trim());
      });
      const current = await images(agent.temp);
      assert.equal(current.length, agent.count);
      const added = current.filter((name) => !previous.includes(name));
      assert.equal(added.length, 1);
      const png = await readFile(path.join(agent.temp, added[0]));
      assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
      assert.equal(png.readUInt32BE(16), pixels.width);
      assert.equal(png.readUInt32BE(20), pixels.height);
      assert.equal((await images(other.temp)).length, other.count);
      assert.equal((await paneText(other.id)).includes(note.trim()), false);
      const snapshot = await page.evaluate(() => window.screenFling.getSnapshot());
      assert.equal(snapshot.result.destination.id, targetId);
      await assertNoSubmissions(agent.home);
      await page.getByRole("button", { name: "Done", exact: true }).click();
      await page.getByRole("button", { name: "Capture region", exact: true }).waitFor();
      completed += 1;
    }
    const diagnostics = await readDiagnostics(page);
    assert.equal(diagnostics.starts.button, 30);
    assert.equal(diagnostics.delivery.dispatchedUnverified, 30);
    assert.equal(Object.values(diagnostics.delivery.failures).reduce((sum, count) => sum + count, 0), 0);
    for (const agent of agents) await assertNoSubmissions(agent.home);
    console.log(JSON.stringify({ acceptance: "codex-local-attachment", status: "passed", application: artifact,
      codexVersion: VERSION, trials: completed, panes: 2, imagesPerPane: agents.map((agent) => agent.count),
      networkDenied: true, credentialsProvided: false, submissionObserved: false, physicalInteractionObserved: false,
      limitations: ["Exact hosted Codex/WezTerm tuple only; no inference, GUI focus, physical shortcut or permission-cycle acceptance.",
        "Attachment labels, unique literal notes and locally created PNG dimensions were observed. Product delivery remains dispatched-unverified."] }));
  } finally {
    await browser?.close().catch(() => undefined);
    for (const agent of agents) await cliRun(["kill-pane", "--pane-id", agent.id]).catch(() => undefined);
    for (const child of children.reverse()) await stop(child);
    await rm(directory, { recursive: true, force: true });
  }
}

main().catch(() => {
  // Never emit the screenshot, raw terminal, private paths, note contents or agent logs.
  console.error(JSON.stringify({ acceptance: "codex-local-attachment", status: "failed", checkpoint, completed, startup }));
  process.exitCode = 1;
});
