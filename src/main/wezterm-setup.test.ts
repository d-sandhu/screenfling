import { mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { wezTermSetupConfigurationSchema } from "../shared/wezterm-setup";
import { WezTermSetup } from "./wezterm-setup";

const configuration = {
  executable: "/synthetic/wezterm",
  configFile: "/synthetic/config.lua",
  socketPath: "/synthetic/mux",
  imageInputHex: "16",
};
let directory: string;
let filePath: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "screenfling-setup-"));
  filePath = join(directory, "wezterm.json");
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("local WezTerm connection setup", () => {
  it.skipIf(process.platform === "win32")("persists a private connection and loads it on the next start", async () => {
    const restart = vi.fn();
    const setup = new WezTermSetup(filePath, "darwin", () => true, restart, async () => true);
    expect(await setup.initialize({})).toEqual({});
    expect(await setup.save(configuration)).toBe("saved");
    expect((await stat(filePath)).mode & 0o777).toBe(0o600);
    expect(setup.getSnapshot().restartRequired).toBe(true);
    expect(restart).not.toHaveBeenCalled();
    expect(setup.restart()).toBe(true);
    expect(setup.restart()).toBe(false);
    expect(restart).toHaveBeenCalledTimes(1);
    const next = new WezTermSetup(filePath, "darwin", () => true, restart);
    expect(await next.initialize({})).toMatchObject({
      SCREENFLING_EXPERIMENTAL_WEZTERM_SOCKET: configuration.socketPath,
    });
    expect(next.getSnapshot().restartRequired).toBe(false);
    expect(await next.save(null)).toBe("saved");
    const cleared = new WezTermSetup(filePath, "darwin", () => true, restart);
    expect(await cleared.initialize({})).toEqual({});
  });

  it("does not replace the saved connection when discovery fails", async () => {
    await writeFile(filePath, "existing", { mode: 0o600 });
    const setup = new WezTermSetup(filePath, "darwin", () => true, vi.fn(), async () => false);
    expect(await setup.save(configuration)).toBe("unavailable");
    expect(await readFile(filePath, "utf8")).toBe("existing");
    expect(setup.getSnapshot().restartRequired).toBe(false);
  });

  it("refuses save and restart during a workflow and contains overlapping saves", async () => {
    let idle = false;
    let release: (ready: boolean) => void = () => undefined;
    const restart = vi.fn();
    const setup = new WezTermSetup(filePath, "darwin", () => idle, restart, () =>
      new Promise<boolean>((resolve) => { release = resolve; }),
    );
    expect(await setup.save(configuration)).toBe("busy");
    idle = true;
    const save = setup.save(configuration);
    expect(await setup.save(null)).toBe("busy");
    idle = false;
    release(true);
    expect(await save).toBe("busy");
    idle = true;
    expect(await setup.save(null)).toBe("saved");
    idle = false;
    expect(setup.restart()).toBe(false);
    expect(restart).not.toHaveBeenCalled();
  });

  it("keeps an explicit partial environment from falling back to disk", async () => {
    await writeFile(filePath, JSON.stringify({ version: 1, configuration }), { mode: 0o600 });
    const environment = { SCREENFLING_EXPERIMENTAL_WEZTERM_SOCKET: "/other/mux" };
    const setup = new WezTermSetup(filePath, "darwin", () => true, vi.fn());
    expect(await setup.initialize(environment)).toEqual(environment);
    expect(setup.getSnapshot().configuration).toBeNull();
    expect(await setup.save(null)).toBe("environment-override");
  });

  it.skipIf(process.platform === "win32")("rejects a symlink preference without reading its target", async () => {
    const target = join(directory, "other.json");
    await writeFile(target, JSON.stringify({ version: 1, configuration }), { mode: 0o600 });
    await symlink(target, filePath);
    const setup = new WezTermSetup(filePath, "darwin", () => true, vi.fn());
    expect(await setup.initialize({})).toEqual({});
    expect(setup.getSnapshot().source).toBe("invalid");
  });

  it("rejects expanded configuration, relative paths and submission bytes before probing", async () => {
    for (const invalid of [
      { ...configuration, socketPath: "~/mux" },
      { ...configuration, imageInputHex: "160d" },
      { ...configuration, imageInputHex: "0A" },
      { ...configuration, arguments: ["--send"] },
    ]) {
      expect(wezTermSetupConfigurationSchema.safeParse(invalid).success).toBe(false);
    }
    const probe = vi.fn(async () => true);
    const setup = new WezTermSetup(filePath, "win32", () => true, vi.fn(), probe);
    expect(await setup.save(configuration)).toBe("unsupported");
    expect(probe).not.toHaveBeenCalled();
  });
});
