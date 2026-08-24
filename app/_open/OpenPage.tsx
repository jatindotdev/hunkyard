'use client';

import { ThemedSurface } from '@/components/ThemedSurface';
import { DiffsHubLogo } from '@/components/DiffsHubLogo';
import { resolveOpenerRoute } from '@/lib/openerRoute';

import { FolderBrowser } from './FolderBrowser';
import { OpenSourceChooser } from './OpenSourceChooser';
import { TargetPicker } from './TargetPicker';

// Everything you can open, at `/`. The query decides which of the three it is
// showing: `/owner/repo/...` is the viewer's namespace, so a path segment here
// would shadow a real GitHub owner.
export function OpenPage({ search }: { search: string }) {
  const route = resolveOpenerRoute(search);

  return (
    <ThemedSurface className="bg-[var(--diffshub-sidebar-bg)] flex min-h-[100svh] flex-col items-center">
      <div className="flex w-full max-w-3xl flex-1 flex-col px-5 py-8 md:py-12">
        <h1 className="mb-6 flex items-center gap-1.5 text-xl font-semibold tracking-tight">
          <DiffsHubLogo />
          Hunkyard
        </h1>
        {route.kind === 'browse' ? (
          <FolderBrowser path={route.path} />
        ) : route.kind === 'targets' ? (
          <TargetPicker repoId={route.repoId} />
        ) : (
          <OpenSourceChooser />
        )}
      </div>
    </ThemedSurface>
  );
}
