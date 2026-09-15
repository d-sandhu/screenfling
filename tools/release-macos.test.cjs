const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { mkdtemp, readFile, rm, writeFile } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { test } = require("node:test");
const path = require("node:path");
const {
  releaseConfiguration, assertDeveloperSignature, acceptedSubmission, signingOptions,
  assertReleaseToolchain, assertReleaseEntitlements, checkedLifecycle, reservePreparation,
} = require("./release-macos.cjs");
const { verifyWezTermArchive } = require("./acceptance/prepare-wezterm.cjs");
const metadata = require("../package.json");

const environment = {
  SCREENFLING_SIGNING_IDENTITY: "a".repeat(40),
  SCREENFLING_APPLE_TEAM_ID: "ABCD123456",
  SCREENFLING_NOTARY_PROFILE: "synthetic-profile",
};
const signature = [
  "CodeDirectory v=20500 size=123 flags=0x10000(runtime) hashes=12+3 location=embedded",
  "Authority=Developer ID Application: Synthetic (ABCD123456)",
  "TeamIdentifier=ABCD123456",
  "Timestamp=Sep 14, 2026 at 12:00:00 PM",
].join("\n");

void test("distribution rejects unsupported hosts and missing, ad-hoc or malformed signing inputs", () => {
  for (const [platform, arch] of [["linux", "arm64"], ["darwin", "x64"], ["win32", "x64"]]) {
    assert.throws(() => releaseConfiguration(environment, platform, arch));
  }
  for (const [key, invalid] of [
    ["SCREENFLING_SIGNING_IDENTITY", ""], ["SCREENFLING_SIGNING_IDENTITY", "-"],
    ["SCREENFLING_APPLE_TEAM_ID", ""], ["SCREENFLING_NOTARY_PROFILE", ""],
    ["SCREENFLING_NOTARY_PROFILE", "bad\nprofile"],
  ]) {
    assert.throws(() => releaseConfiguration({ ...environment, [key]: invalid }, "darwin", "arm64"));
  }
  assert.equal(releaseConfiguration(environment, "darwin", "arm64").identity, "A".repeat(40));
});

void test("distribution requires the actual expected-team Developer ID signature and hardened runtime", () => {
  assert.doesNotThrow(() => assertDeveloperSignature(signature, "ABCD123456"));
  for (const invalid of [
    "Signature=adhoc\nTeamIdentifier=ABCD123456",
    signature.replace("ABCD123456", "XXXXXXXXXX").replace("ABCD123456", "XXXXXXXXXX"),
    signature.replace("Developer ID Application:", "Apple Development:"),
    signature.replace("0x10000(runtime)", "0x0(none)"),
    signature.replace(/Timestamp=.+/, ""),
    signature + "\nSignature=adhoc",
  ]) assert.throws(() => assertDeveloperSignature(invalid, "ABCD123456"));
});

void test("only an Accepted notarization response with an ID permits stapling and archiving", () => {
  const id = "550e8400-e29b-41d4-a716-446655440000";
  assert.equal(acceptedSubmission(JSON.stringify({ status: "Accepted", id })), id);
  const invalidResponses = ["", "not-json", "null", ...[
    {}, { status: "Accepted" }, { status: "Invalid", id },
    { status: "In Progress", id }, { status: "Accepted", id: "bad" },
  ].map((value) => JSON.stringify(value))];
  for (const text of invalidResponses) assert.throws(() => acceptedSubmission(text));
});

void test("release packaging retains existing security fuses and explicitly signs the native helper", () => {
  const app = path.resolve("synthetic/ScreenFling.app");
  const options = signingOptions(releaseConfiguration(environment, "darwin", "arm64"), app);
  assert.equal(options.forceCodeSigning, true);
  assert.equal(options.mac.identity, "A".repeat(40));
  assert.equal(options.mac.hardenedRuntime, true);
  assert.equal(options.mac.notarize, false); // A separate, checked notarytool response is required.
  assert.deepEqual(options.mac.binaries, [path.join(app, "Contents/Resources/screenfling-selector-acl")]);
  assert.equal(options.electronFuses.runAsNode, false);
  assert.equal(options.electronFuses.onlyLoadAppFromAsar, true);
  assert.equal(options.electronFuses.enableNodeOptionsEnvironmentVariable, false);
  const version = /^(\d+\.\d+\.\d+)-alpha\.(\d+)$/.exec(options.extraMetadata.version);
  assert.ok(version);
  assert.equal(options.mac.bundleShortVersion, version[1]);
  assert.equal(options.mac.bundleVersion, version[2]);
});

void test("release preparation rejects an unpinned Node or npm runtime", () => {
  const node = `v${readFileSync(path.join(__dirname, "../.node-version"), "utf8").trim()}`;
  const npm = metadata.packageManager.slice("npm@".length);
  assert.doesNotThrow(() => assertReleaseToolchain(node, npm));
  assert.throws(() => assertReleaseToolchain("v22.0.0", npm));
  assert.throws(() => assertReleaseToolchain(node, "0.0.0"));
});

void test("production entitlements cannot silently disable library validation or debugging protection", () => {
  const allowed = { "com.apple.security.cs.allow-jit": true };
  assert.doesNotThrow(() => assertReleaseEntitlements(allowed));
  for (const key of [
    "com.apple.security.cs.disable-library-validation",
    "com.apple.security.cs.allow-unsigned-executable-memory",
    "com.apple.security.cs.allow-dyld-environment-variables",
    "com.apple.security.get-task-allow",
  ]) assert.throws(() => assertReleaseEntitlements({ ...allowed, [key]: true }));
  for (const invalid of [null, {}, { "com.apple.security.cs.allow-jit": false }]) {
    assert.throws(() => assertReleaseEntitlements(invalid));
  }
});

void test("a passed lifecycle label cannot hide skipped settings, wrong identity, or missing checks", () => {
  const report = {
    acceptance: "packaged-lifecycle",
    status: "passed",
    host: { platform: "darwin", arch: "arm64" },
    application: {
      identityVerified: true, bundleIdentifier: metadata.build.appId,
      version: metadata.build.mac.bundleShortVersion, buildVersion: metadata.build.mac.bundleVersion,
    },
    checks: {
      packagedAclGate: true, startupAndHardenedBridge: true, duplicateLaunchRejected: true,
      packagedDevelopmentRendererIgnored: true, rendererStorageNotPersisted: true,
      crashedRendererReplacedOnce: true, closedWindowReopened: true,
      unresponsiveRendererDidNotBlockRestart: true,
      workflowDiagnosticsUnchanged: true, isolatedSettingsSaveRestartReloadDisconnect: true,
    },
  };
  assert.deepEqual(checkedLifecycle(JSON.stringify(report)), report.checks);
  for (const key of Object.keys(report.checks)) {
    assert.throws(() => checkedLifecycle(JSON.stringify({
      ...report, checks: { ...report.checks, [key]: false },
    })));
    const checks = { ...report.checks };
    delete checks[key];
    assert.throws(() => checkedLifecycle(JSON.stringify({ ...report, checks })));
  }
  for (const invalid of [
    { ...report, status: "failed" },
    { ...report, application: { ...report.application, buildVersion: "wrong" } },
    { ...report, host: { platform: "darwin", arch: "x64" } },
    {}, null,
  ]) assert.throws(() => checkedLifecycle(JSON.stringify(invalid)));
  assert.throws(() => checkedLifecycle(""));
  assert.throws(() => checkedLifecycle("not-json"));
});

void test("preparation reserves output early without removing existing output or another run's lock", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "sf-release-reservation-"));
  const output = path.join(root, "distribution", "candidate");
  const lock = path.join(root, ".release-preparing");
  try {
    await reservePreparation(output, lock);
    const marker = path.join(output, "keep");
    await writeFile(marker, "existing-output");
    await writeFile(path.join(lock, "keep"), "active-run");
    await assert.rejects(reservePreparation(output, lock));
    assert.equal(await readFile(marker, "utf8"), "existing-output");
    assert.equal(await readFile(path.join(lock, "keep"), "utf8"), "active-run");
    await rm(lock, { recursive: true });
    await assert.rejects(reservePreparation(output, lock), { code: "EEXIST" });
    assert.equal(await readFile(marker, "utf8"), "existing-output");
    await assert.rejects(readFile(path.join(lock, "keep")), { code: "ENOENT" });
  } finally { await rm(root, { recursive: true, force: true }); }
});

void test("the shared WezTerm fixture refuses bytes that do not match the pinned archive", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "sf-release-checksum-"));
  try {
    const archive = path.join(root, "fixture.zip");
    await writeFile(archive, "synthetic-not-the-pinned-archive");
    await assert.rejects(verifyWezTermArchive(archive), /checksum mismatch/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
