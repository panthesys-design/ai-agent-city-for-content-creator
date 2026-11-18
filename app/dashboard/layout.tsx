import { cookies } from "next/headers";
import { requireDashboardAccess } from "./access";
import { DashboardShell } from "./dashboard-shell";
import { SIDEBAR_COOKIE } from "./sidebar-state";

/** Signed-in frame for every /dashboard route: collapsible sidebar plus top header. */
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, headquarters } = await requireDashboardAccess();
  // Read the saved sidebar state on the server so the first paint matches it.
  const collapsed = (await cookies()).get(SIDEBAR_COOKIE)?.value === "collapsed";

  return (
    <DashboardShell
      user={{ name: headquarters.displayName?.trim() || user.name || null, email: user.email }}
      headquarters={[{ id: headquarters.documentId, name: headquarters.name, theme: headquarters.theme }]}
      activeHeadquartersId={headquarters.documentId}
      defaultCollapsed={collapsed}
    >
      {children}
    </DashboardShell>
  );
}
