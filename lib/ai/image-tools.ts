import { randomBytes } from "node:crypto";
import { tool, type RunContext } from "@openai/agents";
import OpenAI from "openai";
import { z } from "zod";
import { recordArtifact } from "./artifact-tools";
import type { CityRunContext } from "./context";
import { imageModel, imageProvider } from "./env";
import { renderImageKit, requireImageKit } from "./imagekit";
import { aspectRatios, extensionFor, generationUrl, imageOperations, isImageKitUrl, transformationFor, transformedUrl } from "./imagekit-url";
import { findMediaAsset, findMediaAssetByUrl, saveMediaAsset, uploadToMediaLibrary, type MediaAssetInput } from "./media-library";
import { saveMemory } from "./memory";
import { contextOf, scopeOf, slug } from "./tool-context";

// Image tools for agents. Generation and transformation run on ImageKit AI; every result is uploaded to Strapi's
// media library (stored on ImageKit), recorded in `media-assets`, and saved to the headquarters' shared memory.

const purposes = ["thumbnail", "scene", "graphic", "product", "social", "other"] as const;
type Purpose = (typeof purposes)[number];
const label = (p: string) => p[0].toUpperCase() + p.slice(1).replace(/_/g, " ");

let client: OpenAI | null = null;
const openai = () => (client ??= new OpenAI());
const OPENAI_SIZE = { square: "1024x1024", landscape: "1536x1024", portrait: "1024x1536" } as const;

/** Uploads a rendered image, records it, saves it to memory, and returns the tool's JSON result. */
async function storeImage(
  context: CityRunContext,
  rendered: { bytes: ArrayBuffer | Buffer; mimeType: string },
  asset: Omit<MediaAssetInput, "file">,
  memoryData: Record<string, unknown>,
) {
  await context.report({ activity: `Saving “${asset.title}” to the media library` });
  const file = await uploadToMediaLibrary(rendered.bytes, `${slug(asset.title)}.${extensionFor(rendered.mimeType)}`, rendered.mimeType, {
    alternativeText: asset.prompt ?? asset.title,
    caption: asset.title,
    signal: context.signal,
  });
  const scope = scopeOf(context);
  const assetId = await saveMediaAsset(scope, { ...asset, file });
  const memoryId = await saveMemory(scope, {
    kind: "media",
    title: `${label(asset.operation === "text_to_image" ? asset.purpose : asset.operation)}: ${asset.title}`,
    content: asset.prompt ?? `${label(asset.operation)} of ${asset.sourceUrl}`,
    data: { imageUrl: file.url, assetId, operation: asset.operation, provider: asset.provider, purpose: asset.purpose,
      width: file.width, height: file.height, sourceUrl: asset.sourceUrl, sourceAssetId: asset.sourceAssetId, ...memoryData },
    tags: [asset.purpose, asset.operation],
  });
  const artifact = await recordArtifact(context, {
    title: asset.title, type: "image", category: "image", mimeType: file.mime || rendered.mimeType, url: file.url, memoryId, mediaAssetId: assetId,
    summary: `${label(asset.operation === "text_to_image" ? asset.purpose : asset.operation)}${file.width && file.height ? ` · ${file.width}×${file.height}` : ""}`,
    content: asset.prompt,
    data: { operation: asset.operation, provider: asset.provider, purpose: asset.purpose, width: file.width, height: file.height, sourceUrl: asset.sourceUrl, ...memoryData },
  });
  return JSON.stringify({ imageUrl: file.url, assetId, memoryId, artifactId: artifact?.documentId ?? null, width: file.width, height: file.height });
}

export const imageTool = tool({
  name: "generate_image",
  description:
    "Generate a new image from a text prompt (thumbnail, scene visual, product shot, or graphic) with ImageKit AI. "
    + "Saves it to the media library and memory and returns its URL and assetId (use the assetId with transform_image).",
  parameters: z.object({
    title: z.string().min(1).max(120).describe("Short name for the image, e.g. the scene or video title."),
    prompt: z.string().min(1).max(1000).describe("Detailed visual description: subject, setting, style, lighting, composition. Avoid text in the image."),
    aspectRatio: z.enum(aspectRatios).describe("landscape (16:9) for thumbnails and scenes, portrait (9:16) for vertical video, square for social posts."),
    purpose: z.enum(purposes),
  }),
  execute: async ({ title, prompt, aspectRatio, purpose }, runContext) => {
    const context = contextOf(runContext as RunContext<CityRunContext>);
    const provider = imageProvider();
    await context.report({ activity: `Creating ${purpose}: ${title}` });

    let rendered: { bytes: ArrayBuffer | Buffer; mimeType: string };
    let transformation: string | null = null;
    if (provider === "imagekit") {
      // A unique path per call: ImageKit caches by path and would otherwise return the earlier image.
      const filePath = `creator-city/generated/${slug(title)}-${Date.now().toString(36)}${randomBytes(3).toString("hex")}.jpg`;
      const url = generationUrl(requireImageKit().urlEndpoint, prompt, aspectRatio, filePath);
      transformation = new URL(url).pathname.split("/").find((part) => part.startsWith("ik-genimg")) ?? null;
      rendered = await renderImageKit(url, context.signal);
    } else {
      const result = await openai().images.generate({ model: imageModel(), prompt, size: OPENAI_SIZE[aspectRatio], n: 1 }, { signal: context.signal });
      const b64 = result.data?.[0]?.b64_json;
      if (!b64) throw new Error("The image model returned no image.");
      rendered = { bytes: Buffer.from(b64, "base64"), mimeType: "image/png" };
    }

    return storeImage(
      context,
      rendered,
      { title, operation: "text_to_image", provider, purpose: purpose as Purpose, prompt, transformation, sourceUrl: null, sourceAssetId: null },
      { aspectRatio },
    );
  },
});

const OPERATION_HELP = [
  "remove_background: transparent PNG cutout (highQuality uses remove.bg, ~10x the cost).",
  "change_background: replace the background; prompt describes the new one.",
  "edit: change the image as the prompt says (output 1024 or 1536 px, padded).",
  "generative_fill: extend the canvas to width × height and fill the new area with AI (prompt optional).",
  "drop_shadow: cut out the subject and add a realistic shadow (shadow angles optional).",
  "retouch: improve quality, lighting, and detail (input under 16 MP).",
  "upscale: increase resolution to 16 MP (input under 16 MP).",
  "variation: a new variation of the image.",
  'smart_crop: crop to width × height keeping the subject; focus "auto", "face", or an object such as "dog".',
].join("\n");

export const transformImageTool = tool({
  name: "transform_image",
  description:
    "Transform an existing image from the media library with ImageKit AI and save the result as a new image (the original is kept). "
    + "Identify the source by sourceAssetId (from generate_image, transform_image, or memory) or by its media-library sourceImageUrl.\n"
    + OPERATION_HELP,
  parameters: z.object({
    title: z.string().min(1).max(120).describe("Name for the new image."),
    operation: z.enum(imageOperations),
    sourceAssetId: z.string().regex(/^[A-Za-z0-9]{8,64}$/).nullable().describe("assetId of the image to transform; preferred."),
    sourceImageUrl: z.string().max(2048).nullable().describe("Media-library (ImageKit) URL of the image, when there is no assetId."),
    prompt: z.string().max(1000).nullable().describe("Required for change_background and edit; optional for generative_fill."),
    width: z.number().int().min(16).max(4096).nullable().describe("Target width in px for generative_fill and smart_crop."),
    height: z.number().int().min(16).max(4096).nullable().describe("Target height in px for generative_fill and smart_crop."),
    focus: z.string().max(30).nullable().describe('smart_crop subject: "auto", "face", or an object name.'),
    highQuality: z.boolean().nullable().describe("remove_background only: use remove.bg."),
    shadow: z.object({
      azimuth: z.number().int().min(0).max(360).describe("Light direction in degrees, default 215."),
      elevation: z.number().int().min(0).max(90).describe("Light height in degrees, default 45."),
      saturation: z.number().int().min(0).max(100).describe("Shadow strength, default 60."),
    }).nullable(),
    purpose: z.enum(purposes),
  }),
  execute: async (input, runContext) => {
    const context = contextOf(runContext as RunContext<CityRunContext>);
    const { urlEndpoint } = requireImageKit();

    const built = transformationFor(input);
    if ("error" in built) return `${built.error} Fix the arguments and call again.`;

    // Resolve the source within this headquarters, or accept a URL from this ImageKit account only.
    let sourceUrl: string;
    let sourceAssetId: string | null = null;
    if (input.sourceAssetId) {
      const asset = await findMediaAsset(context.hq.documentId, input.sourceAssetId);
      if (!asset) return "No image with that sourceAssetId in this headquarters. Find it with memory_search (kind \"media\") and call again.";
      sourceUrl = asset.url;
      sourceAssetId = asset.documentId;
    } else if (input.sourceImageUrl) {
      sourceUrl = input.sourceImageUrl;
      sourceAssetId = await findMediaAssetByUrl(context.hq.documentId, sourceUrl);
    } else {
      return "Give sourceAssetId or sourceImageUrl for the image to transform.";
    }
    if (!isImageKitUrl(sourceUrl, urlEndpoint)) {
      return "Only images in the media library (served from ImageKit) can be transformed. Generate or upload the image first.";
    }

    await context.report({ activity: `${label(input.operation)}: ${input.title}` });
    const rendered = await renderImageKit(transformedUrl(sourceUrl, built.transformation), context.signal);
    return storeImage(
      context,
      rendered,
      {
        title: input.title, operation: input.operation, provider: "imagekit", purpose: input.purpose,
        prompt: input.prompt?.trim() || null, transformation: built.transformation, sourceUrl, sourceAssetId,
      },
      {},
    );
  },
});
