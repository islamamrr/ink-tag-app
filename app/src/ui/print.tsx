// Print effects: paper grain, halftone dots, line icons, off-register text
// and hard shadows (design/riso-style.md).
//
// Dots and icons are drawn once with Skia into small PNGs, cached, and shown
// with <Image>: a screen full of icons then costs no live canvases (each
// Skia canvas is its own surface, and every screen in a tab's stack stays
// mounted).

import { BlendMode, PaintStyle, Skia, type SkCanvas, StrokeCap, StrokeJoin } from '@shopify/react-native-skia';
import { createContext, type ReactNode, useContext, useMemo } from 'react';
import { Image, PixelRatio, StyleSheet, Text, type TextStyle, useWindowDimensions, View, type ViewStyle } from 'react-native';

import { INK, PAPER, type Surface } from './theme';

// ------------------------------------------------------------------ surface

const SurfaceContext = createContext<Surface>(PAPER);

/** The ground the current component sits on: paper, a card, or a flood ink. */
export const useSurface = () => useContext(SurfaceContext);

export function OnSurface({ surface, children }: { surface: Surface; children: ReactNode }) {
  return <SurfaceContext.Provider value={surface}>{children}</SurfaceContext.Provider>;
}

// ------------------------------------------------------------------ snapshots

const SCALE = Math.min(3, Math.max(1, PixelRatio.get()));
const shots = new Map<string, string | null>();

/** Draws once into a w × h (points) PNG at the screen's scale and keeps it. */
function snapshot(key: string, w: number, h: number, draw: (c: SkCanvas, k: number) => void, scale = SCALE): string | null {
  const id = `${key}@${w}x${h}x${scale}`;
  if (shots.has(id)) return shots.get(id)!;
  let uri: string | null = null;
  try {
    const surface = Skia.Surface.Make(Math.max(1, Math.round(w * scale)), Math.max(1, Math.round(h * scale)));
    if (surface) {
      draw(surface.getCanvas(), scale);
      surface.flush();
      uri = `data:image/png;base64,${surface.makeImageSnapshot().encodeToBase64()}`;
    }
  } catch {
    uri = null;
  }
  shots.set(id, uri);
  return uri;
}

// ------------------------------------------------------------------ dots

// One dot per cell of a square grid, optionally fading out downwards.
const DOTS = Skia.RuntimeEffect.Make(`
uniform float spacing;
uniform float radius;
uniform float4 color;
uniform float fadeTo;
uniform float fadeFrom;
half4 main(float2 p) {
  float2 c = (floor(p / spacing) + 0.5) * spacing;
  float d = length(p - c);
  float a = 1.0 - smoothstep(radius - 0.6, radius + 0.6, d);
  float f = fadeTo > 0.0 ? clamp(1.0 - p.y / fadeTo, 0.0, 1.0) * fadeFrom : 1.0;
  float k = a * f * color.a;
  return half4(color.rgb * k, k);
}`);

export interface DotsSpec {
  /** Distance between dot centres, points. */
  spacing: number;
  radius: number;
  color: string;
  alpha?: number;
  /** Fade from `fadeFrom` at the top to nothing at this many points down. */
  fadeTo?: number;
  fadeFrom?: number;
  /** Multiply over this colour, like overprinted ink. */
  ground?: string;
}

function drawDots(c: SkCanvas, k: number, { spacing, radius, color, alpha = 1, fadeTo = 0, fadeFrom = 1, ground }: DotsSpec) {
  if (ground) c.drawColor(Skia.Color(ground));
  if (!DOTS) return;
  const col = Skia.Color(color);
  const paint = Skia.Paint();
  paint.setShader(DOTS.makeShader([spacing * k, radius * k, col[0], col[1], col[2], col[3] * alpha, fadeTo * k, fadeFrom]));
  if (ground) paint.setBlendMode(BlendMode.Multiply);
  c.drawPaint(paint);
}

/** A box of halftone dots, `width` × `height` points. Decoration only. */
export function Dots({ width, height, round, style, ...spec }: DotsSpec & { width: number; height: number; round?: boolean; style?: ViewStyle }) {
  const key = `dots:${JSON.stringify(spec)}`;
  const uri = useMemo(() => snapshot(key, width, height, (c, k) => drawDots(c, k, spec)), [key, width, height]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[{ position: 'absolute', width, height, overflow: 'hidden' }, round && { borderRadius: Math.max(width, height) / 2 }, style]}
    >
      {uri && <Image source={{ uri }} style={{ width, height }} fadeDuration={0} />}
    </View>
  );
}

/** A screen's ground: paper with its faint grain, or a flood ink with halftone fading down from the top. */
export function Ground({ surface, halftone = 420 }: { surface: Surface; halftone?: number }) {
  const { width } = useWindowDimensions();
  const w = Math.ceil(width);
  if (surface.flood)
    return (
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: surface.ground }]}>
        <Dots width={w} height={halftone} spacing={9} radius={2.4} color={surface.dots} alpha={surface.dotsAlpha} fadeTo={halftone} ground={surface.ground} style={{ left: 0, top: 0 }} />
      </View>
    );
  return <PaperGrain ground={surface.ground} />;
}

/** The paper's faint dot grid: one small tile, repeated. */
function PaperGrain({ ground }: { ground: string }) {
  const uri = useMemo(() => snapshot(`grain:${ground}`, 10, 10, (c, k) => drawDots(c, k, { spacing: 5, radius: 0.8, color: INK.black, alpha: 0.05, ground }), 1), [ground]);
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: ground }]}>
      {uri && <Image source={{ uri }} resizeMode="repeat" style={StyleSheet.absoluteFill} fadeDuration={0} />}
    </View>
  );
}

// ------------------------------------------------------------------ icons

const circle = (cx: number, cy: number, r: number) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;

const ICONS = {
  search: `${circle(11, 11, 7)}M20 20l-4-4`,
  print: 'M6 9V3h12v6M3 9h18v8H3zM7 14h10v7H7z',
  gallery: 'M3 5h18v14H3zM3 16l5-5 4 4 3-3 6 6',
  badge: 'M2 7h20v14H2zM12 7V3',
  settings: `${circle(12, 12, 3)}M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1`,
  back: 'M15 6l-6 6 6 6',
  next: 'M9 6l6 6-6 6',
  down: 'M6 9l6 6 6-6',
  up: 'M12 19V5M6 11l6-6 6 6',
  heart: 'M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10z',
  camera: `M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM8 6l1.5-2.5h5L16 6${circle(12, 13, 3.5)}`,
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  check: 'M5 12.5l4.5 4.5L19 7',
  close: 'M6 6l12 12M18 6L6 18',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  crop: 'M6 2v16h16M2 6h16v16',
  redraw: 'M20 12a8 8 0 1 1-2.3-5.6M20 4v5h-5',
  bluetooth: 'M7 7l10 10-5 4V3l5 4L7 17',
} as const;

export type IconName = keyof typeof ICONS;

function drawIcon(c: SkCanvas, k: number, name: IconName, size: number, stroke: number, fill: boolean) {
  const path = Skia.Path.MakeFromSVGString(ICONS[name]);
  if (!path) return;
  c.scale((k * size) / 24, (k * size) / 24);
  const paint = Skia.Paint();
  paint.setAntiAlias(true);
  paint.setColor(Skia.Color('#ffffff'));
  if (fill) c.drawPath(path, paint);
  paint.setStyle(PaintStyle.Stroke);
  paint.setStrokeWidth(stroke);
  paint.setStrokeCap(StrokeCap.Round);
  paint.setStrokeJoin(StrokeJoin.Round);
  c.drawPath(path, paint);
}

/** A line icon on a 24-unit grid, drawn white once and tinted. Decoration: label the button that holds it. */
export function Icon({ name, size = 22, color = INK.black, stroke = 2.2, fill = false }: { name: IconName; size?: number; color?: string; stroke?: number; fill?: boolean }) {
  const uri = useMemo(() => snapshot(`icon:${name}:${stroke}:${fill}`, size, size, (c, k) => drawIcon(c, k, name, size, stroke, fill)), [name, size, stroke, fill]);
  return (
    <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ width: size, height: size }}>
      {uri && <Image source={{ uri }} style={{ width: size, height: size, tintColor: color }} fadeDuration={0} />}
    </View>
  );
}

/** A small filled circle (or square) of one ink: status dots, ink keys. */
export function InkDot({ color, size = 10, round = true }: { color: string; size?: number; round?: boolean }) {
  return <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ width: size, height: size, borderRadius: round ? size / 2 : 0, backgroundColor: color }} />;
}

// ------------------------------------------------------------------ offset ink

/** Text printed twice, the second ink a little off-register behind it. */
export function OffsetText({
  children,
  style,
  second,
  dx = 3,
  dy = 2,
  numberOfLines,
}: {
  children: ReactNode;
  style: TextStyle | TextStyle[];
  second: string;
  dx?: number;
  dy?: number;
  numberOfLines?: number;
}) {
  return (
    <View>
      <Text
        style={[style, { position: 'absolute', left: dx, top: dy, right: -dx, color: second }]}
        numberOfLines={numberOfLines}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {children}
      </Text>
      <Text style={style} numberOfLines={numberOfLines}>
        {children}
      </Text>
    </View>
  );
}

// ------------------------------------------------------------------ hard shadow

/** A block of ink behind its child, offset and unblurred, like a misprinted second colour. */
export function HardShadow({ x = 4, y = 4, color = INK.black, radius = 0, style, children }: { x?: number; y?: number; color?: string; radius?: number; style?: ViewStyle | ViewStyle[]; children: ReactNode }) {
  return (
    <View style={style}>
      <View pointerEvents="none" style={{ position: 'absolute', left: x, top: y, right: -x, bottom: -y, backgroundColor: color, borderRadius: radius }} />
      {children}
    </View>
  );
}
