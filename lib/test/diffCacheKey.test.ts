import { describe, expect, test } from 'bun:test';
import { processFile } from '@pierre/diffs';

import { contentAddressedCacheKey } from '../diffCacheKey';

function keyFor(patch: string, seed = 'seed'): string {
  const fileDiff = processFile(patch, { isGitDiff: true });
  if (fileDiff == null) throw new Error('patch did not parse');
  return contentAddressedCacheKey(fileDiff, seed);
}

const before = `diff --git a/src/a.ts b/src/a.ts
index 1111111..2222222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,1 +1,1 @@
-one
+two
`;

// Same path, same position, different content -- the case a URL-derived key
// cannot distinguish.
const after = `diff --git a/src/a.ts b/src/a.ts
index 1111111..3333333 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,1 +1,1 @@
-one
+three
`;

describe('contentAddressedCacheKey', () => {
  test('changes when content changes under a stable path', () => {
    expect(keyFor(before)).not.toBe(keyFor(after));
  });

  test('is stable for identical content, so the cache still hits', () => {
    expect(keyFor(before)).toBe(keyFor(before));
  });

  test('is independent of the seed once object ids exist', () => {
    // Two loads of the same content must share a highlight entry even if the
    // surrounding request key differs.
    expect(keyFor(before, 'load-1')).toBe(keyFor(before, 'load-2'));
  });

  test('includes the path so language cannot cross-contaminate', () => {
    // Byte-identical content, same blob ids, different extension: these
    // tokenize differently, so they must not share an entry.
    const ts = `diff --git a/x.ts b/x.ts
index 1111111..2222222 100644
--- a/x.ts
+++ b/x.ts
@@ -1,1 +1,1 @@
-a
+b
`;
    const py = ts.replaceAll('x.ts', 'x.py');
    expect(keyFor(ts)).not.toBe(keyFor(py));
  });

  test('falls back to the seed for a pure rename', () => {
    // No index line, because no content changed; nothing to invalidate.
    const rename = `diff --git a/old.ts b/new.ts
similarity index 100%
rename from old.ts
rename to new.ts
`;
    const fileDiff = processFile(rename, { isGitDiff: true });
    expect(fileDiff).not.toBeUndefined();
    const key = contentAddressedCacheKey(fileDiff!, 'seed');
    expect(key).toBe('seed:new.ts');
  });

  test('handles an added file, where there is no previous blob', () => {
    const added = `diff --git a/new.ts b/new.ts
new file mode 100644
index 0000000..4444444
--- /dev/null
+++ b/new.ts
@@ -0,0 +1 @@
+added
`;
    const key = keyFor(added);
    expect(key).toContain('4444444');
    expect(key).toContain('new.ts');
  });
});
