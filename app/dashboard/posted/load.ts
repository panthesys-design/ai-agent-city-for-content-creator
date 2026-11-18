import { composioConfigured } from "@/lib/composio/client";
import { listConnections } from "@/lib/composio/connections";
import { listPosts } from "@/lib/composio/posts";
import type { SocialPost } from "@/lib/connection-records";
import type { ConnectionInfo } from "./post-ui";

/** Posts and connections for the Post and Calendar pages (always one headquarters). */
export async function loadPosts(hqId: string): Promise<{ posts: SocialPost[]; connections: ConnectionInfo[]; error: string | null }> {
  if (!composioConfigured()) return { posts: [], connections: [], error: null };
  try {
    const [posts, connections] = await Promise.all([listPosts(hqId), listConnections(hqId)]);
    return {
      posts,
      connections: connections.map(({ documentId, toolkit, toolkitName, status, permission }) => ({ documentId, toolkit, toolkitName, status, permission })),
      error: null,
    };
  } catch (e) {
    return { posts: [], connections: [], error: e instanceof Error ? e.message : "We couldn't load your posts." };
  }
}
