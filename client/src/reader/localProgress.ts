// An anonymous reader's progress, kept in this browser only (M15.3).
//
// A caller who is not signed in writes nothing on the server: no `reader_progress`,
// no `quiz_attempts`. So what they complete, and the verdicts `grade_quiz` returns
// them, live here, in localStorage. It can be lost (another browser, cleared storage,
// a private window), and the UI says so. It unlocks chapters for this one reader
// only, in books they could already read, so it is a convenience and never a trust
// boundary (docs/v0.3-scope.md, the second 2026-11-19 amendment).

import { useSyncExternalStore } from 'react';
import { Timestamp, type Identity } from 'spacetimedb';
import type {
  QuizAttempt,
  QuizAttemptResult,
  ReaderProgress,
} from '../module_bindings/types';

const KEY = 'boc.anonymous_progress.v1';

export interface LocalVerdict {
  readonly scorePercent: number;
  readonly passed: boolean;
  readonly results: readonly {
    readonly questionId: bigint;
    readonly isCorrect: boolean;
  }[];
}

/** Block ids as strings: JSON has no bigint. */
export interface LocalProgress {
  readonly completed: readonly string[];
  /** The latest verdict per quiz block. Only the latest is ever shown. */
  readonly verdicts: Readonly<Record<string, StoredVerdict>>;
}

interface StoredVerdict {
  readonly scorePercent: number;
  readonly passed: boolean;
  readonly results: readonly {
    readonly questionId: string;
    readonly isCorrect: boolean;
  }[];
}

export const EMPTY: LocalProgress = { completed: [], verdicts: {} };

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function parseVerdict(v: unknown): StoredVerdict | undefined {
  if (!isRecord(v)) return undefined;
  const { scorePercent, passed, results } = v;
  if (typeof scorePercent !== 'number' || typeof passed !== 'boolean') return undefined;
  if (!Array.isArray(results)) return undefined;
  const parsed: StoredVerdict['results'][number][] = [];
  for (const r of results) {
    if (
      !isRecord(r) ||
      typeof r.questionId !== 'string' ||
      typeof r.isCorrect !== 'boolean'
    ) {
      return undefined;
    }
    parsed.push({ questionId: r.questionId, isCorrect: r.isCorrect });
  }
  return { scorePercent, passed, results: parsed };
}

/** Pure: read what was stored. Anything unreadable is treated as nothing stored. */
export function parseProgress(raw: string | null): LocalProgress {
  if (!raw) return EMPTY;
  try {
    const value: unknown = JSON.parse(raw);
    if (
      !isRecord(value) ||
      !Array.isArray(value.completed) ||
      !isRecord(value.verdicts)
    ) {
      return EMPTY;
    }
    const completed = value.completed.filter(
      (id): id is string => typeof id === 'string',
    );
    const verdicts: Record<string, StoredVerdict> = {};
    for (const [blockId, v] of Object.entries(value.verdicts)) {
      const verdict = parseVerdict(v);
      if (verdict) verdicts[blockId] = verdict;
    }
    return { completed, verdicts };
  } catch {
    return EMPTY;
  }
}

/** Pure: progress with `blockId` complete. */
export function withCompleted(progress: LocalProgress, blockId: bigint): LocalProgress {
  const id = String(blockId);
  if (progress.completed.includes(id)) return progress;
  return { ...progress, completed: [...progress.completed, id] };
}

/**
 * Pure: progress with a quiz's latest verdict. A pass completes the block. A later
 * failure does not undo it, the same best-of rule `submit_quiz` keeps on the server.
 */
export function withVerdict(
  progress: LocalProgress,
  blockId: bigint,
  verdict: LocalVerdict,
): LocalProgress {
  const stored: StoredVerdict = {
    scorePercent: verdict.scorePercent,
    passed: verdict.passed,
    results: verdict.results.map((r) => ({
      questionId: String(r.questionId),
      isCorrect: r.isCorrect,
    })),
  };
  const next = {
    ...progress,
    verdicts: { ...progress.verdicts, [String(blockId)]: stored },
  };
  return verdict.passed ? withCompleted(next, blockId) : next;
}

/** Pure: the completed block ids. */
export function completedIds(progress: LocalProgress): Set<bigint> {
  return new Set(progress.completed.map((id) => BigInt(id)));
}

/** Pure: the latest verdict on a quiz block, if there is one. */
export function verdictFor(
  progress: LocalProgress,
  blockId: bigint,
): LocalVerdict | undefined {
  const v = progress.verdicts[String(blockId)];
  if (!v) return undefined;
  return {
    scorePercent: v.scorePercent,
    passed: v.passed,
    results: v.results.map((r) => ({
      questionId: BigInt(r.questionId),
      isCorrect: r.isCorrect,
    })),
  };
}

// --- The browser store -------------------------------------------------------

function storage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function readRaw(): string | null {
  try {
    return storage()?.getItem(KEY) ?? null;
  } catch {
    return null;
  }
}

/**
 * The parsed value, cached against the stored string. `useSyncExternalStore` needs
 * the same object back while nothing changed, and keying on the string means a write
 * from anywhere (this tab, another tab, a test clearing storage) is seen.
 */
let cache: { raw: string | null; value: LocalProgress } | undefined;
/** Holds progress for this page when storage is unavailable or refuses the write. */
let unsaved: LocalProgress | undefined;
const listeners = new Set<() => void>();

function snapshot(): LocalProgress {
  if (unsaved) return unsaved;
  const raw = readRaw();
  if (cache?.raw !== raw) cache = { raw, value: parseProgress(raw) };
  return cache.value;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // Another tab wrote, so two tabs of one reader agree without a reload.
  const onStorage = (event: StorageEvent) => {
    if (event.key === KEY || event.key === null) listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

/** Apply a change and keep it. If storage is unavailable, it lasts as long as the page. */
export function updateLocalProgress(change: (p: LocalProgress) => LocalProgress): void {
  const next = change(snapshot());
  try {
    const store = storage();
    if (!store) throw new Error('no storage');
    store.setItem(KEY, JSON.stringify(next));
    unsaved = undefined;
  } catch {
    unsaved = next;
  }
  for (const listener of listeners) listener();
}

/** The anonymous reader's stored progress, live. */
export function useLocalProgress(): LocalProgress {
  return useSyncExternalStore(subscribe, snapshot, () => EMPTY);
}

/**
 * Pure: the stored verdicts as quiz attempt rows, so the quiz shows a local verdict
 * through the same `buildQuiz` path as a recorded one. One attempt per block, since
 * only the latest is kept.
 */
export function asAttemptRows(
  progress: LocalProgress,
  identity: Identity,
): { attempts: QuizAttempt[]; results: QuizAttemptResult[] } {
  const attempts: QuizAttempt[] = [];
  const results: QuizAttemptResult[] = [];
  Object.keys(progress.verdicts).forEach((blockId, index) => {
    const verdict = verdictFor(progress, BigInt(blockId));
    if (!verdict) return;
    const attemptId = BigInt(index + 1);
    attempts.push({
      attemptId,
      identity,
      blockId: BigInt(blockId),
      scorePercent: verdict.scorePercent,
      passed: verdict.passed,
      submittedAt: Timestamp.UNIX_EPOCH,
    });
    verdict.results.forEach((r, i) => {
      results.push({
        resultId: BigInt(i + 1),
        attemptId,
        questionId: r.questionId,
        isCorrect: r.isCorrect,
      });
    });
  });
  return { attempts, results };
}

/**
 * Pure: the blocks this reader has completed. A signed-in reader's come from the
 * server alone. An anonymous reader's are the stored ones, plus any server rows the
 * identity holds from before M15.3, when an anonymous caller could still write them.
 */
export function completedBlockIds(
  rows: readonly ReaderProgress[],
  identity: Identity | undefined,
  local: LocalProgress | undefined,
): Set<bigint> {
  const ids = new Set(
    rows.filter((p) => identity && p.identity.isEqual(identity)).map((p) => p.blockId),
  );
  if (local) for (const id of completedIds(local)) ids.add(id);
  return ids;
}

/**
 * Pure: what `grade_quiz` returned, as a verdict or a refusal.
 *
 * Its Rust return type is `Result<QuizVerdict, String>`. The SDK's generated type
 * says `QuizVerdict | string`, but on the wire (SpacetimeDB 2.8, measured by
 * `e2e/anonymous.spec.ts`) it arrives as `{ ok }` or `{ err }`. So the value is read
 * as `unknown` and both shapes are accepted, and anything else is a refusal rather
 * than a verdict nobody gave.
 */
export function readGradeResult(
  result: unknown,
): { verdict: LocalVerdict } | { refusal: string } {
  if (typeof result === 'string') return { refusal: result };
  if (isRecord(result) && typeof result.err === 'string') return { refusal: result.err };
  const value = isRecord(result) && 'ok' in result ? result.ok : result;
  if (isRecord(value)) {
    const { scorePercent, passed, results } = value;
    if (
      typeof scorePercent === 'number' &&
      typeof passed === 'boolean' &&
      Array.isArray(results)
    ) {
      const parsed: LocalVerdict['results'][number][] = [];
      for (const r of results) {
        if (
          !isRecord(r) ||
          typeof r.questionId !== 'bigint' ||
          typeof r.isCorrect !== 'boolean'
        ) {
          return { refusal: UNREADABLE };
        }
        parsed.push({ questionId: r.questionId, isCorrect: r.isCorrect });
      }
      return { verdict: { scorePercent, passed, results: parsed } };
    }
  }
  return { refusal: UNREADABLE };
}

const UNREADABLE = 'The server’s grade could not be read.';
