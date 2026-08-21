import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { z } from "zod";

import { persistedShortcutSchema } from "../shared/shortcut";

import type { ShortcutConfiguration } from "../shared/shortcut";

const missingFileErrorSchema = z.object({ code: z.literal("ENOENT") });

export type ShortcutPreferenceLoadResult =
  | { readonly configuration: ShortcutConfiguration; readonly kind: "loaded" }
  | { readonly kind: "invalid" }
  | { readonly kind: "missing" };

export type ShortcutPreferenceFiles = {
  readonly makeDirectory: (path: string) => Promise<void>;
  readonly move: (source: string, destination: string) => Promise<void>;
  readonly readText: (path: string) => Promise<string | null>;
  readonly remove: (path: string) => Promise<void>;
  readonly writePrivateText: (path: string, contents: string) => Promise<void>;
};

export type ShortcutPreferences = {
  readonly load: () => Promise<ShortcutPreferenceLoadResult>;
  readonly save: (configuration: ShortcutConfiguration) => Promise<void>;
};

export class NodeShortcutPreferenceFiles implements ShortcutPreferenceFiles {
  async makeDirectory(path: string): Promise<void> {
    await mkdir(path, { mode: 0o700, recursive: true });
  }

  async move(source: string, destination: string): Promise<void> {
    await rename(source, destination);
  }

  async readText(path: string): Promise<string | null> {
    try {
      return await readFile(path, "utf8");
    } catch (cause) {
      if (missingFileErrorSchema.safeParse(cause).success) return null;
      throw cause;
    }
  }

  async remove(path: string): Promise<void> {
    await rm(path, { force: true });
  }

  async writePrivateText(path: string, contents: string): Promise<void> {
    await writeFile(path, contents, {
      encoding: "utf8",
      flag: "wx",
      flush: true,
      mode: 0o600,
    });
  }
}

export class ShortcutPreferenceStore implements ShortcutPreferences {
  readonly #createToken: () => string;
  readonly #filePath: string;
  readonly #files: ShortcutPreferenceFiles;

  constructor(filePath: string, files: ShortcutPreferenceFiles, createToken: () => string) {
    this.#filePath = filePath;
    this.#files = files;
    this.#createToken = createToken;
  }

  async load(): Promise<ShortcutPreferenceLoadResult> {
    const contents = await this.#files.readText(this.#filePath);
    if (contents === null) return { kind: "missing" };

    let persisted: unknown;
    try {
      persisted = JSON.parse(contents);
    } catch {
      return { kind: "invalid" };
    }
    const result = persistedShortcutSchema.safeParse(persisted);
    if (!result.success) return { kind: "invalid" };
    return { configuration: result.data.configuration, kind: "loaded" };
  }

  async save(configuration: ShortcutConfiguration): Promise<void> {
    const temporaryPath = `${this.#filePath}.${this.#createToken()}.tmp`;
    const contents = `${JSON.stringify({ configuration, version: 1 }, null, 2)}\n`;
    await this.#files.makeDirectory(dirname(this.#filePath));

    try {
      await this.#files.writePrivateText(temporaryPath, contents);
      await this.#files.move(temporaryPath, this.#filePath);
    } catch (cause) {
      await this.#files.remove(temporaryPath).catch(() => undefined);
      throw cause;
    }
  }
}
