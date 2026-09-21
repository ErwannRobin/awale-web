// Which country a player counts for.
//
// The code is ISO 3166-1 alpha-2, which is what Cloudflare hands us on every
// request (`request.cf.country`) — so detection costs no extra call, no third
// party, and no IP address is ever stored or sent anywhere: the edge resolves
// it, the browser only ever learns the two letters that came back.
//
// Names are not shipped. `Intl.DisplayNames` knows them in every language the
// browser already has, and falls back to the bare code on the few engines that
// do not — a list of 250 names per language is a lot of bundle for a dropdown.

/** Every alpha-2 code Cloudflare can report, plus nothing that is not a country. */
export const COUNTRY_CODES = [
  'AD', 'AE', 'AF', 'AG', 'AI', 'AL', 'AM', 'AO', 'AQ', 'AR', 'AS', 'AT', 'AU', 'AW', 'AX', 'AZ',
  'BA', 'BB', 'BD', 'BE', 'BF', 'BG', 'BH', 'BI', 'BJ', 'BL', 'BM', 'BN', 'BO', 'BQ', 'BR', 'BS',
  'BT', 'BV', 'BW', 'BY', 'BZ', 'CA', 'CC', 'CD', 'CF', 'CG', 'CH', 'CI', 'CK', 'CL', 'CM', 'CN',
  'CO', 'CR', 'CU', 'CV', 'CW', 'CX', 'CY', 'CZ', 'DE', 'DJ', 'DK', 'DM', 'DO', 'DZ', 'EC', 'EE',
  'EG', 'EH', 'ER', 'ES', 'ET', 'FI', 'FJ', 'FK', 'FM', 'FO', 'FR', 'GA', 'GB', 'GD', 'GE', 'GF',
  'GG', 'GH', 'GI', 'GL', 'GM', 'GN', 'GP', 'GQ', 'GR', 'GS', 'GT', 'GU', 'GW', 'GY', 'HK', 'HM',
  'HN', 'HR', 'HT', 'HU', 'ID', 'IE', 'IL', 'IM', 'IN', 'IO', 'IQ', 'IR', 'IS', 'IT', 'JE', 'JM',
  'JO', 'JP', 'KE', 'KG', 'KH', 'KI', 'KM', 'KN', 'KP', 'KR', 'KW', 'KY', 'KZ', 'LA', 'LB', 'LC',
  'LI', 'LK', 'LR', 'LS', 'LT', 'LU', 'LV', 'LY', 'MA', 'MC', 'MD', 'ME', 'MF', 'MG', 'MH', 'MK',
  'ML', 'MM', 'MN', 'MO', 'MP', 'MQ', 'MR', 'MS', 'MT', 'MU', 'MV', 'MW', 'MX', 'MY', 'MZ', 'NA',
  'NC', 'NE', 'NF', 'NG', 'NI', 'NL', 'NO', 'NP', 'NR', 'NU', 'NZ', 'OM', 'PA', 'PE', 'PF', 'PG',
  'PH', 'PK', 'PL', 'PM', 'PN', 'PR', 'PS', 'PT', 'PW', 'PY', 'QA', 'RE', 'RO', 'RS', 'RU', 'RW',
  'SA', 'SB', 'SC', 'SD', 'SE', 'SG', 'SH', 'SI', 'SJ', 'SK', 'SL', 'SM', 'SN', 'SO', 'SR', 'SS',
  'ST', 'SV', 'SX', 'SY', 'SZ', 'TC', 'TD', 'TF', 'TG', 'TH', 'TJ', 'TK', 'TL', 'TM', 'TN', 'TO',
  'TR', 'TT', 'TV', 'TW', 'TZ', 'UA', 'UG', 'UM', 'US', 'UY', 'UZ', 'VA', 'VC', 'VE', 'VG', 'VI',
  'VN', 'VU', 'WF', 'WS', 'YE', 'YT', 'ZA', 'ZM', 'ZW',
] as const;

export type CountryCode = (typeof COUNTRY_CODES)[number];

const KNOWN = new Set<string>(COUNTRY_CODES);

/**
 * The bucket for a player whose country is unknown — no detection, detection
 * refused, or a Cloudflare `XX`/`T1` (an anonymising proxy or Tor). It is a
 * real bucket rather than a dropped game: the totals have to add up.
 */
export const UNKNOWN_COUNTRY = 'ZZ';

/** `ZZ` included, because the stats tables count it like any other row. */
export type CountryKey = CountryCode | typeof UNKNOWN_COUNTRY;

export function isCountryCode(value: unknown): value is CountryCode {
  return typeof value === 'string' && KNOWN.has(value.toUpperCase());
}

/** Anything at all in, a code we are willing to store out. Never throws. */
export function normaliseCountry(value: unknown): CountryKey {
  if (typeof value !== 'string') return UNKNOWN_COUNTRY;
  const up = value.trim().toUpperCase();
  return KNOWN.has(up) ? (up as CountryCode) : UNKNOWN_COUNTRY;
}

/**
 * The flag, built from the code itself: 'FR' → 🇫🇷. Regional indicators are
 * a straight offset from A-Z, so there is no image and no table to ship.
 * Unknown gets a globe, which every font has.
 */
export function countryFlag(code: string): string {
  const up = typeof code === 'string' ? code.toUpperCase() : '';
  if (!KNOWN.has(up)) return '🌍';
  return String.fromCodePoint(
    ...[...up].map(c => 0x1f1e6 + (c.charCodeAt(0) - 65)),
  );
}

/** The country's name in `locale`, or the bare code where the browser cannot say. */
export function countryName(code: string, locale = 'en'): string {
  const up = typeof code === 'string' ? code.toUpperCase() : '';
  if (!KNOWN.has(up)) return '';
  try {
    const names = new Intl.DisplayNames([locale], { type: 'region' });
    return names.of(up) ?? up;
  } catch {
    return up;
  }
}

/** Every country, sorted by its name in `locale` — the order a picker wants. */
export function countriesByName(locale = 'en'): { code: CountryCode; name: string }[] {
  const list = COUNTRY_CODES.map(code => ({ code, name: countryName(code, locale) || code }));
  try {
    const collator = new Intl.Collator(locale);
    return list.sort((a, b) => collator.compare(a.name, b.name));
  } catch {
    return list.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }
}
