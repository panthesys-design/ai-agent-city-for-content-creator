import { setTimeout as wait } from "node:timers/promises";
import { imagekitConfig } from "./env";
import { signImageKitUrl } from "./imagekit-url";

// Server-only ImageKit delivery: requests an AI-transformed URL and waits until the image is ready.

const MAX_BYTES = 30 * 1024 * 1024;
const MAX_WAIT_MS = 150_000;

export function requireImageKit() {
  const config = imagekitConfig();
  if (!config) throw new Error("IMAGEKIT_URL_ENDPOINT must be set (the same URL endpoint as Strapi's ImageKit plugin).");
  return config;
}

/**
 * Fetches an ImageKit URL that runs an AI transformation. While ImageKit is still working it answers 200 with
 * `is-intermediate-response: true` and an HTML placeholder; this polls with backoff until the image arrives,
 * the time limit passes, or `signal` aborts.
 */
export async function renderImageKit(url: string, signal?: AbortSignal): Promise<{ bytes: ArrayBuffer; mimeType: string; url: string }> {
  const { urlEndpoint, privateKey } = requireImageKit();
  const deadline = Date.now() + MAX_WAIT_MS;
  let delay = 2500;
  for (;;) {
    // Re-sign each attempt so a long wait never outlives the signature.
    const requestUrl = privateKey ? signImageKitUrl(url, urlEndpoint, privateKey, 600) : url;
    const res = await fetch(requestUrl, { signal, cache: "no-store", headers: { accept: "image/png,image/jpeg,image/webp;q=0.9,*/*;q=0.5" } });
    const mimeType = (res.headers.get("content-type") ?? "").split(";")[0].trim();
    const intermediate = res.headers.get("is-intermediate-response") === "true";

    if (res.ok && !intermediate && mimeType.startsWith("image/")) {
      const size = Number(res.headers.get("content-length"));
      if (size > MAX_BYTES) throw new Error(`The rendered image is too large (${Math.round(size / 1048576)} MB).`);
      return { bytes: await res.arrayBuffer(), mimeType, url };
    }
    await res.body?.cancel().catch(() => undefined);

    if (!res.ok) {
      const hint = res.status === 401 || res.status === 403
        ? ' ImageKit rejected the URL: if "Restrict unsigned URLs" is on, set IMAGEKIT_PRIVATE_KEY.'
        : res.status === 404 ? " The source image was not found." : " Failed AI transformations are cached for a few minutes; change the request rather than retrying the same one.";
      throw new Error(`ImageKit returned ${res.status}.${hint}`);
    }
    if (Date.now() + delay > deadline) {
      throw new Error("ImageKit is still preparing the image after 2.5 minutes. Try the same call again shortly; the result is cached once ready.");
    }
    await wait(delay, undefined, { signal });
    delay = Math.min(delay * 1.5, 10_000);
  }
}
