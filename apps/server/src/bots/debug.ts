/**
 * Bot debug toggle. Double-gated: must be in non-production environment AND
 * have BOT_DEBUG=1 explicitly set. Off by default everywhere.
 */
export function isBotDebugEnabled(): boolean {
  return process.env['NODE_ENV'] !== 'production' && process.env['BOT_DEBUG'] === '1';
}

export function botDebugRoom(roomId: string): string {
  return `${roomId}:bot-debug`;
}
