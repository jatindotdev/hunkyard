import type { ThemeLike } from '@pierre/theming';
import { describe, expect, test } from 'bun:test';

import { gitStatusTokenOverrides } from '@/lib/theme/gitStatusTokens';
import { treeThemeProps } from '@/lib/theme/treeThemeProps';

// A theme that names its Git decoration colours, which is what makes the tree's
// row glyphs diverge from the stylesheet palette.
const GIT_DECORATION_THEME: ThemeLike = {
  name: 'git-decoration',
  type: 'dark',
  colors: {
    'editor.background': '#101010',
    'sideBar.background': '#101010',
    'sideBar.foreground': '#cccccc',
    'gitDecoration.addedResourceForeground': '#2ecc71',
    'gitDecoration.modifiedResourceForeground': '#3498db',
    'gitDecoration.deletedResourceForeground': '#e74c3c',
  },
};

describe('gitStatusTokenOverrides', () => {
  test("maps a theme's decoration colours onto the status tokens", () => {
    const { style } = treeThemeProps({
      theme: GIT_DECORATION_THEME,
      colorScheme: 'dark',
    } as Parameters<typeof treeThemeProps>[0]);

    expect(gitStatusTokenOverrides(style as Record<string, unknown>)).toEqual({
      '--hunkyard-status-added': '#2ecc71',
      '--hunkyard-status-modified': '#3498db',
      '--hunkyard-status-deleted': '#e74c3c',
    });
  });

  test('leaves a status the theme is silent about to the stylesheet', () => {
    expect(
      gitStatusTokenOverrides({
        '--trees-theme-git-added-fg': '#2ecc71',
        '--trees-theme-git-modified-fg': '',
        '--trees-theme-sidebar-bg': '#101010',
        color: '#cccccc',
      })
    ).toEqual({ '--hunkyard-status-added': '#2ecc71' });
  });

  test('an unresolved theme overrides nothing', () => {
    expect(gitStatusTokenOverrides(undefined)).toEqual({});
  });
});
