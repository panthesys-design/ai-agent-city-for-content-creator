import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Pin the project root. A stray package-lock.json in the parent folder otherwise makes Next treat
  // that folder as the workspace root, and the dev watcher then sees every write to
  // .next/dev/logs (one per forwarded browser log) as a change, reloading the page forever.
  turbopack: { root: __dirname },
  outputFileTracingRoot: __dirname,
  experimental: {
    // The cloud computer's file panel uploads files up to 5 MB through a server action (default limit 1 MB).
    serverActions: { bodySizeLimit: "6mb" },
    // In dev, Next replays Server Component fetch responses across hot reloads, even `no-store` ones.
    // The city page seeds starter agents on first visit, so stale reads there would seed twice.
    serverComponentsHmrCache: false,
    // With the MCP server on (the default), Next appends every server and forwarded browser log to
    // .next/dev/logs/next-development.log. Turbopack's watcher still picks those writes up as changes
    // (even with the root pinned above), so each page load logs, recompiles, and reloads the page forever.
    mcpServer: false,
  },
};

export default nextConfig;
