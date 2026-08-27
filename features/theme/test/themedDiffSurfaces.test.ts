import { describe, expect, test } from 'bun:test';

import { ThemedCodeView as ReactThemedCodeView } from '@/features/theme/ThemedCodeView';
import { ThemedFile as ReactThemedFile } from '@/features/theme/ThemedFile';
import { ThemedFileDiff as ReactThemedFileDiff } from '@/features/theme/ThemedFileDiff';

describe('themed diffs surfaces', () => {
  test('exports React diff surface components', () => {
    expect(ReactThemedCodeView).toBeDefined();
    expect(typeof ReactThemedFile).toBe('function');
    expect(typeof ReactThemedFileDiff).toBe('function');
  });
});
