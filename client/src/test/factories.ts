import { Identity, Timestamp } from 'spacetimedb';
import type {
  Book,
  Chapter,
  KnowledgeBlock,
  ReaderProgress,
} from '../module_bindings/types';

// Row builders for tests. Every field has a default so a test only states the fields
// it is actually about — a test that mentions `position` is a test about ordering.

const NOW = new Timestamp(0n);

export function aBook(overrides: Partial<Book> = {}): Book {
  return {
    bookId: 1n,
    owner: Identity.zero(),
    title: 'A Book',
    description: 'About things',
    status: { tag: 'Published' },
    locale: undefined,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

export function aChapter(overrides: Partial<Chapter> = {}): Chapter {
  return {
    chapterId: 10n,
    bookId: 1n,
    title: 'A Chapter',
    description: 'Chapter description',
    position: 0,
    isOptional: false,
    isPinned: false,
    locale: undefined,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

export function aBlock(overrides: Partial<KnowledgeBlock> = {}): KnowledgeBlock {
  return {
    blockId: 100n,
    chapterId: 10n,
    title: 'A Block',
    blockType: { tag: 'Reading' },
    bodyHtml: '<p>Body text</p>',
    url: undefined,
    position: 0,
    isOptional: false,
    locale: undefined,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

export function someProgress(overrides: Partial<ReaderProgress> = {}): ReaderProgress {
  return {
    progressId: 1n,
    identity: Identity.zero(),
    blockId: 100n,
    completedAt: NOW,
    ...overrides,
  };
}

/** `n` words of prose in a paragraph — for read-time and word-count tests. */
export function prose(n: number): string {
  return `<p>${Array.from({ length: n }, () => 'word').join(' ')}</p>`;
}
