'use client';

import { useEffect } from 'react';

import { DiffsHubLogo } from '@/components/DiffsHubLogo';
import { ThemedSurface } from '@/components/ThemedSurface';
import { useServerInfo } from '@/components/useServerInfo';
import { encodeOpenerHref, resolveOpenerRoute } from '@/lib/openerRoute';
import { useRouter } from '@/src/navigation';

import { OpenerBar } from './OpenerBar';
import { OpenGitHubTokenForm } from './OpenGitHubTokenForm';

// Everything you can open, at `/`.
//
// One field rather than three surfaces. The query still carries which
// repository is in scope, so a narrowed opener is a link like any other page --
// but nothing else about where you are lives in the URL, because descending
// through folders happens in the field rather than by navigating.
export function OpenPage({ search }: { search: string }) {
  const router = useRouter();
  const route = resolveOpenerRoute(search);
  const repoId = route.kind === 'targets' ? route.repoId : undefined;
  // The server resolves a token from the environment or from what the CLI wrote
  // down, so on most machines there is nothing to paste.
  const { github: serverHasToken, loading } = useServerInfo();

  // The same shortcut as everywhere else, doing the only thing left to do when
  // the field is already the page: put the cursor in it.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        document.querySelector<HTMLInputElement>('input')?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <ThemedSurface className="flex min-h-[100svh] flex-col items-center bg-[var(--diffshub-sidebar-bg)]">
      <div className="flex w-full max-w-2xl flex-1 flex-col px-5 pt-[14vh] pb-10">
        <div className="mb-7 flex flex-col items-center gap-2.5">
          <DiffsHubLogo className="size-7" />
          <h1 className="text-muted-foreground text-sm">
            Review a pull request, a branch, or what you have not committed
          </h1>
        </div>

        <OpenerBar
          repoId={repoId}
          onScope={(next) =>
            router.replace(
              next == null
                ? '/'
                : encodeOpenerHref({ kind: 'targets', repoId: next })
            )
          }
        />

        {!loading && !serverHasToken && (
          <div className="bg-background/60 mt-8 overflow-hidden rounded-xl border">
            <OpenGitHubTokenForm />
          </div>
        )}
      </div>
    </ThemedSurface>
  );
}
