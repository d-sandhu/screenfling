import { constants } from "node:fs";
import { access, lstat, realpath, stat } from "node:fs/promises";
import { dirname } from "node:path";

export type WezTermSelectorPaths = {
  readonly configFile: string;
  readonly executable: string;
  readonly socketPath: string;
};

export class UntrustedWezTermSelectorError extends Error {
  constructor() {
    super("The configured WezTerm selector is not trusted.");
    this.name = "UntrustedWezTermSelectorError";
  }
}

type SelectorKind = "config" | "executable" | "socket";

function isTrustedOwner(owner: bigint, currentUid: bigint): boolean {
  return owner === 0n || owner === currentUid;
}

function currentUserId(): bigint {
  const getuid = process.getuid;
  if (getuid === undefined) throw new UntrustedWezTermSelectorError();
  return BigInt(getuid());
}

async function assertTrustedAncestorDirectories(path: string, currentUid: bigint): Promise<void> {
  let ancestor = dirname(path);
  for (;;) {
    const metadata = await stat(ancestor, { bigint: true });
    if (
      !metadata.isDirectory() ||
      !isTrustedOwner(metadata.uid, currentUid) ||
      (metadata.mode & 0o022n) !== 0n
    ) {
      throw new UntrustedWezTermSelectorError();
    }
    const parent = dirname(ancestor);
    if (parent === ancestor) return;
    ancestor = parent;
  }
}

async function assertTrustedLexicalPath(path: string, currentUid: bigint): Promise<void> {
  let entry = path;
  let isLeaf = true;
  for (;;) {
    const metadata = await lstat(entry, { bigint: true });
    const unsafeType = !isLeaf && !metadata.isDirectory() && !metadata.isSymbolicLink();
    const unsafeOwner = !isTrustedOwner(metadata.uid, currentUid);
    const unsafeMode = !metadata.isSymbolicLink() && (metadata.mode & 0o022n) !== 0n;
    if (unsafeType || unsafeOwner || unsafeMode) throw new UntrustedWezTermSelectorError();
    const parent = dirname(entry);
    if (parent === entry) return;
    entry = parent;
    isLeaf = false;
  }
}

async function assertPrivateSocketParent(path: string, currentUid: bigint): Promise<void> {
  const metadata = await stat(dirname(path), { bigint: true });
  if (!metadata.isDirectory() || metadata.uid !== currentUid || (metadata.mode & 0o077n) !== 0n) {
    throw new UntrustedWezTermSelectorError();
  }
}

async function selectorEvidence(
  path: string,
  kind: SelectorKind,
  currentUid: bigint,
): Promise<string> {
  await assertTrustedLexicalPath(path, currentUid);
  const canonicalPath = await realpath(path);
  await assertTrustedAncestorDirectories(canonicalPath, currentUid);
  if (kind === "socket") await assertPrivateSocketParent(canonicalPath, currentUid);
  const metadata = await stat(canonicalPath, { bigint: true });
  const expectedType = kind === "socket" ? metadata.isSocket() : metadata.isFile();
  const expectedOwner =
    kind === "executable" ? isTrustedOwner(metadata.uid, currentUid) : metadata.uid === currentUid;
  const writableByGroupOrOther = (metadata.mode & 0o022n) !== 0n;
  if (!expectedType || !expectedOwner || writableByGroupOrOther) {
    throw new UntrustedWezTermSelectorError();
  }
  if (kind === "executable") await access(canonicalPath, constants.X_OK);
  if (kind === "config") await access(canonicalPath, constants.R_OK);
  return [
    kind,
    path,
    canonicalPath,
    metadata.dev.toString(),
    metadata.ino.toString(),
    metadata.mode.toString(),
    metadata.uid.toString(),
    metadata.gid.toString(),
    metadata.size.toString(),
    metadata.birthtimeNs.toString(),
    metadata.ctimeNs.toString(),
    metadata.mtimeNs.toString(),
  ].join("\u0000");
}

export async function readTrustedWezTermSelectorEvidence(
  selectors: WezTermSelectorPaths,
  expectedUid?: bigint,
): Promise<readonly string[]> {
  try {
    const currentUid = expectedUid ?? currentUserId();
    return await Promise.all([
      selectorEvidence(selectors.executable, "executable", currentUid),
      selectorEvidence(selectors.configFile, "config", currentUid),
      selectorEvidence(selectors.socketPath, "socket", currentUid),
    ]);
  } catch (cause) {
    if (cause instanceof UntrustedWezTermSelectorError) throw cause;
    throw new UntrustedWezTermSelectorError();
  }
}
