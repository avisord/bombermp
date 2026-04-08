/**
 * CrazyGames SDK wrapper.
 *
 * Provides a thin integration layer around the CrazyGames SDK.
 * When the game is NOT running on CrazyGames (e.g. local dev),
 * every method gracefully no-ops so the rest of the codebase
 * doesn't need to care.
 *
 * SDK docs: https://docs.crazygames.com/
 */

// ─── Types (subset of the SDK we use) ────────────────────────────────────────

interface CrazySDKUser {
  username: string;
  profilePictureUrl: string;
  userId: string;
}

interface CrazySDKUserModule {
  getUser(): Promise<CrazySDKUser | null>;
  getUserToken(): Promise<string | null>;
  showAuthPrompt(): Promise<CrazySDKUser | null>;
  addAuthListener(callback: (user: CrazySDKUser | null) => void): void;
}

interface CrazySDKGameModule {
  gameplayStart(): void;
  gameplayStop(): void;
  loadingStart(): void;
  loadingStop(): void;
  sdkGameLoadingStart(): void;
  sdkGameLoadingStop(): void;
}

interface CrazySDKAdModule {
  requestAd(type: 'midgame' | 'rewarded', callbacks: {
    adStarted: () => void;
    adFinished: () => void;
    adError: (error: string) => void;
  }): void;
}

interface CrazySDKInviteParams {
  roomId: string;
  url?: string;
}

interface CrazySDKInstance {
  game: CrazySDKGameModule;
  user: CrazySDKUserModule;
  ad: CrazySDKAdModule;
  inviteLink(params: CrazySDKInviteParams): void;
  getInviteParam(key: string): string | null;
  isEnvironmentAvailable(): boolean;
}

declare global {
  interface Window {
    CrazyGames?: {
      CrazySDK: {
        getInstance(): CrazySDKInstance;
      };
      SDK?: CrazySDKInstance;
    };
  }
}

// ─── Module state ─────────────────────────────────────────────────────────────

let sdk: CrazySDKInstance | null = null;
let sdkReady = false;
let initPromiseResolve: (() => void) | null = null;
const initPromise = new Promise<void>((resolve) => { initPromiseResolve = resolve; });

// ─── Initialisation ──────────────────────────────────────────────────────────

/**
 * Initialise the CrazyGames SDK. Call once at application boot.
 * Resolves immediately if the SDK is not available (non-CrazyGames env).
 */
export async function initCrazySDK(): Promise<void> {
  try {
    // The SDK is loaded via <script> in index.html
    if (window.CrazyGames?.SDK) {
      sdk = window.CrazyGames.SDK;
    } else if (window.CrazyGames?.CrazySDK) {
      sdk = window.CrazyGames.CrazySDK.getInstance();
    }

    if (sdk) {
      sdkReady = true;
      console.log('[CrazyGames] SDK initialised');
    } else {
      console.log('[CrazyGames] SDK not available — running outside CrazyGames');
    }
  } catch (err) {
    console.warn('[CrazyGames] SDK init failed:', err);
  }
  initPromiseResolve?.();
}

export function isCrazyGamesEnv(): boolean {
  return sdkReady && sdk !== null;
}

export function waitForSDK(): Promise<void> {
  return initPromise;
}

// ─── Game lifecycle events ───────────────────────────────────────────────────

export function gameLoadingStart(): void {
  try { sdk?.game.loadingStart(); } catch { /* noop */ }
}

export function gameLoadingStop(): void {
  try { sdk?.game.loadingStop(); } catch { /* noop */ }
}

export function gameplayStart(): void {
  try { sdk?.game.gameplayStart(); } catch { /* noop */ }
}

export function gameplayStop(): void {
  try { sdk?.game.gameplayStop(); } catch { /* noop */ }
}

// ─── Ads ─────────────────────────────────────────────────────────────────────

/**
 * Request a midgame ad (shown between rounds / at game over).
 * Returns a promise that resolves when the ad finishes or errors.
 * The caller should mute audio and pause the game before calling.
 */
export function requestMidgameAd(): Promise<'finished' | 'error'> {
  if (!sdk) return Promise.resolve('error');
  return new Promise((resolve) => {
    sdk!.ad.requestAd('midgame', {
      adStarted: () => {
        console.log('[CrazyGames] Midgame ad started');
      },
      adFinished: () => {
        console.log('[CrazyGames] Midgame ad finished');
        resolve('finished');
      },
      adError: (error) => {
        console.warn('[CrazyGames] Midgame ad error:', error);
        resolve('error');
      },
    });
  });
}

/**
 * Request a rewarded ad. Returns 'finished' only when the player
 * should receive the reward; returns 'error' otherwise.
 */
export function requestRewardedAd(): Promise<'finished' | 'error'> {
  if (!sdk) return Promise.resolve('error');
  return new Promise((resolve) => {
    sdk!.ad.requestAd('rewarded', {
      adStarted: () => {
        console.log('[CrazyGames] Rewarded ad started');
      },
      adFinished: () => {
        console.log('[CrazyGames] Rewarded ad finished');
        resolve('finished');
      },
      adError: (error) => {
        console.warn('[CrazyGames] Rewarded ad error:', error);
        resolve('error');
      },
    });
  });
}

// ─── User ────────────────────────────────────────────────────────────────────

/**
 * Get the current CrazyGames user, or null if not logged in / not on CG.
 */
export async function getCrazyUser(): Promise<CrazySDKUser | null> {
  if (!sdk) return null;
  try {
    return await sdk.user.getUser();
  } catch {
    return null;
  }
}

/**
 * Get a JWT token for server-side verification.
 */
export async function getUserToken(): Promise<string | null> {
  if (!sdk) return null;
  try {
    return await sdk.user.getUserToken();
  } catch {
    return null;
  }
}

/**
 * Register a listener for auth state changes (login/logout).
 */
export function addAuthListener(callback: (user: CrazySDKUser | null) => void): void {
  try { sdk?.user.addAuthListener(callback); } catch { /* noop */ }
}

// ─── Invite links ────────────────────────────────────────────────────────────

/**
 * Trigger the CrazyGames invite UI for a given room.
 */
export function showInvitePopup(roomId: string): void {
  try {
    sdk?.inviteLink({ roomId });
  } catch {
    console.warn('[CrazyGames] inviteLink not available');
  }
}

/**
 * Check if the player arrived via an invite link and extract the room ID.
 */
export function getInviteRoomId(): string | null {
  if (!sdk) return null;
  try {
    return sdk.getInviteParam('roomId');
  } catch {
    return null;
  }
}
