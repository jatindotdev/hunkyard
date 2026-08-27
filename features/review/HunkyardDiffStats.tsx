'use client';

import { IconSymbolDiffstatFill } from '@pierre/icons';
import { memo, useEffect } from 'react';

import { StatItem } from '@/ui/StatItem';
import { StatusRow } from '@/ui/StatusRow';
import type { HunkyardDiffStats as HunkyardDiffStatsData } from '@/lib/types';

interface HunkyardDiffStatsProps {
  expanded: boolean;
  onToggle(): void;
  stats: HunkyardDiffStatsData | null;
  streaming: boolean;
}

export const HunkyardDiffStats = memo(function HunkyardDiffStats({
  expanded,
  onToggle,
  stats,
  streaming,
}: HunkyardDiffStatsProps) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'F2') {
        event.preventDefault();
        onToggle();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onToggle]);

  if (stats == null) {
    return null;
  }

  return (
    <>
      <StatusRow icon={IconSymbolDiffstatFill}>
        <button
          type="button"
          onClick={onToggle}
          className="text-muted-foreground hover:text-foreground flex w-full cursor-pointer items-center gap-1 text-sm outline-none focus-visible:ring-ring/50 focus-visible:ring-2 focus-visible:rounded-sm"
          aria-expanded={expanded}
        >
          Diff Stats
          <span className="text-muted-foreground/50 hidden md:inline">
            (F2)
          </span>
          {streaming && <StreamingIndicator />}
        </button>
      </StatusRow>
      {expanded && (
        <div className="hunkyard-reveal ml-10 md:mr-3">
          <div>
            <StatItem
              label="Files"
              value={stats.fileCount}
              valueClassName="text-foreground font-semibold"
            />
            <StatItem
              label="Additions"
              value={stats.addedLines}
              valueClassName="text-green-600 dark:text-green-400 font-semibold"
            />
            <StatItem
              label="Deletions"
              value={stats.deletedLines}
              valueClassName="text-red-600 dark:text-red-400 font-semibold"
            />
            <StatItem
              label="Lines"
              value={stats.totalLinesOfCode}
              valueClassName="text-foreground font-semibold"
            />
          </div>
        </div>
      )}
    </>
  );
});

function StreamingIndicator() {
  return (
    <span className="-mr-2 ml-auto rounded-full border border-yellow-500/40 bg-yellow-500/10 px-1.5 py-0.5 text-[10px] leading-none font-medium tracking-wide text-yellow-700 uppercase dark:text-yellow-300">
      streaming
    </span>
  );
}
