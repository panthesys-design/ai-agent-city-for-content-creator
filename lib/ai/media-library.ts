import { strapi } from "@/lib/strapi";
import { strapiPublicUrl } from "./env";
import type { MemoryScope } from "./memory-scope";

// Strapi media library (backed by ImageKit through Strapi's ImageKit plugin) and the `media-assets` collection,
// which records every image agents generate or transform, scoped to one headquarters.

export type UploadedFile = { id: number; documentId: string; url: string; width: number | null; height: number | null; mime: string };

/** Uploads a file to Strapi's media library and returns the stored file with its public URL. */
export async function uploadToMediaLibrary(
  bytes: ArrayBuffer | Buffer,
  filename: string,
  mimeType: string,
  options: { alternativeText?: string; caption?: string; signal?: AbortSignal } = {},
): Promise<UploadedFile> {
  const url = process.env.STRAPI_URL, token = process.env.STRAPI_API_TOKEN;
  if (!url || !token) throw new Error("STRAPI_URL and STRAPI_API_TOKEN must be set.");
  const form = new FormData();
  const data = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : Uint8Array.from(bytes);
  form.append("files", new Blob([data], { type: mimeType }), filename);
  if (options.alternativeText || options.caption) {
    form.append("fileInfo", JSON.stringify({
      name: filename,
      ...(options.alternativeText ? { alternativeText: options.alternativeText.slice(0, 500) } : {}),
      ...(options.caption ? { caption: options.caption.slice(0, 500) } : {}),
    }));
  }
  const res = await fetch(`${url.replace(/\/$/, "")}/api/upload`, { method: "POST", headers: { authorization: `Bearer ${token}` }, body: form, signal: options.signal });
  if (!res.ok) throw new Error(`Uploading ${filename} to Strapi failed (${res.status}). Check the API token's Upload permission.`);
  const [file] = (await res.json()) as { id: number; documentId: string; url: string; width?: number | null; height?: number | null; mime: string }[];
  return {
    id: file.id,
    documentId: file.documentId,
    url: /^https?:\/\//.test(file.url) ? file.url : `${strapiPublicUrl()}${file.url}`,
    width: file.width ?? null,
    height: file.height ?? null,
    mime: file.mime,
  };
}

export type MediaAssetInput = {
  title: string;
  operation: "text_to_image" | "remove_background" | "change_background" | "edit" | "generative_fill" | "drop_shadow" | "retouch" | "upscale" | "variation" | "smart_crop";
  provider: "imagekit" | "openai";
  purpose: "thumbnail" | "scene" | "graphic" | "product" | "social" | "other";
  prompt: string | null;
  transformation: string | null;
  sourceUrl: string | null;
  sourceAssetId: string | null;
  file: UploadedFile;
};

const connect = (documentId: string) => ({ connect: [documentId] });

/**
 * Records a generated or transformed image in `media-assets`. Returns null (with a warning) if the collection
 * is missing or the token lacks permission: the file is already in the media library and memory still gets it.
 */
export async function saveMediaAsset(scope: MemoryScope, asset: MediaAssetInput): Promise<string | null> {
  try {
    const { data } = await strapi<{ data: { documentId: string } }>("/media-assets", {
      method: "POST",
      body: JSON.stringify({
        data: {
          title: asset.title.slice(0, 160),
          operation: asset.operation,
          provider: asset.provider,
          purpose: asset.purpose,
          prompt: asset.prompt,
          transformation: asset.transformation,
          sourceUrl: asset.sourceUrl,
          url: asset.file.url,
          width: asset.file.width,
          height: asset.file.height,
          file: asset.file.id,
          headquarter: connect(scope.hq),
          ...(asset.sourceAssetId ? { source: connect(asset.sourceAssetId) } : {}),
          ...(scope.agent ? { agent: connect(scope.agent) } : {}),
          ...(scope.task ? { task: connect(scope.task) } : {}),
        },
      }),
    });
    return data.documentId;
  } catch (error) {
    console.warn("[media-assets] Could not record the image:", error instanceof Error ? error.message : error);
    return null;
  }
}

/** Finds a media asset by documentId, only within the given headquarters. */
export async function findMediaAsset(hq: string, documentId: string): Promise<{ documentId: string; title: string; url: string } | null> {
  const query = new URLSearchParams({
    "filters[documentId][$eq]": documentId,
    "filters[headquarter][documentId][$eq]": hq,
    "fields[0]": "title",
    "fields[1]": "url",
    "pagination[pageSize]": "1",
  });
  const { data } = await strapi<{ data: { documentId: string; title: string; url: string }[] }>(`/media-assets?${query}`);
  return data[0] ?? null;
}

/** Finds this headquarters' media asset whose file has the given URL (links transformations to their source). */
export async function findMediaAssetByUrl(hq: string, url: string): Promise<string | null> {
  const query = new URLSearchParams({
    "filters[url][$eq]": url,
    "filters[headquarter][documentId][$eq]": hq,
    "fields[0]": "url",
    "pagination[pageSize]": "1",
  });
  const { data } = await strapi<{ data: { documentId: string }[] }>(`/media-assets?${query}`).catch(() => ({ data: [] }));
  return data[0]?.documentId ?? null;
}
