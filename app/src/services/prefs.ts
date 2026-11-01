// Settings the developer screen remembers between launches: the last badge,
// whether to connect to it on start, and the picture options. A small JSON
// file in the app's documents folder. expo-file-system is already part of
// every Expo build, so this needs no new development build.
//
// Never throws: a missing or broken file just means the defaults.

import { File, Paths } from 'expo-file-system';

import type { DitherMethod, FitMode, Timing } from '../core';

export interface Prefs {
  lastBadge: { id: string; name: string } | null;
  autoConnect: boolean;
  fit: FitMode;
  dither: DitherMethod;
  simTiming: Timing;
  /** Show every command and notification in the log, not just the summary. */
  verboseLog: boolean;
}

export const DEFAULT_PREFS: Prefs = {
  lastBadge: null,
  autoConnect: true,
  fit: 'cover',
  dither: 'floyd-steinberg',
  simTiming: 'fast',
  verboseLog: false,
};

const file = () => new File(Paths.document, 'inktag-dev-prefs.json');

export function loadPrefs(): Prefs {
  try {
    const f = file();
    if (!f.exists) return DEFAULT_PREFS;
    return { ...DEFAULT_PREFS, ...(JSON.parse(f.textSync()) as Partial<Prefs>) };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function savePrefs(p: Prefs): void {
  try {
    const f = file();
    if (!f.exists) f.create();
    f.writeSync(JSON.stringify(p));
  } catch (e) {
    console.warn('[inktag] could not save settings', e);
  }
}
