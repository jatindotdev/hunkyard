// Stays app-local. The hunkyard-specific mapping from neutral ChromeTokens to
// the app's CSS variables — preserved byte-for-byte from the previous
// buildThemeChromeStyle (the --hunkyard-*/--color-*/--foreground vocabulary plus
// the app-only --hunkyard-card-* (6/12/12) and annotation-hover-border (28%)
// mixes). Only the handful of hunkyard-specific surfaces the neutral set does
// not carry are derived locally from the same foreground/surface pair.
import type { ThemeLike } from '@pierre/theming';
import { normalizeThemeColors } from '@pierre/theming/color';
import type { CSSProperties } from 'react';

import type { ChromeTokens } from './deriveChromeTokens';

// A ChromeMapping turns the neutral chrome tokens (or undefined when the theme
// has no legible foreground) plus the source theme into a host CSS style. The
// theme is passed so a mapping can read the sidebar background for the surface
// the mixes blend into.
export type ChromeMapping = (
  chrome: ChromeTokens | undefined,
  theme: ThemeLike
) => CSSProperties | undefined;

export const hunkyardChromeMapping: ChromeMapping = (chrome, theme) => {
  // Mirror the previous behavior: the chrome background is the resolved theme's
  // sidebar background, read straight from the shared normalizeThemeColors
  // surface derivation (the same key trees and deriveChromeTokens read).
  const sidebarBg = normalizeThemeColors(theme).colors?.['sideBar.background'];
  const bg =
    typeof sidebarBg === 'string' && sidebarBg !== '' ? sidebarBg : undefined;

  // No chrome means deriveChromeTokens found no legible foreground (degenerate
  // bg-only theme). Mirror the previous behavior: paint just the background when
  // we have one, otherwise contribute nothing.
  if (chrome == null) {
    return bg != null ? ({ backgroundColor: bg } as CSSProperties) : undefined;
  }

  const fg = chrome.fg;
  // The base the hunkyard-specific card mixes blend the foreground into. Mirror
  // the previous `bg ?? 'transparent'` fallback exactly.
  const base = bg ?? 'transparent';
  const style: CSSProperties & Record<string, string> = {};
  if (bg != null) style.backgroundColor = bg;
  style.color = fg;
  style['--color-foreground'] = fg;
  style['--foreground'] = fg;
  style['--color-muted-foreground'] = chrome.mutedFg;
  style['--muted-foreground'] = chrome.mutedFg;
  style['--color-border'] = chrome.border;
  style['--border'] = chrome.border;
  style['--color-border-opaque'] = chrome.borderOpaque;
  style['--border-opaque'] = chrome.borderOpaque;
  // hunkyard-specific card surfaces: a touch softer than the popover (6/12/12
  // vs the neutral 7/14/20 set), so they read as quiet inline rows rather than
  // floating menus. Not part of the shared ChromeTokens.
  style['--hunkyard-card-bg'] = `color-mix(in srgb, ${fg} 6%, ${base})`;
  style['--hunkyard-card-hover-bg'] = `color-mix(in srgb, ${fg} 12%, ${base})`;
  style['--hunkyard-card-border'] = `color-mix(in srgb, ${fg} 12%, ${base})`;
  style['--hunkyard-popover-bg'] = chrome.surface;
  style['--hunkyard-popover-fg'] = fg;
  style['--hunkyard-popover-muted-fg'] = chrome.mutedFg;
  style['--hunkyard-popover-hover-bg'] = chrome.surfaceHover;
  style['--hunkyard-popover-selected-bg'] = chrome.surfaceSelected;
  style['--hunkyard-popover-border'] = chrome.surfaceBorder;
  style['--hunkyard-popover-shadow'] = chrome.surfaceShadow;
  style['--hunkyard-annotation-bg'] = chrome.surface;
  style['--hunkyard-annotation-fg'] = fg;
  style['--hunkyard-annotation-border'] = chrome.surfaceBorder;
  style['--hunkyard-annotation-hover-border'] =
    `color-mix(in srgb, ${fg} 28%, ${base})`;
  style['--hunkyard-annotation-shadow'] = chrome.surfaceShadow;
  style['--color-popover'] = chrome.surface;
  style['--popover'] = chrome.surface;
  style['--color-popover-foreground'] = fg;
  style['--popover-foreground'] = fg;
  style['--color-card'] = chrome.surface;
  style['--card'] = chrome.surface;
  style['--color-card-foreground'] = fg;
  style['--card-foreground'] = fg;
  style['--color-background'] = chrome.background;
  style['--background'] = chrome.background;
  style['--color-accent'] = chrome.surfaceHover;
  style['--accent'] = chrome.surfaceHover;
  style['--color-accent-foreground'] = fg;
  style['--accent-foreground'] = fg;
  // `secondary` is the segmented-control (ButtonGroup) track. It must sit
  // visibly behind the buttons so the Auto/Light/Dark options read as one
  // connected control, so it reuses the slightly stronger hover mix.
  style['--color-secondary'] = chrome.surfaceHover;
  style['--secondary'] = chrome.surfaceHover;
  style['--color-secondary-foreground'] = fg;
  style['--secondary-foreground'] = fg;
  style['--color-input'] = chrome.surfaceHover;
  style['--input'] = chrome.surfaceHover;
  style['--color-muted'] = chrome.surfaceHover;
  style['--muted'] = chrome.surfaceHover;
  style['--color-primary'] = fg;
  style['--primary'] = fg;
  style['--color-primary-foreground'] = chrome.background;
  style['--primary-foreground'] = chrome.background;
  style['--color-ring'] = chrome.ring;
  style['--ring'] = chrome.ring;
  style['--hunkyard-comment-add-fg'] = chrome.additionFg;
  style['--hunkyard-comment-del-fg'] = chrome.deletionFg;
  style['--hunkyard-diff-separator'] = chrome.separator;
  if (chrome.scrollbarThumb != null) {
    style['--hunkyard-scrollbar-thumb-bg'] = chrome.scrollbarThumb;
  }
  if (chrome.scrollbarTrack != null) {
    style['--hunkyard-scrollbar-track-bg'] = chrome.scrollbarTrack;
  }
  return style as CSSProperties;
};
