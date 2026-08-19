import { isAbsolute, relative, resolve } from "node:path";

const RENDERER_PROTOCOL = "screenfling:";
const RENDERER_HOST = "bundle";

export function resolveRendererAsset(rendererRoot: string, requestUrl: string): string | null {
  const url = new URL(requestUrl);
  if (url.protocol !== RENDERER_PROTOCOL || url.hostname !== RENDERER_HOST) return null;

  const decodedPath = decodeURIComponent(url.pathname);
  const assetPath = resolve(rendererRoot, `.${decodedPath}`);
  const relativePath = relative(rendererRoot, assetPath);

  if (!relativePath || relativePath.startsWith("..") || isAbsolute(relativePath)) return null;
  return assetPath;
}
