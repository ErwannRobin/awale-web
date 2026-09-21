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
  addCountryGame, addGame, coerceTable, coerceTally, emptyTally,
  rankCountries, sanitiseLevel,
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

// ---- the counters ---------------------------------------------------------
eq('an empty tally has a slot per level', emptyTally(), { games: 0, byLevel: [0, 0, 0, 0] });
eq('a game lands on its level', addGame(emptyTally(), 2), { games: 1, byLevel: [0, 0, 1, 0] });
eq('a level out of range is clamped', addGame(emptyTally(), 99), { games: 1, byLevel: [0, 0, 0, 1] });
eq('so is a negative one', sanitiseLevel(-4), 0);
eq('and so is nonsense', sanitiseLevel('boom'), 0);

eq('a corrupt tally rebuilds as empty', coerceTally({ games: 'many', byLevel: 'no' }), emptyTally());
eq('a negative count reads as zero', coerceTally({ games: -3, byLevel: [-1, 2] }),
   { games: 0, byLevel: [0, 2, 0, 0] });

{
  let table: Record<string, ReturnType<typeof emptyTally>> = {};
  table = addCountryGame(table, 'CI', 0);
  table = addCountryGame(table, 'CI', 3);
  table = addCountryGame(table, 'FR', 3);
  table = addCountryGame(table, 'nowhere', 1);
  eq('games pile up per country', table.CI, { games: 2, byLevel: [1, 0, 0, 1] });
  eq('an unknown country is a real bucket', table.ZZ, { games: 1, byLevel: [0, 1, 0, 0] });

  const ranked = rankCountries(table);
  eq('busiest first, then alphabetical', ranked.map(r => r.code), ['CI', 'FR', 'ZZ']);
  eq('every game is still counted', ranked.reduce((n, r) => n + r.games, 0), 4);
}

eq('two spellings of one country merge',
   coerceTable({ ci: { games: 1, byLevel: [1, 0, 0, 0] }, CI: { games: 2, byLevel: [0, 2, 0, 0] } }),
   { CI: { games: 3, byLevel: [1, 2, 0, 0] } });
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

  eq('the old country keeps its games', three.byCountry.CI, { games: 2, byLevel: [0, 1, 0, 1] });
  eq('the new one starts from the new game', three.byCountry.FR, { games: 1, byLevel: [0, 0, 0, 1] });
  eq('the totals still add up', three.games,
     three.byCountry.CI.games + three.byCountry.FR.games);
  eq('and so do the per-level totals',
     three.byLevel.map(l => l.games),
     [0, 1, 0, 2]);
  eq('each record remembers where it was played',
     three.history.map(r => r.country), ['FR', 'CI', 'CI']);

  const nowhere = applyResult(emptyStats(), { ...base, level: 0, at: 4 });
  eq('a game with no country is still counted', nowhere.byCountry.ZZ,
     { games: 1, byLevel: [1, 0, 0, 0] });
}

console.log(`${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
