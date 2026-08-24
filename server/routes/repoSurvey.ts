import {
  NoRepositoryError,
  resolveRequestRepoRoot,
  UnknownRepositoryError,
} from '../../lib/git/repo';
import { parseSurveyParts, surveyRepository } from '../../lib/git/survey';

function textResponse(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

// What a repository has to review. Nothing is cached here: refs and the working
// tree change under a stable URL, and /api/local-events already exists to say
// when they have.
export async function handleRepoSurvey(request: Request): Promise<Response> {
  const parts = parseSurveyParts(new URL(request.url).searchParams.get('parts'));

  try {
    const root = await resolveRequestRepoRoot(request);
    const survey = await surveyRepository(root, { parts });
    return Response.json(
      { root, ...survey },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    if (error instanceof UnknownRepositoryError) {
      return textResponse(error.message, 404);
    }
    if (error instanceof NoRepositoryError) {
      return textResponse(error.message, 503);
    }
    const message =
      error instanceof Error ? error.message : 'Failed to survey the repository.';
    return textResponse(message, 500);
  }
}
