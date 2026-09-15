const LOOPBACK_HOSTS = new Set(["127.0.0.1", "[::1]", "localhost"]);
const PACKAGED_RENDERER_URL = "screenfling://bundle/index.html";

export type RendererSurface = "main" | "capture";

export function rendererDocumentUrl(
  devRendererUrl: string | null,
  surface: RendererSurface,
): string {
  const url = new URL(devRendererUrl ?? PACKAGED_RENDERER_URL);
  if (surface === "capture") url.searchParams.set("surface", "capture");
  return url.href;
}

export function readDevRendererUrl(value: string | undefined, packaged = false): string | null {
  // Packaged applications must never execute a development server's renderer.
  if (packaged || !value) return null;

  const url = new URL(value);
  const isAllowed =
    url.protocol === "http:" &&
    LOOPBACK_HOSTS.has(url.hostname) &&
    !url.username &&
    !url.password &&
    url.pathname === "/" &&
    !url.search &&
    !url.hash;

  if (!isAllowed)
    throw new Error("ELECTRON_RENDERER_URL must be an uncredentialed loopback origin.");
  return url.href;
}
