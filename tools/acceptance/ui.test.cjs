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
  let operationId = "550e8400-e29b-41d4-a716-446655440000";
  let nextOperation = 1;
  const calls = [];
  const listeners = new Set();
  const initial = { phase: options.editing ? "editing" : "idle" };
  if (options.editing) initial.operationId = operationId;
  if (options.restoredResult) {
    Object.assign(initial, {
      phase: "result", operationId,
      result: { status: "dispatched-unverified", destination: {
        id: "wezterm:fixture:7", adapter: "wezterm", surface: { kind: "pane", locator: "7" },
      } },
    });
    if (options.restoredResult !== "unknown") initial.revealAvailable = options.restoredResult === "available";
  }
  let state = initial;
  let bootstrapResolvers = [];
  let startResolver = null;
  let copyResolver = null;
  let revealResolver = null;
  let heldPreview = null;
  // Delay the actual image's load notification, not its validity or dimensions.
  document.addEventListener("load", (event) => {
    if (options.holdPreview && event.target instanceof HTMLImageElement &&
        event.target.alt === "Selected screen region") {
      event.stopImmediatePropagation();
      heldPreview = event.target;
    }
  }, true);
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
    return publish({ phase: "result", operationId, result: outcome, revealAvailable: outcome.status === "dispatched-unverified" });
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
    repairPreview: () => { options.previewFault = null; },
    holdNextPreview: () => { options.holdPreview = true; heldPreview = null; },
    previewLoadHeld: () => heldPreview !== null,
    releasePreview: () => {
      options.holdPreview = false;
      const image = heldPreview;
      heldPreview = null;
      if (image !== null) image.dispatchEvent(new Event("load"));
    },
    releaseReveal: () => revealResolver?.({ status: "revealed" }),
    emitEditing: () => publish({ phase: "editing", operationId }),
    releaseBootstrap: () => {
      for (const resolve of bootstrapResolvers) resolve(initial);
      bootstrapResolvers = [];
    },
    releaseStart: () => startResolver?.({ phase: "snapshotting", operationId }),
    releaseCopy: () => copyResolver?.(state),
    removeDestinations: () => {
      destinations = [];
    },
  };
  let setup = { supported: true, source: "none", configuration: null, restartRequired: false, activeConfiguration: null };
  window.screenFling = {
    getWezTermSetup: async () => setup,
    checkWezTermSetup: async () => {
      calls.push({ action: "check-connection" });
      return options.failSetup ? "instance-unavailable" : "ready";
    },
    chooseWezTermFile: async (field) => {
      calls.push({ action: "choose-file", field });
      return options.cancelChoice ? null : field === "executable" ? "/synthetic/wezterm" : "/synthetic/config.lua";
    },
    openScreenRecordingSettings: async () => { calls.push({ action: "settings" }); return true; },
    saveWezTermSetup: async (configuration) => {
      calls.push({ action: "save-connection", configuration });
      if (options.failSetup) return "instance-unavailable";
      setup = { supported: true, source: configuration === null ? "none" : "saved", configuration, restartRequired: true, activeConfiguration: null };
      return "saved";
    },
    restartApplication: async () => { calls.push({ action: "restart" }); return true; },
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
    getScreenCaptureReadiness: async () => {
      if (options.failReadiness) throw new Error("synthetic-readiness-error");
      return { version: 1, platform: "macos", status: options.denied ? "denied" : "granted" };
    },
    startCapture: async () => {
      calls.push({ action: "start" });
      operationId = `550e8400-e29b-41d4-a716-${String(nextOperation++).padStart(12, "0")}`;
      publish({ phase: "snapshotting", operationId });
      publish({ phase: "editing", operationId });
      if (options.delayStart) return new Promise((resolve) => (startResolver = resolve));
      return state;
    },
    getCaptureDraft: async () => {
      if (options.previewFault === "unreadable") throw new Error("synthetic-draft-failure");
      return {
        operationId,
        selection: { x: 10, y: 10, width: 200, height: 100 },
        pixels: { width: 200, height: 100 },
        preview: options.previewFault === "invalid" ? new Uint8Array([255, 216, 0]) : jpeg(200, 100),
      };
    },
    discoverDestinations: async () => ({
      destinations,
      status: options.discoveryStatus ?? (destinations.length === 0 ? "not-configured" : "ready"),
    }),
    copyCapture: async (request) => {
      calls.push({ action: "copy", request });
      result({ status: "copied" });
      if (options.delayCopy) return new Promise((resolve) => (copyResolver = resolve));
      return state;
    },
    stageCapture: async (request) => {
      calls.push({ action: "stage", request });
      if (options.stale) return result({ status: "failed", reason: "target-stale" });
      const selected = destinations.find((destination) => destination.id === request.destinationId);
      if (selected === undefined) throw new Error("fixture-target-not-selected");
      const { id, adapter, surface } = selected;
      return result({
        status: "dispatched-unverified",
        destination: { id, adapter, surface },
      });
    },
    revealDestination: async (request) => {
      calls.push({ action: "reveal", request });
      if (!state.revealAvailable) return { status: "stale" };
      state = { ...state, revealAvailable: false };
      if (options.delayReveal) return new Promise((resolve) => { revealResolver = resolve; });
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
      return {
        phase: "result",
        operationId,
        result: { status: "failed", reason: "capture-failed" },
      };
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
  await page.waitForFunction(
    () => !document.querySelector(".actions--review button + button").disabled,
  );
}

void test("renderer fixture: bootstrap failure is visible with recovery guidance", async () => {
  await withPage({ failBootstrap: true }, async (page) => {
    await page.getByRole("alert").waitFor();
    assert.match(await page.getByRole("alert").innerText(), /Restart ScreenFling/);
    assert.equal(await page.getByText("Opening ScreenFling…", { exact: true }).count(), 0);
  });
});

void test("renderer fixture: failed shortcut status does not block the capture button", async () => {
  await withPage({ failShortcut: true }, async (page) => {
    await page.getByRole("button", { name: "Capture region" }).click();
    await editingReady(page);
  });
});

void test("renderer fixture: a delayed initial snapshot cannot replace a live workflow", async () => {
  await withPage({ delayBootstrap: true }, async (page) => {
    await page.waitForFunction(() => window.fixture !== undefined);
    await page.evaluate(() => window.fixture.emitEditing());
    await editingReady(page);
    await page.evaluate(() => window.fixture.releaseBootstrap());
    await page.getByRole("heading", { name: "Ready to hand off" }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Capture region" }).count(), 0);
  });
});

void test("renderer fixture: a late Start response cannot regress the editing surface", async () => {
  await withPage({ delayStart: true }, async (page) => {
    await page.getByRole("button", { name: "Capture region" }).click();
    await page.getByRole("heading", { name: "Ready to hand off" }).waitFor();
    await page.evaluate(() => window.fixture.releaseStart());
    await editingReady(page);
    await page.getByRole("button", { name: "Copy only" }).click();
    await page.getByRole("heading", { name: "Copied", exact: true }).waitFor();
  });
});

void test("renderer fixture: Copy works without destinations and Done returns to idle", async () => {
  await withPage({ editing: true, noDestinations: true }, async (page) => {
    await editingReady(page);
    assert.equal(await page.getByRole("button", { name: "Stage, don’t send" }).isEnabled(), false);
    await page.getByRole("button", { name: "Copy only" }).click();
    await page.getByRole("heading", { name: "Copied", exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Reveal destination" }).count(), 0);
    await page.getByRole("button", { name: "Done", exact: true }).press("Enter");
    await page.getByRole("button", { name: "Capture region" }).waitFor();
    assert.deepEqual(await page.evaluate(() => window.fixture.calls.map((call) => call.action)), [
      "copy",
    ]);
  });
});

void test("renderer fixture: Done gains keyboard focus only after a pending result settles", async () => {
  await withPage({ editing: true, delayCopy: true }, async (page) => {
    await editingReady(page);
    await page.getByRole("button", { name: "Copy only" }).click();
    await page.getByRole("heading", { name: "Copied", exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Done", exact: true }).isEnabled(), false);
    await page.keyboard.press("Escape");
    assert.equal(await page.getByRole("heading", { name: "Copied", exact: true }).count(), 1);
    await page.evaluate(() => window.fixture.releaseCopy());
    await page.waitForFunction(() => document.activeElement?.textContent === "Done");
    await page.keyboard.press("Enter");
    await page.getByRole("button", { name: "Capture region" }).waitFor();
    assert.deepEqual(await page.evaluate(() => window.fixture.calls.map((call) => call.action)), [
      "copy",
    ]);
  });
});

void test("renderer fixture: explicit target, literal note, one Stage, then separate Reveal", async () => {
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
    assert.deepEqual(await page.evaluate(() => window.fixture.calls.map((call) => call.action)), [
      "stage",
      "reveal",
    ]);
    assert.equal(await page.getByRole("heading", { name: "Staged — unverified" }).count(), 1);
  });
});

void test("renderer fixture: stale Stage gives manual fallback without Reveal or retry", async () => {
  await withPage({ editing: true, stale: true }, async (page) => {
    await editingReady(page);
    await page.getByRole("radio", { name: /pane 7/ }).check();
    await page.getByRole("button", { name: "Stage, don’t send" }).click();
    await page.getByRole("heading", { name: "Capture stopped" }).waitFor();
    assert.match(await page.locator(".summary").innerText(), /clipboard for manual paste/);
    assert.equal(await page.getByRole("button", { name: "Reveal destination" }).count(), 0);
    assert.deepEqual(await page.evaluate(() => window.fixture.calls.map((call) => call.action)), [
      "stage",
    ]);
  });
});

void test("renderer fixture: Copy-only capability never enables Stage", async () => {
  await withPage({ editing: true, copyOnly: true }, async (page) => {
    await editingReady(page);
    await page.getByRole("radio", { name: /pane 7/ }).check();
    assert.equal(await page.getByRole("button", { name: "Stage unavailable" }).isEnabled(), false);
    await page.getByRole("button", { name: "Copy only" }).click();
    await page.getByRole("heading", { name: "Copied", exact: true }).waitFor();
  });
});

void test("renderer fixture: refresh removes a stale selection rather than choosing another", async () => {
  await withPage({ editing: true }, async (page) => {
    await editingReady(page);
    await page.getByRole("radio", { name: /pane 7/ }).check();
    await page.evaluate(() => window.fixture.removeDestinations());
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await page
      .getByText(/Copy only still works/)
      .waitFor();
    assert.equal(await page.getByRole("button", { name: "Stage, don’t send" }).isEnabled(), false);
    assert.deepEqual(await page.evaluate(() => window.fixture.calls), []);
  });
});

void test("renderer fixture: scripted pointer drag completes selection exactly once", async () => {
  await withPage({ overlay: true }, async (page) => {
    await page.waitForFunction(() => window.fixture.calls.some((call) => call.action === "ready"));
    await page.mouse.move(100, 100);
    await page.mouse.down();
    await page.mouse.move(350, 250);
    await page.mouse.up();
    await page.waitForFunction(() =>
      window.fixture.calls.some((call) => call.action === "selection"),
    );
    const calls = await page.evaluate(() => window.fixture.calls);
    assert.deepEqual(
      calls.map((call) => call.action),
      ["ready", "selection"],
    );
    assert.deepEqual(calls[1].request.selection, { x: 100, y: 100, width: 250, height: 150 });
  });
});

void test("renderer fixture: Escape cancels without selection or delivery", async () => {
  await withPage({ overlay: true }, async (page) => {
    await page.waitForFunction(() => window.fixture.calls.some((call) => call.action === "ready"));
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => window.fixture.calls.some((call) => call.action === "cancel"));
    assert.deepEqual(await page.evaluate(() => window.fixture.calls.map((call) => call.action)), [
      "ready",
      "cancel",
    ]);
  });
});

void test("renderer fixture: invalid notes block Stage with guidance and allow correction", async () => {
  await withPage({ editing: true }, async (page) => {
    await editingReady(page);
    await page.getByRole("radio", { name: /pane 8/ }).check();
    const input = page.getByPlaceholder("What should the agent notice?");
    await input.fill("original short note");
    for (const invalid of ["before\u2028after", "before\u0085after", "before\u007fafter", "x".repeat(501), "😀".repeat(501)]) {
      await input.fill(invalid);
      assert.equal(await input.inputValue(), invalid);
      assert.equal(await input.getAttribute("aria-invalid"), "true");
      assert.match(await page.getByRole("alert").innerText(), /Edit the note or use Copy only/);
      assert.equal(
        await page.getByRole("button", { name: "Stage, don’t send" }).isEnabled(),
        false,
      );
      assert.equal(await page.getByRole("button", { name: "Copy only" }).isEnabled(), true);
      await input.press("Enter");
      assert.deepEqual(await page.evaluate(() => window.fixture.calls), []);
    }
    // A bounded paste must remain invalid, never silently become a valid prefix.
    await input.fill("😀".repeat(2_000));
    const bounded = await input.inputValue();
    assert.ok(bounded.length <= 1_002 && Array.from(bounded).length > 500);
    assert.equal(await input.getAttribute("aria-invalid"), "true");
    assert.equal(await page.getByRole("button", { name: "Stage, don’t send" }).isEnabled(), false);
    assert.deepEqual(await page.evaluate(() => window.fixture.calls), []);
    await input.fill("x".repeat(500));
    assert.equal(await input.getAttribute("aria-invalid"), "false");
    const valid = "😀".repeat(500);
    await input.fill(valid);
    assert.equal(await input.getAttribute("aria-invalid"), "false");
    assert.equal(await page.getByRole("alert").count(), 0);
    await page.getByRole("button", { name: "Stage, don’t send" }).click();
    await page.getByRole("heading", { name: "Staged — unverified" }).waitFor();
    const calls = await page.evaluate(() => window.fixture.calls);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].action, "stage");
    assert.equal(calls[0].request.note, valid);
    assert.equal(calls[0].request.destinationId, "wezterm:fixture:8");
  });
});

void test("renderer fixture: Copy ignores an invalid note and never stages it", async () => {
  await withPage({ editing: true }, async (page) => {
    await editingReady(page);
    await page.getByPlaceholder("What should the agent notice?").fill("before\u2028after");
    await page.getByRole("alert").waitFor();
    await page.getByRole("button", { name: "Copy only" }).click();
    await page.getByRole("heading", { name: "Copied", exact: true }).waitFor();
    const calls = await page.evaluate(() => window.fixture.calls);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].action, "copy");
    assert.equal(Object.hasOwn(calls[0].request, "note"), false);
    assert.equal(await page.getByRole("button", { name: "Reveal destination" }).count(), 0);
  });
});

void test("renderer fixture: connection setup requires explicit binding confirmation and never stages", async () => {
  await withPage({}, async (page) => {
    await page.getByText("Connect WezTerm · optional", { exact: true }).click();
    await page.getByLabel("WezTerm executable", { exact: true }).fill("/synthetic/wezterm");
    await page.getByLabel("WezTerm configuration file", { exact: true }).fill("/synthetic/config.lua");
    await page.getByLabel("Exact mux socket").fill("/synthetic/mux");
    await page.getByLabel("Image attachment key (hex bytes)").fill("16");
    assert.equal(await page.getByRole("button", { name: "Save connection" }).isEnabled(), false);
    await page.getByRole("button", { name: "Check connection", exact: true }).click();
    await page.getByText(/Exact panes found. Nothing was sent or saved/).waitFor();
    assert.deepEqual(await page.evaluate(() => window.fixture.calls.map((call) => call.action)), ["check-connection"]);
    assert.equal(await page.getByRole("button", { name: "Restart ScreenFling", exact: true }).count(), 0);
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Save connection" }).click();
    await page.getByText(/Copy-only mode is still active until restart/).waitFor();
    await page.getByRole("button", { name: "Restart ScreenFling", exact: true }).click();
    assert.deepEqual(await page.evaluate(() => window.fixture.calls.map((call) => call.action)), ["check-connection", "save-connection", "restart"]);
  });
});

void test("renderer fixture: connection failure leaves capture and Copy usable", async () => {
  await withPage({ failSetup: true }, async (page) => {
    await page.getByText("Connect WezTerm · optional", { exact: true }).click();
    await page.getByLabel("WezTerm executable", { exact: true }).fill("/synthetic/wezterm");
    await page.getByLabel("WezTerm configuration file", { exact: true }).fill("/synthetic/config.lua");
    await page.getByLabel("Exact mux socket").fill("/synthetic/mux");
    await page.getByLabel("Image attachment key (hex bytes)").fill("16");
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Save connection" }).click();
    await page.getByText(/instance did not return a usable pane list/).waitFor();
    await page.getByRole("button", { name: "Capture region" }).click();
    await editingReady(page);
    await page.getByRole("button", { name: "Copy only" }).click();
    await page.getByRole("button", { name: "Capture another", exact: true }).click();
    await editingReady(page);
    assert.deepEqual(await page.evaluate(() => window.fixture.calls.map((call) => call.action)), ["save-connection", "start", "copy", "start"]);
  });
});

void test("renderer fixture: Browse fills only the explicitly selected field, with no save or dispatch", async () => {
  await withPage({}, async (page) => {
    await page.getByText("Connect WezTerm · optional", { exact: true }).click();
    await page.getByRole("button", { name: "Browse for wezterm executable", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("#connection-executable").value === "/synthetic/wezterm");
    assert.equal(await page.getByLabel("WezTerm configuration file", { exact: true }).inputValue(), "");
    assert.deepEqual(await page.evaluate(() => window.fixture.calls.map((call) => call.action)), ["choose-file"]);
  });
  await withPage({ cancelChoice: true }, async (page) => {
    await page.getByText("Connect WezTerm · optional", { exact: true }).click();
    await page.getByLabel("WezTerm executable", { exact: true }).fill("/synthetic/keep");
    await page.getByRole("button", { name: "Browse for wezterm executable", exact: true }).click();
    assert.equal(await page.getByLabel("WezTerm executable", { exact: true }).inputValue(), "/synthetic/keep");
  });
});

void test("renderer fixture: permission recovery is explicit and never starts capture", async () => {
  await withPage({ denied: true }, async (page) => {
    await page.getByRole("button", { name: "Open System Settings", exact: true }).click();
    await page.getByRole("button", { name: "Restart ScreenFling", exact: true }).click();
    await page.waitForFunction(() => window.fixture.calls.length === 2);
    assert.deepEqual(await page.evaluate(() => window.fixture.calls.map((call) => call.action)), ["settings", "restart"]);
    assert.equal(await page.getByRole("button", { name: "Capture region" }).isEnabled(), false);
  });
});

void test("renderer fixture: a failed permission query offers retry instead of an endless loading state", async () => {
  await withPage({ failReadiness: true }, async (page) => {
    await page.getByText(/Screen Recording status could not be checked/).waitFor();
    await page.getByRole("button", { name: "Check again", exact: true }).click();
    await page.getByText(/Screen Recording status could not be checked/).waitFor();
    await page.getByRole("button", { name: "Capture region" }).click();
    await editingReady(page);
  });
});

void test("renderer fixture: setup and review remain reachable in a short narrow window", async () => {
  await withPage({}, async (page) => {
    await page.setViewportSize({ width: 520, height: 480 });
    await page.getByText("Connect WezTerm · optional", { exact: true }).click();
    await page.getByLabel("WezTerm executable", { exact: true }).fill("relative-path");
    await page.getByText(/Use an absolute path without/).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.getByRole("button", { name: "Capture region" }).click();
    await editingReady(page);
    await page.getByRole("button", { name: "Copy only", exact: true }).click();
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await page.waitForFunction(() => document.activeElement?.textContent?.includes("Capture region"));
  });
});


void test("renderer fixture: review explains failed discovery without a second probe or blocking Copy", async () => {
  await withPage({ editing: true, noDestinations: true, discoveryStatus: "selectors-rejected" }, async (page) => {
    await editingReady(page);
    await page.getByText(/connection changed or its path permissions were rejected/).waitFor();
    assert.equal(await page.getByRole("button", { name: "Stage, don’t send" }).isEnabled(), false);
    await page.getByRole("button", { name: "Copy only" }).click();
    await page.getByRole("heading", { name: "Copied", exact: true }).waitFor();
    assert.deepEqual(await page.evaluate(() => window.fixture.calls.map((call) => call.action)), ["copy"]);
  });
});

void test("renderer fixture: reachable empty instance has actionable review guidance", async () => {
  await withPage({ editing: true, noDestinations: true, discoveryStatus: "no-panes" }, async (page) => {
    await editingReady(page);
    await page.getByText(/WezTerm is reachable, but this instance has no panes/).waitFor();
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await page.getByText(/WezTerm is reachable, but this instance has no panes/).waitFor();
    assert.deepEqual(await page.evaluate(() => window.fixture.calls), []);
  });
});


void test("renderer fixture: every capture waits for its own preview load before delivery", async () => {
  await withPage({ editing: true, holdPreview: true }, async (page) => {
    for (let capture = 0; capture < 2; capture += 1) {
      await page.waitForFunction(() => window.fixture.previewLoadHeld());
      await page.getByRole("radio", { name: /pane 7/ }).check();
      assert.equal(await page.getByRole("button", { name: "Copy only" }).isEnabled(), false);
      assert.equal(await page.getByRole("button", { name: "Stage, don’t send" }).isEnabled(), false);
      await page.evaluate(() => window.fixture.releasePreview());
      await editingReady(page);
      assert.equal(await page.getByRole("button", { name: "Stage, don’t send" }).isEnabled(), true);
      await page.getByRole("button", { name: "Copy only" }).click();
      await page.getByRole("heading", { name: "Copied", exact: true }).waitFor();
      if (capture === 0) {
        await page.evaluate(() => window.fixture.holdNextPreview());
        await page.getByRole("button", { name: "Capture another", exact: true }).click();
      }
    }
    assert.deepEqual(await page.evaluate(() => window.fixture.calls.map((call) => call.action)), ["copy", "start", "copy"]);
  });
});

void test("renderer fixture: unreadable or broken previews block delivery and allow a fresh capture", async () => {
  for (const previewFault of ["unreadable", "invalid"]) {
    await withPage({ editing: true, previewFault }, async (page) => {
      await page.getByRole("alert").filter({ hasText: "preview could not be displayed" }).waitFor();
      await page.getByRole("radio", { name: /pane 7/ }).check();
      assert.equal(await page.getByRole("button", { name: "Copy only" }).isEnabled(), false);
      assert.equal(await page.getByRole("button", { name: "Stage, don’t send" }).isEnabled(), false);
      assert.deepEqual(await page.evaluate(() => window.fixture.calls), []);
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
      await page.getByRole("button", { name: "Done", exact: true }).waitFor();
      await page.evaluate(() => window.fixture.repairPreview());
      await page.getByRole("button", { name: "Capture another", exact: true }).click();
      await editingReady(page);
      assert.equal(await page.getByRole("alert").count(), 0);
      await page.getByRole("button", { name: "Copy only" }).click();
      await page.getByRole("heading", { name: "Copied", exact: true }).waitFor();
      assert.deepEqual(await page.evaluate(() => window.fixture.calls.map((call) => call.action)), ["cancel", "start", "copy"]);
    });
  }
});

void test("renderer fixture: Escape cancels review and dismisses the result without sending", async () => {
  await withPage({ editing: true }, async (page) => {
    await editingReady(page);
    const note = page.getByPlaceholder("What should the agent notice?");
    await note.fill("synthetic context");
    await note.dispatchEvent("keydown", { key: "Escape", isComposing: true });
    await note.dispatchEvent("keydown", { key: "Escape", repeat: true });
    assert.deepEqual(await page.evaluate(() => window.fixture.calls), []);
    await note.press("Escape");
    await page.getByRole("button", { name: "Done", exact: true }).waitFor();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Capture region" }).waitFor();
    assert.deepEqual(await page.evaluate(() => window.fixture.calls.map((call) => call.action)), ["cancel"]);
  });
});

void test("renderer fixture: Escape cannot dismiss or repeat an in-flight Reveal", async () => {
  await withPage({ editing: true, delayReveal: true }, async (page) => {
    await editingReady(page);
    await page.getByRole("radio", { name: /pane 8/ }).check();
    await page.getByRole("button", { name: "Stage, don’t send" }).click();
    await page.getByRole("button", { name: "Reveal destination" }).click();
    await page.keyboard.press("Escape");
    assert.equal(await page.getByRole("heading", { name: "Staged — unverified" }).count(), 1);
    assert.equal(await page.getByRole("button", { name: "Done", exact: true }).isEnabled(), false);
    await page.evaluate(() => window.fixture.releaseReveal());
    await page.getByText("Reveal requested.", { exact: true }).waitFor();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Capture region" }).waitFor();
    assert.deepEqual(await page.evaluate(() => window.fixture.calls.map((call) => call.action)), ["stage", "reveal"]);
  });
});

void test("renderer fixture: a restored result can Reveal its retained exact target without replaying Stage", async () => {
  await withPage({ restoredResult: "available" }, async (page) => {
    await page.getByRole("heading", { name: "Staged — unverified" }).waitFor();
    assert.match(await page.locator(".summary").innerText(), /pane 7/);
    assert.deepEqual(await page.evaluate(() => window.fixture.calls), []);
    await page.getByRole("button", { name: "Reveal destination", exact: true }).click();
    await page.getByText("Reveal requested.", { exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Reveal attempted" }).isEnabled(), false);
    const calls = await page.evaluate(() => window.fixture.calls);
    assert.deepEqual(calls, [{ action: "reveal", request: { operationId: "550e8400-e29b-41d4-a716-446655440000" } }]);
    assert.equal(await page.getByRole("heading", { name: "Staged — unverified" }).count(), 1);
  });
});

void test("renderer fixture: restoring consumed or unknown Reveal state does not create another attempt", async () => {
  for (const restoredResult of ["consumed", "unknown"]) {
    await withPage({ restoredResult }, async (page) => {
      await page.getByRole("heading", { name: "Staged — unverified" }).waitFor();
      assert.equal(await page.getByRole("button", { name: "Reveal destination" }).count(), 0);
      assert.deepEqual(await page.evaluate(() => window.fixture.calls), []);
      await page.getByRole("button", { name: "Done", exact: true }).click();
      await page.getByRole("button", { name: "Capture region" }).waitFor();
    });
  }
});
