import { Hono } from 'hono';

import { handleBrowse } from './routes/browse';
import { handleGitHubDiff } from './routes/githubDiff';
import { handleGitHubFile } from './routes/githubFile';
import { handleHealth } from './routes/health';
import { handleLocalDiff } from './routes/localDiff';
import { handleLocalEvents } from './routes/localEvents';
import { handleLocalFile } from './routes/localFile';
import { createReposApp } from './routes/repos';
import { handleRepoSurvey } from './routes/repoSurvey';
import { createThreadsApp } from './routes/threads';

// Every handler already takes a Web Request and returns a Web Response, so
// Hono is only doing routing here -- `c.req.raw` is the standard Request.
export function createApiApp(options: { port?: () => number } = {}): Hono {
  const app = new Hono();

  app.get('/api/health', () => handleHealth({ port: options.port?.() }));
  app.get('/api/diff', (c) => handleGitHubDiff(c.req.raw));
  app.get('/api/github-diff-file', (c) => handleGitHubFile(c.req.raw));
  app.get('/api/local-diff', (c) => handleLocalDiff(c.req.raw));
  app.get('/api/local-file', (c) => handleLocalFile(c.req.raw));
  app.get('/api/local-events', (c) => handleLocalEvents(c.req.raw));
  app.get('/api/browse', (c) => handleBrowse(c.req.raw));
  app.get('/api/repo-survey', (c) => handleRepoSurvey(c.req.raw));

  app.route('/', createReposApp());
  app.route('/', createThreadsApp());

  return app;
}
