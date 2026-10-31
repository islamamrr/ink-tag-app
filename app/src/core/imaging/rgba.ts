/** An 8-bit RGBA picture, rows top to bottom. Alpha is ignored by the pipeline. */
export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8Array | Uint8ClampedArray;
}

export const createRgba = (width: number, height: number): RgbaImage => ({
  width,
  height,
  data: new Uint8Array(width * height * 4),
});
