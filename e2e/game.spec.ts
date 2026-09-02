import { test, expect, type Page } from '@playwright/test';

// Each test gets a fresh browser context, so localStorage starts empty and
// nothing leaks between tests. Do NOT clear it in a beforeEach: the tests that
// reload to check persistence need writes to survive a navigation.

/** Speeds the board up so a full game fits comfortably in a test. */
async function useInstantSpeed(page: Page) {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('awale.settings.v1', JSON.stringify({
        sound: false, haptics: false, speed: 'instant',
        theme: 'wood', leftHanded: false, showCounts: true, language: 'en',
      }));
    } catch { /* private mode */ }
  });
}

const playablePits = (page: Page) => page.locator('.pit-legal');

/** Plays until the game-over dialog appears, or the cap is reached. */
async function playToEnd(page: Page, maxMoves = 200) {
  const overlay = page.locator('.over-card');
  for (let i = 0; i < maxMoves; i++) {
    if (await overlay.isVisible()) return true;
    const pits = playablePits(page);
    const count = await pits.count();
    if (count === 0) {
      // Mid-animation or the AI's turn — wait for control to come back.
      await page.waitForTimeout(120);
      continue;
    }
    await pits.last().click();
    await page.waitForTimeout(60);
  }
  return overlay.isVisible();
}

test('board sows counterclockwise: pit indices run the right way round', async ({ page }) => {
  await page.goto('/');
  await page.getByText('TWO PLAYERS').click();

  // Read each pit's centre, in the DOM order the layout module produced.
  const boxes = await page.locator('.pit').evaluateAll(els => els.map(el => {
    const r = el.getBoundingClientRect();
    return {
      label: el.getAttribute('aria-label') ?? '',
      x: r.x + r.width / 2,
      y: r.y + r.height / 2,
    };
  }));
  expect(boxes).toHaveLength(12);

  // DOM order is [far row (opponent, reversed), near row (yours)]. Rebuild the
  // ring in engine index order, then measure its winding.
  const far = boxes.slice(0, 6);   // opponent pit 6 … pit 1
  const near = boxes.slice(6);     // your pit 1 … pit 6
  const ring = [...near, ...far.slice().reverse()];

  // Signed area in screen coordinates (y grows downward): negative is
  // counterclockwise to the viewer. This is the invariant the whole board rests on.
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % ring.length];
    sum += p.x * q.y - q.x * p.y;
  }
  expect(sum).toBeLessThan(0);
});

test('a full game against the AI finishes and is recorded', async ({ page }) => {
  await useInstantSpeed(page);
  await page.goto('/');

  await page.getByText('PLAY VS AI').click();
  await page.getByText('Novice').click();

  expect(await playToEnd(page)).toBe(true);
  await expect(page.locator('.over-card')).toContainText(/You win!|wins|Draw/);
  // A rated game moves the rating.
  await expect(page.locator('.over-rating')).toBeVisible();

  await page.getByText('BACK TO MENU').click();
  await page.getByLabel('Stats').click();
  await expect(page.locator('.stat-grid')).toBeVisible();
  await expect(page.locator('.stat-tile').first()).toContainText('1');
});

test('a game in progress survives a reload', async ({ page }) => {
  await useInstantSpeed(page);
  await page.goto('/');

  await page.getByText('PLAY VS AI').click();
  await page.getByText('Novice').click();
  await playablePits(page).last().click();
  await page.waitForTimeout(600);

  const before = await page.locator('.pit-count').allInnerTexts();

  await page.goto('/');
  await expect(page.getByText('CONTINUE')).toBeVisible();
  await page.getByText('CONTINUE').click();

  await expect.poll(async () => page.locator('.pit-count').allInnerTexts()).toEqual(before);
});

test('settings change the board and persist', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Settings').first().click();

  await page.getByRole('radio', { name: 'Night' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'night');

  // Turning off seed counts must actually remove the badges.
  await page.getByRole('switch', { name: 'Show seed counts' }).click();
  await page.getByText('Done').click();
  await page.getByText('TWO PLAYERS').click();
  await expect(page.locator('.pit-count')).toHaveCount(0);

  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'night');
});

test('switching to French translates the interface', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Settings').first().click();
  await page.getByRole('radio', { name: 'Français' }).click();

  await expect(page.getByText('Réglages').first()).toBeVisible();
  await page.getByText('Terminé').click();
  await expect(page.getByText('DEUX JOUEURS')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
});

test('challenges unlock in order', async ({ page }) => {
  await page.goto('/');
  await page.getByText('Challenges').first().click();

  const items = page.locator('.challenge-item');
  await expect(items).toHaveCount(12);
  await expect(items.first()).toBeEnabled();
  await expect(items.nth(1)).toBeDisabled();
});

test('the tutorial runs from start to finish', async ({ page }) => {
  await useInstantSpeed(page);
  await page.goto('/');
  await page.getByText('LEARN').click();

  await expect(page.locator('.tut-card')).toBeVisible();
  for (let i = 0; i < 90; i++) {
    if (await page.locator('.menu-hero').isVisible()) break;
    const next = page.getByRole('button', { name: /^(NEXT|FINISH)$/ });
    if (await next.isVisible()) { await next.click(); await page.waitForTimeout(80); continue; }
    const pits = playablePits(page);
    // Last pit = closest to the opponent's row, so the free-play step's
    // "capture something" gate is actually reachable.
    if (await pits.count() > 0) { await pits.last().click(); await page.waitForTimeout(80); continue; }
    await page.waitForTimeout(120);
  }
  await expect(page.locator('.menu-hero')).toBeVisible();
});

test('the board is playable with a keyboard alone', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /TWO PLAYERS Pass/ }).click();

  // Tab until a playable pit has focus, then play it with the keyboard.
  let focused = '';
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press('Tab');
    focused = await page.evaluate(() => document.activeElement?.className ?? '');
    if (focused.includes('pit-legal')) break;
  }
  expect(focused).toContain('pit-legal');

  const label = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? '');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1200);

  // That pit is now empty, so its label must have changed.
  const stillThere = await page.locator(`[aria-label="${label}"]`).count();
  expect(stillThere).toBe(0);

  // And the move was announced for screen readers.
  await expect(page.locator('[role="status"][aria-live="polite"]').first())
    .toContainText(/sowed pit|to play/);
});

test('the game still loads with the network offline', async ({ page, context }) => {
  await page.goto('/');
  // Let the service worker install and take control.
  await page.waitForFunction(() => navigator.serviceWorker?.controller != null, null, { timeout: 20_000 });
  await page.reload();

  await context.setOffline(true);
  await page.reload();

  await expect(page.locator('.menu-hero')).toBeVisible();
  await page.getByRole('button', { name: /TWO PLAYERS Pass/ }).click();
  await expect(page.locator('.pit')).toHaveCount(12);
  await context.setOffline(false);
});
