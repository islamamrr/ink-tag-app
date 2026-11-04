// "Send to Ink Tag" from the phone's share sheet (Photos, Files, a browser
// image). expo-share-intent adds the Android intent filter and the iOS share
// extension (app.json); this hook hands the shared picture to the app.
//
// The native module is optional: in Expo Go the hook simply never fires.

import { useShareIntent } from 'expo-share-intent';
import { useMemo } from 'react';

export interface SharedPhoto {
  uri: string;
  mimeType: string;
  width?: number | null;
  height?: number | null;
}

/** The latest picture shared to the app, until clear() is called. */
export function useSharedPhoto(): { photo: SharedPhoto | null; clear: () => void; error: string | null } {
  const { hasShareIntent, shareIntent, resetShareIntent, error } = useShareIntent({ resetOnBackground: false });
  const photo = useMemo((): SharedPhoto | null => {
    if (!hasShareIntent) return null;
    const f = shareIntent.files?.find((x) => x.mimeType?.startsWith('image/'));
    return f ? { uri: f.path, mimeType: f.mimeType, width: f.width, height: f.height } : null;
  }, [hasShareIntent, shareIntent]);

  return {
    photo,
    error,
    clear: () => resetShareIntent(),
  };
}
