import { NoRepositoryError, resolveConfiguredRepoRoot } from '@/lib/git/repo';
import { resolveGitTarget } from '@/lib/git/targets';
import { isWatchableTarget, watchTarget } from '@/lib/git/watch';

// Server-sent events telling the viewer when the diff it is showing has
// changed. Only mutable targets are watched; a commit cannot change.
export async function GET(request: Request): Promise<Response> {
  const target = new URL(request.url).searchParams.get('target') ?? undefined;

  let repoRoot: string;
  try {
    repoRoot = await resolveConfiguredRepoRoot();
  } catch (error) {
    const status = error instanceof NoRepositoryError ? 503 : 500;
    return new Response(
      error instanceof Error ? error.message : 'Failed to watch the repository.',
      { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }
    );
  }

  const resolved = resolveGitTarget(target);
  if (!isWatchableTarget(resolved)) {
    // Nothing will ever change, so say so rather than holding a connection
    // open for the life of the page. A 204 must carry no body at all -- passing
    // even an empty string throws.
    return new Response(null, { status: 204 });
  }

  const encoder = new TextEncoder();
  let handle: { close(): void } | undefined;
  let heartbeat: NodeJS.Timeout | undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: string, data: string) => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${data}\n\n`));
        } catch {
          // The client went away between the watcher firing and this write.
          handle?.close();
          clearInterval(heartbeat);
        }
      };

      send('ready', JSON.stringify({ target: resolved.title }));

      handle = watchTarget(resolved, repoRoot, () => {
        send('changed', JSON.stringify({ at: Date.now() }));
      });

      // A comment line keeps intermediaries from closing an idle connection.
      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': keepalive\n\n'));
        } catch {
          clearInterval(heartbeat);
        }
      }, 30_000);
    },
    cancel() {
      handle?.close();
      clearInterval(heartbeat);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      Connection: 'keep-alive',
    },
  });
}
