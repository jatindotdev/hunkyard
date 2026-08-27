import { IconCheck, IconCiWarningFill, IconRefresh } from '@pierre/icons';

import { useChromeThemeProps } from './useChromeThemeProps';
import { Button } from '@/components/Button';
import { cn } from '@/lib/cn';
import { hunkyardChromeMapping } from '@/lib/theme/hunkyardChromeMapping';
import type { ViewerLoadState } from '@/lib/types';

interface HunkyardStatusPanelProps {
  errorMessage: string | null;
  // True once the patch is loaded but the highlighter's worker pool has not
  // reported ready. Distinguished because it is the whole wait for a local
  // diff, which arrives in milliseconds -- saying "reading the patch" then
  // would name the one thing that already finished.
  awaitingHighlighter?: boolean;
  // A local review reads from disk, so "fetching from GitHub" is wrong.
  isLocal?: boolean;
  onRetry(): void;
  state: ViewerLoadState;
}

export function HunkyardStatusPanel({
  errorMessage,
  awaitingHighlighter = false,
  isLocal = false,
  onRetry,
  state,
}: HunkyardStatusPanelProps) {
  // Mirror the rest of the hunkyard chrome so the loading screen sits on the
  // active Shiki theme's surface instead of the global light/dark palette.
  // Mounted before the viewer is available, so we lean on the same provider
  // useChromeThemeProps the header/sidebar use — the controller source keeps the
  // last-resolved theme, so this stays on-palette without flashing the default.
  const { style: chromeStyle } = useChromeThemeProps(hunkyardChromeMapping);
  const themeChromeStyle =
    Object.keys(chromeStyle).length > 0 ? chromeStyle : undefined;
  const isError = state === 'error';
  // Reaching this panel having finished means the patch was read and had
  // nothing in it. It had no branch of its own, so it fell through to the
  // streaming one and sat there spinning at a diff that had already arrived.
  const isEmpty = !isError && state === 'ready';

  const title = isError
    ? 'Couldn’t load diff'
    : isEmpty
      ? 'Nothing to review'
      : awaitingHighlighter
        ? 'Starting the highlighter'
        : state === 'parsing'
          ? 'Preparing diff'
          : state === 'fetching'
            ? 'Reading diff'
            : 'Streaming diff';

  const message = isError
    ? (errorMessage ?? 'Failed to fetch the diff, please try again.')
    : isEmpty
      ? isLocal
        ? 'This target has no changes. Pick another from the opener, or ⌘K.'
        : 'This diff has no files in it.'
      : awaitingHighlighter
        ? 'Warming up syntax highlighting…'
        : state === 'parsing'
          ? 'Parsing the patch and building the file tree…'
          : state === 'fetching'
            ? isLocal
              ? 'Reading the diff from your repository…'
              : 'Fetching the patch from GitHub…'
            : 'Reading the patch and showing files as they arrive…';

  return (
    <div
      className={cn(
        'col-span-full flex min-h-0 items-center justify-center p-6',
        themeChromeStyle == null && 'bg-background'
      )}
      style={themeChromeStyle}
    >
      <section
        role={isError ? 'alert' : 'status'}
        aria-live="polite"
        aria-busy={(!isError && !isEmpty) || undefined}
        className="w-full max-w-md p-5 text-center"
      >
        {isEmpty ? (
          <IconCheck
            aria-hidden="true"
            className="text-muted-foreground mx-auto mb-3 size-5"
          />
        ) : !isError ? (
          <IconRefresh
            aria-hidden="true"
            className="text-muted-foreground mx-auto mb-3 size-5 -scale-x-100 animate-spin [animation-direction:reverse] [animation-duration:0.7s] motion-reduce:animate-none"
          />
        ) : (
          <IconCiWarningFill className="text-muted-foreground mx-auto mb-3 size-5" />
        )}
        <h2 className="text-foreground text-sm font-medium">{title}</h2>
        <p className="text-muted-foreground mt-1 text-sm text-pretty">
          {message}
        </p>
        {isError && (
          <Button type="button" className="mt-4" onClick={onRetry}>
            Try again
          </Button>
        )}
      </section>
    </div>
  );
}
