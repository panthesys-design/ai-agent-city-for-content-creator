import { uploadToMediaLibrary } from "@/lib/ai/media-library";
import { createArtifact } from "@/lib/artifacts";
import { getCurrentUser } from "@/lib/auth/session";
import { findHeadquarters } from "@/lib/headquarters";
import { TEXT_UPLOAD_TYPES, UPLOAD_MAX_BYTES, UPLOAD_TYPES, extensionOf, formatBytes } from "@/lib/upload-records";

// A file the user attaches in chat: saved to the media library (ImageKit through Strapi) and recorded as an
// artifact with category "upload" in the caller's headquarters, so the chat message can reference it and every
// agent can open it later with read_artifact. One file per request (multipart field `file`).

export const maxDuration = 120;

const TEXT_MAX = 60_000;

export async function POST(request: Request) {
  const sessionUser = await getCurrentUser();
  if (!sessionUser) return Response.json({ error: "Your session has ended. Sign in again to continue." }, { status: 401 });
  const hq = await findHeadquarters(sessionUser.email);
  if (!hq) return Response.json({ error: "Create your headquarters first." }, { status: 403 });

  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > UPLOAD_MAX_BYTES + 64 * 1024) return Response.json({ error: `Files can be up to ${formatBytes(UPLOAD_MAX_BYTES)}.` }, { status: 413 });
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File) || !file.size) return Response.json({ error: "Choose a file to upload." }, { status: 400 });
  if (file.size > UPLOAD_MAX_BYTES) return Response.json({ error: `${file.name} is larger than ${formatBytes(UPLOAD_MAX_BYTES)}.` }, { status: 413 });
  const ext = extensionOf(file.name);
  const mimeType = UPLOAD_TYPES[ext];
  if (!mimeType) return Response.json({ error: `.${ext || "?"} files can't be uploaded. Use an image, video, audio file, PDF, text, or Office document.` }, { status: 415 });

  const name = file.name.replace(/[\u0000-\u001f\\/]/g, "").slice(0, 150) || `upload.${ext}`;
  const title = name.replace(/\.[^.]+$/, "") || name;
  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    const stored = await uploadToMediaLibrary(bytes, name, mimeType, { caption: title, alternativeText: title, signal: request.signal });
    const type = mimeType.startsWith("image/") ? "image" : mimeType.startsWith("audio/") ? "audio" : mimeType.startsWith("video/") ? "video" : "document";
    const content = TEXT_UPLOAD_TYPES.has(mimeType)
      ? bytes.toString("utf8").slice(0, TEXT_MAX)
      : type === "document" ? `[${name}](${stored.url})\n\nUploaded by the user (${formatBytes(bytes.length)}, ${mimeType}).` : null;
    const artifact = await createArtifact({ hq: hq.documentId }, {
      title, type, category: "upload", mimeType, url: stored.url, content,
      summary: `Uploaded · ${ext.toUpperCase()} · ${formatBytes(bytes.length)}${stored.width && stored.height ? ` · ${stored.width}×${stored.height}` : ""}`,
      data: { source: "upload", filename: name, size: bytes.length, ...(stored.width && stored.height ? { width: stored.width, height: stored.height } : {}) },
    });
    return Response.json({ artifact });
  } catch (error) {
    console.error("[uploads]", error);
    return Response.json({ error: `We couldn't upload ${name}. Please try again.` }, { status: 502 });
  }
}
