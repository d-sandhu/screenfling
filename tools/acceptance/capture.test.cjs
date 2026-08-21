const assert = require("node:assert/strict");
const { mkdirSync, mkdtempSync, rmSync, writeFileSync } = require("node:fs");
const { afterEach, test } = require("node:test");
const os = require("node:os");
const path = require("node:path");

const {
  allowExpectedPageClose,
  cancelOverlay,
  completeOverlaySelection,
  readArtifactEvidence,
  readDiagnostics,
  startCapture,
  waitForOverlay,
} = require("./capture.cjs");
const packageMetadata = require("../../package.json");

const originalWindow = globalThis.window;
const temporaryDirectories = [];

afterEach(() => {
  globalThis.window = originalWindow;
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

async function createMacArtifact(
  bundleIdentifier,
  bundleName = packageMetadata.productName,
  version = packageMetadata.version,
) {
  const plist = await import("plist");
  const root = mkdtempSync(path.join(os.tmpdir(), "screenfling-acceptance-"));
  temporaryDirectories.push(root);
  const contents = path.join(root, "ScreenFling.app", "Contents");
  const executable = path.join(contents, "MacOS", "ScreenFling");
  mkdirSync(path.dirname(executable), { recursive: true });
  mkdirSync(path.join(contents, "Resources"), { recursive: true });
  writeFileSync(executable, "");
  writeFileSync(path.join(contents, "Resources", "app.asar"), "");
  writeFileSync(
    path.join(contents, "Info.plist"),
    plist.build({
      CFBundleIdentifier: bundleIdentifier,
      CFBundleName: bundleName,
      CFBundleShortVersionString: version,
    }),
  );
  return executable;
}

void test("cancelOverlay reports a bridge failure while the overlay remains open", async () => {
  const bridgeFailure = new Error("cancel bridge failed");
  globalThis.window = {
    captureOverlay: {
      cancel: () => Promise.reject(bridgeFailure),
    },
  };
  const overlay = {
    close: () => Promise.resolve(),
    evaluate: async (action, operationId) => action(operationId),
    isClosed: () => false,
  };

  await assert.rejects(cancelOverlay(overlay, "operation-id"), bridgeFailure);
});

void test("completeOverlaySelection reports a bridge failure while the overlay remains open", async () => {
  const bridgeFailure = new Error("selection bridge failed");
  globalThis.window = {
    captureOverlay: {
      completeSelection: () => Promise.reject(bridgeFailure),
    },
  };
  const overlay = {
    close: () => Promise.resolve(),
    evaluate: async (action, request) => action(request),
    isClosed: () => false,
  };

  await assert.rejects(
    completeOverlaySelection(overlay, { operationId: "operation-id", selection: {} }),
    bridgeFailure,
  );
});

void test("completeOverlaySelection closes an overlay that does not close itself", async () => {
  let closed = false;
  globalThis.window = {
    captureOverlay: {
      completeSelection: () => Promise.resolve(),
    },
  };
  const overlay = {
    close: () => {
      closed = true;
      return Promise.resolve();
    },
    evaluate: async (action, request) => action(request),
    isClosed: () => closed,
  };

  await assert.rejects(
    completeOverlaySelection(overlay, { operationId: "operation-id", selection: {} }, 1),
    /overlay-close-timeout/,
  );
  assert.equal(closed, true);
});

void test("readDiagnostics returns only the bridge-provided sanitized snapshot", async () => {
  const diagnostics = {
    version: 1,
    starts: { button: 2, shortcut: 1 },
    delivery: {
      cancelled: 1,
      copied: 1,
      dispatchedUnverified: 0,
      failures: {
        captureFailed: 0,
        clipboardFailed: 0,
        dispatchFailed: 0,
        permissionBlocked: 0,
        targetStale: 0,
        unexpected: 0,
        unsupported: 0,
      },
      sentVerified: 0,
      stagedVerified: 0,
    },
    reveal: { failed: 0, revealed: 0, stale: 0, unavailable: 0, unsupported: 0 },
    timingsMs: {
      buttonToSelecting: { count: 0, maximum: null, median: null, minimum: null, p95: null },
      selectionToEditing: { count: 0, maximum: null, median: null, minimum: null, p95: null },
      selectionToResult: { count: 0, maximum: null, median: null, minimum: null, p95: null },
      shortcutToSelecting: { count: 0, maximum: null, median: null, minimum: null, p95: null },
    },
  };
  globalThis.window = {
    screenFling: { getDiagnostics: () => Promise.resolve(diagnostics) },
  };
  const mainWindow = { evaluate: async (action) => action() };

  assert.deepEqual(await readDiagnostics(mainWindow), diagnostics);
  assert.equal(JSON.stringify(await readDiagnostics(mainWindow)).includes("operationId"), false);
});

void test("readDiagnostics reports an unavailable bridge", async () => {
  globalThis.window = {};
  const mainWindow = { evaluate: async (action) => action() };

  await assert.rejects(readDiagnostics(mainWindow), /Diagnostics bridge unavailable/);
});

void test("allowExpectedPageClose accepts a bridge race only after the overlay closes", async () => {
  const closedPage = { isClosed: () => true };

  await assert.doesNotReject(
    allowExpectedPageClose(closedPage, () => Promise.reject(new Error("page closed"))),
  );
});

void test("allowExpectedPageClose times out a bridge that never settles", async () => {
  const openPage = { isClosed: () => false };

  await assert.rejects(
    allowExpectedPageClose(openPage, () => new Promise(() => undefined), 1),
    /overlay-action-timeout/,
  );
});

void test(
  "readArtifactEvidence rejects a packaged macOS artifact with the wrong identity",
  { skip: process.platform !== "darwin" },
  async () => {
    const wrongIdentities = [
      ["com.example.not-screenfling", packageMetadata.productName, packageMetadata.version],
      [packageMetadata.build.appId, "Not ScreenFling", packageMetadata.version],
      [packageMetadata.build.appId, packageMetadata.productName, "999.0.0"],
    ];
    for (const identity of wrongIdentities) {
      const executable = await createMacArtifact(...identity);
      await assert.rejects(readArtifactEvidence(executable), /artifact-identity-mismatch/);
    }
  },
);

void test(
  "readArtifactEvidence verifies the exact packaged macOS identity",
  { skip: process.platform !== "darwin" },
  async () => {
    const executable = await createMacArtifact(packageMetadata.build.appId);

    await assert.doesNotReject(readArtifactEvidence(executable));
    assert.equal((await readArtifactEvidence(executable)).identityVerified, true);
  },
);

void test("waitForOverlay rejects when no overlay page opens", async () => {
  const context = { waitForEvent: () => new Promise(() => undefined) };
  const externalDeadline = new Promise((_, rejectDeadline) => {
    setTimeout(() => rejectDeadline(new Error("external-test-deadline")), 25);
  });

  await assert.rejects(
    Promise.race([waitForOverlay(context, 1), externalDeadline]),
    /overlay-open-timeout/,
  );
});

void test("waitForOverlay closes an overlay page that arrives after its deadline", async () => {
  let closed = false;
  const overlay = {
    close: () => {
      closed = true;
      return Promise.resolve();
    },
    getByText: () => ({ waitFor: () => Promise.resolve() }),
    isClosed: () => closed,
    waitForURL: () => Promise.resolve(),
  };
  const context = {
    waitForEvent: () => new Promise((resolvePage) => setTimeout(() => resolvePage(overlay), 5)),
  };

  await assert.rejects(waitForOverlay(context, 1), /overlay-open-timeout/);
  await new Promise((resolveLatePage) => setTimeout(resolveLatePage, 10));
  assert.equal(closed, true);
});

void test("startCapture rejects when the overlay never reaches selecting", async () => {
  let closed = false;
  const overlay = {
    close: () => {
      closed = true;
      return Promise.resolve();
    },
    getByText: () => ({ waitFor: () => Promise.resolve() }),
    isClosed: () => closed,
    waitForURL: () => Promise.resolve(),
  };
  const context = { waitForEvent: () => Promise.resolve(overlay) };
  const mainWindow = {
    evaluate: () => Promise.resolve({ phase: "snapshotting" }),
    getByRole: () => ({ click: () => Promise.resolve() }),
  };
  const externalDeadline = new Promise((_, rejectDeadline) => {
    setTimeout(() => rejectDeadline(new Error("external-test-deadline")), 25);
  });

  await assert.rejects(
    Promise.race([startCapture(mainWindow, context, 1), externalDeadline]),
    /overlay-ready-timeout/,
  );
  assert.equal(closed, true);
});
