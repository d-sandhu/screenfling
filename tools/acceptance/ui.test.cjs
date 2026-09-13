const assert = require("node:assert/strict");
const { readFile } = require("node:fs/promises");
const { createServer } = require("node:http");
const path = require("node:path");
const { after, before, test } = require("node:test");

const { chromium } = require("playwright");

// Built production renderers with synthetic bridge fixtures. These tests do not
// capture a screen, write the OS clipboard, or prove native/agent acceptance.
let browser;
let server;
let origin;

before(async () => {
  const root = path.resolve(__dirname, "../../out/renderer");
  const types = { ".css": "text/css", ".html": "text/html", ".js": "text/javascript" };
  server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, "http://localhost").pathname;
      const file = path.resolve(root, `.${decodeURIComponent(pathname)}`);
      if (!file.startsWith(`${root}${path.sep}`)) throw new Error("invalid-fixture-path");
      const bytes = await readFile(file);
      response.writeHead(200, { "Content-Type": types[path.extname(file)] ?? "text/plain" });
      response.end(bytes);
    } catch {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  if (server !== undefined) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

function installFixture(options) {
  const operationId = "550e8400-e29b-41d4-a716-446655440000";
  const calls = [];
  const listeners = new Set();
  const initial = { phase: options.editing ? "editing" : "idle" };
  if (options.editing) initial.operationId = operationId;
  let state = initial;
  let bootstrapResolvers = [];
  let startResolver = null;
  let destinations = ["7", "8"].map((locator) => ({
    id: `wezterm:fixture:${locator}`,
    adapter: "wezterm",
    endpoint: { scope: "local", instanceId: "fixture" },
    surface: { kind: "pane", locator },
    context: { cwd: "/synthetic-shared-label", observedAt: "2026-09-13T00:00:00.000Z" },
    capabilities: {
      address: "exact",
      imageInput: "clipboard-key",
      textInput: "paste",
      readBack: "none",
      verification: ["target-live"],
      actions: options.copyOnly ? ["copy"] : ["copy", "stage", "reveal"],
    },
  }));
  if (options.noDestinations) destinations = [];

  function jpeg(width, height) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    context.fillStyle = "white";
    context.fillRect(0, 0, width, height);
    return Uint8Array.from(atob(canvas.toDataURL("image/jpeg").split(",")[1]), (char) =>
      char.charCodeAt(0),
    );
  }

  function publish(next) {
    state = next;
    for (const listener of listeners) listener(next);
    return next;
  }

  function result(outcome) {
    return publish({ phase: "result", operationId, result: outcome });
  }

  const shortcut = {
    accelerator: "CommandOrControl+Shift+9",
    cleanupRequired: false,
    configuration: { key: "9", modifiers: "CommandOrControl+Shift" },
    configurationState: "default",
    registered: true,
  };

  window.fixture = {
    calls,
    emitEditing: () => publish({ phase: "editing", operationId }),
    releaseBootstrap: () => {
      for (const resolve of bootstrapResolvers) resolve(initial);
      bootstrapResolvers = [];
    },
    releaseStart: () => startResolver?.({ phase: "snapshotting", operationId }),
    removeDestinations: () => {
      destinations = [];
    },
  };
  window.screenFling = {
    onWorkflowSnapshot: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: async () => {
      if (options.failBootstrap) throw new Error("synthetic-bootstrap-failure");
      if (options.delayBootstrap) {
        return new Promise((resolve) => bootstrapResolvers.push(resolve));
      }
      return state;
    },
    getShortcutStatus: async () => {
      if (options.failShortcut) throw new Error("synthetic-shortcut-failure");
      return shortcut;
    },
    getScreenCaptureReadiness: async () => ({
      version: 1,
      platform: "macos",
      status: "granted",
    }),
    startCapture: async () => {
      calls.push({ action: "start" });
      publish({ phase: "snapshotting", operationId });
      publish({ phase: "editing", operationId });
      if (options.delayStart) return new Promise((resolve) => (startResolver = resolve));
      return state;
    },
    getCaptureDraft: async () => ({
      operationId,
      selection: { x: 10, y: 10, width: 200, height: 100 },
      pixels: { width: 200, height: 100 },
      preview: jpeg(200, 100),
    }),
    discoverDestinations: async () => destinations,
    copyCapture: async (request) => {
      calls.push({ action: "copy", request });
      return result({ status: "copied" });
    },
    stageCapture: async (request) => {
      calls.push({ action: "stage", request });
      if (options.stale) return result({ status: "failed", reason: "target-stale" });
      const selected = destinations.find((destination) => destination.id === request.destinationId);
      if (selected === undefined) throw new Error("fixture-target-not-selected");
      const { id, adapter, endpoint, surface } = selected;
      return result({
        status: "dispatched-unverified",
        destination: { id, adapter, endpoint, surface },
      });
    },
    revealDestination: async (request) => {
      calls.push({ action: "reveal", request });
      return { status: "revealed" };
    },
    cancelOperation: async (request) => {
      calls.push({ action: "cancel", request });
      return result({ status: "cancelled" });
    },
    dismissResult: async () => publish({ phase: "idle" }),
  };

  window.captureOverlay = {
    onSnapshot: (listener) => {
      let subscribed = true;
      queueMicrotask(() => {
        if (!subscribed) return;
        listener({
          operationId,
          display: {
            id: "42",
            x: 0,
            y: 0,
            width: innerWidth,
            height: innerHeight,
            scaleFactor: 1,
            rotation: 0,
          },
          returnedPixels: { width: innerWidth, height: innerHeight },
          preview: jpeg(innerWidth, innerHeight),
        });
      });
      return () => (subscribed = false);
    },
    ready: async (request) => {
      calls.push({ action: "ready", request });
      return { phase: "selecting", operationId };
    },
    completeSelection: async (request) => {
      calls.push({ action: "selection", request });
      return { phase: "editing", operationId };
    },
    cancel: async (request) => {
      calls.push({ action: "cancel", request });
      return { phase: "result", operationId, result: { status: "cancelled" } };
    },
    failed: async (request) => {
      calls.push({ action: "failed", request });
      return { phase: "result", operationId, result: { status: "failed", reason: "capture-failed" } };
    },
  };
}

async function withPage(options, run) {
  const context = await browser.newContext({ viewport: { width: 1000, height: 800 } });
  const errors = [];
  try {
    await context.route("**/*", (route) => {
      if (route.request().url().startsWith(`${origin}/`)) return route.continue();
      return route.abort();
    });
    await context.addInitScript(installFixture, options);
    const page = await context.newPage();
    page.setDefaultTimeout(5_000);
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${origin}/index.html${options.overlay ? "?surface=capture" : ""}`);
    await run(page);
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }
}

async function editingReady(page) {
  await page.getByRole("heading", { name: "Ready to hand off" }).waitFor();
  await page.getByAltText("Selected screen region").waitFor();
  await page.waitForFunction(() => !document.querySelector(".actions--review button + button").disabled);
}

test("renderer fixture: bootstrap failure is visible with recovery guidance", async () => {
  await withPage({ failBootstrap: true }, async (page) => {
    await page.getByRole("alert").waitFor();
    assert.match(await page.getByRole("alert").innerText(), /Restart ScreenFling/);
    assert.equal(await page.getByText("Opening ScreenFling…", { exact: true }).count(), 0);
  });
});

test("renderer fixture: failed shortcut status does not block the capture button", async () => {
  await withPage({ failShortcut: true }, async (page) => {
    await page.getByRole("button", { name: "Capture region" }).click();
    await editingReady(page);
  });
});

test("renderer fixture: a delayed initial snapshot cannot replace a live workflow", async () => {
  await withPage({ delayBootstrap: true }, async (page) => {
    await page.waitForFunction(() => window.fixture !== undefined);
    await page.evaluate(() => window.fixture.emitEditing());
    await editingReady(page);
    await page.evaluate(() => window.fixture.releaseBootstrap());
    await page.getByRole("heading", { name: "Ready to hand off" }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Capture region" }).count(), 0);
  });
});

test("renderer fixture: a late Start response cannot regress the editing surface", async () => {
  await withPage({ delayStart: true }, async (page) => {
    await page.getByRole("button", { name: "Capture region" }).click();
    await page.getByRole("heading", { name: "Ready to hand off" }).waitFor();
    await page.evaluate(() => window.fixture.releaseStart());
    await editingReady(page);
    await page.getByRole("button", { name: "Copy only" }).click();
    await page.getByRole("heading", { name: "Copied", exact: true }).waitFor();
  });
});

test("renderer fixture: Copy works without destinations and Done returns to idle", async () => {
  await withPage({ editing: true, noDestinations: true }, async (page) => {
    await editingReady(page);
    assert.equal(await page.getByRole("button", { name: "Stage, don’t send" }).isEnabled(), false);
    await page.getByRole("button", { name: "Copy only" }).click();
    await page.getByRole("heading", { name: "Copied", exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Reveal destination" }).count(), 0);
    await page.getByRole("button", { name: "Done", exact: true }).press("Enter");
    await page.getByRole("button", { name: "Capture region" }).waitFor();
    assert.deepEqual(await page.evaluate(() => window.fixture.calls.map((call) => call.action)), ["copy"]);
  });
});

test("renderer fixture: explicit target, literal note, one Stage, then separate Reveal", async () => {
  await withPage({ editing: true }, async (page) => {
    await editingReady(page);
    assert.equal(await page.getByRole("button", { name: "Stage, don’t send" }).isEnabled(), false);
    await page.getByRole("radio", { name: /pane 8/ }).check();
    const note = 'Synthetic "quote" \\ Unicode café Enter';
    await page.getByPlaceholder("What should the agent notice?").fill(note);
    await page.getByPlaceholder("What should the agent notice?").press("Enter");
    assert.deepEqual(await page.evaluate(() => window.fixture.calls), []);
    await page.getByRole("button", { name: "Stage, don’t send" }).click();
    await page.getByRole("heading", { name: "Staged — unverified" }).waitFor();
    assert.match(await page.locator(".summary").innerText(), /pane 8/);
    assert.match(await page.locator(".summary").innerText(), /could not be verified/);
    const beforeReveal = await page.evaluate(() => window.fixture.calls);
    assert.equal(beforeReveal.length, 1);
    assert.equal(beforeReveal[0].request.destinationId, "wezterm:fixture:8");
    assert.equal(beforeReveal[0].request.note, note);
    await page.getByRole("button", { name: "Reveal destination" }).click();
    await page.getByText("Reveal requested.", { exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Reveal attempted" }).isEnabled(), false);
    assert.deepEqual(await page.evaluate(() => window.fixture.calls.map((call) => call.action)), ["stage", "reveal"]);
    assert.equal(await page.getByRole("heading", { name: "Staged — unverified" }).count(), 1);
  });
});

test("renderer fixture: stale Stage gives manual fallback without Reveal or retry", async () => {
  await withPage({ editing: true, stale: true }, async (page) => {
    await editingReady(page);
    await page.getByRole("radio", { name: /pane 7/ }).check();
    await page.getByRole("button", { name: "Stage, don’t send" }).click();
    await page.getByRole("heading", { name: "Capture stopped" }).waitFor();
    assert.match(await page.locator(".summary").innerText(), /clipboard for manual paste/);
    assert.equal(await page.getByRole("button", { name: "Reveal destination" }).count(), 0);
    assert.deepEqual(await page.evaluate(() => window.fixture.calls.map((call) => call.action)), ["stage"]);
  });
});

test("renderer fixture: Copy-only capability never enables Stage", async () => {
  await withPage({ editing: true, copyOnly: true }, async (page) => {
    await editingReady(page);
    await page.getByRole("radio", { name: /pane 7/ }).check();
    assert.equal(await page.getByRole("button", { name: "Stage unavailable" }).isEnabled(), false);
    await page.getByRole("button", { name: "Copy only" }).click();
    await page.getByRole("heading", { name: "Copied", exact: true }).waitFor();
  });
});

test("renderer fixture: refresh removes a stale selection rather than choosing another", async () => {
  await withPage({ editing: true }, async (page) => {
    await editingReady(page);
    await page.getByRole("radio", { name: /pane 7/ }).check();
    await page.evaluate(() => window.fixture.removeDestinations());
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await page.getByText("No supported exact destination is available. Copy only still works.").waitFor();
    assert.equal(await page.getByRole("button", { name: "Stage, don’t send" }).isEnabled(), false);
    assert.deepEqual(await page.evaluate(() => window.fixture.calls), []);
  });
});

test("renderer fixture: scripted pointer drag completes selection exactly once", async () => {
  await withPage({ overlay: true }, async (page) => {
    await page.waitForFunction(() => window.fixture.calls.some((call) => call.action === "ready"));
    await page.mouse.move(100, 100);
    await page.mouse.down();
    await page.mouse.move(350, 250);
    await page.mouse.up();
    await page.waitForFunction(() => window.fixture.calls.some((call) => call.action === "selection"));
    const calls = await page.evaluate(() => window.fixture.calls);
    assert.deepEqual(calls.map((call) => call.action), ["ready", "selection"]);
    assert.deepEqual(calls[1].request.selection, { x: 100, y: 100, width: 250, height: 150 });
  });
});

test("renderer fixture: Escape cancels without selection or delivery", async () => {
  await withPage({ overlay: true }, async (page) => {
    await page.waitForFunction(() => window.fixture.calls.some((call) => call.action === "ready"));
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => window.fixture.calls.some((call) => call.action === "cancel"));
    assert.deepEqual(await page.evaluate(() => window.fixture.calls.map((call) => call.action)), ["ready", "cancel"]);
  });
});
