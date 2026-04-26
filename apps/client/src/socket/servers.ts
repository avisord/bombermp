import { GAME_VERSION, isMajorCompatible } from '@bombermp/shared';
import { assetPath } from '../assets/registry.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ServerInfo {
  slug:        string;
  name:        string;
  url:         string;
  /** Marked true for entries the user added themselves (stored in localStorage). */
  isCustom?:   boolean;
}

export interface ServerStatus {
  info:                ServerInfo;
  online:              boolean;
  players:             number;
  latencyMs:           number;
  /** Server version reported by /health, if any. */
  serverVersion:       string | null;
  /** True when client and server agree on major version. */
  versionCompatible:   boolean;
}

// ─── Built-in server list ────────────────────────────────────────────────────

const WS_FALLBACK = (import.meta.env['VITE_WS_URL'] as string | undefined) ?? 'http://localhost:3001';

async function fetchBuiltInServers(): Promise<ServerInfo[]> {
  try {
    const res = await fetch(assetPath('/servers.json'));
    const list: ServerInfo[] = await res.json();
    if (Array.isArray(list) && list.length > 0) return list;
  } catch { /* fall through */ }

  return [{ slug: 'default', name: 'Default', url: WS_FALLBACK }];
}

// ─── Custom servers (localStorage) ───────────────────────────────────────────

const CUSTOM_SERVERS_KEY = 'bombermp_custom_servers';

export function loadCustomServers(): ServerInfo[] {
  try {
    const raw = localStorage.getItem(CUSTOM_SERVERS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((s): s is ServerInfo =>
        s && typeof s.slug === 'string' && typeof s.name === 'string' && typeof s.url === 'string')
      .map((s) => ({ ...s, isCustom: true }));
  } catch {
    return [];
  }
}

function saveCustomServers(servers: ServerInfo[]): void {
  localStorage.setItem(CUSTOM_SERVERS_KEY, JSON.stringify(servers));
}

export function addCustomServer(server: Omit<ServerInfo, 'isCustom'>): void {
  const existing = loadCustomServers();
  const filtered = existing.filter((s) => s.slug !== server.slug);
  filtered.push({ ...server, isCustom: true });
  saveCustomServers(filtered);
}

export function removeCustomServer(slug: string): void {
  const existing = loadCustomServers();
  saveCustomServers(existing.filter((s) => s.slug !== slug));
}

/** Generate a stable slug from a URL — used as the localStorage key. */
export function customSlugFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const base = `custom-${u.host.replace(/[^a-z0-9]/gi, '-')}`;
    return base.toLowerCase();
  } catch {
    return `custom-${Date.now()}`;
  }
}

// ─── Combined server list ────────────────────────────────────────────────────

/** Returns built-in servers merged with user-registered custom servers. */
export async function fetchServerList(): Promise<ServerInfo[]> {
  const builtIn = await fetchBuiltInServers();
  const custom = loadCustomServers();
  // Custom servers take precedence on slug collision (rare).
  const bySlug = new Map<string, ServerInfo>();
  for (const s of builtIn) bySlug.set(s.slug, s);
  for (const s of custom)  bySlug.set(s.slug, s);
  return [...bySlug.values()];
}

// ─── Health probe ────────────────────────────────────────────────────────────

const PING_TIMEOUT_MS = 3000;

interface HealthResponse {
  status?:  string;
  version?: string;
  players?: number;
}

/**
 * Fetches `/health` from a server URL and returns the parsed body + RTT.
 * Throws on network error / timeout.
 */
export async function probeServer(url: string, timeoutMs = PING_TIMEOUT_MS): Promise<{
  body:      HealthResponse;
  latencyMs: number;
}> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const t0 = performance.now();
    const res = await fetch(`${url.replace(/\/$/, '')}/health`, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json() as HealthResponse;
    return { body, latencyMs: Math.round(performance.now() - t0) };
  } finally {
    clearTimeout(timer);
  }
}

export async function pingServer(server: ServerInfo): Promise<ServerStatus> {
  try {
    const { body, latencyMs } = await probeServer(server.url);
    const serverVersion = typeof body.version === 'string' ? body.version : null;
    const versionCompatible = serverVersion !== null
      ? isMajorCompatible(GAME_VERSION, serverVersion)
      // Old servers without a `version` field — treat as legacy/incompatible
      // so users see why they can't connect.
      : false;
    return {
      info: server,
      online: true,
      players: typeof body.players === 'number' ? body.players : 0,
      latencyMs,
      serverVersion,
      versionCompatible,
    };
  } catch {
    return {
      info: server,
      online: false,
      players: 0,
      latencyMs: 0,
      serverVersion: null,
      versionCompatible: false,
    };
  }
}

export async function pingAllServers(servers: ServerInfo[]): Promise<ServerStatus[]> {
  return Promise.all(servers.map(pingServer));
}
