import { getAccessToken } from "./api-client";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:4000";

export type WsHandler = (event: { type: string; payload: unknown }) => void;

/**
 * Minimal reconnecting WS client for a given namespace (e.g. "/ws/activity").
 * Phase 1 treats real-time as a nice-to-have layered on top of REST polling
 * fallbacks (see docs/05 §Activity feed) — this client degrades silently if
 * the backend gateway isn't reachable.
 */
export function connectNamespace(namespace: string, onMessage: WsHandler): () => void {
  if (typeof window === "undefined") return () => {};

  let socket: WebSocket | null = null;
  let closedByCaller = false;
  let retryDelay = 1000;

  function connect() {
    const token = getAccessToken();
    const url = `${WS_URL}${namespace}${token ? `?token=${encodeURIComponent(token)}` : ""}`;
    try {
      socket = new WebSocket(url);
    } catch {
      return;
    }

    socket.onmessage = (evt) => {
      try {
        const parsed = JSON.parse(evt.data);
        onMessage(parsed);
      } catch {
        // ignore malformed frames
      }
    };

    socket.onclose = () => {
      if (closedByCaller) return;
      retryDelay = Math.min(retryDelay * 1.5, 15000);
      setTimeout(connect, retryDelay);
    };

    socket.onerror = () => {
      socket?.close();
    };
  }

  connect();

  return () => {
    closedByCaller = true;
    socket?.close();
  };
}
