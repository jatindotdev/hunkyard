'use client';

import { useCallback, useEffect, useState } from 'react';

import type { RepositorySurvey, SurveyPart } from '@/lib/git/survey';

export interface SurveyState {
  survey: (RepositorySurvey & { root: string }) | null;
  loading: boolean;
  error: string | null;
  // A repository id that no longer resolves, which is what a bookmark to a
  // forgotten repository becomes. repoIdFor is one way, so there is nothing to
  // fall back to but the picker.
  unknownRepo: boolean;
}

function surveyUrl(repoId: string | undefined, parts: readonly SurveyPart[]) {
  const params = new URLSearchParams();
  if (repoId != null && repoId !== '') params.set('repo', repoId);
  params.set('parts', parts.join(','));
  return `/api/repo-survey?${params.toString()}`;
}

export function useRepoSurvey(
  repoId: string | undefined,
  parts: readonly SurveyPart[] = ['refs', 'status', 'commits']
): SurveyState & { reload(): void } {
  const [state, setState] = useState<SurveyState>({
    survey: null,
    loading: true,
    error: null,
    unknownRepo: false,
  });
  // A retry has to be state rather than a navigation: useLocation.navigate
  // no-ops on an identical href, so a retry spelled as one would do nothing.
  const [attempt, setAttempt] = useState(0);
  const reload = useCallback(() => setAttempt((value) => value + 1), []);

  const key = parts.join(',');
  useEffect(() => {
    const controller = new AbortController();
    setState((previous) => ({ ...previous, loading: true }));

    void (async () => {
      try {
        const response = await fetch(surveyUrl(repoId, key.split(',') as SurveyPart[]), {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!response.ok) {
          const message = (await response.text()).trim();
          setState({
            survey: null,
            loading: false,
            error: message,
            unknownRepo: response.status === 404,
          });
          return;
        }
        setState({
          survey: (await response.json()) as RepositorySurvey & { root: string },
          loading: false,
          error: null,
          unknownRepo: false,
        });
      } catch (error) {
        if (controller.signal.aborted) return;
        setState({
          survey: null,
          loading: false,
          error:
            error instanceof Error ? error.message : 'Failed to read the repository.',
          unknownRepo: false,
        });
      }
    })();

    return () => controller.abort();
  }, [repoId, key, attempt]);

  return { ...state, reload };
}
