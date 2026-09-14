import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";

import { areMacSelectorAclsTrusted } from "./macos-selector-acl";

export const PREFERENCE_READ_TIMEOUT_MS = 2_000;

// Race only reads. The caller applies a value after this returns, never from the
// abandoned read's continuation. This cannot cancel a pending kernel operation.
export async function boundedPreferenceRead<T>(read: () => Promise<T>): Promise<T> {
  const expires = performance.now() + PREFERENCE_READ_TIMEOUT_MS;
  let timer: NodeJS.Timeout | undefined;
  try {
    const value = await Promise.race([
      Promise.resolve().then(read),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("Preference read timed out.")), PREFERENCE_READ_TIMEOUT_MS);
      }),
    ]);
    if (performance.now() >= expires) throw new Error("Preference read timed out.");
    return value;
  } finally {
    clearTimeout(timer);
  }
}

// Private connection preferences authorize executable and endpoint selection.
// Inspect both lexical and resolved directory chains; never chmod existing user
// directories. Root-owned sticky temporary ancestors are safe for owner-only
// children and allow disposable fixtures on macOS. They are not private parents.
export async function assertPrivatePreferenceParent(filePath: string): Promise<void> {
  const uid = process.getuid?.();
  if (uid === undefined || !isAbsolute(filePath)) throw new Error("Untrusted preference path.");
  const parent = dirname(filePath);
  const paths = new Set<string>();
  for (const start of [parent, await realpath(parent)]) {
    let current = start;
    for (;;) {
      if (paths.size >= 256) throw new Error("Untrusted preference path.");
      const metadata = await lstat(current);
      const owned = metadata.uid === uid || metadata.uid === 0;
      const stickyRoot = metadata.uid === 0 && (metadata.mode & 0o1000) !== 0;
      if (!owned || (!metadata.isDirectory() && !metadata.isSymbolicLink()) ||
          (!metadata.isSymbolicLink() && !stickyRoot && (metadata.mode & 0o022) !== 0)) {
        throw new Error("Untrusted preference directory.");
      }
      paths.add(current);
      const next = dirname(current);
      if (next === current) break;
      current = next;
    }
  }
  const canonicalParent = await realpath(parent);
  const metadata = await lstat(canonicalParent);
  if (!metadata.isDirectory() || metadata.uid !== uid || (metadata.mode & 0o077) !== 0) {
    throw new Error("Preference directory must be private.");
  }
  if (process.platform === "darwin" && !(await areMacSelectorAclsTrusted([...paths]))) {
    throw new Error("Untrusted preference directory permissions.");
  }
}

export async function assertPrivatePreferenceFile(filePath: string): Promise<void> {
  const metadata = await lstat(filePath);
  if (!metadata.isFile() || metadata.uid !== process.getuid?.() || (metadata.mode & 0o077) !== 0 ||
      (process.platform === "darwin" && !(await areMacSelectorAclsTrusted([filePath])))) {
    throw new Error("Untrusted preference file.");
  }
}

// Read at most limit+1 bytes from a regular, non-symlink file. Shortcut settings
// retain compatibility with ordinary files; connection settings require private
// ownership, parents and ACLs before their contents can authorize an adapter.
export async function readPreferenceText(
  filePath: string,
  limit: number,
  security: "regular" | "private",
): Promise<string | null> {
  let file;
  try {
    file = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (cause) {
    if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") return null;
    throw cause;
  }
  try {
    const before = await file.stat({ bigint: true });
    if (!before.isFile() || before.size > BigInt(limit)) throw new Error("Invalid preference file.");
    if (security === "private") {
      await assertPrivatePreferenceParent(filePath);
      await assertPrivatePreferenceFile(filePath);
    }
    const buffer = Buffer.alloc(limit + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await file.read(buffer, length, buffer.length - length, length);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    const after = await file.stat({ bigint: true });
    const named = await lstat(filePath, { bigint: true });
    if (length > limit || BigInt(length) !== before.size || !named.isFile() ||
        before.dev !== named.dev || before.ino !== named.ino ||
        before.ctimeNs !== after.ctimeNs || before.mtimeNs !== after.mtimeNs ||
        before.size !== after.size) {
      throw new Error("Preference changed during read.");
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, length));
  } finally {
    await file.close();
  }
}
