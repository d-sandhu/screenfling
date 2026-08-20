const { spawn } = require("node:child_process");
const { createHash, randomUUID } = require("node:crypto");
const {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { basename, join, resolve } = require("node:path");

const VERSION = "20240203-110809-5046fc22";
const RELEASE_ROOT = `https://github.com/wezterm/wezterm/releases/download/${VERSION}`;
const ASSETS = {
  darwin: {
    name: `WezTerm-macos-${VERSION}.zip`,
    sha256: "e77388cad55f2e9da95a220a89206a6c58f865874a629b7c3ea3c162f5692224",
  },
  win32: {
    name: `WezTerm-windows-${VERSION}.zip`,
    sha256: "57e5d03b585303d81e8b8e96d1230362852eb39aca92b3b29c7a42cfb82f9ac4",
  },
};
const RECEIVER = resolve(__dirname, "receiver.cjs");
const REPOSITORY = resolve(__dirname, "../../..");
const DISPATCH_COUNT = 100;
const WAIT_INTERVAL_MS = 20;
const WAIT_LIMIT_MS = 10_000;

function fail(message) {
  throw new Error(message);
}

async function runCommand(executable, args, input, environment) {
  return new Promise((resolveCommand, rejectCommand) => {
    const child = spawn(executable, args, {
      env: environment,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    const output = [];
    const errors = [];

    child.stdout.on("data", (chunk) => output.push(chunk));
    child.stderr.on("data", (chunk) => errors.push(chunk));
    child.on("error", rejectCommand);
    child.on("close", (code) => {
      if (code !== 0) {
        rejectCommand(
          new Error(
            `${basename(executable)} exited ${String(code)}: ${Buffer.concat(errors).toString("utf8")}`,
          ),
        );
        return;
      }
      resolveCommand(Buffer.concat(output));
    });

    if (input === undefined) {
      child.stdin.end();
    } else {
      child.stdin.end(input);
    }
  });
}

async function download(url, destination) {
  const response = await fetch(url);
  if (!response.ok) {
    fail(`download failed with HTTP ${String(response.status)}`);
  }
  await writeFile(destination, Buffer.from(await response.arrayBuffer()), { mode: 0o600 });
}

async function findFile(root, wantedName) {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const candidate = join(root, entry.name);
    if (entry.isDirectory()) {
      const nested = await findFile(candidate, wantedName);
      if (nested !== undefined) {
        return nested;
      }
    } else if (entry.name === wantedName) {
      return candidate;
    }
  }
  return undefined;
}

async function waitUntil(check, description) {
  const deadline = Date.now() + WAIT_LIMIT_MS;
  while (Date.now() < deadline) {
    if (await check()) {
      return;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, WAIT_INTERVAL_MS));
  }
  fail(`timed out waiting for ${description}`);
}

async function fileSize(path) {
  try {
    return (await stat(path)).size;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return -1;
    }
    throw error;
  }
}

async function main() {
  const asset = ASSETS[process.platform];
  if (asset === undefined) {
    fail("Gate B supports native macOS and Windows only.");
  }

  const root = await mkdtemp(join(tmpdir(), "sf-wz-"));
  const archive = join(root, asset.name);
  const extracted = join(root, "wz");
  const socketPath = join(root, "mux.sock");
  const configPath = join(root, "wezterm.lua");
  const outputPaths = [join(root, "receiver-a.bin"), join(root, "receiver-b.bin")];
  const readyPaths = [join(root, "receiver-a.ready"), join(root, "receiver-b.ready")];
  const instanceGeneration = randomUUID();
  let server;
  let serverErrors = "";
  let wezterm;
  let remainingPaneId;
  let sendInvocations = 0;

  try {
    process.stdout.write(`${JSON.stringify({ state: "downloading", version: VERSION })}\n`);
    await download(`${RELEASE_ROOT}/${asset.name}`, archive);
    const digest = createHash("sha256")
      .update(await readFile(archive))
      .digest("hex");
    if (digest !== asset.sha256) {
      fail(`checksum mismatch: expected ${asset.sha256}, received ${digest}`);
    }

    await mkdir(extracted, { mode: 0o700 });
    if (process.platform === "win32") {
      const extractScript =
        "Expand-Archive -LiteralPath $env:SCREENFLING_ARCHIVE -DestinationPath $env:SCREENFLING_EXTRACTED";
      await runCommand(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", extractScript],
        undefined,
        {
          ...process.env,
          SCREENFLING_ARCHIVE: archive,
          SCREENFLING_EXTRACTED: extracted,
        },
      );
    } else {
      await runCommand("/usr/bin/unzip", ["-q", archive, "-d", extracted], undefined, process.env);
    }

    const executableSuffix = process.platform === "win32" ? ".exe" : "";
    wezterm = await findFile(extracted, `wezterm${executableSuffix}`);
    const muxServer = await findFile(extracted, `wezterm-mux-server${executableSuffix}`);
    if (wezterm === undefined || muxServer === undefined) {
      fail("pinned archive did not contain the required WezTerm executables");
    }
    if (process.platform !== "win32") {
      await chmod(wezterm, 0o700);
      await chmod(muxServer, 0o700);
    }

    const luaSocket = socketPath.replaceAll("\\", "/").replaceAll('"', '\\"');
    await writeFile(
      configPath,
      `return { unix_domains = { { name = "screenfling-gate-b", socket_path = "${luaSocket}", no_serve_automatically = true } } }\n`,
      { mode: 0o600 },
    );

    server = spawn(
      muxServer,
      [
        "--config-file",
        configPath,
        "--cwd",
        REPOSITORY,
        process.execPath,
        RECEIVER,
        outputPaths[0],
        readyPaths[0],
      ],
      { env: process.env, stdio: ["ignore", "ignore", "pipe"], windowsHide: true },
    );
    server.stderr.on("data", (chunk) => {
      serverErrors = `${serverErrors}${chunk.toString("utf8")}`.slice(-4_000);
    });

    const cliEnvironment = { ...process.env, WEZTERM_UNIX_SOCKET: socketPath };
    const cli = async (args, input) => {
      if (wezterm === undefined) {
        fail("WezTerm executable is unavailable");
      }
      return runCommand(
        wezterm,
        ["--config-file", configPath, "cli", "--no-auto-start", ...args],
        input,
        cliEnvironment,
      );
    };
    const listPanes = async () =>
      JSON.parse((await cli(["list", "--format", "json"])).toString("utf8"));

    await waitUntil(async () => {
      if ((await fileSize(readyPaths[0])) < 0) {
        return false;
      }
      try {
        return (await listPanes()).length === 1;
      } catch {
        return false;
      }
    }, `owned mux server (${serverErrors})`);

    const firstList = await listPanes();
    const firstPaneId = firstList[0]?.pane_id;
    if (!Number.isInteger(firstPaneId)) {
      fail("first pane has no integer pane ID");
    }
    const spawnedPane = await cli([
      "spawn",
      "--new-window",
      "--cwd",
      REPOSITORY,
      "--",
      process.execPath,
      RECEIVER,
      outputPaths[1],
      readyPaths[1],
    ]);
    const secondPaneId = Number.parseInt(spawnedPane.toString("utf8").trim(), 10);
    if (!Number.isInteger(secondPaneId) || secondPaneId === firstPaneId) {
      fail("second receiver did not receive a distinct integer pane ID");
    }
    remainingPaneId = secondPaneId;

    await waitUntil(async () => (await fileSize(readyPaths[1])) >= 0, "second receiver");
    const routes = [
      { instanceGeneration, paneId: firstPaneId },
      { instanceGeneration, paneId: secondPaneId },
    ];
    const expected = [Buffer.alloc(0), Buffer.alloc(0)];
    const pasteKey = process.platform === "win32" ? Buffer.from([0x1b, 0x76]) : Buffer.from([0x16]);
    const notes = [
      "ScreenFling literal note",
      "quotes: 'single' and \"double\"",
      "slashes: C:\\tmp\\shot.png /tmp/shot.png",
      "unicode: café — 東京 — 🧭",
      "looks like keys: Enter Cmd+V activate-pane",
      'looks like automation: tell application "Terminal"',
    ];

    const validateRoute = async (route) => {
      if (route.instanceGeneration !== instanceGeneration) {
        fail("stale instance generation");
      }
      const panes = await listPanes();
      if (!panes.some((pane) => pane.pane_id === route.paneId)) {
        fail("stale pane route");
      }
    };
    const stage = async (route, note) => {
      await validateRoute(route);
      await cli(["send-text", "--no-paste", "--pane-id", String(route.paneId)], pasteKey);
      sendInvocations += 1;
      await cli(["send-text", "--no-paste", "--pane-id", String(route.paneId)], Buffer.from(note));
      sendInvocations += 1;
    };

    for (let index = 0; index < DISPATCH_COUNT; index += 1) {
      const target = index % 2;
      const other = 1 - target;
      const note = notes[index % notes.length];
      if (note.includes("\r") || note.includes("\n")) {
        fail("test note unexpectedly contains an Enter byte");
      }
      const beforeOtherSize = await fileSize(outputPaths[other]);
      await stage(routes[target], note);
      expected[target] = Buffer.concat([expected[target], pasteKey, Buffer.from(note)]);
      await waitUntil(
        async () => (await fileSize(outputPaths[target])) === expected[target].length,
        `dispatch ${String(index + 1)}`,
      );
      const afterOtherSize = await fileSize(outputPaths[other]);
      if (afterOtherSize !== beforeOtherSize) {
        fail(`dispatch ${String(index + 1)} changed the non-target receiver`);
      }
      process.stdout.write(
        `${JSON.stringify({ state: "dispatched", dispatch: index + 1, target, bytes: expected.map((buffer) => buffer.length), wrongTarget: false, enterBytes: 0 })}\n`,
      );
    }

    for (let index = 0; index < outputPaths.length; index += 1) {
      if (!expected[index].equals(await readFile(outputPaths[index]))) {
        fail(`receiver ${String(index)} bytes differ from exact expected input`);
      }
    }

    await cli(["kill-pane", "--pane-id", String(firstPaneId)]);
    await waitUntil(
      async () => !(await listPanes()).some((pane) => pane.pane_id === firstPaneId),
      "closed pane removal",
    );
    const sendsBeforeStaleAttempt = sendInvocations;
    let staleRefused = false;
    try {
      await stage(routes[0], "must not dispatch");
    } catch (error) {
      staleRefused = error instanceof Error && error.message === "stale pane route";
    }
    if (!staleRefused || sendInvocations !== sendsBeforeStaleAttempt) {
      fail("stale route was not refused before dispatch");
    }

    process.stdout.write(
      `${JSON.stringify(
        {
          verdict: "platform-routing-primitive-pass",
          platform: process.platform,
          arch: process.arch,
          weztermVersion: VERSION,
          sha256: digest,
          paneIds: [firstPaneId, secondPaneId],
          dispatches: DISPATCH_COUNT,
          sendInvocations,
          exactBytes: true,
          wrongTargetWrites: 0,
          enterBytes: 0,
          staleRouteRefusedBeforeSend: true,
          activePaneFallbackUsed: false,
          activatePaneUsed: false,
          osFocusObserved: false,
          limitations: [
            "headless mux proof; no human-visible GUI focus trial",
            "one run proves only its reported platform; aggregate both Tier 1 runs separately",
            "control bytes prove transport only; supported agent/version bindings require observed trials",
          ],
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    if (wezterm !== undefined && remainingPaneId !== undefined) {
      try {
        await runCommand(
          wezterm,
          [
            "--config-file",
            configPath,
            "cli",
            "--no-auto-start",
            "kill-pane",
            "--pane-id",
            String(remainingPaneId),
          ],
          undefined,
          { ...process.env, WEZTERM_UNIX_SOCKET: socketPath },
        );
      } catch {
        // The server teardown below owns the remaining process tree.
      }
    }
    if (server !== undefined && server.exitCode === null) {
      server.kill();
      await Promise.race([
        new Promise((resolveExit) => server.once("close", resolveExit)),
        new Promise((resolveDelay) => setTimeout(resolveDelay, 2_000)),
      ]);
    }
    await rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
