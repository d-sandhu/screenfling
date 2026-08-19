const { readFile, writeFile } = require("node:fs/promises");
const { join } = require("node:path");

module.exports = async function removeUnusedMacDeclarations(context) {
  if (context.electronPlatformName !== "darwin") return;

  const plist = await import("plist");
  const appName = context.packager.appInfo.productFilename;
  const infoPath = join(context.appOutDir, `${appName}.app`, "Contents", "Info.plist");
  const info = plist.parse(await readFile(infoPath, "utf8"));

  delete info.NSAppTransportSecurity;

  await writeFile(infoPath, plist.build(info));
};
