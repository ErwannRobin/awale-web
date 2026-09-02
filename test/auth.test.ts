// Signing in, without a phone.
//
// Everything that decides whether somebody is who they say they are lives in
// `src/lib/authCore.ts` and is pure, so it can be tested for real rather than
// mocked: a token either verifies under the right key or it does not, and a
// webhook signature either matches the body or it does not.
//
// The parts that are not here are the parts that are not ours — phone-verif's
// own answers. What is here is every decision the game makes about them.
import assert from 'node:assert/strict';
import {
  SESSION_TTL_MS, UPSTREAM_MIN_GAP_MS, VERIFICATION_TTL_MS,
  base64UrlDecode, base64UrlEncode, claimsFor, cleanDisplayName, isStale, markPolled, mintToken,
  newVerification, peekClaims, readToken, settle, shouldPollUpstream, signingKey, verifyWebhook,
} from '../src/lib/authCore.ts';
import { QUIET_ZONE, encodeQr } from '../src/lib/qr.ts';

let passed = 0;
const failures: string[] = [];

async function check(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (error) {
    failures.push(name);
    console.log(`  FAIL ${name}`);
    console.log(String(error));
  }
}

const KEY_A = 'phone-verif-api-key-aaaaaaaaaaaaaaaa';
const KEY_B = 'phone-verif-api-key-bbbbbbbbbbbbbbbb';

console.log('base64url');

await check('round trips bytes that standard base64 would pad', () => {
  for (const length of [0, 1, 2, 3, 16, 31, 32]) {
    const bytes = new Uint8Array(length);
    for (let i = 0; i < length; i++) bytes[i] = (i * 37) % 256;
    const text = base64UrlEncode(bytes);
    assert.equal(/[+/=]/.test(text), false, 'no padding or url-hostile characters');
    assert.deepEqual(base64UrlDecode(text), bytes);
  }
});

await check('refuses to decode nonsense rather than returning junk', () => {
  assert.equal(base64UrlDecode('!!!!'), null);
});

console.log('');
console.log('session tokens');

await check('a freshly minted token reads back with its claims', async () => {
  const key = await signingKey(KEY_A);
  const now = Date.now();
  const token = await mintToken(claimsFor('user-1', 'Ama', now), key);

  const result = await readToken(token, key, now + 1000);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.claims.sub, 'user-1');
  assert.equal(result.claims.name, 'Ama');
  assert.equal(result.claims.exp, now + SESSION_TTL_MS);
});

await check('a token signed with another key is not accepted', async () => {
  const token = await mintToken(claimsFor('user-1', 'Ama'), await signingKey(KEY_A));
  const result = await readToken(token, await signingKey(KEY_B));
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, 'bad-signature');
});

await check('rotating the API key invalidates every session', async () => {
  // The signing key is derived from the API key, so this is the same property
  // as above stated the way an operator would meet it.
  const before = await signingKey(KEY_A);
  const after = await signingKey(KEY_B);
  const token = await mintToken(claimsFor('user-1', 'Ama'), before);
  assert.equal((await readToken(token, after)).ok, false);
});

await check('the same secret always derives the same key', async () => {
  const token = await mintToken(claimsFor('user-1', 'Ama'), await signingKey(KEY_A));
  // A second Worker instance, deriving the key again from the same secret.
  assert.equal((await readToken(token, await signingKey(KEY_A))).ok, true);
});

await check('editing the payload breaks the signature', async () => {
  const key = await signingKey(KEY_A);
  const token = await mintToken(claimsFor('user-1', 'Ama'), key);
  const [version, payload, signature] = token.split('.');

  // Somebody promoting themselves by hand: same shape, different subject.
  const forged = JSON.parse(
    new TextDecoder().decode(base64UrlDecode(payload)!),
  ) as Record<string, unknown>;
  forged.sub = 'somebody-else';
  const swapped = base64UrlEncode(new TextEncoder().encode(JSON.stringify(forged)));

  const result = await readToken(`${version}.${swapped}.${signature}`, key);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, 'bad-signature');
});

await check('an expired token is refused even though it is genuine', async () => {
  const key = await signingKey(KEY_A);
  const now = Date.now();
  const token = await mintToken(claimsFor('user-1', 'Ama', now), key);
  const result = await readToken(token, key, now + SESSION_TTL_MS + 1);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, 'expired');
});

await check('a malformed token is rejected rather than guessed at', async () => {
  const key = await signingKey(KEY_A);
  for (const bad of ['', 'nonsense', 'v1.only-two', 'v2.a.b', 'v1.!!!.!!!']) {
    const result = await readToken(bad, key);
    assert.equal(result.ok, false, bad);
    if (!result.ok) assert.equal(result.reason, 'malformed', bad);
  }
});

await check('peeking reads the claims but proves nothing', async () => {
  const token = await mintToken(claimsFor('user-1', 'Ama'), await signingKey(KEY_A));
  assert.equal(peekClaims(token)?.sub, 'user-1');

  // The point of the warning on `peekClaims`: it reads an unsigned token too,
  // which is exactly why the browser may not authorise anything with it.
  const home = base64UrlEncode(
    new TextEncoder().encode(JSON.stringify({ sub: 'admin', name: 'x', iat: 0, exp: 2e12 })),
  );
  assert.equal(peekClaims(`v1.${home}.not-a-signature`)?.sub, 'admin');
  assert.equal((await readToken(`v1.${home}.not-a-signature`, await signingKey(KEY_A))).ok, false);
});

console.log('');
console.log('webhooks');

const SECRET = 'webhook-secret-value';

async function sign(body: string, secret = SECRET): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return 'sha256=' + Array.from(new Uint8Array(mac), b => b.toString(16).padStart(2, '0')).join('');
}

await check('a correctly signed webhook is accepted', async () => {
  const body = JSON.stringify({ event: 'verification_success', session_id: 's1', user_id: 'u1' });
  assert.equal(await verifyWebhook(body, await sign(body), SECRET), true);
});

await check('the header is read with or without the sha256= prefix', async () => {
  const body = '{"event":"verification_success"}';
  const header = await sign(body);
  assert.equal(await verifyWebhook(body, header.slice('sha256='.length), SECRET), true);
});

await check('a body changed after signing is rejected', async () => {
  const body = JSON.stringify({ event: 'verification_success', user_id: 'u1' });
  const header = await sign(body);
  const tampered = JSON.stringify({ event: 'verification_success', user_id: 'someone-else' });
  assert.equal(await verifyWebhook(tampered, header, SECRET), false);
});

await check('an unsigned or wrongly signed webhook is rejected', async () => {
  const body = '{"event":"verification_success"}';
  assert.equal(await verifyWebhook(body, null, SECRET), false);
  assert.equal(await verifyWebhook(body, 'sha256=', SECRET), false);
  assert.equal(await verifyWebhook(body, 'sha256=zzzz', SECRET), false);
  assert.equal(await verifyWebhook(body, await sign(body, 'wrong-secret'), SECRET), false);
  // No secret configured must fail closed, not wave everything through.
  assert.equal(await verifyWebhook(body, await sign(body), ''), false);
});

console.log('');
console.log('verification sessions');

await check('a new session starts pending and knows nobody', () => {
  const record = newVerification('s1', 1000);
  assert.equal(record.status, 'pending');
  assert.equal(record.userId, null);
  assert.equal(record.settledAt, null);
});

await check('verifying records the user and the fact they are new', () => {
  const record = settle(
    newVerification('s1', 1000), { status: 'verified', userId: 'u1', isNewUser: true }, 2000,
  );
  assert.equal(record.status, 'verified');
  assert.equal(record.userId, 'u1');
  assert.equal(record.isNewUser, true);
  assert.equal(record.settledAt, 2000);
});

await check('a webhook and a poll in either order reach the same answer', () => {
  const start = newVerification('s1', 1000);
  const webhookFirst = settle(
    settle(start, { status: 'verified', userId: 'u1' }, 2000),
    { status: 'verified', userId: 'u1' }, 3000,
  );
  const pollFirst = settle(
    settle(start, { status: 'verified', userId: 'u1' }, 3000),
    { status: 'verified', userId: 'u1' }, 2000,
  );
  assert.equal(webhookFirst.status, pollFirst.status);
  assert.equal(webhookFirst.userId, pollFirst.userId);
});

await check('a later failure cannot un-verify somebody already playing', () => {
  const verified = settle(newVerification('s1', 1000), { status: 'verified', userId: 'u1' }, 2000);
  assert.equal(settle(verified, { status: 'failed' }, 3000).status, 'verified');
  assert.equal(settle(verified, { status: 'expired' }, 3000).status, 'verified');
});

await check('"verified, but we were not told who" is not a verification', () => {
  const record = settle(newVerification('s1', 1000), { status: 'verified', userId: null }, 2000);
  assert.equal(record.status, 'pending');
  assert.equal(record.userId, null);
});

await check('a sign-in nobody finished goes stale, and a finished one never does', () => {
  const pending = newVerification('s1', 1000);
  assert.equal(isStale(pending, 1000 + VERIFICATION_TTL_MS - 1), false);
  assert.equal(isStale(pending, 1000 + VERIFICATION_TTL_MS + 1), true);

  const verified = settle(pending, { status: 'verified', userId: 'u1' }, 2000);
  assert.equal(isStale(verified, 1000 + VERIFICATION_TTL_MS + 1), false);
});

console.log('');
console.log('asking phone-verif no more often than we have to');

await check('the first poll goes upstream', () => {
  assert.equal(shouldPollUpstream(newVerification('s1', 1000), 1000), true);
});

await check('polls inside the window are answered from the record', () => {
  const record = markPolled(newVerification('s1', 1000), 1000);
  // A browser polling every two seconds, or three tabs polling at once, must
  // not become three calls to a service that answers a flood with a 429.
  assert.equal(shouldPollUpstream(record, 1000 + UPSTREAM_MIN_GAP_MS - 1), false);
  assert.equal(shouldPollUpstream(record, 1000 + UPSTREAM_MIN_GAP_MS), true);
});

await check('a settled or stale session is never polled again', () => {
  const verified = settle(newVerification('s1', 1000), { status: 'verified', userId: 'u1' }, 2000);
  assert.equal(shouldPollUpstream(verified, 1e12), false);

  const abandoned = newVerification('s2', 1000);
  assert.equal(shouldPollUpstream(abandoned, 1000 + VERIFICATION_TTL_MS + 1), false);
});

await check('settling keeps the poll clock, so a webhook cannot reopen the tap', () => {
  const polled = markPolled(newVerification('s1', 1000), 1500);
  const next = settle(polled, { status: 'pending' }, 1600);
  assert.equal(next.polledAt, 1500);
});

console.log('');
console.log('QR codes');

await check('a link encodes to a square grid with its quiet zone', () => {
  const link = 'https://wa.me/1234567890?text=Verification%20token%3A%20%5Bi2vzxv%5D';
  const qr = encodeQr(link);
  // Versions are 21, 25, 29 … modules, always odd, plus the border either side.
  const modules = qr.size - QUIET_ZONE * 2;
  assert.equal(modules >= 21, true);
  assert.equal((modules - 21) % 4, 0, 'a real QR version');
  assert.equal(qr.path.length > 0, true);
});

await check('the same text always draws the same code', () => {
  assert.equal(encodeQr('https://wa.me/1').path, encodeQr('https://wa.me/1').path);
  assert.notEqual(encodeQr('https://wa.me/1').path, encodeQr('https://wa.me/2').path);
});

await check('a longer link grows the code rather than losing the end of it', () => {
  const short = encodeQr('https://wa.me/1');
  const long = encodeQr('https://wa.me/1?text=' + 'x'.repeat(300));
  assert.equal(long.size > short.size, true);
});

await check('the finder patterns are where a scanner looks for them', () => {
  // Top-left finder: a 7x7 ring. If this is right the grid is oriented and
  // offset correctly, which is the part a hand-written path can get wrong.
  const qr = encodeQr('https://wa.me/1234567890');
  const dark = new Set<string>();
  for (const [, x, y] of qr.path.matchAll(/M(\d+) (\d+)h1v1h-1z/g)) dark.add(`${x},${y}`);

  const q = QUIET_ZONE;
  for (let i = 0; i < 7; i++) {
    assert.equal(dark.has(`${q + i},${q}`), true, `top edge at ${i}`);
    assert.equal(dark.has(`${q},${q + i}`), true, `left edge at ${i}`);
  }
  // The ring's white gap, one module in from the edge.
  assert.equal(dark.has(`${q + 1},${q + 1}`), false);
  // And the solid 3x3 core.
  assert.equal(dark.has(`${q + 3},${q + 3}`), true);
});

console.log('');
console.log('display names');

await check('a name is stripped, collapsed and capped', () => {
  assert.equal(cleanDisplayName('  Kofi   Mensah  '), 'Kofi Mensah');
  assert.equal(cleanDisplayName('x'.repeat(50)).length, 20);
  assert.equal(cleanDisplayName('Ama '), 'Ama');
  assert.equal(cleanDisplayName('   ', 'fallback'), 'fallback');
  assert.equal(cleanDisplayName(42, 'fallback'), 'fallback');
});

console.log('');
if (failures.length > 0) {
  console.log(`${passed} passed, ${failures.length} failed`);
  for (const name of failures) console.log(`  - ${name}`);
  process.exit(1);
}
console.log(`${passed} passed, 0 failed`);
