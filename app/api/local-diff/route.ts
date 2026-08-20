import { NoRepositoryError, resolveConfiguredRepoRoot } from '@/lib/git/repo';
import {
  EmptyPatchError,
  UnknownRevisionError,
  openNonEmptyPatchStream,
} from '@/lib/git/patchStream';
import { resolveGitTarget } from '@/lib/git/targets';

// The client reads a failing response's body as the user-visible message, so
// errors are plain text rather than JSON.
function textResponse(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      // Working-tree content changes under a stable URL, so it must never be
      // cached anywhere.
      'Cache-Control': 'no-store',
    },
  });
}

export async function GET(request: Request): Promise<Response> {
  const target = new URL(request.url).searchParams.get('target') ?? undefined;

  try {
    const repoRoot = await resolveConfiguredRepoRoot();
    const resolved = resolveGitTarget(target ?? undefined);
    // Revisions are verified, and the first chunk is peeked, before any
    // byte reaches the client -- so both a typo'd branch and an empty diff can
    // still be answered with a status rather than an aborted body.
    const stream = await openNonEmptyPatchStream(resolved, repoRoot);

    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
        // Mirrors X-Patch-Source on the GitHub route: says where this came from.
        'X-Patch-Source': `git:${resolved.kind}:${resolved.title}`,
      },
    });
  } catch (error) {
    if (error instanceof NoRepositoryError) {
      return textResponse(error.message, 503);
    }
    if (error instanceof UnknownRevisionError) {
      return textResponse(error.message, 400);
    }
    if (error instanceof EmptyPatchError) {
      // 422 matches what the GitHub route returns for an empty patch, so the
      // client's existing error surfacing applies unchanged.
      return textResponse(error.message, 422);
    }
    const message =
      error instanceof Error ? error.message : 'Failed to read the local diff.';
    return textResponse(message, 500);
  }
}
