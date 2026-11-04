// The typefaces designs are drawn with. Bundled (Inter, SIL OFL, see
// assets/fonts/OFL.txt) rather than the phone's own, so a design looks the
// same on every phone and in the library later.

import { Skia, type SkTypeface } from '@shopify/react-native-skia';
import { Asset } from 'expo-asset';

import type { Fonts } from './render';

let loading: Promise<Fonts> | null = null;

async function typeface(mod: number): Promise<SkTypeface> {
  const [asset] = await Asset.loadAsync(mod);
  const data = await Skia.Data.fromURI(asset.localUri ?? asset.uri);
  const t = Skia.Typeface.MakeFreeTypeFaceFromData(data);
  if (!t) throw new Error("Couldn't load the app's fonts.");
  return t;
}

/** Loads the fonts once; later calls share the same promise. */
export function loadFonts(): Promise<Fonts> {
  loading ??= (async () => ({
    regular: await typeface(require('../../assets/fonts/Inter-Regular.ttf')),
    bold: await typeface(require('../../assets/fonts/Inter-Bold.ttf')),
  }))();
  loading.catch(() => (loading = null));
  return loading;
}
