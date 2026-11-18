import { createHmac } from "node:crypto";

// Pure ImageKit URL building for AI generation and transformations (https://imagekit.io/docs/ai-transformations).
// No network or env access here, so it is unit tested in imagekit-url.test.mjs.

export const imageOperations = [
  "remove_background",
  "change_background",
  "edit",
  "generative_fill",
  "drop_shadow",
  "retouch",
  "upscale",
  "variation",
  "smart_crop",
] as const;
export type ImageOperation = (typeof imageOperations)[number];

export const aspectRatios = ["square", "landscape", "portrait"] as const;
export type AspectRatio = (typeof aspectRatios)[number];

export type TransformRequest = {
  operation: ImageOperation;
  prompt?: string | null;
  width?: number | null;
  height?: number | null;
  /** smart_crop: "auto", "face", or an object name such as "dog". */
  focus?: string | null;
  /** remove_background: use remove.bg (`e-removedotbg`, ~10x the cost) instead of ImageKit's own model. */
  highQuality?: boolean | null;
  shadow?: { azimuth: number; elevation: number; saturation: number } | null;
};

const MAX_SIDE = 4096;
const FOCUS = /^[a-z][a-z_]{1,29}$/;
const PROMPT_LIMIT = 1000;

/** `prompte-` form: base64 then percent-encoded, so commas, colons, and slashes in the prompt are safe. */
export const encodedPrompt = (text: string) => `prompte-${encodeURIComponent(Buffer.from(text.trim(), "utf8").toString("base64"))}`;

/** `ik-genimg` only documents the plain `prompt-` form, so drop characters that have URL or transformation meaning. */
export function plainPrompt(text: string) {
  const clean = text.replace(/[/\\,:?#&%=+;"'`<>{}|^[\]]/g, " ").replace(/\s+/g, " ").trim();
  return `prompt-${encodeURIComponent(clean)}`;
}

const side = (n: number | null | undefined) => (typeof n === "number" && Number.isInteger(n) && n >= 16 && n <= MAX_SIDE ? n : null);

/**
 * Builds the transformation chain for one operation. Steps are separated by `:` (ImageKit allows one async AI
 * step per chain). Returns an error message for missing or invalid parameters instead of throwing, so the model
 * can correct its call.
 */
export function transformationFor(req: TransformRequest): { transformation: string } | { error: string } {
  const prompt = req.prompt?.trim() || null;
  if (prompt && prompt.length > PROMPT_LIMIT) return { error: `prompt must be at most ${PROMPT_LIMIT} characters.` };
  const w = side(req.width), h = side(req.height);
  switch (req.operation) {
    case "remove_background":
      return { transformation: `${req.highQuality ? "e-removedotbg" : "e-bgremove"}:f-png` };
    case "change_background":
      if (!prompt) return { error: "change_background needs a prompt describing the new background." };
      return { transformation: `e-changebg-${encodedPrompt(prompt)}` };
    case "edit":
      if (!prompt) return { error: "edit needs a prompt describing the change." };
      return { transformation: `e-edit-${encodedPrompt(prompt)}` };
    case "generative_fill":
      if (!w || !h) return { error: `generative_fill needs width and height (16–${MAX_SIDE} px) for the extended canvas.` };
      return { transformation: `bg-genfill${prompt ? `-${encodedPrompt(prompt)}` : ""},w-${w},h-${h},cm-pad_resize` };
    case "drop_shadow": {
      const s = req.shadow;
      const clamp = (n: number, max: number) => Math.min(max, Math.max(0, Math.round(n)));
      const params = s ? `-az-${clamp(s.azimuth, 360)}_el-${clamp(s.elevation, 90)}_st-${clamp(s.saturation, 100)}` : "";
      // The shadow needs a transparent subject, so remove the background first (the chain ImageKit documents).
      return { transformation: `e-removedotbg:e-dropshadow${params}:f-png` };
    }
    case "retouch":
      return { transformation: "e-retouch" };
    case "upscale":
      return { transformation: "e-upscale" };
    case "variation":
      return { transformation: "e-genvar" };
    case "smart_crop": {
      if (!w || !h) return { error: `smart_crop needs width and height (16–${MAX_SIDE} px).` };
      const focus = (req.focus ?? "auto").trim().toLowerCase();
      if (!FOCUS.test(focus)) return { error: 'focus must be "auto", "face", or a lowercase object name such as "dog".' };
      return { transformation: `w-${w},h-${h},fo-${focus}` };
    }
  }
}

/** Resize applied after text-to-image generation; smart crop keeps the subject in frame. */
const ASPECT: Record<AspectRatio, string | null> = { square: null, landscape: "w-1280,h-720,fo-auto", portrait: "w-720,h-1280,fo-auto" };

/**
 * Text-to-image URL. The file path must be unique: ImageKit caches by path, so reusing one never regenerates.
 */
export function generationUrl(urlEndpoint: string, prompt: string, aspectRatio: AspectRatio, filePath: string) {
  const tr = ASPECT[aspectRatio];
  return `${urlEndpoint.replace(/\/$/, "")}/ik-genimg-${plainPrompt(prompt)}/${filePath.replace(/^\//, "")}${tr ? `?tr=${tr}` : ""}`;
}

/** True when the URL is served from this ImageKit account's endpoint (the only images that can be transformed). */
export function isImageKitUrl(url: string, urlEndpoint: string) {
  try {
    const parsed = new URL(url), base = new URL(urlEndpoint);
    if (parsed.protocol !== "https:" || parsed.host !== base.host) return false;
    const basePath = base.pathname.replace(/\/$/, "");
    return parsed.pathname.startsWith(`${basePath}/`) && parsed.pathname.length > basePath.length + 1;
  } catch {
    return false;
  }
}

/**
 * Adds a transformation to an existing ImageKit URL, chaining after any `tr` already present. Keeps other query
 * parameters (such as `updatedAt`) and drops old signature parameters. The query is built by hand because the
 * prompt is already percent-encoded and URLSearchParams would encode it twice.
 */
export function transformedUrl(sourceUrl: string, transformation: string) {
  const hashless = sourceUrl.split("#")[0];
  const [base, query = ""] = hashless.split(/\?(.*)/s);
  const kept: string[] = [];
  let existing = "";
  for (const part of query.split("&")) {
    const key = part.split("=")[0];
    if (key === "tr") existing = part.slice(3);
    else if (part && key !== "ik-s" && key !== "ik-t") kept.push(part);
  }
  kept.push(`tr=${existing ? `${existing}:` : ""}${transformation}`);
  return `${base}?${kept.join("&")}`;
}

/** Signs a URL for ImageKit's "Restrict unsigned URLs" (HMAC-SHA1 of the URL after the endpoint plus expiry). */
export function signImageKitUrl(url: string, urlEndpoint: string, privateKey: string, expiresInSeconds = 3600, now = Date.now()) {
  const endpoint = urlEndpoint.endsWith("/") ? urlEndpoint : `${urlEndpoint}/`;
  if (!url.startsWith(endpoint)) return url;
  const expiry = Math.floor(now / 1000) + expiresInSeconds;
  const signature = createHmac("sha1", privateKey).update(url.slice(endpoint.length) + expiry).digest("hex");
  return `${url}${url.includes("?") ? "&" : "?"}ik-t=${expiry}&ik-s=${signature}`;
}

const EXTENSIONS: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/avif": "avif", "image/gif": "gif" };
export const extensionFor = (mimeType: string) => EXTENSIONS[mimeType] ?? "png";
