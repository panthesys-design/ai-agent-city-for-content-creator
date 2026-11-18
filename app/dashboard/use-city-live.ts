"use client";

import { useEffect, useRef } from "react";
import type { CitySnapshot } from "@/lib/city-live";

/** Subscribes to `/api/city/stream` while mounted and calls `onSnapshot` for each change. Reconnects on its own. */
export function useCityLive(onSnapshot: (snapshot: CitySnapshot) => void) {
  const handler = useRef(onSnapshot);
  useEffect(() => { handler.current = onSnapshot; }, [onSnapshot]);

  useEffect(() => {
    const source = new EventSource("/api/city/stream");
    source.onmessage = (event) => {
      try {
        handler.current(JSON.parse(event.data) as CitySnapshot);
      } catch { /* ignore a malformed frame; the next one replaces it */ }
    };
    return () => source.close();
  }, []);
}
