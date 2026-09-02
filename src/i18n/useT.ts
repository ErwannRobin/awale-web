import { useMemo } from 'react';
import { useSettings } from '../lib/useSettings.ts';
import { translatorFor, type Translate } from './index.ts';

/** `const t = useT()` then `t('menu.learn')`. Re-renders on a language change. */
export function useT(): Translate {
  const { language } = useSettings();
  return useMemo(() => translatorFor(language), [language]);
}
