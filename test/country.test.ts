// Countries: the code list, the profile field that holds one, and the counters
// the world table is made of.
//
// The assertion that matters most is the last block: changing country must not
// move a single game that has already been played. Everything else here is the
// usual defence against a corrupt blob in storage.
import {
  COUNTRY_CODES, countriesByName, countryFlag, countryName,
  isCountryCode, normaliseCountry, UNKNOWN_COUNTRY,
} from '../src/lib/country.ts';
import {
  addCountryGame, addGame, addHeadToHead, addPvpMatch, aiWinRate, coerceHeadToHead,
  coerceTable, coerceTally, emptyTally, findRival, nationPoints, rankCountries,
  rankNations, rivalriesOf, rivalryKey, sanitiseLevel, sanitiseOutcome,
  type CountryTally, type HeadToHead,
} from '../src/lib/countryStats.ts';
import {
  applyDetectedCountry, chooseCountry, defaultProfile, loadProfile, saveProfile,
} from '../src/lib/profile.ts';
import { applyResult, emptyStats } from '../src/lib/stats.ts';
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

function memory(): KeyValueStore {
  const m = new Map<string, string>();
  return { get: k => m.get(k) ?? null, set: (k, v) => { m.set(k, v); }, remove: k => { m.delete(k); } };
}
setStore(memory());

// ---- the code list --------------------------------------------------------
ok('the list is a set', new Set(COUNTRY_CODES).size === COUNTRY_CODES.length);
ok('every code is two upper-case letters', COUNTRY_CODES.every(c => /^[A-Z]{2}$/.test(c)));
ok('ZZ is not a country', !isCountryCode(UNKNOWN_COUNTRY));
ok('a real code is one', isCountryCode('CI') && isCountryCode('fr'));
ok('nonsense is not', !isCountryCode('') && !isCountryCode('FRA') && !isCountryCode(42));

eq('lower case normalises up', normaliseCountry('ci'), 'CI');
eq('whitespace is trimmed', normaliseCountry(' GH '), 'GH');
eq('an unknown code lands in ZZ', normaliseCountry('XX'), UNKNOWN_COUNTRY);
eq('so does nothing at all', normaliseCountry(null), UNKNOWN_COUNTRY);

eq('the flag is built from the code', countryFlag('FR'), '🇫🇷');
eq('an unknown code gets the globe', countryFlag('ZZ'), '🌍');
ok('a name comes back for a real code', countryName('FR', 'en').length > 0);
eq('and nothing for one that is not', countryName('ZZ', 'en'), '');
ok('the picker lists every country', countriesByName('en').length === COUNTRY_CODES.length);

// The original counters — games and levels — are what most of these assert on;
// the outcome and online fields get their own block further down.
const slim = (t: CountryTally | undefined) => (t ? { games: t.games, byLevel: t.byLevel } : t);

// ---- the counters ---------------------------------------------------------
eq('an empty tally has a slot per level', slim(emptyTally()), { games: 0, byLevel: [0, 0, 0, 0] });
eq('a game lands on its level', slim(addGame(emptyTally(), 2)), { games: 1, byLevel: [0, 0, 1, 0] });
eq('a level out of range is clamped', slim(addGame(emptyTally(), 99)), { games: 1, byLevel: [0, 0, 0, 1] });
eq('so is a negative one', sanitiseLevel(-4), 0);
eq('and so is nonsense', sanitiseLevel('boom'), 0);

eq('a corrupt tally rebuilds as empty', coerceTally({ games: 'many', byLevel: 'no' }), emptyTally());
eq('a negative count reads as zero', slim(coerceTally({ games: -3, byLevel: [-1, 2] })),
   { games: 0, byLevel: [0, 2, 0, 0] });

{
  let table: Record<string, ReturnType<typeof emptyTally>> = {};
  table = addCountryGame(table, 'CI', 0);
  table = addCountryGame(table, 'CI', 3);
  table = addCountryGame(table, 'FR', 3);
  table = addCountryGame(table, 'nowhere', 1);
  eq('games pile up per country', slim(table.CI), { games: 2, byLevel: [1, 0, 0, 1] });
  eq('an unknown country is a real bucket', slim(table.ZZ), { games: 1, byLevel: [0, 1, 0, 0] });

  const ranked = rankCountries(table);
  eq('busiest first, then alphabetical', ranked.map(r => r.code), ['CI', 'FR', 'ZZ']);
  eq('every game is still counted', ranked.reduce((n, r) => n + r.games, 0), 4);
}

eq('two spellings of one country merge',
   slim(coerceTable({ ci: { games: 1, byLevel: [1, 0, 0, 0] }, CI: { games: 2, byLevel: [0, 2, 0, 0] } }).CI),
   { games: 3, byLevel: [1, 2, 0, 0] });
eq('a table that is not an object is empty', coerceTable('nope'), {});

// ---- the profile field ----------------------------------------------------
eq('a fresh profile has no country', defaultProfile().country, UNKNOWN_COUNTRY);
eq('and is open to detection', defaultProfile().countrySource, 'auto');

{
  const detected = applyDetectedCountry(defaultProfile(), 'SN');
  eq('detection fills an empty profile', [detected.country, detected.countrySource], ['SN', 'auto']);

  const moved = applyDetectedCountry(detected, 'FR');
  eq('and corrects itself when the player travels', moved.country, 'FR');

  const chosen = chooseCountry(moved, 'CI');
  eq('a choice is honoured', [chosen.country, chosen.countrySource], ['CI', 'manual']);
  const overridden = applyDetectedCountry(chosen, 'FR');
  eq('and detection never overrides it again', overridden.country, 'CI');

  eq('a choice survives a reload', loadProfile().country, 'CI');
  eq('garbage detection is ignored', applyDetectedCountry(chosen, 'XX').country, 'CI');
}

{
  // A profile written before countries existed.
  saveProfile(defaultProfile());
  const legacy = { name: 'Ama', avatar: 'plum' };
  const store = memory();
  store.set('awale.profile.v1', JSON.stringify(legacy));
  setStore(store);
  const loaded = loadProfile();
  eq('an old profile keeps its name', loaded.name, 'Ama');
  eq('and is unset but detectable', [loaded.country, loaded.countrySource], [UNKNOWN_COUNTRY, 'auto']);
  setStore(memory());
}

// ---- a game keeps the country it was played under -------------------------
{
  const base = { outcome: 'win' as const, you: 30, them: 18 };
  const one = applyResult(emptyStats(), { ...base, level: 1, country: 'CI', at: 1 });
  const two = applyResult(one, { ...base, level: 3, country: 'CI', at: 2 });
  // The player moves to France, and plays one more game there.
  const three = applyResult(two, { ...base, level: 3, country: 'FR', at: 3 });

  eq('the old country keeps its games', slim(three.byCountry.CI), { games: 2, byLevel: [0, 1, 0, 1] });
  eq('the new one starts from the new game', slim(three.byCountry.FR), { games: 1, byLevel: [0, 0, 0, 1] });
  eq('the totals still add up', three.games,
     three.byCountry.CI.games + three.byCountry.FR.games);
  eq('and so do the per-level totals',
     three.byLevel.map(l => l.games),
     [0, 1, 0, 2]);
  eq('each record remembers where it was played',
     three.history.map(r => r.country), ['FR', 'CI', 'CI']);

  const nowhere = applyResult(emptyStats(), { ...base, level: 0, at: 4 });
  eq('a game with no country is still counted', slim(nowhere.byCountry.ZZ),
     { games: 1, byLevel: [1, 0, 0, 0] });
}

// ---- outcomes against the AI ------------------------------------------------
{
  let t = emptyTally();
  t = addGame(t, 3, 'win');
  t = addGame(t, 3, 'loss');
  t = addGame(t, 3, 'draw');
  t = addGame(t, 0, 'win');
  t = addGame(t, 1); // an older client: a level and nothing else
  eq('outcomes land on their level', [t.wins, t.losses, t.draws],
     [[1, 0, 0, 1], [0, 0, 0, 1], [0, 0, 0, 1]]);
  eq('a game with no outcome still counts as played', t.games, 5);
  eq('the win rate is over known outcomes only', aiWinRate(t), 50);
  eq('and per level', aiWinRate(t, 3), 33);
  eq('a level nobody finished is 0, not NaN', aiWinRate(t, 2), 0);
  eq('an outcome that is not one is dropped', sanitiseOutcome('victory'), null);
  eq('an old stored tally reads with empty outcomes',
     coerceTally({ games: 2, byLevel: [2, 0, 0, 0] }).wins, [0, 0, 0, 0]);
}

// ---- online, between countries ----------------------------------------------
{
  let table: Record<string, CountryTally> = {};
  table = addPvpMatch(table, 'FR', 'CI', 'a');
  table = addPvpMatch(table, 'CI', 'FR', 'a');
  table = addPvpMatch(table, 'CI', 'FR', 'draw');
  table = addPvpMatch(table, 'SN', 'SN', 'b');
  eq('a win abroad is a win for one and a loss for the other',
     [table.FR.pvp.wins, table.FR.pvp.losses, table.CI.pvp.wins, table.CI.pvp.losses], [1, 1, 1, 1]);
  eq('a draw abroad is a draw for both', [table.FR.pvp.draws, table.CI.pvp.draws], [1, 1]);
  eq('a derby is played, not won', table.SN.pvp, { games: 1, wins: 0, losses: 0, draws: 0, internal: 1 });
  eq('nation points: 3 a win, 1 a draw', nationPoints(table.FR.pvp), 4);
  eq('online games leave the AI counters alone', table.FR.games, 0);
  ok('a country with only online games is still ranked',
     rankCountries(table).some(r => r.code === 'SN'));
}

// ---- head to head -----------------------------------------------------------
{
  eq('a pair has one key, whichever way round', [rivalryKey('FR', 'CI'), rivalryKey('ci', 'fr')], ['CI-FR', 'CI-FR']);
  eq('no rivalry with yourself', rivalryKey('FR', 'FR'), null);
  eq('nor with nowhere', rivalryKey('FR', 'XX'), null);

  let h: HeadToHead | null = null;
  h = addHeadToHead(h, 'FR', 'CI', 'a');   // France wins
  h = addHeadToHead(h, 'FR', 'CI', 'a');   // France again
  h = addHeadToHead(h, 'CI', 'FR', 'a');   // Côte d'Ivoire, listed first this time
  h = addHeadToHead(h, 'CI', 'FR', 'draw');
  eq('the row is stored sorted and counts the right side',
     h, { a: 'CI', b: 'FR', games: 4, aWins: 1, bWins: 2, draws: 1 });
  eq('a stored row survives a round trip', coerceHeadToHead(JSON.parse(JSON.stringify(h))), h);
  eq('garbage is not a rivalry', coerceHeadToHead({ a: 'FR', b: 'FR' }), null);
  eq('seen from France', rivalriesOf([h!], 'FR'),
     [{ opponent: 'CI', games: 4, wins: 2, losses: 1, draws: 1 }]);
  eq('seen from somewhere else, nothing', rivalriesOf([h!], 'SN'), []);
}

// ---- the nations ranking and the rival ------------------------------------
{
  let table: Record<string, CountryTally> = {};
  for (let i = 0; i < 3; i++) table = addPvpMatch(table, 'CI', 'FR', 'a');    // CI 9
  table = addPvpMatch(table, 'FR', 'SN', 'a');                                // FR 3
  table = addPvpMatch(table, 'SN', 'GH', 'draw');                             // SN 1, GH 1
  table = addCountryGame(table, 'ZZ', 0, 'win');
  const nations = rankNations(rankCountries(table), [
    { code: 'GH', players: 5, avgRating: 1250, topRating: 1400, topPlayer: { userId: 'u1', name: 'Kofi' } },
    { code: 'ZZ', players: 9, avgRating: 1000, topRating: 1000, topPlayer: null },
  ]);
  eq('ranked by points, then by players', nations.map(n => n.code), ['CI', 'FR', 'GH', 'SN']);
  eq('unknown is never a nation', nations.some(n => n.code === 'ZZ'), false);
  eq('positions follow the order', nations.map(n => n.position), [1, 2, 3, 4]);
  eq('the people half is merged in', nations[2].topPlayer?.name, 'Kofi');

  eq('chasing: the rival is the nation above', findRival(nations, 'FR'),
     { nation: nations[0], gap: 6, ahead: true });
  eq('leading: the rival is the nation below', findRival(nations, 'CI'),
     { nation: nations[1], gap: 6, ahead: false });
  eq('level: a gap of nothing', findRival(nations, 'SN')?.gap, 0);
  eq('not on the board: chase the last nation that scored', findRival(nations, 'JP')?.nation.code, 'SN');
  eq('no country, no rival', findRival(nations, 'ZZ'), null);
}

console.log(`${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
