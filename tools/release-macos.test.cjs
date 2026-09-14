const assert = require("node:assert/strict");
const { test } = require("node:test");
const path = require("node:path");
const {
  releaseConfiguration, assertDeveloperSignature, acceptedSubmission, signingOptions,
} = require("./release-macos.cjs");

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

test("distribution rejects unsupported hosts and missing, ad-hoc or malformed signing inputs", () => {
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

test("distribution requires the actual expected-team Developer ID signature and hardened runtime", () => {
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

test("only an Accepted notarization response with an ID permits stapling and archiving", () => {
  const id = "550e8400-e29b-41d4-a716-446655440000";
  assert.equal(acceptedSubmission(JSON.stringify({ status: "Accepted", id })), id);
  for (const value of ["", "not-json", "null", {}, { status: "Accepted" },
    { status: "Invalid", id }, { status: "In Progress", id }, { status: "Accepted", id: "bad" }]) {
    assert.throws(() => acceptedSubmission(typeof value === "string" ? value : JSON.stringify(value)));
  }
});

test("release packaging retains existing security fuses and explicitly signs the native helper", () => {
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
  assert.match(options.extraMetadata.version, /^\d+\.\d+\.\d+-alpha\.\d+$/);
});
