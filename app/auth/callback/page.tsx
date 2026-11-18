"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { completeGoogleSignIn } from "@/app/(auth)/actions";

export default function AuthCallbackPage() {
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    // The token arrives in the fragment so it never reaches server logs; clear it from the address bar right away.
    const params = new URLSearchParams(window.location.hash.slice(1));
    const token = params.get("token");
    const providerError = params.get("error");
    window.history.replaceState(null, "", window.location.pathname);

    if (providerError || !token) {
      startTransition(() => setError("Google sign-in was not completed. Please try again."));
      return;
    }

    startTransition(async () => {
      const result = await completeGoogleSignIn(token);
      if (result?.error) setError(result.error);
    });
  }, []);

  return (
    <main className="flex min-h-dvh items-center justify-center bg-secondary/40 px-4 py-10">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-background p-6 text-center shadow-sm sm:p-8" aria-live="polite">
        {error ? (
          <>
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>
            <Link href="/sign-in" className="mt-4 inline-block text-sm font-medium text-primary hover:underline">
              Back to sign in
            </Link>
          </>
        ) : (
          <p className="text-sm text-foreground/70">Finishing sign-in…</p>
        )}
      </div>
    </main>
  );
}
