import type { Translate } from '../i18n/index.ts';
import { countryName, UNKNOWN_COUNTRY } from '../lib/country.ts';

/** A country's name in the UI language, or the "no country" label. */
export function countryLabel(code: string, t: Translate, locale: string): string {
  return code === UNKNOWN_COUNTRY ? t('stats.countryUnknown') : countryName(code, locale) || code;
}
