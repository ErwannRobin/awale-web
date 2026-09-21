// The pure state modules: rating maths, settings/stats/profile validation, and
// the save slot. All of these read user-editable JSON out of storage, so the
// point of most of these assertions is that a corrupt blob degrades to defaults
// instead of blanking the app.
import {
  emptyStats, applyResult, expectedScore, suggestedLevel, rankFor, winRate,
  LEVEL_RATING, START_RATING,
} from '../src/lib/stats.ts';
import { setStore, type KeyValueStore } from '../src/lib/storage.ts';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else { fail++; console.error(`FAIL ${name}`); }
}
function eq(name: string, got: unknown, want: unknown) {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a === b) pass++;
  else { fail++; console.error(`FAIL ${name}\n  got  ${a}\n  want ${b}`); }
}

// A fake store, so these tests never touch a real localStorage.
function memory(): KeyValueStore {
  const m = new Map<string, string>();
  return { get: k => m.get(k) ?? null, set: (k, v) => { m.set(k, v); }, remove: k => { m.delete(k); } };
}
setStore(memory());

// ---- Elo ----------------------------------------------------------------
ok('equal ratings expect a draw', Math.abs(expectedScore(1200, 1200) - 0.5) < 1e-9);
ok('a stronger player expects more', expectedScore(1400, 1200) > 0.5);
ok('expectation stays inside [0,1]',
   expectedScore(0, 3000) > 0 && expectedScore(3000, 0) < 1);

{
  const s0 = emptyStats();
  const win = applyResult(s0, { level: 3, outcome: 'win', you: 30, them: 18, at: 1 });
  ok('beating the top level raises the rating', win.rating > s0.rating);
  eq('a win counts once', [win.games, win.wins, win.losses, win.draws], [1, 1, 0, 0]);
  eq('per-level tally follows', win.byLevel[3], { games: 1, wins: 1, losses: 0, draws: 0 });
  eq('streak starts', [win.streak, win.bestStreak], [1, 1]);
  eq('margin recorded', win.bestMargin, 12);
  eq('seeds accumulate', win.seedsCaptured, 30);
  eq('history keeps the game', win.history.length, 1);
  ok('peak tracks the rating', win.peakRating === win.rating);

  const loss = applyResult(win, { level: 0, outcome: 'loss', you: 10, them: 30, at: 2 });
  ok('losing to the weakest level costs a lot', win.rating - loss.rating > 15);
  eq('a loss breaks the streak', loss.streak, 0);
  eq('best streak is remembered', loss.bestStreak, 1);
  ok('peak survives a loss', loss.peakRating === win.rating);
  eq('best margin survives a loss', loss.bestMargin, 12);

  const draw = applyResult(loss, { level: 1, outcome: 'draw', you: 24, them: 24, at: 3 });
  eq('draws are counted', draw.draws, 1);
  eq('history is newest first', draw.history[0].at, 3);
}

// A long unbeaten run must not overflow the capped history.
{
  let s = emptyStats();
  for (let i = 0; i < 80; i++) s = applyResult(s, { level: 2, outcome: 'win', you: 26, them: 22, at: i });
  eq('history is capped', s.history.length, 50);
  eq('games are not', s.games, 80);
  eq('streak counts them all', s.streak, 80);
}

ok('win rate of an unplayed record is 0', winRate({ games: 0, wins: 0 }) === 0);
eq('win rate rounds', winRate({ games: 3, wins: 2 }), 67);

// ---- matchmaking + ranks -------------------------------------------------
eq('a beginner is matched with Novice', suggestedLevel(500), 0);
eq('a strong player is matched with Master', suggestedLevel(2000), 3);
eq('exact level rating matches its level', suggestedLevel(LEVEL_RATING[2]), 2);
ok('the starting rating maps to a real rank', rankFor(START_RATING).tier.key.startsWith('rank.'));
ok('the top rank has no next', rankFor(9999).next === null);
ok('the bottom rank has a next', rankFor(0).next !== null);

// ---- settings validation -------------------------------------------------
{
  const store = memory();
  setStore(store);
  store.set('awale.settings.v1', '{"theme":"neon","speed":42,"sound":"yes","language":"de"}');
  // Import after the store is primed: settings cache on first read.
  const mod = await import('../src/lib/settings.ts?fresh-settings');
  const s = mod.getSettings();
  eq('a bogus theme falls back', s.theme, 'wood');
  eq('a bogus speed falls back', s.speed, 'normal');
  eq('a bogus sound flag falls back', s.sound, true);
  ok('a bogus language falls back to a real one', s.language === 'en' || s.language === 'fr');
}

// ---- saved game validation ----------------------------------------------
{
  const store = memory();
  setStore(store);
  const mod = await import('../src/lib/saveGame.ts?fresh-save');

  eq('no save means nothing to resume', mod.loadSavedGame(), null);

  store.set('awale.savedgame.v1', JSON.stringify({
    mode: 'ai', level: 2, pits: Array(12).fill(4), scores: [0, 0], turn: 0, history: [],
  }));
  ok('a valid save loads', mod.loadSavedGame() !== null);

  // 48 seeds, always — a blob that does not add up is corrupt, not a game.
  store.set('awale.savedgame.v1', JSON.stringify({
    mode: 'ai', level: 2, pits: Array(12).fill(5), scores: [0, 0], turn: 0, history: [],
  }));
  eq('a save that loses seeds is rejected', mod.loadSavedGame(), null);

  store.set('awale.savedgame.v1', JSON.stringify({
    mode: 'online', level: 2, pits: Array(12).fill(4), scores: [0, 0], turn: 0, history: [],
  }));
  eq('an unknown mode is rejected', mod.loadSavedGame(), null);

  store.set('awale.savedgame.v1', 'not json at all');
  eq('garbage is rejected', mod.loadSavedGame(), null);
}

// ---- profile -------------------------------------------------------------
{
  const store = memory();
  setStore(store);
  const mod = await import('../src/lib/profile.ts?fresh-profile');
  eq('whitespace is collapsed and trimmed', mod.sanitiseName('  Ama   Serwaa  '), 'Ama Serwaa');
  eq('long names are capped', mod.sanitiseName('x'.repeat(80)).length, mod.NAME_MAX);
  store.set('awale.profile.v1', '{"name":42,"avatar":"rainbow"}');
  eq('a bogus profile falls back', mod.loadProfile(),
     { name: '', avatar: 'clay', country: 'ZZ', countrySource: 'auto' });
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
