// Photo → RGBA at the badge's size, on the phone. The orientation and
// downsizing happen natively (expo-image-manipulator), the crop/fit draw in
// Skia; everything after the pixel buffer is src/core.

import {
  AlphaType,
  ColorType,
  FilterMode,
  MipmapMode,
  Skia,
  type SkImage,
} from '@shopify/react-native-skia';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import { computeFit, type FitMode, type RgbaImage } from '../core';

/** Long edge photos are decoded at; plenty for a 528 × 792 panel. */
const DECODE_MAX = 1600;

export interface Picture {
  uri: string;
  image: SkImage;
  width: number;
  height: number;
}

/** Lets the person pick one photo. Resolves null if they back out. */
export async function pickPhoto(): Promise<Picture | null> {
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: 1,
  });
  if (res.canceled || !res.assets[0]) return null;
  return loadPicture(res.assets[0].uri);
}

/**
 * Decodes a photo with EXIF orientation applied and the long edge capped.
 * Re-encoding as PNG through the image manipulator bakes the orientation in,
 * so Skia sees upright pixels whatever the camera wrote.
 */
export async function loadPicture(uri: string): Promise<Picture> {
  const ref = await ImageManipulator.manipulate(uri, {
    maxWidth: DECODE_MAX,
    maxHeight: DECODE_MAX,
  }).renderAsync();
  const saved = await ref.saveAsync({ format: SaveFormat.PNG });
  const image = Skia.Image.MakeImageFromEncoded(await Skia.Data.fromURI(saved.uri));
  if (!image) throw new Error("Couldn't read that picture.");
  return { uri, image, width: image.width(), height: image.height() };
}

/** Crops or pads the picture to width × height and returns its pixels. */
export function renderFitted(
  pic: Picture,
  width: number,
  height: number,
  fit: FitMode,
  crop?: { x: number; y: number },
): RgbaImage {
  const { src, dst } = computeFit(pic.width, pic.height, width, height, fit, crop);
  const surface = Skia.Surface.Make(width, height);
  if (!surface) throw new Error('Out of memory preparing the picture.');
  const canvas = surface.getCanvas();
  canvas.clear(Skia.Color('white'));
  canvas.drawImageRectOptions(
    pic.image,
    Skia.XYWHRect(src.x, src.y, src.width, src.height),
    Skia.XYWHRect(dst.x, dst.y, dst.width, dst.height),
    FilterMode.Linear,
    MipmapMode.Linear,
    null,
  );
  surface.flush();
  const pixels = surface.makeImageSnapshot().readPixels(0, 0, {
    width,
    height,
    colorType: ColorType.RGBA_8888,
    alphaType: AlphaType.Unpremul,
  });
  if (!(pixels instanceof Uint8Array)) throw new Error("Couldn't read the picture's pixels.");
  return { width, height, data: pixels };
}

/** An RGBA buffer as a Skia image, for showing previews. */
export function toSkImage(img: RgbaImage): SkImage | null {
  return Skia.Image.MakeImage(
    {
      width: img.width,
      height: img.height,
      colorType: ColorType.RGBA_8888,
      alphaType: AlphaType.Unpremul,
    },
    Skia.Data.fromBytes(new Uint8Array(img.data.buffer, img.data.byteOffset, img.data.byteLength)),
    img.width * 4,
  );
}
