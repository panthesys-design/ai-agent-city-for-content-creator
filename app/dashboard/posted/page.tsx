import type { Metadata } from "next";
import { jobsConfig } from "@/lib/ai/env";
import { requireDashboardAccess } from "../access";
import { loadPosts } from "./load";
import { PostList } from "./post-list";

export const metadata: Metadata = { title: "Post — Creator City" };

export default async function PostPage() {
  const { headquarters } = await requireDashboardAccess();
  const { posts, connections, error } = await loadPosts(headquarters.documentId);
  return <PostList initialPosts={posts} connections={connections} schedulingEnabled={Boolean(jobsConfig())} error={error} />;
}
