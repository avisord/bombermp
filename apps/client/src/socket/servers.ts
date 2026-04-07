import { assetPath } from '../assets/registry.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ServerInfo {
  slug: string;
  name: string;
  url:  string;
}

export interface ServerStatus {
  info:      ServerInfo;
  online:    boolean;
  players:   number;
  latencyMs: number;
}

// ─── Fetch server list ───────────────────────────────────────────────────────

const WS_FALLBACK = (import.meta.env['VITE_WS_URL'] as string | undefined) ?? 'http://localhost:3001';

export async function fetchServerList(): Promise<ServerInfo[]> {
  try {
    const res = await fetch(assetPath('/servers.json'));
    const list: ServerInfo[] = await res.json();
    if (Array.isArray(list) && list.length > 0) return list;
  } catch { /* fall through */ }

  // Fallback: single server from env
  return [{ slug: 'default', name: 'Default', url: WS_FALLBACK }];
}

// ─── Ping a single server ────────────────────────────────────────────────────

const PING_TIMEOUT_MS = 3000;

export async function pingServer(server: ServerInfo): Promise<ServerStatus> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PING_TIMEOUT_MS);

  try {
    const t0 = performance.now();
    const res = await fetch(`${server.url}/health`, { signal: controller.signal });
    const latencyMs = Math.round(performance.now() - t0);
    const body = await res.json() as { players?: number };
    return {
      info: server,
      online: true,
      players: typeof body.players === 'number' ? body.players : 0,
      latencyMs,
    };
  } catch {
    return { info: server, online: false, players: 0, latencyMs: 0 };
  } finally {
    clearTimeout(timer);
  }
}

// ─── Ping all servers in parallel ────────────────────────────────────────────

export async function pingAllServers(servers: ServerInfo[]): Promise<ServerStatus[]> {
  return Promise.all(servers.map(pingServer));
}
