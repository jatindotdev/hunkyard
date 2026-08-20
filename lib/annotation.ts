export const annotationCardBase =
  'm-2 flex max-w-[600px] gap-2.5 rounded-xl border border-[var(--diffshub-annotation-border,var(--color-border))] bg-[var(--diffshub-annotation-bg,var(--color-card))] bg-clip-padding p-3 font-sans text-[var(--diffshub-annotation-fg,var(--color-card-foreground))] shadow-[var(--diffshub-annotation-shadow,0_2px_4px_rgb(0_0_0_/_0.025),0_4px_8px_rgb(0_0_0_/_0.025))]';

// Placeholder reviewer identities for the interim comment layer. The real
// author (GitHub login + avatar URL) replaces this once threads are wired to
// a source; until then an avatar is generated from the name rather than served
// as an image, so no asset is required.
const AVATAR_NAMES = [
  'ada',
  'brook',
  'cyd',
  'dex',
  'edda',
  'faye',
  'gil',
  'hana',
  'ines',
  'jae',
  'kit',
  'lark',
  'mira',
  'noor',
  'oz',
  'pax',
  'quill',
  'rue',
  'sol',
] as const;

export type AvatarName = (typeof AVATAR_NAMES)[number];

export interface Persona {
  name: AvatarName;
  // A `background-color` for the initial-letter chip. Not an image URL: the
  // avatar is drawn, so there is nothing to fetch.
  avatarSrc: string;
}

// Kept as a no-op so callers need not branch. Generated avatars have no
// network cost, so there is nothing to warm.
export function preloadAvatars(): void {}

function hashName(value: string): number {
  let hash = 5381;
  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) + hash + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function buildPersona(name: AvatarName): Persona {
  // Fixed saturation/lightness keeps every chip legible against both themes.
  const hue = hashName(name) % 360;
  return { name, avatarSrc: `hsl(${hue} 52% 45%)` };
}

// Picks a random persona. Intended as a useState lazy initializer so each new
// draft form gets a fresh identity on mount.
export function getRandomPersona(): Persona {
  const name = AVATAR_NAMES[Math.floor(Math.random() * AVATAR_NAMES.length)];
  return buildPersona(name);
}

// Returns a persona for the given name or seed. If the seed is an exact name
// (i.e. it was stored directly from getRandomPersona), returns that persona so
// draft and saved annotations stay in sync. Otherwise hashes the seed to spread
// arbitrary comment keys across the list.
export function getCommentPersona(seed: string): Persona {
  if (AVATAR_NAMES.includes(seed as AvatarName)) {
    return buildPersona(seed as AvatarName);
  }
  return buildPersona(AVATAR_NAMES[hashName(seed) % AVATAR_NAMES.length]);
}
