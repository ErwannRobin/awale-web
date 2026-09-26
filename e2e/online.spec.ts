// Two browsers, one board.
//
// Everything below the UI is already covered by `test/online.test.ts`, which
// plays whole games through the protocol in one process. What only a browser
// can prove is the rest of the chain: a real WebSocket to the dev match server,
// a room code that travels by link, and two screens that agree about whose turn
// it is. That is what this file is for.
import { test, expect, type BrowserContext, type Page } from '@playwright/test';

async function freshPlayer(context: BrowserContext, name: string, country = 'ZZ'): Promise<Page> {
  await context.addInitScript(([display, where]) => {
    try {
      localStorage.setItem('awale.settings.v1', JSON.stringify({
        sound: false, haptics: false, speed: 'instant',
        theme: 'wood', leftHanded: false, showCounts: true, language: 'en',
      }));
      localStorage.setItem('awale.profile.v1', JSON.stringify({
        name: display, avatar: 'olive', country: where, countrySource: 'manual',
      }));
    } catch { /* private mode */ }
  }, [name, country]);
  return context.newPage();
}

const legalPits = (page: Page) => page.locator('.pit-legal');

/** Whoever is holding the move, from two boards that disagree by design. */
async function mover(a: Page, b: Page): Promise<Page> {
  for (let i = 0; i < 50; i++) {
    if (await legalPits(a).count() > 0) return a;
    if (await legalPits(b).count() > 0) return b;
    await a.waitForTimeout(100);
  }
  throw new Error('neither board became playable');
}

test('two browsers play the same game over a websocket', async ({ browser }) => {
  const one = await browser.newContext();
  const two = await browser.newContext();

  try {
    const host = await freshPlayer(one, 'Ama');
    await host.goto('/');
    await host.getByText('PLAY ONLINE').click();
    await host.getByText('INVITE A FRIEND').click();

    // The room code is the whole invitation, so it has to be on screen.
    const code = await host.locator('.room-code').innerText();
    expect(code).toMatch(/^[A-Z2-9]{5}$/);
    await expect(host.getByText('Waiting for your opponent')).toBeVisible();

    // The guest arrives by link and should land on the board, not the menu.
    const guest = await freshPlayer(two, 'Kofi');
    await guest.goto(`/?join=${code}`);

    await expect(host.locator('.board')).toBeVisible({ timeout: 15_000 });
    await expect(guest.locator('.board')).toBeVisible({ timeout: 15_000 });

    // Exactly one side may move, and it is the same side on both screens.
    const first = await mover(host, guest);
    const second = first === host ? guest : host;
    await expect(legalPits(second)).toHaveCount(0);
    await expect(first.locator('.turn-pill')).toContainText('Your Turn');

    // A move made on one screen shows up on the other, and hands the turn over.
    await legalPits(first).first().click();
    await expect(legalPits(second).first()).toBeVisible({ timeout: 15_000 });
    await expect(second.locator('.turn-pill')).toContainText('Your Turn');
    await expect(legalPits(first)).toHaveCount(0);

    // And back again, so this is a conversation rather than one lucky message.
    await legalPits(second).first().click();
    await expect(legalPits(first).first()).toBeVisible({ timeout: 15_000 });

    // Resigning ends the game on both screens at once, with the same winner.
    await first.getByRole('button', { name: /Resign/ }).click();
    await first.getByRole('button', { name: /Tap again to resign/ }).click();

    await expect(second.locator('.over-card')).toBeVisible({ timeout: 15_000 });
    await expect(second.locator('.over-title')).toContainText('You win');
    await expect(first.locator('.over-card')).toBeVisible();
    await expect(first.locator('.over-note')).toContainText('You resigned');
  } finally {
    await one.close();
    await two.close();
  }
});

test('a timed game shows both clocks, and the room keeps the creator\'s', async ({ browser }) => {
  const one = await browser.newContext();
  const two = await browser.newContext();

  try {
    const host = await freshPlayer(one, 'Ama');
    await host.goto('/');
    await host.getByText('PLAY ONLINE').click();
    await host.getByRole('radio', { name: /Blitz/ }).click();
    await expect(host.getByRole('radio', { name: /Blitz/ })).toHaveAttribute('aria-checked', 'true');
    await host.getByText('INVITE A FRIEND').click();
    await expect(host.getByText('Clock: Blitz 3+2')).toBeVisible();
    const code = await host.locator('.room-code').innerText();

    // The guest types the code rather than following the link, so names no
    // clock of their own — and still plays at the room's.
    const guest = await freshPlayer(two, 'Kofi');
    await guest.goto('/');
    await guest.getByText('PLAY ONLINE').click();
    await guest.getByRole('radio', { name: /Classic/ }).click();
    await guest.getByText('JOIN A GAME').click();
    await guest.getByLabel('Enter the code').fill(code);
    await guest.getByRole('button', { name: 'JOIN', exact: true }).click();

    await expect(host.locator('.board')).toBeVisible({ timeout: 15_000 });
    await expect(guest.locator('.board')).toBeVisible({ timeout: 15_000 });
    await expect(host.locator('.pcard-clock')).toHaveCount(2);
    await expect(guest.locator('.pcard-clock')).toHaveCount(2);
    // Three minutes each, give or take the second the page took to load.
    await expect(guest.locator('.pcard-clock').first()).toHaveText(/^(3:00|2:5\d)$/);

    // One clock runs: the one belonging to whoever is to move.
    const first = await mover(host, guest);
    await expect(first.locator('.pcard-you .pcard-clock-running')).toHaveCount(1);
    await expect(first.locator('.pcard-opp .pcard-clock-running')).toHaveCount(0);

    // A move hands it over.
    await legalPits(first).first().click();
    await expect(first.locator('.pcard-opp .pcard-clock-running')).toHaveCount(1, { timeout: 15_000 });
    await expect(first.locator('.pcard-you .pcard-clock-running')).toHaveCount(0);
  } finally {
    await one.close();
    await two.close();
  }
});

test('a reaction sent on one screen floats up on the other', async ({ browser }) => {
  const one = await browser.newContext();
  const two = await browser.newContext();

  try {
    const host = await freshPlayer(one, 'Ama');
    await host.goto('/');
    await host.getByText('PLAY ONLINE').click();
    await host.getByText('INVITE A FRIEND').click();
    const code = await host.locator('.room-code').innerText();
    const guest = await freshPlayer(two, 'Kofi');
    await guest.goto(`/?join=${code}`);
    await expect(host.locator('.board')).toBeVisible({ timeout: 15_000 });
    await expect(guest.locator('.board')).toBeVisible({ timeout: 15_000 });

    await host.getByRole('button', { name: 'Send a reaction' }).click();
    await host.getByRole('menuitem', { name: 'On fire' }).click();

    // On the guest's screen it rises from the opponent's card; on the host's,
    // from their own.
    await expect(guest.locator('.pcard-opp .react-bubble')).toHaveText('🔥', { timeout: 15_000 });
    await expect(host.locator('.pcard-you .react-bubble')).toHaveText('🔥');
    // And it goes away by itself.
    await expect(guest.locator('.react-bubble')).toHaveCount(0, { timeout: 5_000 });
  } finally {
    await one.close();
    await two.close();
  }
});

test('a game between two countries is a round of their rivalry', async ({ browser }) => {
  const one = await browser.newContext();
  const two = await browser.newContext();

  try {
    const host = await freshPlayer(one, 'Ama', 'CI');
    await host.goto('/');
    await host.getByText('PLAY ONLINE').click();
    await host.getByText('INVITE A FRIEND').click();
    const code = await host.locator('.room-code').innerText();

    const guest = await freshPlayer(two, 'Marie', 'FR');
    await guest.goto(`/?join=${code}`);
    await expect(host.locator('.board')).toBeVisible({ timeout: 15_000 });
    await expect(guest.locator('.board')).toBeVisible({ timeout: 15_000 });

    // Each side sees where the other plays from.
    await expect(host.getByText('🇫🇷 Marie').first()).toBeVisible();
    await expect(guest.getByText('🇨🇮 Ama').first()).toBeVisible();

    await host.getByRole('button', { name: /Resign/ }).click();
    await host.getByRole('button', { name: /Tap again to resign/ }).click();
    await expect(guest.locator('.over-card')).toBeVisible({ timeout: 15_000 });

    // The head-to-head the game just changed. Other runs share the dev
    // server, so the exact score is not asserted — only that it is there.
    await expect(guest.locator('.over-rivalry')).toContainText('All-time:', { timeout: 15_000 });

    // And the nations ranking has both countries on it, France ahead.
    await guest.getByText('BACK TO MENU').click();
    await guest.getByLabel('Stats').click();
    await guest.getByRole('tab', { name: 'Nations' }).click();
    await expect(guest.locator('.rec-row').filter({ hasText: 'France' })).toBeVisible();
    await expect(guest.locator('.rival-card')).toBeVisible();
  } finally {
    await one.close();
    await two.close();
  }
});

test('a room that already has two players turns a third away', async ({ browser }) => {
  const one = await browser.newContext();
  const two = await browser.newContext();
  const three = await browser.newContext();

  try {
    const host = await freshPlayer(one, 'Ama');
    await host.goto('/');
    await host.getByText('PLAY ONLINE').click();
    await host.getByText('INVITE A FRIEND').click();
    const code = await host.locator('.room-code').innerText();

    const guest = await freshPlayer(two, 'Kofi');
    await guest.goto(`/?join=${code}`);
    await expect(guest.locator('.board')).toBeVisible({ timeout: 15_000 });

    // A room code is the only key there is, so a shared link reaching a third
    // person must be a closed door rather than a hijacked seat.
    const gatecrasher = await freshPlayer(three, 'Nosy');
    await gatecrasher.goto(`/?join=${code}`);
    await expect(gatecrasher.getByText('already has two players')).toBeVisible({ timeout: 15_000 });
    await expect(gatecrasher.locator('.board')).toHaveCount(0);

    // And the real game is undisturbed.
    await expect(guest.locator('.board')).toBeVisible();
  } finally {
    await one.close();
    await two.close();
    await three.close();
  }
});

test('quick match pairs two strangers, even after one walks away', async ({ browser }, testInfo) => {
  // The matchmaker is one shared queue on the dev server, so two of these
  // running at once would pair across each other. The board layout is not what
  // is under test here, so one viewport is the right number.
  test.skip(testInfo.project.name !== 'desktop', 'one shared queue: run once');

  const contexts = await Promise.all([0, 1, 2].map(() => browser.newContext()));
  try {
    const [first, second, third] = await Promise.all(
      contexts.map((context, i) => freshPlayer(context, `Player ${i + 1}`)),
    );

    const askForAMatch = async (page: Page) => {
      await page.goto('/');
      await page.getByText('PLAY ONLINE').click();
      await page.getByText('QUICK MATCH').click();
    };

    // Someone asks for a match, then thinks better of it and closes the tab.
    // Their code is left in the queue, pointing at a room nobody is sitting in.
    await askForAMatch(first);
    await expect(first.locator('.room-code')).toBeVisible({ timeout: 15_000 });
    await first.close();

    // The next two must still find each other rather than each waiting alone in
    // a dead room — which is what happens if a stale code is trusted.
    await askForAMatch(second);
    await expect(second.locator('.room-code')).toBeVisible({ timeout: 15_000 });
    await askForAMatch(third);

    await expect(second.locator('.board')).toBeVisible({ timeout: 20_000 });
    await expect(third.locator('.board')).toBeVisible({ timeout: 20_000 });
  } finally {
    await Promise.all(contexts.map(context => context.close()));
  }
});
