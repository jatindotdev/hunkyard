import type { CodeViewDiffItem, CodeViewItem } from '@pierre/diffs';

// Generic over the annotation metadata, so it works for any review model rather
// than being tied to one.
export function isDiffItem<T>(
  item: CodeViewItem<T>
): item is CodeViewDiffItem<T> {
  return item.type === 'diff';
}
