// Settings the developer screen remembers between launches: the last badge,
// whether to connect to it on start, and the picture options. A small JSON
// file in the app's documents folder. expo-file-system is already part of
// every Expo build, so this needs no new development build.
//
// Never throws: a missing or broken file just means the defaults.

import { File, Paths } from 'expo-file-system';

import type { DitherMethod, FitMode, Look, Timing } from '../core';

export interface Prefs {
  lastBadge: { id: string; name: string } | null;
  autoConnect: boolean;
  fit: FitMode;
  dither: DitherMethod;
  look: Look;
  /** 'auto' lets the look choose where dither error is carried. */
  errorSpace: 'auto' | 'srgb' | 'oklab';
  /** Extra cost of choosing white while dithering; 0 is off. */
  whitePenalty: number;
  /** Sharpening before dithering, 0 to 1. */
  sharpen: number;
  simTiming: Timing;
  /** Show every command and notification in the log, not just the summary. */
  verboseLog: boolean;
}

export const DEFAULT_PREFS: Prefs = {
  lastBadge: null,
  autoConnect: true,
  fit: 'cover',
  dither: 'floyd-steinberg',
  look: 'boost',
  errorSpace: 'auto',
  whitePenalty: 0,
  sharpen: 0,
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
