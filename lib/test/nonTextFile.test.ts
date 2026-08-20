import { describe, expect, test } from 'bun:test';
import { processFile } from '@pierre/diffs';

import { classifyNonTextFile, describeNonTextFile } from '../nonTextFile';

function classify(patch: string) {
  const fileDiff = processFile(patch, { isGitDiff: true });
  if (fileDiff == null) throw new Error('patch did not parse');
  return classifyNonTextFile(fileDiff);
}

describe('classifyNonTextFile', () => {
  test('a text change has something to show', () => {
    expect(
      classify(`diff --git a/a.ts b/a.ts
index 1111111..2222222 100644
--- a/a.ts
+++ b/a.ts
@@ -1 +1 @@
-a
+b
`)
    ).toBeNull();
  });

  test('an added binary file is binary', () => {
    expect(
      classify(`diff --git a/logo.png b/logo.png
new file mode 100644
index 0000000..5bda219
Binary files /dev/null and b/logo.png differ
`)
    ).toBe('binary');
  });

  test('a changed binary file is binary', () => {
    expect(
      classify(`diff --git a/logo.png b/logo.png
index 5bda219..8c15b85 100644
Binary files a/logo.png and b/logo.png differ
`)
    ).toBe('binary');
  });

  test('an added zero-byte text file is empty, not binary', () => {
    // Both parse to `new` with no hunks; only the blob id tells them apart, and
    // git's empty blob is a fixed hash.
    expect(
      classify(`diff --git a/empty.txt b/empty.txt
new file mode 100644
index 0000000..e69de29
`)
    ).toBe('empty');
  });

  test('a pure rename is not flagged, since the header explains it', () => {
    expect(
      classify(`diff --git a/a.ts b/b.ts
similarity index 100%
rename from a.ts
rename to b.ts
`)
    ).toBeNull();
  });

  test('an unknown no-hunk shape is called binary rather than empty', () => {
    // Claiming a file is empty when we cannot tell would be a stronger and
    // possibly wrong statement.
    expect(
      classify(`diff --git a/thing b/thing
old mode 100644
new mode 100755
`)
    ).toBe('binary');
  });
});

describe('describeNonTextFile', () => {
  test('reads as a label', () => {
    expect(describeNonTextFile('binary')).toBe('Binary file');
    expect(describeNonTextFile('empty')).toBe('Empty file');
  });
});
