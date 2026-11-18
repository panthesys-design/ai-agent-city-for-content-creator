// Client-safe rules for files users attach in chat (`POST /api/uploads`). Each upload is saved to the media library
// and recorded as an artifact with category "upload", so every agent can find and open it later.

/** Largest file a user can upload in chat. */
export const UPLOAD_MAX_BYTES = 25 * 1024 * 1024;

/** Allowed file types by extension. The extension decides the type, since browsers report some types (e.g. .md) inconsistently. */
export const UPLOAD_TYPES: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif",
  mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime",
  mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", aac: "audio/aac", ogg: "audio/ogg",
  pdf: "application/pdf", txt: "text/plain", md: "text/markdown", csv: "text/csv", json: "application/json",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

/** Value for a file input's `accept` attribute. */
export const UPLOAD_ACCEPT = Object.keys(UPLOAD_TYPES).map((ext) => `.${ext}`).join(",");

/** Text files whose content is kept in the artifact, so agents can read them without downloading. */
export const TEXT_UPLOAD_TYPES = new Set(["text/plain", "text/markdown", "text/csv", "application/json"]);

export const extensionOf = (name: string) => (name.includes(".") ? name.split(".").pop()!.toLowerCase() : "");

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Problem with a file before uploading it (unsupported type or too large), or null when it can be uploaded. */
export function uploadProblem(file: { name: string; size: number }): string | null {
  if (!UPLOAD_TYPES[extensionOf(file.name)]) return "This file type isn't supported.";
  if (file.size > UPLOAD_MAX_BYTES) return `Larger than ${formatBytes(UPLOAD_MAX_BYTES)}.`;
  return null;
}

/** Uploads one file from the browser (`POST /api/uploads`) and returns the new "upload" artifact. */
export async function uploadArtifactFile<T = unknown>(file: File): Promise<T> {
  const form = new FormData();
  form.append("file", file);
  const response = await fetch("/api/uploads", { method: "POST", body: form });
  const body = (await response.json().catch(() => null)) as { artifact?: T; error?: string } | null;
  if (!response.ok || !body?.artifact) throw new Error(body?.error ?? `We couldn't upload ${file.name}.`);
  return body.artifact;
}
