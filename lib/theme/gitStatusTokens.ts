// A theme that names its own Git decoration colours: the file tree renders its
// row glyphs in them, so any surface drawing a status swatch has to draw it in
// the same colour or it labels the rows with a colour they are not using.
//
// The mapping is resolved here rather than as a `var()` fallback chain in the
// stylesheet because a custom property is substituted where it is *declared*,
// not where it is used: a `--hunkyard-status-*` declared on `:root` in terms of
// a variable the theme sets further down the tree resolves to its fallback at
// `:root` and inherits that dead value everywhere.
const THEME_TOKEN_BY_STATUS_TOKEN = {
  '--hunkyard-status-added': '--trees-theme-git-added-fg',
  '--hunkyard-status-modified': '--trees-theme-git-modified-fg',
  '--hunkyard-status-deleted': '--trees-theme-git-deleted-fg',
} as const;

// The status tokens the active theme has an opinion about, ready to apply to a
// surface. A status the theme leaves unset is absent, which leaves the stylesheet
// palette in `app/globals.css` -- the same one the tree itself falls back to --
// standing. 'renamed' is never here: no theme has a decoration colour for it.
export function gitStatusTokenOverrides(
  treeThemeStyle: Record<string, unknown> | undefined
): Record<string, string> {
  const overrides: Record<string, string> = {};
  if (treeThemeStyle == null) return overrides;
  for (const [statusToken, themeToken] of Object.entries(
    THEME_TOKEN_BY_STATUS_TOKEN
  )) {
    const value = treeThemeStyle[themeToken];
    if (typeof value === 'string' && value !== '') {
      overrides[statusToken] = value;
    }
  }
  return overrides;
}
