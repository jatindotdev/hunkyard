'use client';
import { preloadHighlighter } from '@pierre/diffs';
import { useEffect } from 'react';

export function PreloadHighlighter() {
  useEffect(() => {
    void preloadHighlighter({
      themes: [
        'pierre-dark',
        'pierre-dark-soft',
        'pierre-light',
        'pierre-light-soft',
      ],
      langs: ['zig', 'rust', 'typescript', 'tsx', 'bash'],
      // Must match WorkerPoolContext, which explains the choice: the
      // highlighter is a singleton, so the first caller's engine is the one
      // every later call gets.
      preferredHighlighter: 'shiki-wasm',
    });
  }, []);
  return null;
}
