// ─── Game Version (semver: major.minor.patch) ────────────────────────────────
//
// Single source of truth for the BomberMP API/protocol version. The build
// pipeline keeps this in sync with the workspace package.json files via
// `scripts/bump-version.mjs`. Bumping rules:
//
//   - **major** → breaking protocol change (event payload shape, auth flow,
//     game-state format). Major-version mismatch prevents client/server from
//     connecting (`version not supported`).
//   - **minor** → backwards-compatible additions (new optional fields, new
//     events the old client can ignore).
//   - **patch** → bug fixes, no protocol surface change.
//
// Both server and client compare their *major* component on connect; minor
// and patch can drift freely.

export const GAME_VERSION = '1.0.1';

// ─── Helpers ─────────────────────────────────────────────────────────────────

export interface SemVer {
  major: number;
  minor: number;
  patch: number;
}

/** Parse a `M.m.p` string. Returns `null` if invalid. */
export function parseSemVer(input: string): SemVer | null {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(input.trim());
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
  };
}

/** True iff both versions parse and share the same major. */
export function isMajorCompatible(a: string, b: string): boolean {
  const va = parseSemVer(a);
  const vb = parseSemVer(b);
  if (!va || !vb) return false;
  return va.major === vb.major;
}

/** Human-readable reason for a version mismatch ("client too old / new"). */
export function describeVersionMismatch(clientVersion: string, serverVersion: string): string {
  const c = parseSemVer(clientVersion);
  const s = parseSemVer(serverVersion);
  if (!c || !s) {
    return `Version not supported (client ${clientVersion}, server ${serverVersion})`;
  }
  if (c.major < s.major) {
    return `Version not supported: client ${clientVersion} is older than server ${serverVersion}. Please refresh.`;
  }
  if (c.major > s.major) {
    return `Version not supported: client ${clientVersion} is newer than server ${serverVersion}.`;
  }
  return `Version mismatch (client ${clientVersion}, server ${serverVersion})`;
}
