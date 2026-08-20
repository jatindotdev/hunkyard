import { describe, expect, test } from 'bun:test';

import {
  anchorFromSelection,
  annotationForAnchor,
  toAnnotationSide,
  toThreadSide,
} from '../types';

describe('side translation', () => {
  test('maps the library vocabulary to GitHub and back', () => {
    expect(toThreadSide('deletions')).toBe('LEFT');
    expect(toThreadSide('additions')).toBe('RIGHT');
    expect(toAnnotationSide('LEFT')).toBe('deletions');
    expect(toAnnotationSide('RIGHT')).toBe('additions');
  });

  test('defaults to the added side when unspecified', () => {
    // A single-file view has no sides, and a comment there belongs on the
    // content that exists rather than on nothing.
    expect(toThreadSide(undefined)).toBe('RIGHT');
  });

  test('round-trips', () => {
    for (const side of ['LEFT', 'RIGHT'] as const) {
      expect(toThreadSide(toAnnotationSide(side))).toBe(side);
    }
  });
});

describe('anchorFromSelection', () => {
  test('a single line carries no range', () => {
    const anchor = anchorFromSelection(
      { start: 12, end: 12, side: 'additions' },
      'src/a.ts',
      'abc123'
    );
    expect(anchor).toEqual({
      path: 'src/a.ts',
      line: 12,
      side: 'RIGHT',
      commitId: 'abc123',
    });
    expect(anchor.startLine).toBeUndefined();
  });

  test('a multi-line selection records both ends', () => {
    const anchor = anchorFromSelection(
      { start: 8, end: 14, side: 'additions', endSide: 'additions' },
      'src/a.ts',
      'abc123'
    );
    expect(anchor.startLine).toBe(8);
    expect(anchor.line).toBe(14);
    expect(anchor.startSide).toBe('RIGHT');
    expect(anchor.side).toBe('RIGHT');
  });

  test('the anchor line is the end of the drag, not the start', () => {
    // The viewer puts the comment box at the end of the selection, and GitHub
    // treats `line` as the comment's position, so they have to agree.
    const anchor = anchorFromSelection(
      { start: 3, end: 9, side: 'additions' },
      'src/a.ts',
      'sha'
    );
    expect(anchor.line).toBe(9);
  });

  test('a deletion-side selection anchors LEFT', () => {
    const anchor = anchorFromSelection(
      { start: 5, end: 5, side: 'deletions' },
      'src/a.ts',
      'sha'
    );
    expect(anchor.side).toBe('LEFT');
  });

  test('a range spanning sides is preserved rather than normalised', () => {
    // GitHub accepts these (verified against the real API), so the model
    // records what the user actually selected instead of quietly rewriting it.
    const anchor = anchorFromSelection(
      { start: 5, end: 12, side: 'deletions', endSide: 'additions' },
      'src/a.ts',
      'sha'
    );
    expect(anchor.startSide).toBe('LEFT');
    expect(anchor.side).toBe('RIGHT');
  });
});

describe('annotationForAnchor', () => {
  test('renders one annotation at the end of the range', () => {
    expect(
      annotationForAnchor({
        path: 'src/a.ts',
        line: 14,
        startLine: 8,
        side: 'RIGHT',
        startSide: 'RIGHT',
        commitId: 'sha',
      })
    ).toEqual({ side: 'additions', lineNumber: 14 });
  });

  test('a LEFT anchor renders on the deletions side', () => {
    expect(
      annotationForAnchor({
        path: 'src/a.ts',
        line: 4,
        side: 'LEFT',
        commitId: 'sha',
      })
    ).toEqual({ side: 'deletions', lineNumber: 4 });
  });
});
