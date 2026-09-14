const { spawnSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const { createReadStream } = require("node:fs");
const { mkdir, mkdtemp, rm, writeFile } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const path = require("node:path");

const metadata = require("../../package.json");
const { readArtifactEvidence } = require("./capture.cjs");

function run(executable, arguments_) {
  const result = spawnSync(executable, arguments_, {
    encoding: "utf8",
    maxBuffer: 128 * 1024,
    timeout: 120_000,
  });
  if (result.status !== 0) throw new Error("candidate-archive-command-failed");
  return result;
}

async function verify(app) {
  const identity = await readArtifactEvidence(path.join(app, "Contents/MacOS/ScreenFling"));
  run("/usr/bin/codesign", ["--verify", "--deep", "--strict", app]);
  run("/usr/bin/codesign", [
    "--verify",
    "--strict",
    path.join(app, "Contents/Resources/screenfling-selector-acl"),
  ]);
  const signature = run("/usr/bin/codesign", ["--display", "--verbose=2", app]);
  if (!/^Signature=adhoc$/m.test(signature.stderr)) throw new Error("candidate-not-adhoc");
  return identity;
}

async function main() {
  if (process.platform !== "darwin") throw new Error("macos-host-required");
  if (!["arm64", "x64"].includes(process.arch)) throw new Error("unsupported-package-architecture");
  const testedCommit = run("git", ["rev-parse", "HEAD"]).stdout.trim();
  const sourceCommit = process.env.SCREENFLING_SOURCE_COMMIT ?? testedCommit;
  if (![testedCommit, sourceCommit].every((value) => /^[a-f0-9]{40}$/.test(value))) {
    throw new Error("candidate-commit-unavailable");
  }
  const app = path.resolve(
    "release",
    process.arch === "arm64" ? "mac-arm64" : "mac",
    "ScreenFling.app",
  );
  const identity = await verify(app);
  const output = path.resolve("release/candidate");
  await mkdir(output, { recursive: true });
  const filename = `ScreenFling-macos-${process.arch}.zip`;
  const archive = path.join(output, filename);
  run("/usr/bin/ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", app, archive]);
  const unpacked = await mkdtemp(path.join(tmpdir(), "screenfling-archive-"));
  try {
    run("/usr/bin/ditto", ["-x", "-k", archive, unpacked]);
    await verify(path.join(unpacked, "ScreenFling.app"));
  } finally {
    await rm(unpacked, { recursive: true, force: true });
  }
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(archive)) hash.update(chunk);
  const sha256 = hash.digest("hex");
  await writeFile(path.join(output, "SHA256SUMS"), `${sha256}  ${filename}\n`);
  await writeFile(
    path.join(output, "candidate.json"),
    JSON.stringify(
      {
        schema: "screenfling-dogfood-candidate/v1",
        classification: "pre-alpha-not-native-accepted",
        sourceCommit,
        testedCommit,
        architecture: process.arch,
        application: identity,
        electron: metadata.devDependencies.electron,
        node: process.version,
        signature: "adhoc",
        developerId: false,
        notarized: false,
        archiveRoundTripVerified: true,
        filename,
        sha256,
      },
      null,
      2,
    ) + "\n",
  );
  console.log("macOS candidate archive, extracted signatures, identity, and checksum verified.");
}

void main().catch(() => {
  console.error("macOS candidate archive failed; no release readiness is claimed.");
  process.exitCode = 1;
});
