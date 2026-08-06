import { expect, test, type Page } from '@playwright/test';

/**
 * The Definition of Done demo path, against a real stack.
 *
 * Everything here is deliberately end-to-end: unit tests already cover the unlock
 * rules and the components, and mock the SDK. What only a browser can confirm is the
 * part in between — that Mermaid honours the click directives, that the subscription
 * actually pushes, and that a second tab on the same identity sees a change with no
 * reload. That last one is item 4 of the Definition of Done, and it is the product.
 *
 * The demo book comes from scripts/seed.ts:
 *
 *   Foundations ──┬─> Attractors ──┬─> Synthesis ──> Appendix (pinned)
 *                 └─> Bifurcation ─┘
 *                 └─> Aside (optional)
 */

const BOOK = 'Chaos, Briefly';

/** Wait for the connection banner; nothing else renders until it is up. */
async function connected(page: Page) {
  await page.goto('/');
  await expect(page.getByText('Connected as')).toBeVisible();
}

/** A chapter node in the rendered map, by its title. */
function mapNode(page: Page, title: string) {
  return page.locator('.knowledge-map a').filter({ hasText: title }).first();
}

/** Mermaid writes SVG anchors with `xlink:href`. */
function nodeHref(page: Page, title: string) {
  return mapNode(page, title).getAttribute('xlink:href');
}

/**
 * Mark the page so a full reload becomes detectable.
 *
 * The map's node links are real anchors — clicking one works whether or not the app
 * intercepts it, so "the chapter opened" proves nothing about staying in-app. A
 * reload wipes this flag; a pushState navigation does not.
 */
async function markPage(page: Page) {
  await page.evaluate(() => {
    (window as unknown as Record<string, unknown>).__bocNoReload = true;
  });
}

async function pageWasNotReloaded(page: Page) {
  return page.evaluate(
    () => (window as unknown as Record<string, unknown>).__bocNoReload === true,
  );
}

async function completeEveryBlock(page: Page) {
  const button = page.getByRole('button', { name: 'Mark as complete' });
  for (let remaining = await button.count(); remaining > 0; remaining--) {
    await button.first().click();
    await expect(button).toHaveCount(remaining - 1);
  }
}

test('a reader can see the book, its map, and how long it takes', async ({ page }) => {
  await connected(page);

  await expect(page.getByRole('heading', { name: BOOK })).toBeVisible();
  await expect(page.getByText('6 chapters')).toBeVisible();
  await expect(page.getByText(/min read/)).toBeVisible();

  // The map is the navigation surface, so every chapter has to be on it.
  for (const title of ['Foundations', 'Attractors', 'Bifurcation', 'Synthesis']) {
    await expect(mapNode(page, title)).toBeVisible();
  }
});

test('the map states each chapter, and clicking a node opens it', async ({ page }) => {
  await connected(page);

  // A fresh identity has no progress: the root is open, everything downstream is not.
  await expect(mapNode(page, 'Foundations')).toContainText('○');
  await expect(mapNode(page, 'Attractors')).toContainText('🔒');
  // Pinned: reachable despite depending on Synthesis.
  await expect(mapNode(page, 'Appendix')).not.toContainText('🔒');
  // Optional chapters carry their badge.
  await expect(mapNode(page, 'Aside')).toContainText('⭐');

  await markPage(page);
  await mapNode(page, 'Foundations').click();
  await expect(page).toHaveURL(/\/chapter\/\d+$/);
  // In-app navigation: a full page load would drop the connection and the identity
  // token round-trip with it.
  expect(await pageWasNotReloaded(page)).toBe(true);
  await expect(page.getByRole('heading', { name: 'Foundations' })).toBeVisible();
  // Level 3 specifically: the block's own body starts with an <h2> of the same text.
  await expect(
    page.getByRole('heading', { level: 3, name: 'State and evolution' }),
  ).toBeVisible();
});

test('a blocked chapter is locked, and stays locked at its own URL', async ({ page }) => {
  await connected(page);

  const href = await nodeHref(page, 'Synthesis');
  expect(href).toMatch(/\/chapter\/\d+/);

  await page.goto(href ?? '/');
  await expect(page.getByText('This chapter is locked.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Mark as complete' })).toHaveCount(0);
});

test('completing a chapter unlocks what depends on it', async ({ page }) => {
  await connected(page);

  await mapNode(page, 'Foundations').click();
  await completeEveryBlock(page);
  await page.getByRole('button', { name: 'Back to the book' }).click();

  // No reload anywhere in this test: the map redraws from the subscription.
  await expect(mapNode(page, 'Foundations')).toContainText('✓');
  await expect(mapNode(page, 'Attractors')).toContainText('○');
  await expect(mapNode(page, 'Bifurcation')).toContainText('○');
  // Synthesis waits for both arms of the diamond.
  await expect(mapNode(page, 'Synthesis')).toContainText('🔒');
});

test('two tabs on one identity stay in sync without a reload', async ({ page, context }) => {
  // Definition of Done, item 4.
  await connected(page);
  await mapNode(page, 'Foundations').click();

  const watcher = await context.newPage();
  await connected(watcher);
  await expect(mapNode(watcher, 'Foundations')).toContainText('○');

  await completeEveryBlock(page);

  // `watcher` is never touched again — no goto, no reload, no click.
  await expect(mapNode(watcher, 'Foundations')).toContainText('✓');
  await expect(mapNode(watcher, 'Attractors')).toContainText('○');

  await watcher.close();
});

test('an author can build a book through the UI', async ({ page }) => {
  await connected(page);
  await page.getByRole('button', { name: 'Author' }).click();

  const title = `Test Book ${Date.now()}`;
  await page.getByLabel('Title').fill(title);
  await page.getByRole('button', { name: 'Create' }).click();

  await page.getByRole('button', { name: title }).click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await expect(page.getByText(/only you can see this book/i)).toBeVisible();

  await page.getByLabel('Title').first().fill('Chapter One');
  await page.getByRole('button', { name: 'Create' }).first().click();
  await expect(page.getByRole('heading', { name: 'Chapter One' })).toBeVisible();

  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText(/readers can see this book/i)).toBeVisible();
});
