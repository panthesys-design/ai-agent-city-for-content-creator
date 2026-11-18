import {
  buildingIcons, headquarters, headquartersStyles, headquartersThemes, headquartersTints,
  type HeadquartersSpec,
} from "@/components/agent-city";
import { ensureStrapiUser, strapi } from "./strapi";
import type { AgentDefaults, PublishingApproval } from "./workspace-settings";

// Server-only persistence for each user's headquarters in the Strapi "headquarters" collection
// (singular API ID `headquarter`, plural `headquarters`). See docs/headquarters.md for the schema.

/** The appearance fields a user chooses; the ID and type stay fixed. The plot is saved separately (`x`, `y`). */
export type HeadquartersInput = Required<Pick<HeadquartersSpec, "name" | "style" | "theme" | "height" | "tint" | "icon" | "spire" | "trees">>;
/** `agentsSeeded` is set once the starter agents were created, so deleting them all never re-creates them. */
/** `x`/`y` are the dragged plot; null means the original plot from the `headquarters` preset. */
/**
 * Workspace settings (Settings page; parsed with the helpers in `workspace-settings.ts`): `timeZone` is the IANA zone
 * for "today" in agent instructions and activity times; `agentDefaults` is what new agents start with (raw JSON, read
 * with `agentDefaultsFrom`); `publishingApproval` is "ask" or "auto"; `displayName` is the owner's profile name.
 */
export type HeadquartersRecord = HeadquartersInput & {
  id: number; documentId: string; agentsSeeded?: boolean | null; x?: number | null; y?: number | null;
  timeZone?: string | null; agentDefaults?: Partial<AgentDefaults> | null; publishingApproval?: PublishingApproval | null; displayName?: string | null;
};

/** Settings fields the Settings page writes, alongside the appearance fields of `HeadquartersInput`. */
export type HeadquartersPatch = Partial<HeadquartersInput> & {
  timeZone?: string | null; agentDefaults?: AgentDefaults; publishingApproval?: PublishingApproval; displayName?: string | null;
};

export const HEADQUARTERS_NAME_MAX = 32;

/** The user's headquarters, or null when they have not created one yet. */
export async function findHeadquarters(email: string): Promise<HeadquartersRecord | null> {
  const query = new URLSearchParams({
    "filters[owner][email][$eqi]": email.trim().toLowerCase(),
    "pagination[pageSize]": "1",
  });
  const { data } = await strapi<{ data: HeadquartersRecord[] }>(`/headquarters?${query}`);
  return data[0] ?? null;
}

/** Saves a new headquarters linked to the user's Strapi profile (created first if missing). */
export async function createHeadquarters(email: string, input: HeadquartersInput, settings: { timeZone?: string | null } = {}): Promise<HeadquartersRecord> {
  const owner = await ensureStrapiUser(email);
  const { data } = await strapi<{ data: HeadquartersRecord }>("/headquarters", {
    method: "POST",
    body: JSON.stringify({ data: { ...input, timeZone: settings.timeZone ?? null, owner: { connect: [owner.documentId] } } }),
  });
  return data;
}

/** Updates the headquarters' appearance or settings. Callers pass the signed-in user's own record. */
export async function updateHeadquarters(documentId: string, patch: HeadquartersPatch): Promise<HeadquartersRecord> {
  const { data } = await strapi<{ data: HeadquartersRecord }>(`/headquarters/${encodeURIComponent(documentId)}`, {
    method: "PUT",
    body: JSON.stringify({ data: patch }),
  });
  return data;
}

/** Where the headquarters stands: its saved plot, or the original one. */
export function headquartersPosition(record: Pick<HeadquartersRecord, "x" | "y">): { x: number; y: number } {
  return Number.isInteger(record.x) && Number.isInteger(record.y) ? { x: record.x!, y: record.y! } : { x: headquarters.x, y: headquarters.y };
}

/** A saved record as a city building, keeping the stable headquarters ID. */
export function toHeadquartersSpec(record: HeadquartersRecord): HeadquartersSpec {
  const { name, style, theme, height, tint, icon, spire, trees } = record;
  return { ...headquarters, ...headquartersPosition(record), name, style, theme, height, tint, icon, spire, trees };
}

function oneOf<T extends string>(options: readonly T[], value: FormDataEntryValue | null): T | null {
  return typeof value === "string" && (options as readonly string[]).includes(value) ? (value as T) : null;
}

/** Validates the creation form. Returns the input, or an error message for the first invalid field. */
export function parseHeadquartersForm(formData: FormData): { input: HeadquartersInput } | { error: string } {
  const rawName = formData.get("name");
  const name = typeof rawName === "string" ? rawName.trim().replace(/\s+/g, " ") : "";
  if (!name) return { error: "Give your headquarters a name." };
  if (name.length > HEADQUARTERS_NAME_MAX) return { error: `Keep the name to ${HEADQUARTERS_NAME_MAX} characters or fewer.` };

  const style = oneOf(headquartersStyles, formData.get("style"));
  const theme = oneOf(headquartersThemes, formData.get("theme"));
  const tint = oneOf(headquartersTints, formData.get("tint"));
  const icon = oneOf(buildingIcons, formData.get("icon"));
  const height = Number(formData.get("height"));
  if (!style) return { error: "Choose a headquarters design." };
  if (!theme) return { error: "Choose a building color." };
  if (!tint) return { error: "Choose a glass tint." };
  if (!icon) return { error: "Choose an icon." };
  if (![1, 2, 3, 4, 5].includes(height)) return { error: "Choose a tower height." };

  return {
    input: {
      name, style, theme, tint, icon,
      height: height as HeadquartersInput["height"],
      spire: formData.get("spire") === "on",
      trees: formData.get("trees") === "on",
    },
  };
}

/** A headquarters by document ID, for background work that runs without a signed-in session. */
export async function getHeadquartersById(documentId: string): Promise<HeadquartersRecord | null> {
  try {
    const { data } = await strapi<{ data: HeadquartersRecord }>(`/headquarters/${encodeURIComponent(documentId)}`);
    return data ?? null;
  } catch {
    return null;
  }
}
