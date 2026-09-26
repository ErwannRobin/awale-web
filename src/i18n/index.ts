// Tiny translation layer. No dependency, no bundler magic: a key lookup plus
// {placeholder} substitution, with English as the fallback for anything a
// translation is missing.
import { en, type StringKey } from './en.ts';
import { fr } from './fr.ts';
import { pt } from './pt.ts';
import { es } from './es.ts';
import { ar } from './ar.ts';
import type { Language } from '../lib/settings.ts';

export type { StringKey };

const TABLES: Record<Language, Record<StringKey, string>> = { en, fr, pt, es, ar };

/** Each language named in itself, so a player can find their own. */
export const LANGUAGES: { code: Language; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'fr', label: 'Français' },
  { code: 'pt', label: 'Português' },
  { code: 'es', label: 'Español' },
  { code: 'ar', label: 'العربية' },
];

/**
 * Written right to left. The page flips for these — but never the board,
 * whose pits must keep reading counterclockwise (see lib/layout.ts).
 */
export const isRtl = (lang: Language): boolean => lang === 'ar';

export type Params = Record<string, string | number>;

export function translate(lang: Language, key: StringKey, params?: Params): string {
  const template = TABLES[lang]?.[key] ?? en[key] ?? key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    (name in params ? String(params[name]) : whole));
}

export type Translate = (key: StringKey, params?: Params) => string;

export const translatorFor = (lang: Language): Translate =>
  (key, params) => translate(lang, key, params);
