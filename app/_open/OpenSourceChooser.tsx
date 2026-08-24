'use client';

import { IconFolderOpen } from '@pierre/icons';

import { Button } from '@/components/Button';
import { useRepos } from '@/components/useRepos';
import { useServerInfo } from '@/components/useServerInfo';
import { encodeOpenerHref } from '@/lib/openerRoute';
import { useRouter } from '@/src/navigation';

import { OpenFetchForm } from './OpenFetchForm';
import { OpenGitHubTokenForm } from './OpenGitHubTokenForm';
import { RecentReposList } from './RecentReposList';

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-muted-foreground text-sm font-normal">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

// The two things you can review: a pull request somewhere, or a repository on
// this machine. GitHub stays paste-a-URL rather than an inbox -- there is no
// list of your pull requests here and none is fetched.
export function OpenSourceChooser() {
  const router = useRouter();
  const { home } = useRepos();
  // The server resolves a token from the environment or from `gh auth token`,
  // so on most machines there is nothing to paste and asking for one is a form
  // that will never be filled in. It stays in the header's settings menu, where
  // it is also the way to override the server's token with another account's.
  const { github: serverHasToken, loading } = useServerInfo();

  return (
    <div className="flex flex-col gap-8">
      <Section title="A pull request, comparison, commit or patch">
        <div className="bg-background overflow-hidden rounded-lg border">
          <OpenFetchForm />
          {!loading && !serverHasToken && <OpenGitHubTokenForm />}
        </div>
      </Section>

      <Section
        title="A repository on this machine"
        action={
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={home == null}
            onClick={() =>
              // Home, because that is where a checkout is most likely to be.
              router.push(encodeOpenerHref({ kind: 'browse', path: home ?? '/' }))
            }
          >
            <IconFolderOpen className="size-4 opacity-70" />
            Browse…
          </Button>
        }
      >
        <RecentReposList home={home} />
      </Section>
    </div>
  );
}
