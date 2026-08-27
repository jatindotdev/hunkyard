'use client';

import { memo } from 'react';

import { GitHubTokenControl } from '@/features/github/GitHubTokenControl';
import { useGitHubToken } from '@/features/github/useGitHubToken';

export const OpenGitHubTokenForm = memo(function OpenGitHubTokenForm() {
  const { clearToken, hasToken, setToken } = useGitHubToken();
  return (
    <GitHubTokenControl
      active={hasToken}
      className="border-border/70 border-t px-4 py-3"
      onClear={clearToken}
      onSave={setToken}
      title="Private GitHub access"
    />
  );
});
