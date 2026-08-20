import type { Draft, Thread, ThreadAnchor } from './types';

export interface SubmitOptions {
  // GitHub's review verdicts. A local store has no notion of approving, so it
  // ignores this.
  event?: 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES';
  body?: string;
}

// Where review threads live.
//
// Two implementations: one writes markdown into the repository for a local
// review, one posts to GitHub's review API. The UI talks only to this, so
// reviewing a working tree and reviewing a pull request are the same code path
// with a different store.
export interface ThreadStore {
  // Threads that already exist. For GitHub that is a fetch; for a local review
  // it is whatever is in .hunkyard/review.md.
  list(): Promise<Thread[]>;

  // Add a comment. `anchor` starts a new thread; `replyToThreadId` continues
  // one. Returns the thread as it now stands.
  //
  // Whether this is visible to anyone else immediately is deliberately not
  // specified here: GitHub holds comments in a pending review until submit,
  // and the local store writes through. Callers must not assume either.
  add(input: {
    anchor: ThreadAnchor;
    body: string;
    replyToThreadId?: string;
  }): Promise<Thread>;

  remove(threadId: string, commentId: string): Promise<void>;

  setResolved(threadId: string, resolved: boolean): Promise<void>;

  // Publishes anything held back. A no-op for a store that writes through.
  submit(options: SubmitOptions): Promise<void>;

  // Whether `submit` does anything, so the UI can decide whether to offer it.
  readonly batches: boolean;

  // Whether resolving is supported. GitHub needs GraphQL for it; a markdown
  // file can just record it.
  readonly supportsResolve: boolean;
}

// Drafts in progress, before they become comments. Kept separate from the store
// because a draft belongs to this machine and this session regardless of where
// the thread will eventually live -- and because losing them on reload was the
// single worst thing about the layer this replaces.
export interface DraftStore {
  list(): Promise<Draft[]>;
  save(draft: Draft): Promise<void>;
  discard(draftId: string): Promise<void>;
  clear(): Promise<void>;
}
