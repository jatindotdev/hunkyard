import { IconBranch } from '@pierre/icons';

import { cn } from '@/lib/cn';

interface LocalTargetLabelProps {
  className?: string;
  // Repository root on disk. Only the final segment is shown; the full path is
  // the title, since a reviewer knows which repo they are in and cares about
  // the target.
  repoRoot?: string;
  target: string;
}

function repoName(repoRoot: string | undefined): string | undefined {
  if (repoRoot == null || repoRoot === '') return undefined;
  const segments = repoRoot.split('/').filter((segment) => segment !== '');
  return segments[segments.length - 1];
}

// Replaces the URL box for a local review. There is no URL to type or open, so
// showing an input primed with a github.com placeholder would be a lie about
// what the page is.
export function LocalTargetLabel({
  className,
  repoRoot,
  target,
}: LocalTargetLabelProps) {
  const name = repoName(repoRoot);
  return (
    <div
      className={cn(
        'flex min-w-0 items-center gap-1.5 font-mono text-xs',
        className
      )}
      title={repoRoot == null ? target : `${repoRoot} · ${target}`}
    >
      <IconBranch className="size-3 shrink-0 opacity-50" />
      {name != null && (
        <>
          <span className="truncate opacity-60">{name}</span>
          <span className="opacity-30">/</span>
        </>
      )}
      <span className="truncate">{target}</span>
    </div>
  );
}
