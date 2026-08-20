import { Hono, type Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

import { runGit } from '../../lib/git/exec';
import { resolveConfiguredRepoRoot } from '../../lib/git/repo';
import { parseGitHubDiffSource } from '../../lib/githubDiffSource';
import { getPullHeadSha } from '../../lib/review/github';
import { GitHubThreadStore } from '../../lib/review/GitHubThreadStore';
import { LocalThreadStore } from '../../lib/review/LocalThreadStore';
import type { ThreadStore } from '../../lib/review/ThreadStore';
import type { ThreadAnchor } from '../../lib/review/types';
import { resolveServerGitHubToken } from '../../lib/serverGitHubToken';

// Who a local comment is attributed to. `git config user.name` is the identity
// the repository already knows, and matching it means a review written here
// reads the same as the commits around it.
async function resolveLocalAuthor(repoRoot: string): Promise<string> {
  const result = await runGit(['config', 'user.name'], { cwd: repoRoot });
  const name = result.stdout.toString('utf8').trim();
  return name === '' ? 'you' : name;
}

async function resolveStore(
  params: URLSearchParams
): Promise<{ store: ThreadStore; author?: string; headCommitId?: string }> {
  const path = params.get('path');

  // A GitHub path wins when present: the same page can only be one or the other.
  if (path != null && path !== '') {
    const source = parseGitHubDiffSource(path);
    if (source == null || source.kind !== 'pull') {
      throw Object.assign(
        new Error('Threads are only supported on pull requests.'),
        { status: 400 }
      );
    }
    const token = resolveServerGitHubToken();
    if (token == null) {
      throw Object.assign(
        new Error(
          'Reviewing a pull request needs a GitHub token. Run `gh auth login`, or set GH_TOKEN.'
        ),
        { status: 401 }
      );
    }
    const ref = {
      owner: source.repo.owner,
      repo: source.repo.repo,
      pull: Number(source.number),
    };
    return {
      store: new GitHubThreadStore(ref, token),
      // The commit a comment is written against. Submit re-reads the head at
      // the time it sends, so this is what the anchor records rather than what
      // the review is posted against.
      headCommitId: await getPullHeadSha(ref, token).catch(() => undefined),
    };
  }

  const repoRoot = await resolveConfiguredRepoRoot();
  const target = params.get('target') ?? '';
  const [author, head] = await Promise.all([
    resolveLocalAuthor(repoRoot),
    runGit(['rev-parse', 'HEAD'], { cwd: repoRoot }),
  ]);
  const headCommitId = head.stdout.toString('utf8').trim();
  return {
    store: new LocalThreadStore(repoRoot, target, author),
    author,
    headCommitId: headCommitId === '' ? undefined : headCommitId,
  };
}

// Review state changes constantly and must never be cached anywhere.
const NO_STORE_RECORD = { 'Cache-Control': 'no-store' } as const;
const NO_STORE = new Headers(NO_STORE_RECORD);

// Hono types its status parameter as a narrow union rather than number, so the
// status an error carries is narrowed here once instead of cast at each throw.
function statusOf(error: unknown): ContentfulStatusCode {
  const status = (error as { status?: unknown }).status;
  return (typeof status === 'number' ? status : 500) as ContentfulStatusCode;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'Thread request failed.';
}

function isAnchor(value: unknown): value is ThreadAnchor {
  if (typeof value !== 'object' || value == null) return false;
  const anchor = value as Record<string, unknown>;
  return (
    typeof anchor.path === 'string' &&
    typeof anchor.line === 'number' &&
    (anchor.side === 'LEFT' || anchor.side === 'RIGHT') &&
    typeof anchor.commitId === 'string'
  );
}

export function createThreadsApp(): Hono {
  const app = new Hono();

  // Every handler resolves the store the same way and reports failures the
  // same way, so that lives here rather than in each route.
  const withStore = async (
    c: Context,
    run: (store: ThreadStore) => Promise<unknown>
  ): Promise<Response> => {
    try {
      const { store } = await resolveStore(new URL(c.req.url).searchParams);
      const result = (await run(store)) ?? {};
      return c.json(result, 200, NO_STORE_RECORD);
    } catch (error) {
      return c.json(
        { error: messageOf(error) },
        { status: statusOf(error), headers: NO_STORE }
      );
    }
  };

  // What the UI can offer for this source: whether submitting means anything,
  // and whether resolving is available.
  app.get('/api/review/capabilities', async (c) => {
    try {
      const params = new URL(c.req.url).searchParams;
      const { store, author, headCommitId } = await resolveStore(params);
      return c.json(
        {
          batches: store.batches,
          supportsResolve: store.supportsResolve,
          author: author ?? null,
          headCommitId: headCommitId ?? null,
        },
        200,
        NO_STORE_RECORD
      );
    } catch (error) {
      return c.json(
        { error: messageOf(error) },
        { status: statusOf(error) }
      );
    }
  });

  app.get('/api/threads', (c) => withStore(c, (store) => store.list()));

  app.post('/api/threads', async (c) => {
    const body = (await c.req.json().catch(() => null)) as {
      anchor?: unknown;
      body?: unknown;
      replyToThreadId?: unknown;
    } | null;

    if (body == null || typeof body.body !== 'string' || body.body.trim() === '') {
      return c.json({ error: 'A comment needs a body.' }, 400);
    }
    if (!isAnchor(body.anchor)) {
      return c.json({ error: 'A comment needs a valid anchor.' }, 400);
    }
    const replyToThreadId =
      typeof body.replyToThreadId === 'string' ? body.replyToThreadId : undefined;

    return withStore(c, (store) =>
      store.add({
        anchor: body.anchor as ThreadAnchor,
        body: (body.body as string).trim(),
        replyToThreadId,
      })
    );
  });

  app.delete('/api/threads/:threadId/comments/:commentId', (c) =>
    withStore(c, async (store) => {
      await store.remove(c.req.param('threadId'), c.req.param('commentId'));
      return { ok: true };
    })
  );

  app.patch('/api/threads/:threadId', async (c) => {
    const body = (await c.req.json().catch(() => null)) as {
      resolved?: unknown;
    } | null;
    if (typeof body?.resolved !== 'boolean') {
      return c.json({ error: 'resolved must be true or false.' }, 400);
    }
    return withStore(c, async (store) => {
      await store.setResolved(c.req.param('threadId'), body.resolved as boolean);
      return { ok: true };
    });
  });

  app.post('/api/review/submit', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      event?: unknown;
      body?: unknown;
    };
    const event =
      body.event === 'APPROVE' || body.event === 'REQUEST_CHANGES'
        ? body.event
        : 'COMMENT';
    return withStore(c, async (store) => {
      await store.submit({
        event,
        body: typeof body.body === 'string' ? body.body : undefined,
      });
      return { ok: true };
    });
  });

  return app;
}
