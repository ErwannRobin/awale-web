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

test('the board holds still while the coaching text changes', async ({ page }) => {
  await useInstantSpeed(page);
  await page.goto('/');

  await page.getByText('PLAY VS AI').click();
  await page.getByText('Novice').click();

  const board = page.locator('.board');
  await expect(board).toBeVisible();
  const start = await board.boundingBox();

  // The line under the turn pill swaps between three different lengths as the
  // turn changes, and the tip below the board rotates every six seconds. Both
  // sit in a slot sized for their longest text, so the board must not budge.
  for (let i = 0; i < 4; i++) {
    await page.waitForTimeout(3500);   // long enough to cross a tip change
    const pits = playablePits(page);
    if (await pits.count() > 0) await pits.last().click();
    await page.waitForTimeout(400);
    expect(await board.boundingBox()).toEqual(start);
  }
});

test('one × switches both coaching texts off, and Settings brings them back', async ({ page }) => {
  await useInstantSpeed(page);
  await page.goto('/');

  await page.getByText('PLAY VS AI').click();
  await page.getByText('Novice').click();

  await expect(page.locator('.turn-line-row')).toBeVisible();
  await expect(page.locator('.tip-card')).toBeVisible();

  // Either × switches off BOTH — the line above the board and the card below.
  await page.locator('.tip-close').first().click();
  await expect(page.locator('.turn-line-row')).toHaveCount(0);
  await expect(page.locator('.tip-card')).toHaveCount(0);

  // It is a stored setting, not a one-screen dismissal, so it outlives this
  // board. (The reload can't be checked here: the harness rewrites settings on
  // every navigation.)
  const stored = await page.evaluate(() => localStorage.getItem('awale.settings.v1'));
  expect(JSON.parse(stored ?? '{}').showTips).toBe(false);

  // Settings puts them back.
  await page.getByLabel('Settings').first().click();
  await page.getByRole('switch', { name: 'Show tips' }).click();
  await page.getByText('Done').click();
  await expect(page.locator('.tip-card')).toBeVisible();
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

test('Escape closes Settings', async ({ page }) => {
  await page.goto('/');
  await page.getByText('TWO PLAYERS').click();
  await expect(page.locator('.board')).toBeVisible();

  await page.getByLabel('Settings').first().click();
  await expect(page.getByText('Done')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.board')).toBeVisible();
});

test('Escape does not walk out of a game', async ({ page }) => {
  await page.goto('/');
  await page.getByText('TWO PLAYERS').click();
  await expect(page.locator('.board')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.board')).toBeVisible();
});

test('the player chip opens a profile screen, and the gear opens settings', async ({ page }) => {
  await page.goto('/');

  // The chip: who you are. Name, avatar — and the account, which is the only
  // place to sign in or out.
  await page.getByLabel('Profile').click();
  await expect(page.getByRole('heading', { name: 'Profile' })).toBeVisible();
  await page.getByLabel('Display name').fill('Ama');
  await expect(page.getByRole('heading', { name: 'Account' })).toBeVisible();
  await page.getByText('Done').click();
  await expect(page.locator('.chip-name')).toHaveText('Ama');

  // The gear: how the game behaves. The name lives on the other screen now.
  await page.getByLabel('Settings').first().click();
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await expect(page.getByLabel('Display name')).toHaveCount(0);
});

test('the browser chrome takes the colour of the table top', async ({ page }) => {
  const colour = () => page.locator('meta[name="theme-color"]').getAttribute('content');

  await page.goto('/');
  // Wood: the top of its table gradient, not the near-black it used to hold.
  expect((await colour())?.toLowerCase()).toBe('#6b4024');

  await page.getByLabel('Settings').first().click();
  await page.getByRole('radio', { name: 'Sand' }).click();
  await expect.poll(async () => (await colour())?.toLowerCase()).toBe('#f0e0c2');
  await expect(page.locator('html')).toHaveCSS('color-scheme', 'light');
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

/**
 * Walks the tutorial forward until the last step's play call-to-action shows.
 * `onStep` runs once per pass, before anything is clicked.
 */
async function runTutorialToEnd(page: Page, onStep?: () => Promise<void>) {
  const play = page.getByRole('button', { name: /PLAY A GAME/ });
  // The tutorial ignores the speed setting and always sows slowly, so a demo
  // step can hold the walker for several seconds. Hence the generous cap.
  for (let i = 0; i < 400; i++) {
    await onStep?.();
    if (await play.isVisible()) return true;
    const next = page.getByRole('button', { name: /^NEXT$/ });
    if (await next.isVisible()) { await next.click(); await page.waitForTimeout(80); continue; }
    const pits = playablePits(page);
    // Last pit = closest to the opponent's row, so the free-play step's
    // "capture something" gate is actually reachable.
    if (await pits.count() > 0) { await pits.last().click(); await page.waitForTimeout(80); continue; }
    await page.waitForTimeout(120);
  }
  return play.isVisible();
}

test('the tutorial runs from start to finish into an easy game', async ({ page }) => {
  await useInstantSpeed(page);
  await page.goto('/');
  await page.getByText('LEARN').click();

  await expect(page.locator('.tut-card')).toBeVisible();
  expect(await runTutorialToEnd(page)).toBe(true);

  // The closing call to action drops straight into a game against Novice.
  await page.getByRole('button', { name: /PLAY A GAME/ }).click();
  await expect(page.locator('.tut-card')).toHaveCount(0);
  await expect(page.locator('.board')).toBeVisible();
  // Read the opponent's card, not a loose text match: the status line reserves
  // its height with hidden copies of every line it can show, one of which
  // names the opponent too.
  await expect(page.locator('.pcard-opp')).toContainText('Novice');
});

test('the tutorial offers the challenges as a secondary exit', async ({ page }) => {
  await useInstantSpeed(page);
  await page.goto('/');
  await page.getByText('LEARN').click();
  expect(await runTutorialToEnd(page)).toBe(true);

  await page.getByRole('button', { name: /Go to Challenges/ }).click();
  await expect(page.locator('.challenge-item').first()).toBeVisible();
});

test('the tutorial card advances on a tap and the step can be replayed', async ({ page }) => {
  await useInstantSpeed(page);
  await page.goto('/');
  await page.getByText('LEARN').click();

  const progress = page.locator('.tut-progress');
  const replay = page.getByRole('button', { name: /Replay step/ });
  await expect(progress).toHaveText('1 / 13');
  // Nothing has moved yet, so there is nothing to replay.
  await expect(replay).toHaveCount(0);

  // The card itself is the primary way forward.
  await page.locator('.tut-card').click();
  await expect(progress).toHaveText('2 / 13');
  await page.locator('.tut-card').click();
  await expect(progress).toHaveText('3 / 13');   // the demo sow
  await expect(replay).toBeVisible();

  await page.getByRole('button', { name: /^NEXT$/ }).click();
  await expect(progress).toHaveText('4 / 13');

  // Back returns to the previous step; replay stays on the current one.
  await page.locator('.tut-nav .ctrl').first().click();
  await expect(progress).toHaveText('3 / 13');
  await replay.click();
  await expect(progress).toHaveText('3 / 13');
});

test('the tutorial names the side of the board this screen shows', async ({ page }, testInfo) => {
  await useInstantSpeed(page);
  await page.goto('/');
  await page.getByText('LEARN').click();

  await page.locator('.tut-card').click();
  await expect(page.locator('.tut-progress')).toHaveText('2 / 13');
  // The board stands on end below PORTRAIT_MAX_WIDTH, where the learner's six
  // pits are a column on the left rather than the bottom row.
  await expect(page.locator('.tut-card .tut-text').first())
    .toHaveText(testInfo.project.name === 'phone' ? /left column/ : /bottom row/);
});

test('the tutorial leaves the learner\'s own move on the board', async ({ page }) => {
  await useInstantSpeed(page);
  await page.goto('/');
  await page.getByText('LEARN').click();

  const progress = page.locator('.tut-progress');
  await page.locator('.tut-card').click();          // 1 -> 2
  await page.locator('.tut-card').click();          // 2 -> 3 (the demo sow)
  await page.getByRole('button', { name: /^NEXT$/ }).click();   // 3 -> 4
  await expect(progress).toHaveText('4 / 13');

  const emptyPits = page.locator('.pit-count', { hasText: /^0$/ });
  await expect(emptyPits).toHaveCount(1);           // the pit the demo emptied

  await playablePits(page).last().click();
  await expect(progress).toHaveText('5 / 13');

  // The explanation step must not re-seed a staged position over the move the
  // learner just made: their emptied pit is still empty.
  await expect(emptyPits).toHaveCount(2);
});

test('the tutorial card keeps one height across every step', async ({ page }) => {
  await useInstantSpeed(page);
  await page.goto('/');
  await page.getByText('LEARN').click();

  // A card that grows with its text would shove the board down the screen.
  const card = page.locator('.tut-card');
  const heights = new Set<number>();
  await runTutorialToEnd(page, async () => {
    heights.add(Math.round((await card.boundingBox())!.height));
  });
  expect([...heights]).toHaveLength(1);
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

// ---------------------------------------------------------------------------
// Move preview. A player should be able to ask "where does my last seed land?"
// before committing — by hovering with a mouse, or holding with a finger —
// and the asking must never itself play the move.
// ---------------------------------------------------------------------------

test('hovering your own pit marks the hole its last seed lands in', async ({ page }) => {
  await useInstantSpeed(page);
  await page.goto('/');
  await page.getByText('TWO PLAYERS').click();
  await page.waitForSelector('.pit-legal');

  // Four seeds from pit 1 land in the fourth pit along, and nowhere else is
  // marked: the preview is the target hole, not the whole sowing.
  await page.locator('[data-pit="0"]').hover();
  await expect(page.locator('.pit-target')).toHaveCount(1);
  await expect(page.locator('[data-pit="4"]')).toHaveClass(/pit-target/);
  // The mark is only a mark: the target pit is not redrawn with the seed that
  // would arrive, it still shows the four it really holds.
  await expect(page.locator('[data-pit="4"] .seed')).toHaveCount(4);

  // A preview is a peek, not a move: the board has not changed.
  await expect(page.locator('[data-pit="0"]')).toHaveAttribute('aria-label', /4 seeds/);

  // Moving off the board clears it.
  await page.mouse.move(2, 2);
  await expect(page.locator('.pit-target')).toHaveCount(0);
});

test('hovering an opponent pit marks where THEIR seeds would land', async ({ page }) => {
  await useInstantSpeed(page);
  await page.goto('/');
  await page.getByText('TWO PLAYERS').click();
  await page.waitForSelector('.pit-legal');

  // Reading the opponent's threats is half the game, so their row answers the
  // same question yours does. Four seeds from their third pit reach your first.
  await page.locator('[data-pit="8"]').hover();
  await expect(page.locator('.pit-target')).toHaveCount(1);
  await expect(page.locator('[data-pit="0"]')).toHaveClass(/pit-target/);

  // Peeking at their row is all you may do with it: it is not yours to play.
  await expect(page.locator('[data-pit="8"]')).toHaveAttribute('aria-disabled', 'true');
  await page.locator('[data-pit="8"]').click({ force: true });
  await page.waitForTimeout(300);
  await expect(page.locator('[data-pit="8"]')).toHaveAttribute('aria-label', /4 seeds/);
  await expect(page.locator('[data-pit="0"]')).toHaveAttribute('aria-label', /4 seeds/);

  // And the tab order still stops only at the pits you can actually play.
  const stops = await page.locator('.pit').evaluateAll(
    els => els.filter(el => (el as HTMLElement).tabIndex >= 0).map(el => el.getAttribute('data-pit')),
  );
  expect(stops.sort()).toEqual(['0', '1', '2', '3', '4', '5']);
});

test('a big pit laps the board and lands past the hole it came from', async ({ page }) => {
  await useInstantSpeed(page);
  await page.addInitScript(() => {
    try {
      // Your sixth pit holds twelve seeds: eleven fill the rest of the ring,
      // and the twelfth passes its own hole by to land one further on.
      localStorage.setItem('awale.savedgame.v1', JSON.stringify({
        mode: 'local', level: 1,
        pits: [0, 0, 0, 0, 0, 12, 4, 4, 4, 4, 4, 4],
        scores: [12, 0], turn: 0, history: [], at: Date.now(),
      }));
    } catch { /* private mode */ }
  });
  await page.goto('/');
  await page.getByRole('button', { name: /CONTINUE/ }).click();
  await page.waitForSelector('.pit-legal');

  await page.locator('[data-pit="5"]').hover();
  await expect(page.locator('.pit-target')).toHaveCount(1);
  await expect(page.locator('[data-pit="6"]')).toHaveClass(/pit-target/);
});

test('holding a pit marks its landing hole, and dragging moves the mark along', async ({ browser }) => {
  // A touch-capable context: the hold gesture only exists for touch and pen.
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true,
  });
  const page = await context.newPage();
  await useInstantSpeed(page);
  await page.goto('/');
  await page.getByText('TWO PLAYERS').click();
  await page.waitForSelector('.pit-legal');
  // The emulated mouse is still parked where the menu button was, which may
  // now be a pit — and a hovering mouse previews. Park it off the board.
  await page.mouse.move(2, 2);

  // Playwright's touchscreen only taps, so drive raw touch points over CDP:
  // Chromium turns them into the pointer events the board listens for.
  const cdp = await context.newCDPSession(page);
  const centre = async (pit: number) => {
    const box = await page.locator(`[data-pit="${pit}"]`).boundingBox();
    if (!box) throw new Error(`pit ${pit} has no box`);
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };
  const touch = (type: string, p?: { x: number; y: number }) => cdp.send('Input.dispatchTouchEvent', {
    type, touchPoints: p ? [{ x: p.x, y: p.y, id: 1 }] : [],
  });

  const first = await centre(0);
  const later = await centre(3);

  await touch('touchStart', first);
  // A brief touch is a tap, not a hold — nothing previewed yet. A one-shot
  // count, because a retrying assertion would simply wait for the hold.
  await page.waitForTimeout(100);
  expect(await page.locator('.pit-target').count()).toBe(0);

  // Hold, and the landing hole of the pit under the finger is marked.
  await page.waitForTimeout(400);
  await expect(page.locator('[data-pit="4"]')).toHaveClass(/pit-target/);

  // Slide to another pit without lifting: the mark follows.
  await touch('touchMove', later);
  await expect(page.locator('[data-pit="7"]')).toHaveClass(/pit-target/);
  await expect(page.locator('.pit-target')).toHaveCount(1);

  // Slide onto the opponent's row and it answers for them.
  await touch('touchMove', await centre(8));
  await expect(page.locator('[data-pit="0"]')).toHaveClass(/pit-target/);
  await expect(page.locator('.pit-target')).toHaveCount(1);

  // Lifting ends the peek and plays nothing.
  await touch('touchEnd');
  await expect(page.locator('.pit-target')).toHaveCount(0);
  await expect(page.locator('[data-pit="3"]')).toHaveAttribute('aria-label', /4 seeds/);

  // A quick tap still plays the move. Each CDP call is a round trip, so on a
  // loaded machine the gap between the two can itself outlast the hold delay
  // and turn the tap into a hold — which plays nothing, by design. Retry the
  // whole gesture rather than the assertion: the pit is untouched either way.
  const tap = await centre(0);
  await expect(async () => {
    await touch('touchStart', tap);
    await touch('touchEnd');
    await expect(page.locator('[data-pit="0"]'))
      .toHaveAttribute('aria-label', /0 seeds/, { timeout: 1000 });
  }).toPass({ timeout: 15_000 });

  await context.close();
});

test('the browser Back button walks back through the screens', async ({ page }) => {
  await page.goto('/');

  await page.getByText('Challenges').first().click();
  const puzzles = page.locator('.challenge-item');
  await expect(puzzles.first()).toBeVisible();

  await puzzles.first().click();
  await expect(page.locator('.board')).toBeVisible();

  // Back is one screen back, not one site back — the app is still here.
  await page.goBack();
  await expect(puzzles.first()).toBeVisible();

  await page.goBack();
  await expect(page.getByText('TWO PLAYERS')).toBeVisible();

  // And Forward returns to the screen Back left.
  await page.goForward();
  await expect(puzzles.first()).toBeVisible();
});

test('Back out of settings puts the game back on the board', async ({ page }) => {
  await useInstantSpeed(page);
  await page.goto('/');
  await page.getByText('TWO PLAYERS').click();
  await expect(page.locator('.board')).toBeVisible();

  // A move, so the board is one the player would hate to lose.
  await playablePits(page).first().click();
  await expect(page.locator('[data-pit="0"]')).toHaveAttribute('aria-label', /0 seeds/);

  await page.getByLabel('Settings').first().click();
  await expect(page.getByRole('radio', { name: 'Night' })).toBeVisible();

  await page.goBack();
  await expect(page.locator('.board')).toBeVisible();
  await expect(page.locator('[data-pit="0"]')).toHaveAttribute('aria-label', /0 seeds/);
});
