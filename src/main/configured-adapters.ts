import { createWezTermAdapter } from "./wezterm-adapter";

import type { DestinationAdapter } from "./destination-adapter";

export type AdapterEnvironment = {
  readonly SCREENFLING_EXPERIMENTAL_WEZTERM_CONFIG_FILE?: string;
  readonly SCREENFLING_EXPERIMENTAL_WEZTERM_EXECUTABLE?: string;
  readonly SCREENFLING_EXPERIMENTAL_WEZTERM_IMAGE_INPUT_HEX?: string;
  readonly SCREENFLING_EXPERIMENTAL_WEZTERM_SOCKET?: string;
};

function parseHexInput(value: string): Uint8Array | null {
  if (!/^(?:[a-f\d]{2}){1,64}$/iu.test(value)) return null;
  const input = new Uint8Array(value.length / 2);
  for (let index = 0; index < input.length; index += 1) {
    input[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return input;
}

export function createConfiguredAdapters(
  environment: AdapterEnvironment,
  platform: NodeJS.Platform,
): readonly DestinationAdapter[] {
  if (platform !== "darwin") return [];
  const executable = environment.SCREENFLING_EXPERIMENTAL_WEZTERM_EXECUTABLE;
  const configFile = environment.SCREENFLING_EXPERIMENTAL_WEZTERM_CONFIG_FILE;
  const socketPath = environment.SCREENFLING_EXPERIMENTAL_WEZTERM_SOCKET;
  const inputHex = environment.SCREENFLING_EXPERIMENTAL_WEZTERM_IMAGE_INPUT_HEX;
  if (
    executable === undefined ||
    configFile === undefined ||
    socketPath === undefined ||
    inputHex === undefined
  ) {
    return [];
  }
  const imagePasteInput = parseHexInput(inputHex);
  if (imagePasteInput === null) return [];
  try {
    return [
      createWezTermAdapter({
        executable,
        configFile,
        socketPath,
        imagePasteInput: Uint8Array.from(imagePasteInput),
      }),
    ];
  } catch {
    return [];
  }
}
