// The translation tables.
//
// The type system already refuses a table with a missing key. What it cannot
// see is a key whose text lost a placeholder — a French `{name}` spelled
// `{nom}`, an Arabic line that dropped `{time}` — which renders as a literal
// brace, or as nothing, only in that one language. So every placeholder in
// English must appear in every other table, and no other.
import { en } from '../src/i18n/en.ts';
import { fr } from '../src/i18n/fr.ts';
import { pt } from '../src/i18n/pt.ts';
import { es } from '../src/i18n/es.ts';
import { ar } from '../src/i18n/ar.ts';
import { translate, isRtl, LANGUAGES } from '../src/i18n/index.ts';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) pass++;
  else { fail++; console.error(`FAIL ${name}`); }
}

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(',');
const tables = { fr, pt, es, ar } as Record<string, Record<string, string>>;

for (const [lang, table] of Object.entries(tables)) {
  const keys = Object.keys(table);
  ok(`${lang} has every key`, Object.keys(en).every(k => k in table));
  ok(`${lang} has no stray keys`, keys.every(k => k in en));
  for (const [key, text] of Object.entries(en)) {
    ok(`${lang} ${key}: same placeholders`, placeholders(table[key] ?? '') === placeholders(text));
    ok(`${lang} ${key}: not empty`, (table[key] ?? '').trim().length > 0);
  }
}

ok('every table is offered in the picker', LANGUAGES.map(l => l.code).join() === 'en,fr,pt,es,ar');
ok('only Arabic reads right to left', LANGUAGES.filter(l => isRtl(l.code)).map(l => l.code).join() === 'ar');
ok('placeholders are filled in every language',
  (['en', 'fr', 'pt', 'es', 'ar'] as const).every(l => translate(l, 'daily.title', { n: 7 }).includes('7')));

console.log(`i18n: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
