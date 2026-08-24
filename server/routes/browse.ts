import { browseDirectory } from '../../lib/fs/browse';
import {
  BrowseNotFoundError,
  BrowsePermissionError,
  InvalidBrowsePathError,
} from '../../lib/fs/browsePath';

// The client reads a failing response's body as the user-visible message, so
// errors are plain text, as they are on the local diff route.
function textResponse(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

export async function handleBrowse(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;

  try {
    const listing = await browseDirectory({
      path: params.get('path') ?? undefined,
      filter: params.get('filter') ?? undefined,
      hidden: params.get('hidden') === '1',
    });
    return Response.json(listing, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    if (error instanceof InvalidBrowsePathError) {
      return textResponse(error.message, 400);
    }
    if (error instanceof BrowsePermissionError) {
      return textResponse(error.message, 403);
    }
    if (error instanceof BrowseNotFoundError) {
      return textResponse(error.message, 404);
    }
    const message =
      error instanceof Error ? error.message : 'Failed to list the directory.';
    return textResponse(message, 500);
  }
}
