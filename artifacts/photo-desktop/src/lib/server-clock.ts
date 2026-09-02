import { useEffect, useState } from "react";
import { fetchServerTime } from "./api";

let serverOffsetMs = 0;

export function getServerNowMs(): number {
  return Date.now() + serverOffsetMs;
}

export function getServerNow(): Date {
  return new Date(getServerNowMs());
}

export async function syncServerClock(): Promise<void> {
  const requestStarted = Date.now();
  const serverIso = await fetchServerTime();
  const requestFinished = Date.now();
  const serverMs = Date.parse(serverIso);
  if (!Number.isNaN(serverMs)) {
    // Use the midpoint of the request to reduce the effect of network latency.
    const clientMidpoint = requestStarted + (requestFinished - requestStarted) / 2;
    serverOffsetMs = serverMs - clientMidpoint;
  }
}

export function useServerNow(): Date {
  const [now, setNow] = useState(() => getServerNow());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(getServerNow()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}