"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ConnectionStatus } from "@/lib/connection-records";
import { checkConnectionAction, startConnectionAction } from "./actions";

// Connects an app in a popup: Composio's hosted sign-in opens in a small window, and /api/accounts/callback posts the
// result back here and closes it. If the popup is blocked, the sign-in opens in this tab and returns to Accounts.

export type ConnectOutcome = { toolkit: string; connectionId: string | null; status: ConnectionStatus | "closed" };

type Pending = { toolkit: string; connectionId: string | null; popup: Window | null };

export function useConnectApp(onDone: (outcome: ConnectOutcome) => void) {
  const [pendingToolkit, setPendingToolkit] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const current = useRef<Pending | null>(null);
  const done = useRef(onDone);
  useEffect(() => { done.current = onDone; }, [onDone]);

  const finish = useCallback((outcome: ConnectOutcome) => {
    if (!current.current || current.current.toolkit !== outcome.toolkit) return;
    current.current = null;
    setPendingToolkit(null);
    done.current(outcome);
  }, []);

  // The callback page's message (same origin only).
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data as { type?: string; toolkit?: string; connectionId?: string; status?: ConnectionStatus } | null;
      if (data?.type !== "creator-city:connection" || !data.toolkit) return;
      finish({ toolkit: data.toolkit, connectionId: data.connectionId || current.current?.connectionId || null, status: data.status ?? "failed" });
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [finish]);

  // When the user closes the popup without the callback (or it loaded elsewhere), check the connection directly.
  useEffect(() => {
    if (!pendingToolkit) return;
    const timer = setInterval(async () => {
      const pending = current.current;
      if (!pending?.popup || !pending.popup.closed) return;
      clearInterval(timer);
      const result = pending.connectionId ? await checkConnectionAction(pending.connectionId) : null;
      const status = result?.ok && result.connection ? result.connection.status : "closed";
      finish({ toolkit: pending.toolkit, connectionId: pending.connectionId, status });
    }, 800);
    return () => clearInterval(timer);
  }, [pendingToolkit, finish]);

  const connect = useCallback(async (toolkit: string, options: { replaces?: string } = {}) => {
    setError(null);
    // Open the window during the click, before awaiting, so popup blockers allow it.
    const width = 520, height = 720;
    const left = Math.max(0, window.screenX + (window.outerWidth - width) / 2);
    const top = Math.max(0, window.screenY + (window.outerHeight - height) / 2);
    const popup = window.open("about:blank", "creator-city-connect", `popup,width=${width},height=${height},left=${left},top=${top}`);
    current.current = { toolkit, connectionId: null, popup };
    setPendingToolkit(toolkit);
    const result = await startConnectionAction(toolkit, options);
    if (!result.ok) {
      popup?.close();
      current.current = null;
      setPendingToolkit(null);
      setError(result.error);
      return;
    }
    if (current.current) current.current.connectionId = result.connectionId;
    if (popup && !popup.closed) popup.location.href = result.redirectUrl;
    else window.location.assign(result.redirectUrl);
  }, []);

  return { connect, pendingToolkit, error, clearError: () => setError(null) };
}
