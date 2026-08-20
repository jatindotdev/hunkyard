import {
  PathEscapesRepoError,
  loadLocalDiffFiles,
  type HydratableChangeType,
} from '@/lib/git/files';
import { NoRepositoryError, resolveConfiguredRepoRoot } from '@/lib/git/repo';
import { resolveGitTarget } from '@/lib/git/targets';

// Only the types the client asks us to hydrate. `new` and `deleted` are refused
// client-side because one side is empty by definition.
const HYDRATABLE: readonly string[] = ['change', 'rename-changed', 'rename-pure'];

function isHydratable(value: string | null): value is HydratableChangeType {
  return value != null && HYDRATABLE.includes(value);
}

// The client parses failures as `{ error }` JSON, falling back to raw text.
function jsonError(message: string, status: number): Response {
  return Response.json(
    { error: message },
    { status, headers: { 'Cache-Control': 'no-store' } }
  );
}

export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const name = params.get('name');
  const type = params.get('type');
  const prevName = params.get('prevName') ?? undefined;
  const target = params.get('target') ?? undefined;

  if (name == null || name === '' || !isHydratable(type)) {
    return jsonError('name and a supported type parameter are required.', 400);
  }

  try {
    const repoRoot = await resolveConfiguredRepoRoot();
    const files = await loadLocalDiffFiles({
      repoRoot,
      target: resolveGitTarget(target),
      name,
      prevName,
      type,
    });
    return Response.json(files, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof NoRepositoryError) return jsonError(error.message, 503);
    // A traversal attempt is a client error, and the message deliberately does
    // not echo a resolved filesystem path back.
    if (error instanceof PathEscapesRepoError) {
      return jsonError('Path is outside the repository.', 400);
    }
    const message =
      error instanceof Error ? error.message : 'Failed to read the file.';
    return jsonError(message, 502);
  }
}
