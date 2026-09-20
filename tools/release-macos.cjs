const { spawnSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const { createReadStream, readFileSync } = require("node:fs");
const { mkdir, mkdtemp, rename, rm, writeFile } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { z } = require("zod");

const { prepareWezTermFixture } = require("./acceptance/prepare-wezterm.cjs");
const metadata = require("../package.json");
const ROOT = path.resolve(__dirname, "..");
const profileSchema = z.string().min(1).max(128).regex(/^[^\p{Cc}\p{Zl}\p{Zp}]+$/u);
const submissionSchema = z.object({
  status: z.literal("Accepted"),
  id: z.string().regex(/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i),
});
const entitlementSchema = z.strictObject({ "com.apple.security.cs.allow-jit": z.literal(true) });
const lifecycleSchema = z.object({
  acceptance: z.literal("packaged-lifecycle"),
  status: z.literal("passed"),
  host: z.object({ platform: z.literal("darwin"), arch: z.literal("arm64") }),
  application: z.object({
    identityVerified: z.literal(true),
    bundleIdentifier: z.literal(metadata.build.appId),
    version: z.literal(metadata.build.mac.bundleShortVersion),
    buildVersion: z.literal(metadata.build.mac.bundleVersion),
  }),
  checks: z.object({
    packagedAclGate: z.literal(true),
    startupAndHardenedBridge: z.literal(true),
    packagedDevelopmentRendererIgnored: z.literal(true),
    rendererStorageNotPersisted: z.literal(true),
    duplicateLaunchRejected: z.literal(true),
    crashedRendererReplacedOnce: z.literal(true),
    unresponsiveRendererDidNotBlockRestart: z.literal(true),
    closedWindowReopened: z.literal(true),
    workflowDiagnosticsUnchanged: z.literal(true),
    isolatedSettingsSaveRestartReloadDisconnect: z.literal(true),
  }),
});

function releaseConfiguration(environment, platform, architecture) {
  if (platform !== "darwin" || architecture !== "arm64") {
    throw new Error("The macOS alpha distribution must be built on an Apple Silicon Mac.");
  }
  const identity = environment.SCREENFLING_SIGNING_IDENTITY;
  const teamId = environment.SCREENFLING_APPLE_TEAM_ID;
  const profile = environment.SCREENFLING_NOTARY_PROFILE;
  if (!/^[a-fA-F0-9]{40}$/.test(identity ?? "")) {
    throw new Error("Set SCREENFLING_SIGNING_IDENTITY to the installed Developer ID certificate SHA-1.");
  }
  if (!/^[A-Z0-9]{10}$/.test(teamId ?? "")) {
    throw new Error("Set SCREENFLING_APPLE_TEAM_ID to the certificate's ten-character team ID.");
  }
  const parsedProfile = profileSchema.safeParse(profile);
  if (!parsedProfile.success) {
    throw new Error("Set SCREENFLING_NOTARY_PROFILE to an existing notarytool Keychain profile.");
  }
  return { identity: identity.toUpperCase(), teamId, profile: parsedProfile.data };
}

function assertReleaseToolchain(node, npm) {
  const expectedNode = readFileSync(path.join(ROOT, ".node-version"), "utf8").trim();
  if (node !== `v${expectedNode}` || `npm@${npm}` !== metadata.packageManager) {
    throw new Error(`Release preparation requires Node ${expectedNode} and ${metadata.packageManager}.`);
  }
}

function assertDeveloperSignature(details, teamId) {
  if (!/^Authority=Developer ID Application: .+$/m.test(details) ||
      !details.split(/\r?\n/).includes(`TeamIdentifier=${teamId}`) ||
      !/^CodeDirectory .+flags=[^\r\n]*\bruntime\b/m.test(details) ||
      !/^Timestamp=.+$/m.test(details) || /^Signature=adhoc$/m.test(details)) {
    throw new Error("Developer ID, expected team, hardened runtime, or timestamp verification failed.");
  }
}

function assertReleaseEntitlements(value) {
  if (!entitlementSchema.safeParse(value).success) {
    throw new Error("Release entitlements must allow JIT only; no production protection may be disabled.");
  }
}

function acceptedSubmission(text) {
  let value;
  try { value = JSON.parse(text); } catch { /* Reject malformed service output. */ }
  const parsed = submissionSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error("Apple notarization was not Accepted; no distribution archive was produced.");
  }
  return parsed.data.id;
}

function checkedLifecycle(text) {
  let value;
  try { value = JSON.parse(text); } catch { /* Reject missing or malformed evidence. */ }
  const parsed = lifecycleSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error("The packaged lifecycle must pass every required check, including settings restarts.");
  }
  return parsed.data.checks;
}

function signingOptions(configuration, app) {
  return {
    ...metadata.build,
    forceCodeSigning: true,
    mac: {
      ...metadata.build.mac,
      identity: configuration.identity,
      hardenedRuntime: true,
      entitlements: "tools/entitlements.mac.plist",
      entitlementsInherit: "tools/entitlements.mac.plist",
      preAutoEntitlements: false,
      binaries: [path.join(app, "Contents/Resources/screenfling-selector-acl")],
      // Submit explicitly below, so absent credentials cannot silently skip notarization.
      notarize: false,
      gatekeeperAssess: false,
    },
  };
}

function run(label, executable, arguments_, timeout = 120_000) {
  const result = spawnSync(executable, arguments_, {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
    timeout,
    shell: false,
  });
  if (result.status !== 0) throw new Error(`${label} failed. No distribution is ready.`);
  return { stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function cleanCommit() {
  const commit = run("Source identification", "git", ["rev-parse", "HEAD"]).stdout.trim();
  if (!/^[a-f0-9]{40}$/.test(commit) ||
      run("Clean checkout check", "git", ["status", "--porcelain"]).stdout.trim() !== "") {
    throw new Error("Use a clean, committed checkout before preparing a distribution.");
  }
  return commit;
}

async function reservePreparation(output, lock) {
  await mkdir(path.dirname(lock), { recursive: true });
  try { await mkdir(lock); } catch {
    throw new Error("Release preparation is already active or interrupted. Inspect release/.release-preparing before retrying.");
  }
  try {
    await mkdir(path.dirname(output), { recursive: true });
    await mkdir(output); // Never overwrite an existing candidate, even an interrupted one.
  } catch (error) {
    await rm(lock, { recursive: true, force: true });
    throw error;
  }
}

async function verify(app, configuration, notarized) {
  const { readArtifactEvidence } = require("./acceptance/capture.cjs");
  const plist = await import("plist");
  const identity = await readArtifactEvidence(path.join(app, "Contents/MacOS/ScreenFling"));
  run("Bundle signature", "/usr/bin/codesign", ["--verify", "--deep", "--strict", app]);
  for (const signed of [
    app,
    path.join(app, "Contents/Frameworks/ScreenFling Helper (Renderer).app"),
    path.join(app, "Contents/Resources/screenfling-selector-acl"),
  ]) {
    run("Signature", "/usr/bin/codesign", ["--verify", "--strict", signed]);
    assertDeveloperSignature(
      run("Signature identity", "/usr/bin/codesign", ["--display", "--verbose=4", signed]).stderr,
      configuration.teamId,
    );
    const entitlements = run("Release entitlements", "/usr/bin/codesign", [
      "--display", "--entitlements", ":-", signed,
    ]).stdout;
    assertReleaseEntitlements(plist.parse(entitlements));
  }
  if (notarized) {
    run("Stapled ticket", "/usr/bin/xcrun", ["stapler", "validate", app]);
    run("Gatekeeper assessment", "/usr/sbin/spctl", ["--assess", "--type", "execute", app]);
  }
  return identity;
}

async function main() {
  const configuration = releaseConfiguration(process.env, process.platform, process.arch);
  process.chdir(ROOT);
  const npmVersion = run("npm version", "npm", ["--version"]).stdout.trim();
  assertReleaseToolchain(process.version, npmVersion);
  const version = metadata.build.extraMetadata.version;
  if (!/^\d+\.\d+\.\d+-alpha\.\d+$/.test(version)) {
    throw new Error("Set an explicit alpha application version in build.extraMetadata.version.");
  }
  const commit = cleanCommit();
  // Do not embed a stale CI/environment commit in the renderer.
  process.env.GITHUB_SHA = commit;
  const identities = run("Installed signing identity", "/usr/bin/security", [
    "find-identity", "-v", "-p", "codesigning",
  ]);
  if (!identities.stdout.split(/\r?\n/).some((line) =>
    line.includes(configuration.identity) && line.includes("Developer ID Application:") &&
    line.includes(`(${configuration.teamId})`))) {
    throw new Error("The selected Developer ID certificate/private key is not available in Keychain.");
  }
  const output = path.join(ROOT, "release/distribution", `${version}-${commit.slice(0, 12)}`);
  const lock = path.join(ROOT, "release/.release-preparing");
  await reservePreparation(output, lock);
  let fixture = null;
  let temporary = null;
  let completed = false;
  try {
    // Build from the committed lockfile, not a developer's existing node_modules.
    run("Locked dependency install", "npm", ["ci", "--no-audit", "--include=dev"], 600_000);
    fixture = await prepareWezTermFixture(tmpdir());
    Object.assign(process.env, fixture.environment);
    console.log("Checking source, dependencies, and the production UI before signing.");
    run("Dependency audit", "npm", ["audit", "--audit-level=high"]);
    run("Project checks", "npm", ["run", "check"], 600_000);
    run("Production build", "npm", ["run", "build"], 600_000);
    run("Browser fixture runtime", "npx", ["--no-install", "playwright", "install", "chromium", "--only-shell"], 300_000);
    run("Built renderer checks", process.execPath, ["--test", "tools/acceptance/ui.test.cjs"], 120_000);
    const app = path.join(ROOT, "release/mac-arm64/ScreenFling.app");
    const { build, Platform, Arch } = require("electron-builder");
    await build({
      targets: Platform.MAC.createTarget(["dir"], Arch.arm64),
      config: signingOptions(configuration, app),
      publish: "never",
    });
    await verify(app, configuration, false);
    const packagedChecks = checkedLifecycle(
      run("Packaged lifecycle", process.execPath, ["tools/acceptance/lifecycle.cjs"], 120_000).stdout,
    );

    temporary = await mkdtemp(path.join(ROOT, "release/.notarize-"));
    const submission = path.join(temporary, "submission.zip");
    run("Notarization archive", "/usr/bin/ditto", [
      "-c", "-k", "--sequesterRsrc", "--keepParent", app, submission,
    ]);
    console.log("Submitting the signed application to Apple using the existing Keychain profile.");
    const submissionId = acceptedSubmission(run("Apple notarization", "/usr/bin/xcrun", [
      "notarytool", "submit", submission, "--keychain-profile", configuration.profile,
      "--wait", "--output-format", "json",
    ], 1_200_000).stdout);
    run("Ticket stapling", "/usr/bin/xcrun", ["stapler", "staple", app]);
    const application = await verify(app, configuration, true);
    const filename = `ScreenFling-${version}-macos-arm64.zip`;
    const archive = path.join(temporary, filename);
    run("Distribution archive", "/usr/bin/ditto", [
      "-c", "-k", "--sequesterRsrc", "--keepParent", app, archive,
    ]);
    const extracted = path.join(temporary, "extracted");
    run("Archive extraction", "/usr/bin/ditto", ["-x", "-k", archive, extracted]);
    await verify(path.join(extracted, "ScreenFling.app"), configuration, true);
    if (cleanCommit() !== commit) throw new Error("Source changed during distribution preparation.");
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(archive)) hash.update(chunk);
    const sha256 = hash.digest("hex");
    await rename(archive, path.join(output, filename));
    await writeFile(path.join(output, "SHA256SUMS"), `${sha256}  ${filename}\n`);
    await writeFile(path.join(output, "distribution.json"), JSON.stringify({
      schema: "screenfling-distribution/v1",
      sourceCommit: commit,
      architecture: "arm64",
      application,
      applicationVersion: version,
      node: process.version,
      npm: npmVersion,
      electron: metadata.devDependencies.electron,
      filename,
      sha256,
      developerId: true,
      notarized: true,
      notarizationSubmissionId: submissionId,
      archiveRoundTripVerified: true,
      packagedChecks,
      nativeAcceptance: "not-recorded-by-this-command",
      published: false,
    }, null, 2) + "\n");
    completed = true;
    console.log(`Verified signed distribution: ${path.relative(ROOT, output)}`);
    console.log("Nothing was published. Native and real-agent acceptance still need separate evidence.");
  } finally {
    if (!completed) await rm(output, { recursive: true, force: true });
    if (temporary !== null) await rm(temporary, { recursive: true, force: true });
    if (fixture !== null) await rm(fixture.directory, { recursive: true, force: true });
    await rm(lock, { recursive: true, force: true });
  }
}

if (require.main === module) {
  if (process.argv.length === 3 && process.argv[2] === "--help") {
    console.log(`npm run release:mac
Build on an Apple Silicon Mac from a clean checkout with the pinned Node/npm versions.
Required environment variables (no passwords or private keys go in this repository):
  SCREENFLING_SIGNING_IDENTITY  Installed Developer ID certificate SHA-1 (40 hex characters)
  SCREENFLING_APPLE_TEAM_ID     Certificate's ten-character Apple team ID
  SCREENFLING_NOTARY_PROFILE    Existing xcrun notarytool Keychain profile
Reinstalls the committed lockfile, then downloads the checksum-pinned headless
WezTerm fixture into a disposable directory,
then runs the audit, existing code/browser checks, and the full packaged restart checks.
Signs with hardened runtime and JIT-only entitlements, notarizes, staples, verifies
Gatekeeper and the extracted ZIP, then writes release/distribution/.
Refuses concurrent preparation and existing output. Does not publish, change macOS
permissions, or claim physical/agent acceptance.`);
  } else if (process.argv.length !== 2) {
    console.error("Unknown arguments. Use npm run release:mac -- --help.");
    process.exitCode = 1;
  } else {
    void main().catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
  }
}

module.exports = {
  releaseConfiguration, assertDeveloperSignature, acceptedSubmission, signingOptions,
  assertReleaseToolchain, assertReleaseEntitlements, checkedLifecycle, reservePreparation,
};