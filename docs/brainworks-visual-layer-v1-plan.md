# Brainworks Visual Layer v1 — Strict Bounded Plan

**Objective:** Display the existing Bailey's Brainworks setup as an interactive city, using Creator City's visual components ONLY. Existing Hub remains the single authority for tasks, workers, routing, approvals, and evidence.

**Status (2026-11-22):** DESIGN ONLY — not implemented, deployed, or user-accepted. Claude Code review attempted on Desktop 91 but OAuth expired; no Claude opinion/consensus obtained.

## A. Invariants / explicit non-goals

- Reuse `components/agent-city` graphics, roads, selection, zoom, node layout, and a simple inspector. Do not reuse Creator City's orchestrator, memory, job runner, CloudHike computer, Composio posting, Strapi task store, or scheduler.
- Do **not** modify or restart Hub, its SQLite database, controllers, Prefontaine/Bannister, Cluck Studio, or service configs.
- V1 is read-only: no task creation, sends, retries, reassignments, stops, approvals, publishing, or writes into Hub. A click changes the view, never authority.
- No paid dependencies, new always-on worker, external exposure, focus stealing, or stored secrets.
- Distinguish task state, worker/process liveness, freshness, and completion evidence. Unknown stays UNKNOWN. A stale heartbeat alone never means OFFLINE.
- Connect roads only for handoffs evidenced in Hub task lineage; UI coordinates/roads do not change dispatch.
- License check before public release: no explicit root LICENSE was observed in the upstream source. Public/forkable does not automatically mean freely redistributable.

## B. Grounded source inventory

| Source | Verified fact | Limit |
|---|---|---|
| `C:\Users\diema\Documents\Baileys Brainworks\Apps\brainworks-hub-3` | Current observed master commit `0e70b5b` | Live source identity/restart NOT reverified here |
| `D:\BrainworksHub\index\work_index.json` | `generated_at`, `counts`, `done[]`, `journal[]` | Does not contain full OPEN task detail |
| `D:\BrainworksHub\index\reconciler_heartbeat.json` | Reconciler observations and per-step report | Not by itself process-liveness proof |
| `D:\BrainworksHub\index\station_desktop91.json` | Station lane outcomes and timestamps | Not an all-machine liveness registry |
| Hub's `mobile.py` | Defines GET `/api/health`, `/api/status`, `/api/items`, `/api/items/{id}`, `/api/workers` | Direct unauthenticated localhost GET returned **401**; respect authentication |
| `D:\BrainworksHub\data\hub2.db` | Hub's state database exists | No browser SQL, cloning or write access in V1 |
| `panthesys-design/ai-agent-city-for-content-creator` | Fork at `189332f18f9a1effc5f20a15635949c8bfcb74f1` | Visual elements reusable; running advertised agent services NOT verified |

Observed (timestamped, **not live-claimed**) Hub index counters: OPEN 21, DONE 67, CANCELLED 45.

## C. First city map

- **HQ:** Brainworks Hub, sole control/ledger authority.
- **Runners/machines:** Desktop 91, SophiaStation, Bill/Prefontaine, Bannister.
- **Capabilities:** Research Engine, Marketing Engine and verified tool lanes.
- **Projects:** Cluck Studio, Social HQ, DownStream, Capable Kitchen, Hearth, Sophia's Quest. A project building is not automatically a live worker.
- A node may have **work status** (OPEN/DONE/BLOCKED/NEEDS OWNER/UNKNOWN), separately **runtime status** (VERIFIED ACTIVE/VERIFIED IDLE/VERIFIED OFFLINE/UNKNOWN), and **freshness** (OBSERVED AT, STALE, UNAVAILABLE).
- Show one status legend, last-checked timestamp and a persistent `data may be stale` indicator. No synthetic agents or fabricated activity animation.

## D. Minimal adapter contract

```ts
type VisualNode = {
  id: string; name: string; kind: "hub"|"runner"|"capability"|"project";
  source: "hub-api"|"hub-projection"|"direct-liveness-evidence"|"verified-external";
  sourceId?: string;
  observedAt: string; staleAfterSeconds: number;
  workState: "open"|"claimed"|"done"|"blocked"|"needs_owner"|"none"|"unknown";
  runtimeState: "active"|"idle"|"offline"|"unknown";
  statusBasis: string; // evidence used, NOT a reassuring label
  taskCount?: number;
  evidence?: { label: string; safeLinkOrPath: string };
};
type Snapshot = {
  generatedAt: string;
  nodes: VisualNode[];
  edges: { from: string; to: string; evidence: string }[];
  counts?: { open?: number; done?: number; cancelled?: number };
  warnings: string[];
};
```

Use **existing authenticated, owner-authorized, read-only Hub GET endpoints** in the established session/security boundary where possible; otherwise use existing sanitized projection files for fields they genuinely support. Never bypass 401. If OPEN task detail cannot be obtained, scope a separately reviewed authorized read-only projection rather than quietly inventing state or creating a second ledger. Keep raw logs, tokens, PII and arbitrary local file paths out of browser payloads. UI layout preferences are independent, not Hub task state.

## E. Task order with exact deliverables / DONE WHEN

### BVL-01 — Freeze sources, permissions and visual schema
**Action:** Pin source revisions, map node types and accessible read-only fields; test authorized access without bypassing 401; build a sanitized sample snapshot with UNKNOWN for unsupported fields.
**Deliverables:** `docs/brainworks-visual-data-contract.md`, `fixtures/brainworks-visual-safe.json`, an allowlist of source fields and safe links.
**DONE WHEN:** Every displayed fact has a source and observation time; no secrets or invented runtime health in fixture; authenticated access design reviewed; no live Hub edits.

### BVL-02 — Render one isolated visual page
**Action:** Reuse city components for 8–12 nodes, district grouping, source badges, keyboard-accessible selection and an inspector. Do not import the Creator City agent runtime into the visual route.
**Deliverables:** One isolated read-only page, fixture adapter and focused unit/component checks.
**DONE WHEN:** Fixture renders, pan/zoom/select work, UNKNOWN and STALE look distinct, changing layout never affects Hub, and no API mutation or agent execution is possible.

### BVL-03 — Make data real, with failure states
**Action:** Feed the UI through the approved authorized read-only Hub route/projection; pin refresh intervals, source timestamps, 401 behavior and stale/timeout handling. Never infer process liveness from heartbeat only.
**Deliverables:** Read-only data adapter, source-provenance diagnostic and explicit offline/unauthorized screens.
**DONE WHEN:** Visible counts match authoritative read-back at the same timestamp; 401 shows AUTH REQUIRED rather than credential workaround; stale and missing records show UNKNOWN/STALE; no POST requests are issued.

### BVL-04 — Drill into evidence
**Action:** Click a building to inspect task count, latest verified outcome, recent evidence/receipt pointer and freshness, not raw scripts, secrets or logs. Present project buildings without a false worker identity.
**Deliverables:** Node detail panel, zero/one/many task fixtures, safe-link and HTML-escaping tests.
**DONE WHEN:** At least three sampled nodes agree with recorded authoritative evidence; untrusted text cannot execute; missing evidence is plainly marked; no unrestricted file browsing is enabled.

### BVL-05 — Accept the visual on Desktop 91
**Action:** Run source checks, launch only isolated UI on a non-conflicting localhost port, inspect a real browser viewport and responsive size, check requests and visual clarity, verify safe closure.
**Deliverables:** Local preview, screenshot evidence, regression outputs, run/rollback steps, acceptance note with exact revision.
**DONE WHEN:** Brian can see HQ and three differing nodes, click and read traceable statuses, and distinguish active work from unknown; request log contains zero writes; Hub stays unchanged; tests and actual browser acceptance pass. Otherwise report PARTIAL, never DONE.

## F. What is deliberately later

Owner-gated retry/send/pause/reassign, new task scheduling, external publishing, cloud execution, and changing Hub schemas are **OUT OF SCOPE** until individually authorized, with PE + Code Aid safety and read-back requirements.

**Safety stop:** Any unplanned Hub write, cross-origin credential bypass, focus theft, port collision, paywall/spend, fabricated liveness, or side-effecting request stops the visual test. Roll back only the isolated visual branch.

**Actual execution state:** BVL-01 through BVL-05 NOT STARTED; this is a bounded plan, not a working integration.
