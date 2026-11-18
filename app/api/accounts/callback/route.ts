import { getCurrentUser } from "@/lib/auth/session";
import { findConnection, syncConnection } from "@/lib/composio/connections";
import { findHeadquarters } from "@/lib/headquarters";

// Where Composio sends the user after they sign in to an app (the connection link's callbackUrl). Only the signed-in
// owner's headquarters is searched for the connection, which is then synced with Composio. In the sign-in popup this
// page tells the Accounts page (or chat card) and closes; opened in the main window, it redirects to Accounts.

const escape = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export async function GET(request: Request) {
  const url = new URL(request.url);
  const connectionId = url.searchParams.get("connection") ?? "";
  let status = "failed";
  let toolkit = "";
  let name = "the app";

  const user = await getCurrentUser();
  const hq = user ? await findHeadquarters(user.email) : null;
  if (hq && /^[a-z0-9]{8,64}$/i.test(connectionId)) {
    const row = await findConnection(hq.documentId, connectionId).catch(() => null);
    if (row) {
      const synced = await syncConnection(hq.documentId, row).catch(() => row);
      status = synced.status;
      toolkit = synced.toolkit;
      name = synced.toolkitName;
    }
  }
  const ok = status === "active";
  const back = `/dashboard/accounts?${new URLSearchParams({ connected: toolkit, status })}`;
  // Only checked values reach the page, and `<` is escaped so nothing can close the script element.
  const safeJson = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c");
  const message = safeJson({ type: "creator-city:connection", connectionId: toolkit ? connectionId : "", toolkit, status });
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${ok ? "Connected" : "Not connected"} — Creator City</title>
<style>body{margin:0;display:grid;place-items:center;min-height:100vh;font:15px system-ui,sans-serif;background:#fbfaff;color:#171427}
@media (prefers-color-scheme:dark){body{background:#0c0b14;color:#f2f0fa}}main{max-width:340px;padding:24px;text-align:center}a{color:#6d4ae0}</style></head>
<body><main><h1 style="font-size:18px">${ok ? `${escape(name)} is connected` : `${escape(name)} wasn't connected`}</h1>
<p>${ok ? "You can close this window." : "You can close this window and try again."}</p><p><a href="${escape(back)}">Back to Accounts</a></p></main>
<script>
(function () {
  var message = ${message};
  if (window.opener && !window.opener.closed) {
    try { window.opener.postMessage(message, window.location.origin); } catch (e) {}
    setTimeout(function () { window.close(); }, ${ok ? 600 : 2500});
  } else {
    window.location.replace(${safeJson(back)});
  }
})();
</script></body></html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}
