'use client';

import { DEFAULT_THEMES } from '@pierre/diffs';
import WorkerUrl from '@pierre/diffs/worker/worker.js?worker&url';
import {
  type WorkerInitializationRenderOptions,
  WorkerPoolContextProvider,
  type WorkerPoolOptions,
} from '@pierre/diffs/react';
import type { ReactNode } from 'react';

function isMobileBrowser(): boolean {
  const navigator = global.navigator;
  if (navigator == null) {
    return false;
  }

  return (
    navigator.maxTouchPoints > 0 &&
    global.matchMedia?.('(max-width: 767px), (pointer: coarse)').matches ===
      true
  );
}

function getWorkerResourceLimits(): Pick<
  Required<WorkerPoolOptions>,
  'poolSize' | 'totalASTLRUCacheSize'
> {
  return isMobileBrowser()
    ? { poolSize: 1, totalASTLRUCacheSize: 10 }
    : { poolSize: 3, totalASTLRUCacheSize: 100 };
}

const WorkerResourceLimits = getWorkerResourceLimits();

const PoolOptions: WorkerPoolOptions = {
  // We really shouldn't let the pool get too big...
  poolSize: Math.min(
    Math.max(1, (global.navigator?.hardwareConcurrency ?? 1) - 1),
    WorkerResourceLimits.poolSize
  ),
  totalASTLRUCacheSize: WorkerResourceLimits.totalASTLRUCacheSize,
  workerFactory() {
    // `?worker&url` is Vite's own worker handling, and `type: 'module'` is not
    // optional: the shipped worker is an ES module, and without it Vite serves
    // it as a classic script and every instantiation fails with "Cannot use
    // import statement outside a module". This is the spelling Pierre's own
    // Vite demo uses.
    return new Worker(WorkerUrl, { type: 'module' });
  },
};

// Shiki's own performance guide recommends the JavaScript regex engine for the
// web, and @pierre/diffs defaults to it. We deliberately use the Oniguruma
// WebAssembly engine instead, because the guide's reasoning does not hold for
// this app.
//
// Measured in Chrome, which is where this actually runs, on 5,024 lines of tsx
// tokenised repeatedly:
//
//   oniguruma   create 31ms   first 449ms    steady 204ms   24,620 lines/s
//   javascript  create  1ms   first 1025ms   steady 570ms    8,810 lines/s
//
// The JavaScript engine does create its highlighter faster, which is the
// guide's argument, but 30ms is swamped by compiling grammars on first use, and
// sustained it is a third of the speed. A diff viewer exists to render large
// diffs, so throughput is what matters. The guide's other argument is bundle
// size, and the 608KB engine is served from localhost by the same binary that
// serves the app, so it costs no network.
//
// The same gap appears under Node's V8 (8,670 lines/s) and Bun's
// JavaScriptCore (12,989 lines/s), so it is the engine rather than one runtime.
// Both tokenised twenty languages with no failures, so this is a speed trade
// rather than a coverage one.
const HighlighterOptions: WorkerInitializationRenderOptions = {
  // hunkyard used to override the default pair with the soft pierre themes;
  // now that the canonical default IS the non-soft pair (shared via theming),
  // every site initializes the pool with the same defaults.
  theme: DEFAULT_THEMES,
  langs: [
    'cpp',
    'css',
    'go',
    'python',
    'rust',
    'sh',
    'swift',
    'tsx',
    'typescript',
    'zig',
  ],
  preferredHighlighter: 'shiki-wasm',
};

interface WorkerPoolProps {
  children: ReactNode;
  highlighterOptions?: WorkerInitializationRenderOptions;
  poolOptions?: WorkerPoolOptions;
}

export function WorkerPoolContext({
  children,
  highlighterOptions = HighlighterOptions,
  poolOptions = PoolOptions,
}: WorkerPoolProps) {
  return (
    <WorkerPoolContextProvider
      poolOptions={poolOptions}
      highlighterOptions={highlighterOptions}
    >
      {children}
    </WorkerPoolContextProvider>
  );
}
