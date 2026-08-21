import { describe, expect, test } from 'bun:test';

import { isTypingTarget } from '@/components/useReviewKeyboard';

// The real events carry a composedPath because the draft editor is slotted into
// the diff's shadow DOM, which is exactly why event.target is not enough.
function eventWithPath(path: readonly unknown[]): KeyboardEvent {
  return { composedPath: () => path } as unknown as KeyboardEvent;
}

function element(tagName: string, isContentEditable = false) {
  return { tagName, isContentEditable };
}

describe('isTypingTarget', () => {
  test('is true for a text field anywhere along the path', () => {
    for (const tag of ['INPUT', 'TEXTAREA', 'SELECT']) {
      expect(isTypingTarget(eventWithPath([element(tag)]))).toBe(true);
    }
  });

  test('is true for a contenteditable host', () => {
    expect(isTypingTarget(eventWithPath([element('DIV', true)]))).toBe(true);
  });

  // The shortcut keys have to keep working when the diff itself has focus.
  test('is false for the diff surface', () => {
    expect(
      isTypingTarget(eventWithPath([element('DIV'), element('DIFFS-CONTAINER')]))
    ).toBe(false);
  });

  test('ignores non-element entries such as document and window', () => {
    expect(isTypingTarget(eventWithPath([{}, null, undefined]))).toBe(false);
  });
});
