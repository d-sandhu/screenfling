import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { net, protocol, session } from "electron";

import { resolveRendererAsset } from "./renderer-path";
import { RENDERER_PARTITION } from "./window-options";

const SCHEME = "screenfling";
const PRODUCTION_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

protocol.registerSchemesAsPrivileged([
  {
    privileges: {
      secure: true,
      standard: true,
    },
    scheme: SCHEME,
  },
]);

export function registerAppProtocol(): void {
  const rendererRoot = join(__dirname, "../renderer");

  const rendererSession = session.fromPartition(RENDERER_PARTITION, { cache: false });
  rendererSession.setPermissionCheckHandler(() => false);
  rendererSession.setPermissionRequestHandler((_webContents, _permission, respond) => respond(false));
  rendererSession.protocol.handle(SCHEME, async (request) => {
    if (request.method !== "GET") return new Response("Method not allowed", { status: 405 });

    const assetPath = resolveRendererAsset(rendererRoot, request.url);
    if (!assetPath) return new Response("Not found", { status: 404 });

    const response = await net.fetch(pathToFileURL(assetPath).toString());
    const headers = new Headers(response.headers);
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Cache-Control", "no-store");
    if (assetPath.endsWith(".html")) headers.set("Content-Security-Policy", PRODUCTION_CSP);

    return new Response(response.body, {
      headers,
      status: response.status,
      statusText: response.statusText,
    });
  });
}
