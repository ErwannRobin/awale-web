import { useEffect, useState } from 'react';
import { getSettings, subscribeSettings, type Settings } from './settings.ts';

/** Re-renders whenever any setting changes, from anywhere in the app. */
export function useSettings(): Settings {
  const [settings, setSettings] = useState<Settings>(getSettings);
  useEffect(() => subscribeSettings(setSettings), []);
  return settings;
}
