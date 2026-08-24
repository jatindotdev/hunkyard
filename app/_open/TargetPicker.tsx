'use client';

import { IconBranch, IconCommit, IconFolderOpen } from '@pierre/icons';
import { useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/Button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/DropdownMenu';
import { Input } from '@/components/Input';
import { useRepoSurvey } from '@/components/useRepoSurvey';
import { useRepos } from '@/components/useRepos';
import { cn } from '@/lib/cn';
import { encodeLocalDiffPath } from '@/lib/localDiffSource';
import {
  buildCompareSpec,
  groupRefsForPicker,
  likelyBaseRef,
  suggestReviewTargets,
  validateRevspecInput,
} from '@/lib/local/repoSurvey';
import type { RepositorySurvey } from '@/lib/git/survey';
import { useRouter } from '@/src/navigation';

import { OpenSourceChooser } from './OpenSourceChooser';

function Row({
  title,
  detail,
  trailing,
  onClick,
}: {
  title: string;
  detail: string;
  trailing?: React.ReactNode;
  onClick(): void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="hover:bg-accent/50 flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors"
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{title}</span>
        <span className="text-muted-foreground block truncate text-xs">
          {detail}
        </span>
      </span>
      {trailing}
    </button>
  );
}

function RefMenu({
  label,
  value,
  survey,
  onSelect,
}: {
  label: string;
  value: string;
  survey: RepositorySurvey;
  onSelect(name: string): void;
}) {
  const groups = groupRefsForPicker(survey);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="sm" aria-label={label}>
          <IconBranch className="size-3.5 opacity-60" />
          <span className="max-w-[22ch] truncate font-mono text-xs">{value}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-80 overflow-y-auto">
        {groups.map((group, index) => (
          <div key={group.label}>
            {index > 0 && <DropdownMenuSeparator />}
            <DropdownMenuLabel>{group.label}</DropdownMenuLabel>
            {group.refs.map((ref) => (
              <DropdownMenuItem
                key={`${group.label}:${ref.name}`}
                onSelect={() => onSelect(ref.name)}
              >
                <span className="truncate font-mono text-xs">{ref.name}</span>
              </DropdownMenuItem>
            ))}
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function TargetPicker({ repoId }: { repoId: string }) {
  const router = useRouter();
  const { repos } = useRepos();
  const { survey, loading, error, unknownRepo, reload } = useRepoSurvey(repoId);
  const [spec, setSpec] = useState('');
  const [specError, setSpecError] = useState<string | null>(null);
  const [base, setBase] = useState<string | null>(null);
  const [head, setHead] = useState<string | null>(null);

  const root = survey?.root ?? repos.find((repo) => repo.id === repoId)?.root;

  useEffect(() => {
    if (survey == null) return;
    setBase((current) => current ?? likelyBaseRef(survey));
    setHead(
      (current) => current ?? survey.status?.branch ?? survey.branches[0]?.name ?? null
    );
  }, [survey]);

  const targets = useMemo(
    () => (survey == null ? [] : suggestReviewTargets(survey)),
    [survey]
  );

  const review = (target: string | undefined) => {
    router.push(encodeLocalDiffPath(target, repoId));
  };

  // repoIdFor is one way, so a bookmark to a repository that has since been
  // forgotten cannot be resolved back to a path. The picker is the only thing
  // left to offer.
  if (unknownRepo) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-muted-foreground text-sm">
          That repository is not on your list any more. Open one below.
        </p>
        <OpenSourceChooser />
      </div>
    );
  }

  if (error != null) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-muted-foreground text-sm">{error}</p>
        {/* A retry has to be state: navigating to the href we are already on
            would no-op. */}
        <Button type="button" variant="outline" size="sm" onClick={reload}>
          Try again
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-medium">
            {root == null ? 'This repository' : root.split('/').at(-1)}
          </h2>
          <p className="text-muted-foreground truncate font-mono text-xs">
            {root ?? repoId}
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => router.push('/')}
        >
          <IconFolderOpen className="size-4 opacity-70" />
          Open something else
        </Button>
      </header>

      <section className="space-y-2">
        <h3 className="text-muted-foreground text-sm font-normal">
          Uncommitted
        </h3>
        <div className="border-border divide-border divide-y overflow-hidden rounded-lg border">
          {(targets.length === 0
            ? // Painted before the survey lands, so the three rows never pop in.
              [
                { spec: undefined, title: 'Working tree', detail: '', count: null },
                { spec: '--staged', title: 'Staged changes', detail: '', count: null },
                {
                  spec: '--all',
                  title: 'All uncommitted changes',
                  detail: '',
                  count: null,
                },
              ]
            : targets.filter((target) => target.kind !== 'range')
          ).map((target) => (
            <Row
              key={target.title}
              title={target.title}
              detail={target.detail}
              onClick={() => review(target.spec)}
              trailing={
                <span
                  className={cn(
                    'text-muted-foreground text-xs tabular-nums',
                    target.count === 0 && 'opacity-40'
                  )}
                >
                  {target.count == null
                    ? ''
                    : `${target.count} ${target.count === 1 ? 'file' : 'files'}`}
                </span>
              }
            />
          ))}
        </div>
      </section>

      {targets.some((target) => target.kind === 'range') && (
        <section className="space-y-2">
          <h3 className="text-muted-foreground text-sm font-normal">
            This branch
          </h3>
          <div className="border-border overflow-hidden rounded-lg border">
            {targets
              .filter((target) => target.kind === 'range')
              .map((target) => (
                <Row
                  key={target.spec}
                  title={target.title}
                  detail={target.detail}
                  onClick={() => review(target.spec)}
                />
              ))}
          </div>
        </section>
      )}

      {survey != null && (
        <section className="space-y-2">
          <h3 className="text-muted-foreground text-sm font-normal">Compare</h3>
          <div className="border-border flex flex-wrap items-center gap-2 rounded-lg border p-3">
            <RefMenu
              label="Base"
              value={base ?? 'base'}
              survey={survey}
              onSelect={setBase}
            />
            <span className="text-muted-foreground font-mono text-xs">...</span>
            <RefMenu
              label="Head"
              value={head ?? 'head'}
              survey={survey}
              onSelect={setHead}
            />
            <Button
              type="button"
              size="sm"
              className="ml-auto"
              disabled={base == null || head == null || base === head}
              onClick={() =>
                base != null && head != null && review(buildCompareSpec(base, head))
              }
            >
              Review
            </Button>
          </div>
        </section>
      )}

      {survey != null && survey.commits.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-muted-foreground text-sm font-normal">
            Recent commits
          </h3>
          <div className="border-border divide-border max-h-72 divide-y overflow-y-auto rounded-lg border">
            {survey.commits.map((entry) => (
              <Row
                key={entry.oid}
                title={entry.subject === '' ? entry.shortOid : entry.subject}
                detail={`${entry.shortOid} · ${entry.author}`}
                onClick={() => review(entry.oid)}
                trailing={<IconCommit className="size-4 opacity-40" />}
              />
            ))}
          </div>
        </section>
      )}

      <section className="space-y-2">
        <h3 className="text-muted-foreground text-sm font-normal">
          Anything git understands
        </h3>
        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const result = validateRevspecInput(spec);
            if (!result.valid) {
              setSpecError(result.message);
              return;
            }
            setSpecError(null);
            review(result.spec);
          }}
        >
          <Input
            inputSize="sm"
            className="font-mono"
            placeholder="v1.0.0...HEAD, a commit, --staged"
            value={spec}
            onChange={(event) => {
              setSpec(event.currentTarget.value);
              if (specError != null) setSpecError(null);
            }}
          />
          <Button type="submit" variant="outline" size="sm">
            Review
          </Button>
        </form>
        {specError != null && (
          <p className="text-destructive text-xs">{specError}</p>
        )}
      </section>

      {loading && survey == null && (
        <p className="text-muted-foreground text-xs">Reading the repository…</p>
      )}
    </div>
  );
}
