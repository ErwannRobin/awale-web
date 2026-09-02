// Tiny translation layer. No dependency, no bundler magic: a key lookup plus
// {placeholder} substitution, with English as the fallback for anything a
// translation is missing.
import { en, type StringKey } from './en.ts';
import { fr } from './fr.ts';
import type { Language } from '../lib/settings.ts';

export type { StringKey };

const TABLES: Record<Language, Record<StringKey, string>> = { en, fr };

export const LANGUAGES: { code: Language; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'fr', label: 'Français' },
];

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
