import type { Thread, ThreadAnchor, ThreadSide } from './types';

// `.hunkyard/review.md` is the local store's file format.
//
// It has three readers with different needs, which is what drives the shape:
// a person skimming the review, this parser reading it back, and a coding agent
// being handed it as work. So the anchors are `path:line` headings that an agent
// can act on directly, the prose is ordinary markdown, and the machine fields
// live in HTML comments that render as nothing.
//
// Prose is safe to edit by hand. The `<!-- hunkyard ... -->` lines are not.

const FORMAT_VERSION = 1;
const THREAD_MARKER = 'hunkyard';

export interface ReviewDocument {
  target: string;
  threads: Thread[];
}

function formatAnchorHeading(anchor: ThreadAnchor): string {
  const range =
    anchor.startLine == null || anchor.startLine === anchor.line
      ? `${anchor.line}`
      : `${anchor.startLine}-${anchor.line}`;
  // The side is only worth stating when it is the deleted one, since that is
  // the case a reader would otherwise misread.
  const side = anchor.side === 'LEFT' ? ' (deleted side)' : '';
  return `${anchor.path}:${range}${side}`;
}

function formatThreadMeta(thread: Thread): string {
  const fields: string[] = [
    `${THREAD_MARKER}`,
    `thread=${thread.id}`,
    `path=${thread.anchor.path}`,
    `line=${thread.anchor.line}`,
    `side=${thread.anchor.side}`,
    `commit=${thread.anchor.commitId}`,
    `resolved=${String(thread.resolved)}`,
  ];
  if (thread.anchor.startLine != null) {
    fields.splice(4, 0, `startLine=${thread.anchor.startLine}`);
    if (thread.anchor.startSide != null) {
      fields.splice(5, 0, `startSide=${thread.anchor.startSide}`);
    }
  }
  return `<!-- ${fields.join(' ')} -->`;
}

export function serializeReview(doc: ReviewDocument): string {
  const lines: string[] = [
    '# Review notes',
    '',
    `<!-- ${THREAD_MARKER} version=${FORMAT_VERSION} target=${doc.target} -->`,
    '',
    `Target: \`${doc.target}\``,
    '',
    'Prose here is yours to edit. The `<!-- hunkyard ... -->` lines carry the',
    'anchors and are rewritten automatically, so leave them alone.',
    '',
  ];

  for (const thread of doc.threads) {
    lines.push(`## ${formatAnchorHeading(thread.anchor)}`);
    lines.push('');
    lines.push(formatThreadMeta(thread));
    lines.push('');
    if (thread.resolved) {
      lines.push('> Resolved.');
      lines.push('');
    }
    for (const comment of thread.comments) {
      lines.push(`**${comment.author.login}** · ${comment.createdAt}`);
      lines.push(`<!-- ${THREAD_MARKER} comment=${comment.id} -->`);
      lines.push('');
      lines.push(comment.body.trim());
      lines.push('');
    }
  }

  return lines.join('\n');
}

function parseMetaFields(line: string): Map<string, string> {
  const fields = new Map<string, string>();
  const inner = /<!--\s*(.*?)\s*-->/.exec(line)?.[1];
  if (inner == null) return fields;
  for (const token of inner.split(/\s+/)) {
    const equals = token.indexOf('=');
    if (equals > 0) {
      fields.set(token.slice(0, equals), token.slice(equals + 1));
    }
  }
  return fields;
}

function isSide(value: string | undefined): value is ThreadSide {
  return value === 'LEFT' || value === 'RIGHT';
}

// Reads a review file back. Unparseable sections are skipped rather than
// throwing: this file is meant to be hand-edited, and losing every thread
// because one heading was mangled would be the wrong trade.
export function parseReview(text: string): ReviewDocument {
  const lines = text.split('\n');
  const header = lines.find(
    (line) => line.includes(THREAD_MARKER) && line.includes('version=')
  );
  const target = header == null ? '' : (parseMetaFields(header).get('target') ?? '');

  const threads: Thread[] = [];
  let current: Thread | null = null;
  let pendingAuthor: { login: string; createdAt: string } | null = null;
  let pendingCommentId: string | null = null;
  let body: string[] = [];

  const flushComment = () => {
    if (current == null || pendingAuthor == null) {
      body = [];
      pendingAuthor = null;
      pendingCommentId = null;
      return;
    }
    const text = body.join('\n').trim();
    if (text !== '') {
      current.comments.push({
        id: pendingCommentId ?? `c_${current.comments.length + 1}`,
        author: { login: pendingAuthor.login },
        body: text,
        createdAt: pendingAuthor.createdAt,
        pending: false,
      });
    }
    body = [];
    pendingAuthor = null;
    pendingCommentId = null;
  };

  const flushThread = () => {
    flushComment();
    if (current != null && current.comments.length > 0) threads.push(current);
    current = null;
  };

  for (const line of lines) {
    if (line.startsWith('## ')) {
      flushThread();
      // The heading is for humans; the metadata comment that follows is
      // authoritative, so an empty shell is created here and filled below.
      current = {
        id: '',
        anchor: { path: '', side: 'RIGHT', line: 0, commitId: '' },
        comments: [],
        resolved: false,
        outdated: false,
      };
      continue;
    }

    if (line.includes(`<!-- ${THREAD_MARKER}`) && line.includes('thread=')) {
      const fields = parseMetaFields(line);
      if (current != null) {
        const side = fields.get('side');
        const startSide = fields.get('startSide');
        const startLine = fields.get('startLine');
        current.id = fields.get('thread') ?? '';
        current.anchor = {
          path: fields.get('path') ?? '',
          line: Number(fields.get('line') ?? 0),
          side: isSide(side) ? side : 'RIGHT',
          commitId: fields.get('commit') ?? '',
          ...(startLine == null ? {} : { startLine: Number(startLine) }),
          ...(isSide(startSide) ? { startSide } : {}),
        };
        current.resolved = fields.get('resolved') === 'true';
      }
      continue;
    }

    if (line.includes(`<!-- ${THREAD_MARKER}`) && line.includes('comment=')) {
      pendingCommentId = parseMetaFields(line).get('comment') ?? null;
      continue;
    }

    const authorLine = /^\*\*(.+?)\*\*\s*·\s*(\S+)\s*$/.exec(line);
    if (authorLine != null) {
      flushComment();
      pendingAuthor = { login: authorLine[1], createdAt: authorLine[2] };
      continue;
    }

    if (line.startsWith('> Resolved.')) continue;
    if (pendingAuthor != null) body.push(line);
  }
  flushThread();

  return { target, threads };
}
