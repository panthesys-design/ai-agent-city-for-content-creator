// Client-safe shapes for external accounts connected through Composio (Instagram, YouTube, LinkedIn, Notion…), the
// access each one grants the city's agents, and posts agents published or scheduled with them.
//
// Strapi collections: `connected-accounts` and `social-posts` (see docs/accounts.md). Server code: lib/composio/.
// Tokens never reach this app: Composio stores them, and a row here keeps only the account's ID and settings.

export const appCategories = ["social", "video", "workspace", "messaging", "storage", "design", "marketing"] as const;
export type AppCategory = (typeof appCategories)[number];

export const appCategoryLabels: Record<AppCategory, string> = {
  social: "Social media", video: "Video", workspace: "Docs & planning", messaging: "Messaging", storage: "Files & storage",
  design: "Design", marketing: "Email & marketing",
};

export type CatalogApp = {
  /** Composio toolkit slug. */
  slug: string;
  name: string;
  category: AppCategory;
  /** What agents can do with it, in one line. */
  blurb: string;
  /** Agents publish to it (posts, videos, threads), so it shows on the Posted page. */
  publishes: boolean;
};

/**
 * Apps featured on the Accounts page. Any other Composio toolkit can still be found with "Browse all apps".
 * Slugs are Composio toolkit slugs (X is `twitter`).
 */
export const FEATURED_APPS: CatalogApp[] = [
  { slug: "instagram", name: "Instagram", category: "social", blurb: "Publish posts, reels, and carousels; read comments and insights.", publishes: true },
  { slug: "youtube", name: "YouTube", category: "video", blurb: "Manage videos and playlists, reply to comments, read channel analytics.", publishes: true },
  { slug: "twitter", name: "X (Twitter)", category: "social", blurb: "Post and schedule tweets and threads, reply, and read mentions.", publishes: true },
  { slug: "linkedin", name: "LinkedIn", category: "social", blurb: "Share posts, articles, images, and videos to your profile or page.", publishes: true },
  { slug: "facebook", name: "Facebook", category: "social", blurb: "Publish to your Pages and read engagement.", publishes: true },
  { slug: "threads", name: "Threads", category: "social", blurb: "Publish threads and replies.", publishes: true },
  { slug: "tiktok", name: "TikTok", category: "video", blurb: "Upload videos and read account stats.", publishes: true },
  { slug: "pinterest", name: "Pinterest", category: "social", blurb: "Create pins and manage boards.", publishes: true },
  { slug: "reddit", name: "Reddit", category: "social", blurb: "Submit posts and comments to communities.", publishes: true },
  { slug: "notion", name: "Notion", category: "workspace", blurb: "Save scripts, research, and content calendars as pages and databases.", publishes: false },
  { slug: "googledocs", name: "Google Docs", category: "workspace", blurb: "Write and update documents.", publishes: false },
  { slug: "googlesheets", name: "Google Sheets", category: "workspace", blurb: "Keep content calendars and reports in spreadsheets.", publishes: false },
  { slug: "googlecalendar", name: "Google Calendar", category: "workspace", blurb: "Plan publishing dates and shoots.", publishes: false },
  { slug: "googledrive", name: "Google Drive", category: "storage", blurb: "Store and share finished media.", publishes: false },
  { slug: "dropbox", name: "Dropbox", category: "storage", blurb: "Store and share finished media.", publishes: false },
  { slug: "canva", name: "Canva", category: "design", blurb: "Create and export designs.", publishes: false },
  { slug: "slack", name: "Slack", category: "messaging", blurb: "Share drafts and updates with your team.", publishes: true },
  { slug: "discord", name: "Discord", category: "messaging", blurb: "Post announcements to your community.", publishes: true },
  { slug: "gmail", name: "Gmail", category: "marketing", blurb: "Draft and send emails.", publishes: true },
  { slug: "mailchimp", name: "Mailchimp", category: "marketing", blurb: "Build and send newsletters.", publishes: true },
];

export const featuredApp = (slug: string) => FEATURED_APPS.find((a) => a.slug === slug) ?? null;

/**
 * Website hosts of apps agents can reach through a connection (Composio toolkit slug → hosts, subdomains included).
 * When an agent opens one of these in the cloud browser while the app is connected, it is reminded to use the
 * connected app's tools instead (see `appForUrl`).
 */
export const APP_HOSTS: Record<string, readonly string[]> = {
  instagram: ["instagram.com"],
  youtube: ["youtube.com", "youtu.be"],
  twitter: ["x.com", "twitter.com"],
  linkedin: ["linkedin.com"],
  facebook: ["facebook.com", "fb.com"],
  threads: ["threads.net", "threads.com"],
  tiktok: ["tiktok.com"],
  pinterest: ["pinterest.com"],
  reddit: ["reddit.com"],
  notion: ["notion.so", "notion.com"],
  googledocs: ["docs.google.com/document"],
  googlesheets: ["docs.google.com/spreadsheets", "sheets.google.com"],
  googlecalendar: ["calendar.google.com"],
  googledrive: ["drive.google.com"],
  dropbox: ["dropbox.com"],
  canva: ["canva.com"],
  slack: ["slack.com"],
  discord: ["discord.com"],
  gmail: ["mail.google.com", "gmail.com"],
  mailchimp: ["mailchimp.com"],
};

/**
 * The first of `toolkits` whose website `url` is on, or null. An entry is a host (matching it and its subdomains) or
 * a host plus path prefix (for Google apps that share docs.google.com). URLs without a scheme are read as https.
 */
export function appForUrl(url: string, toolkits: readonly string[]): string | null {
  let parsed: URL;
  try {
    parsed = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(url.trim()) ? url.trim() : `https://${url.trim()}`);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  const host = parsed.hostname.toLowerCase().replace(/\.$/, "");
  const path = parsed.pathname.toLowerCase();
  for (const toolkit of toolkits) {
    for (const entry of APP_HOSTS[toolkit] ?? []) {
      const slash = entry.indexOf("/");
      const entryHost = slash < 0 ? entry : entry.slice(0, slash);
      const entryPath = slash < 0 ? "" : entry.slice(slash);
      const hostMatches = host === entryHost || host.endsWith(`.${entryHost}`);
      if (hostMatches && (!entryPath || path === entryPath || path.startsWith(`${entryPath}/`))) return toolkit;
    }
  }
  return null;
}

/** Composio toolkit slugs are lowercase letters, digits, and underscores. */
export const isToolkitSlug = (value: unknown): value is string => typeof value === "string" && /^[a-z0-9_]{2,60}$/.test(value);

/** An app as the Accounts page shows it: catalog data plus what Composio says about connecting it. */
export type AppInfo = {
  slug: string;
  name: string;
  logo: string | null;
  category: AppCategory | null;
  blurb: string;
  /**
   * How the user can connect it. `managed`: Composio's own OAuth app, ready to use. `configured`: this project has its
   * own auth config in Composio. `setup`: neither yet; it must be set up in the Composio dashboard first.
   */
  connect: "managed" | "configured" | "setup" | "none";
};

// ---------- Connections ----------

export const connectionStatuses = ["initiated", "active", "failed", "expired", "disabled", "revoked"] as const;
export type ConnectionStatus = (typeof connectionStatuses)[number];

export const connectionStatusLabels: Record<ConnectionStatus, string> = {
  initiated: "Waiting for sign-in", active: "Connected", failed: "Failed", expired: "Expired", disabled: "Paused", revoked: "Revoked",
};

/** `read`: agents may only use read-only tools. `publish`: they may also post, upload, and change things. */
export const appPermissions = ["read", "publish"] as const;
export type AppPermission = (typeof appPermissions)[number];
export const agentAccessModes = ["all", "selected"] as const;
export type AgentAccess = (typeof agentAccessModes)[number];

export type ConnectionRecord = {
  documentId: string;
  toolkit: string;
  toolkitName: string;
  logo: string | null;
  composioAccountId: string;
  status: ConnectionStatus;
  statusReason: string | null;
  accountLabel: string | null;
  permission: AppPermission;
  agentAccess: AgentAccess;
  /** Agent documentIds allowed when `agentAccess` is "selected". */
  allowedAgents: string[];
  /** Ask the user before an agent posts or changes something with this account. */
  requireApproval: boolean;
  connectedAt: string | null;
  createdAt: string | null;
};

const str = (v: unknown) => (typeof v === "string" && v ? v : null);

function oneOf<T extends string>(options: readonly T[], value: unknown, fallback: T): T {
  return typeof value === "string" && (options as readonly string[]).includes(value) ? (value as T) : fallback;
}

const AGENT_ID = /^[a-z0-9]{8,64}$/i;
export const parseAgentIds = (value: unknown): string[] =>
  Array.isArray(value) ? [...new Set(value.filter((v): v is string => typeof v === "string" && AGENT_ID.test(v)))].slice(0, 100) : [];

export function connectionFromStrapi(row: Record<string, unknown>): ConnectionRecord {
  const toolkit = String(row.toolkit ?? "");
  return {
    documentId: String(row.documentId),
    toolkit,
    toolkitName: str(row.toolkitName) ?? featuredApp(toolkit)?.name ?? toolkit,
    logo: str(row.logo),
    composioAccountId: String(row.composioAccountId ?? ""),
    status: oneOf(connectionStatuses, row.status, "initiated"),
    statusReason: str(row.statusReason),
    accountLabel: str(row.accountLabel),
    permission: oneOf(appPermissions, row.permission, "publish"),
    agentAccess: oneOf(agentAccessModes, row.agentAccess, "all"),
    allowedAgents: parseAgentIds(row.allowedAgents),
    requireApproval: row.requireApproval !== false,
    connectedAt: str(row.connectedAt),
    createdAt: str(row.createdAt),
  };
}

/** Maps a Composio connected-account status to ours. */
export function statusFromComposio(status: unknown, disabled = false): ConnectionStatus {
  if (disabled) return "disabled";
  switch (String(status ?? "").toUpperCase()) {
    case "ACTIVE": return "active";
    case "INITIATED": case "INITIALIZING": return "initiated";
    case "EXPIRED": return "expired";
    case "REVOKED": return "revoked";
    case "INACTIVE": return "disabled";
    default: return "failed";
  }
}

/**
 * Whether an agent may use a connection at all. Headquarters (agentId null) may always see what is connected, but
 * only agents run app tools. Only active connections count.
 */
export function agentCanUse(connection: Pick<ConnectionRecord, "status" | "agentAccess" | "allowedAgents">, agentId: string | null): boolean {
  if (connection.status !== "active" || !agentId) return false;
  return connection.agentAccess === "all" || connection.allowedAgents.includes(agentId);
}

// ---------- Tool permissions ----------

/** What a Composio tool does, from its tags: reads only, creates/changes something, or deletes something. */
export type ToolEffect = "read" | "write" | "destructive";

export function toolEffect(tags: readonly string[] | null | undefined): ToolEffect {
  const set = new Set(tags ?? []);
  if (set.has("destructiveHint")) return "destructive";
  if (set.has("readOnlyHint") && !set.has("createHint") && !set.has("updateHint")) return "read";
  // Untagged tools are treated as writes: asking once too often beats posting without permission.
  return "write";
}

/**
 * Whether a tool may run on a connection, and whether the user must approve it first. Read-only connections refuse
 * every non-read tool; deletions always need approval; other changes need it when the workspace's publishing
 * approval (Settings page) is "ask", or, when it is "auto", when the connection itself asks for it. The workspace
 * setting can only add approvals, never remove one an account requires.
 */
export function toolPolicy(connection: Pick<ConnectionRecord, "permission" | "requireApproval">, effect: ToolEffect, workspaceApproval: "ask" | "auto" = "ask"):
  { allowed: true; approval: boolean } | { allowed: false; reason: string } {
  if (effect === "read") return { allowed: true, approval: false };
  if (connection.permission === "read") {
    return { allowed: false, reason: "This account is connected read-only. The user can allow posting on the Accounts page." };
  }
  return { allowed: true, approval: effect === "destructive" || workspaceApproval === "ask" || connection.requireApproval };
}

/** Validates the access settings the Accounts page sends. */
export function parseConnectionSettings(raw: unknown): { settings: Pick<ConnectionRecord, "permission" | "agentAccess" | "allowedAgents" | "requireApproval"> } | { error: string } {
  const input = (raw ?? {}) as Record<string, unknown>;
  const permission = oneOf(appPermissions, input.permission, "" as AppPermission);
  if (!permission) return { error: "Choose what agents may do with this account." };
  const agentAccess = oneOf(agentAccessModes, input.agentAccess, "" as AgentAccess);
  if (!agentAccess) return { error: "Choose which agents may use this account." };
  const allowedAgents = parseAgentIds(input.allowedAgents);
  if (agentAccess === "selected" && !allowedAgents.length) return { error: "Pick at least one agent, or allow all agents." };
  return { settings: { permission, agentAccess, allowedAgents: agentAccess === "selected" ? allowedAgents : [], requireApproval: input.requireApproval !== false } };
}

// ---------- Posts ----------

export const postStatuses = ["draft", "scheduled", "publishing", "published", "failed", "cancelled"] as const;
export type PostStatus = (typeof postStatuses)[number];

export const postStatusLabels: Record<PostStatus, string> = {
  draft: "Draft", scheduled: "Scheduled", publishing: "Publishing", published: "Published", failed: "Failed", cancelled: "Cancelled",
};

export type SocialPost = {
  documentId: string;
  toolkit: string;
  /** The Composio tool that publishes it; empty for a draft nobody has prepared for publishing yet. */
  toolSlug: string;
  title: string;
  summary: string | null;
  /** The post text (caption, tweet, description) as written. */
  content: string | null;
  /** https URLs of images or videos that go with the post. */
  media: string[];
  status: PostStatus;
  /** When it publishes (scheduled), or the suggested time (draft). */
  publishAt: string | null;
  publishedAt: string | null;
  url: string | null;
  error: string | null;
  agentName: string | null;
  /** The account it publishes with, once prepared. */
  connectionId: string | null;
  accountLabel: string | null;
  artifactId: string | null;
  createdAt: string | null;
};

const rel = (v: unknown) => (v && typeof v === "object" && "documentId" in v ? String((v as { documentId: unknown }).documentId) : null);

export const parseMedia = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && /^https:\/\/\S+$/.test(v)).slice(0, 10) : [];

export function postFromStrapi(row: Record<string, unknown>): SocialPost {
  const agent = row.agent as { name?: unknown } | null | undefined;
  const account = row.connectedAccount as { accountLabel?: unknown; toolkitName?: unknown } | null | undefined;
  return {
    documentId: String(row.documentId),
    toolkit: String(row.toolkit ?? ""),
    toolSlug: String(row.toolSlug ?? ""),
    title: String(row.title ?? "Post"),
    summary: str(row.summary),
    content: str(row.content),
    media: parseMedia(row.media),
    status: oneOf(postStatuses, row.status, "draft"),
    publishAt: str(row.publishAt),
    publishedAt: str(row.publishedAt),
    url: str(row.url),
    error: str(row.error),
    agentName: agent && typeof agent.name === "string" ? agent.name : null,
    connectionId: rel(row.connectedAccount),
    accountLabel: account ? str(account.accountLabel) ?? str(account.toolkitName) : null,
    artifactId: rel(row.artifact),
    createdAt: str(row.createdAt),
  };
}

/** Where a post sits on the calendar: its publish time, else when it was published, else when it was made. */
export const postDate = (post: Pick<SocialPost, "status" | "publishAt" | "publishedAt" | "createdAt">): string | null =>
  post.status === "published" ? post.publishedAt ?? post.publishAt ?? post.createdAt : post.publishAt ?? post.publishedAt ?? (post.status === "draft" ? null : post.createdAt);

/** Scheduled times must be at least this far ahead, so the publishing schedule has a chance to run. */
export const MIN_SCHEDULE_LEAD_MS = 5 * 60 * 1000;

/** Checks a schedule time from the browser. */
export function scheduleTimeProblem(iso: string, now = Date.now()): string | null {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return "Pick a date and time.";
  if (at < now + MIN_SCHEDULE_LEAD_MS - 30_000) return "Pick a time at least 5 minutes from now.";
  if (at > now + 366 * 24 * 3600_000) return "Pick a time within a year.";
  return null;
}

/**
 * What the user can do with a draft, given the account it would publish with. `ready`: it can be published or
 * scheduled. `prepare`: an agent must pick the app's tool first. `connect` / `posting`: the account is missing or
 * read-only.
 */
export type DraftReadiness = "ready" | "prepare" | "connect" | "posting";

export function draftReadiness(post: Pick<SocialPost, "toolSlug" | "connectionId" | "toolkit">, connections: Pick<ConnectionRecord, "documentId" | "toolkit" | "status" | "permission">[]): DraftReadiness {
  const active = connections.filter((c) => c.toolkit === post.toolkit && c.status === "active");
  if (!active.length) return "connect";
  if (!post.toolSlug || !post.connectionId) return "prepare";
  const account = active.find((c) => c.documentId === post.connectionId);
  if (!account) return "prepare";
  return account.permission === "publish" ? "ready" : "posting";
}

/** Finds a public link to what a tool created (a post URL, a permalink) in a tool result, if there is one. */
export function findResultUrl(data: unknown, depth = 0): string | null {
  if (depth > 4 || !data || typeof data !== "object") return null;
  const record = data as Record<string, unknown>;
  for (const key of ["url", "permalink", "post_url", "share_url", "link", "webViewLink", "public_url"]) {
    const value = record[key];
    if (typeof value === "string" && /^https:\/\/\S+$/.test(value)) return value;
  }
  for (const value of Object.values(record)) {
    const found = findResultUrl(value, depth + 1);
    if (found) return found;
  }
  return null;
}
