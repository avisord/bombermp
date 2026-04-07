const BOT_NAMES = ['Sparky', 'Blaze', 'Fuse', 'Boom', 'Ash', 'Ember', 'Flash', 'Volt'];

export function pickBotName(index: number): string {
  return BOT_NAMES[index % BOT_NAMES.length]!;
}
