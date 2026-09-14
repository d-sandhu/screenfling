const { execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const { createReadStream, constants } = require("node:fs");
const { access, appendFile, mkdtemp, rm } = require("node:fs/promises");
const path = require("node:path");

const VERSION = "20240203-110809-5046fc22";
const SHA256 = "e77388cad55f2e9da95a220a89206a6c58f865874a629b7c3ea3c162f5692224";

async function verifyWezTermArchive(archive) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(archive)) hash.update(chunk);
  if (hash.digest("hex") !== SHA256) throw new Error("Headless WezTerm checksum mismatch.");
}

// The same pinned, disposable fixture is used by CI and release preparation.
// It is never installed and does not open a GUI or read an operator's config.
async function prepareWezTermFixture(parent) {
  if (process.platform !== "darwin" || !path.isAbsolute(parent) || /[\r\n]/u.test(parent)) {
    throw new Error("A macOS temporary directory is required for the headless fixture.");
  }
  const directory = await mkdtemp(path.join(parent, "sf-wezterm-"));
  try {
    const archive = path.join(directory, "wezterm.zip");
    const options = { stdio: "pipe", timeout: 125_000, maxBuffer: 128 * 1024 };
    execFileSync("/usr/bin/curl", [
      "--fail", "--silent", "--show-error", "--location", "--proto", "=https",
      "--proto-redir", "=https", "--tlsv1.2", "--max-time", "120",
      `https://github.com/wezterm/wezterm/releases/download/${VERSION}/WezTerm-macos-${VERSION}.zip`,
      "--output", archive,
    ], options);
    await verifyWezTermArchive(archive); // Never extract an unverified download.
    execFileSync("/usr/bin/ditto", ["-x", "-k", archive, directory], options);
    const binaries = path.join(directory, `WezTerm-macos-${VERSION}/WezTerm.app/Contents/MacOS`);
    const environment = {
      SCREENFLING_TEST_WEZTERM_EXECUTABLE: path.join(binaries, "wezterm"),
      SCREENFLING_TEST_WEZTERM_MUX_SERVER: path.join(binaries, "wezterm-mux-server"),
    };
    await Promise.all(Object.values(environment).map((file) => access(file, constants.X_OK)));
    await rm(archive);
    return { directory, environment };
  } catch {
    await rm(directory, { recursive: true, force: true });
    throw new Error("Pinned headless WezTerm preparation failed; no verification was skipped.");
  }
}

if (require.main === module) {
  void (async () => {
    const parent = process.env.RUNNER_TEMP;
    const environmentFile = process.env.GITHUB_ENV;
    if (parent === undefined || environmentFile === undefined) {
      throw new Error("This entry point requires a GitHub runner environment.");
    }
    const fixture = await prepareWezTermFixture(parent);
    try {
      await appendFile(environmentFile, Object.entries(fixture.environment)
        .map(([key, value]) => `${key}=${value}\n`).join(""));
    } catch (error) {
      await rm(fixture.directory, { recursive: true, force: true });
      throw error;
    }
    console.log(`Pinned headless WezTerm ${VERSION} verified; no installation or GUI.`);
  })().catch(() => {
    console.error("Pinned headless WezTerm preparation failed.");
    process.exitCode = 1;
  });
}

module.exports = { prepareWezTermFixture, verifyWezTermArchive };
