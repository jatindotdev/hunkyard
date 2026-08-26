import { describe, expect, test } from 'bun:test';
import type { CSSProperties } from 'react';

import { buildAnnotationThemeStyle } from '../lib/annotationThemeStyle';

// The byte-for-byte chrome parity for the default Pierre soft themes now lives in
// lib/test/chromeThemeProps.test.ts (same
// golden fixtures, via chromeThemeProps + hunkyardChromeMapping). This file keeps
// the unique coverage for buildAnnotationThemeStyle, the app-local helper that
// scopes the inline comment surface vars without leaking the code-view chrome.
describe('buildAnnotationThemeStyle', () => {
  test('scopes inline comment theming without changing code-view chrome tokens', () => {
    const themeChromeStyle = {
      backgroundColor: '#101010',
      color: '#f8fafc',
      '--background': '#101010',
      '--color-background': '#101010',
      '--color-border': 'color-mix(in srgb, #f8fafc 20%, transparent)',
      '--color-border-opaque': 'color-mix(in srgb, #f8fafc 15%, #101010)',
      '--hunkyard-annotation-bg': 'color-mix(in srgb, #f8fafc 7%, #101010)',
      '--hunkyard-annotation-border':
        'color-mix(in srgb, #f8fafc 18%, #101010)',
      '--hunkyard-annotation-fg': '#f8fafc',
      '--hunkyard-annotation-hover-border':
        'color-mix(in srgb, #f8fafc 28%, #101010)',
      '--hunkyard-annotation-shadow':
        '0 18px 44px color-mix(in srgb, #101010 72%, transparent)',
      '--hunkyard-popover-muted-fg': '#cbd5e1',
    } as CSSProperties & Record<string, string>;
    const annotationStyle = buildAnnotationThemeStyle(themeChromeStyle);

    expect(annotationStyle).toMatchObject({
      '--hunkyard-annotation-bg': 'color-mix(in srgb, #f8fafc 7%, #101010)',
      '--hunkyard-annotation-border':
        'color-mix(in srgb, #f8fafc 18%, #101010)',
      '--hunkyard-annotation-fg': '#f8fafc',
      '--hunkyard-annotation-hover-border':
        'color-mix(in srgb, #f8fafc 28%, #101010)',
      '--hunkyard-annotation-shadow':
        '0 18px 44px color-mix(in srgb, #101010 72%, transparent)',
      '--hunkyard-popover-muted-fg': '#cbd5e1',
    });
    expect(annotationStyle).not.toHaveProperty('backgroundColor');
    expect(annotationStyle).not.toHaveProperty('color');
    expect(annotationStyle).not.toHaveProperty('--background');
    expect(annotationStyle).not.toHaveProperty('--color-background');
    expect(annotationStyle).not.toHaveProperty('--color-border');
    expect(annotationStyle).not.toHaveProperty('--color-border-opaque');
  });
});
