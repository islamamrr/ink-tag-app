// Badge pictures on screen: a design's six-colour preview (drawn and
// dithered on the phone, exactly what the badge will show), the library's
// saved thumbnails, and template thumbnails drawn from sample content. Each
// sits in a print frame: black outline, hard shadow, a slight tilt.

import { Canvas, Image as SkiaImage, type SkImage } from '@shopify/react-native-skia';
import { useEffect, useMemo, useState } from 'react';
import { Image, Text, View, type ViewStyle } from 'react-native';

import { type CatalogEntry, type Design, type InkTag, type Orientation, type Prepared, toBase64 } from '../core';
import { templateDesign } from '../services/app';
import { toSkImage } from '../services/render';
import { Placeholder } from './kit';
import { INK, mainInk, type Flood, type Shares } from './theme';

export const ratio = (o: Orientation) => (o === 'landscape' ? 1.5 : 2 / 3);

export interface PrintLook {
  /** Degrees; prints sit a little crooked. */
  tilt?: number;
  /** Hard shadow colour (none by default). */
  shadow?: string;
  /** A sticker on the corner ("ON BADGE"). */
  sticker?: string;
}

/** The badge's outline around a picture, at its real 2:3 (or 3:2) shape, as a print. */
export function BadgeFrame({ width, orientation, children, bold, style, tilt = 0, shadow, sticker }: { width: number; orientation: Orientation; children?: React.ReactNode; bold?: boolean; style?: ViewStyle } & PrintLook) {
  const big = width > 160;
  const off = big ? 6 : 4;
  return (
    <View style={{ width, aspectRatio: ratio(orientation), transform: tilt ? [{ rotate: `${tilt}deg` }] : undefined }}>
      {shadow && <View style={{ position: 'absolute', left: off, top: off, right: -off, bottom: -off, backgroundColor: shadow }} />}
      <View style={[{ flex: 1, borderWidth: bold ? 3.5 : 2, borderColor: INK.black, overflow: 'hidden', backgroundColor: INK.white }, style]}>{children}</View>
      {sticker && (
        <View style={{ position: 'absolute', right: -6, top: -8, backgroundColor: INK.red, borderWidth: 2, borderColor: INK.black, paddingHorizontal: 6, paddingVertical: 2, transform: [{ rotate: '4deg' }] }}>
          <Text style={{ fontFamily: 'SpaceMono-Bold', fontSize: 10, color: INK.paper }}>{sticker}</Text>
        </View>
      )}
    </View>
  );
}

function SkiaFill({ image }: { image: SkImage }) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  return (
    <View style={{ flex: 1 }} onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
      {size.w > 0 && (
        <Canvas style={{ width: size.w, height: size.h }}>
          <SkiaImage image={image} x={0} y={0} width={size.w} height={size.h} fit="fill" />
        </Canvas>
      )}
    </View>
  );
}

/** Draws and dithers a design shortly after it changes. */
export function usePrepared(app: InkTag, design: Design | null, delay = 300) {
  const [state, setState] = useState<{ design: Design; prepared: Prepared } | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    if (!design) return;
    let live = true;
    const t = setTimeout(() => {
      app
        .prepare(design)
        .then((prepared) => live && (setState({ design, prepared }), setError(null)))
        .catch((e) => live && setError(e));
    }, delay);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [app, design, delay]);
  const prepared = state && state.design === design ? state.prepared : null;
  // While redrawing, keep the last picture rather than flashing a placeholder.
  return { prepared, last: state?.prepared ?? null, error };
}

/** A design's preview: "badge" is the six-colour result, "photo" the picture before. */
export function DesignPreview({
  prepared,
  width,
  orientation,
  show = 'badge',
  ...look
}: {
  prepared: Prepared | null;
  width: number;
  orientation: Orientation;
  show?: 'badge' | 'photo';
} & PrintLook) {
  const img = useMemo(() => (prepared ? toSkImage(show === 'badge' ? prepared.converted.preview : prepared.rendered) : null), [prepared, show]);
  return (
    <BadgeFrame width={width} orientation={orientation} {...look}>
      {img ? <SkiaFill image={img} /> : <Placeholder style={{ flex: 1 }} label="Drawing…" />}
    </BadgeFrame>
  );
}

/** A picture's main ink, decided the first time it's drawn and then kept, so the screen doesn't change colour while editing. */
export function useFloodOnce(key: string | null, prepared: Prepared | null, fallback: Flood = 'blue') {
  const [kept, setKept] = useState<{ key: string; flood: Flood; shares: Shares } | null>(null);
  // Adjusting state while rendering (React's "storing information from previous renders").
  if (key && prepared && kept?.key !== key) {
    const next = { key, flood: mainInk(prepared.converted.shares, fallback), shares: prepared.converted.shares };
    setKept(next);
    return next;
  }
  return kept?.key === key ? kept : null;
}

// ------------------------------------------------------------------ library thumbnails

const thumbCache = new Map<string, string>();

export function ItemThumb({ app, itemId, width, orientation, bold, ...look }: { app: InkTag; itemId: string; width: number; orientation: Orientation; bold?: boolean } & PrintLook) {
  const [loaded, setLoaded] = useState<{ id: string; uri: string } | null>(null);
  const uri = thumbCache.get(itemId) ?? (loaded?.id === itemId ? loaded.uri : null);
  useEffect(() => {
    if (thumbCache.has(itemId)) return;
    let live = true;
    app.library.preview(itemId).then((b) => {
      if (!b) return;
      const u = `data:image/png;base64,${toBase64(b)}`;
      thumbCache.set(itemId, u);
      if (live) setLoaded({ id: itemId, uri: u });
    });
    return () => {
      live = false;
    };
  }, [app, itemId]);
  const o = app.library.get(itemId)?.scene.orientation ?? orientation;
  return (
    <BadgeFrame width={width} orientation={o} bold={bold} {...look}>
      {uri ? <Image source={{ uri }} style={{ flex: 1 }} resizeMode="cover" accessibilityIgnoresInvertColors /> : <Placeholder style={{ flex: 1 }} />}
    </BadgeFrame>
  );
}

// ------------------------------------------------------------------ template thumbnails

// Drawn one at a time from sample content and cached for the session, so
// scrolling the Templates tab doesn't redraw anything.
const tplCache = new Map<string, SkImage>();
/** Each template's inks, from its sample drawn upright in its first layout. */
const tplShares = new Map<string, Shares>();
const inkListeners = new Set<() => void>();
const waiting = new Map<string, ((i: SkImage | null) => void)[]>();
let queue: Promise<unknown> = Promise.resolve();

function drawTemplate(app: InkTag, e: CatalogEntry, orientation: Orientation, layout: number): Promise<SkImage | null> {
  const key = `${e.id}:${orientation}:${layout}`;
  const hit = tplCache.get(key);
  if (hit) return Promise.resolve(hit);
  return new Promise((resolve) => {
    const list = waiting.get(key);
    if (list) return void list.push(resolve);
    waiting.set(key, [resolve]);
    queue = queue.then(async () => {
      let img: SkImage | null = null;
      try {
        const design = templateDesign(e, e.sample, { layout, orientation });
        const p = await app.prepare(design);
        img = toSkImage(p.converted.preview);
        if (img) tplCache.set(key, img);
        if (!tplShares.has(e.id)) {
          tplShares.set(e.id, p.converted.shares);
          inkListeners.forEach((l) => l());
        }
      } catch {
        img = null;
      }
      waiting.get(key)?.forEach((r) => r(img));
      waiting.delete(key);
    });
  });
}

export function TemplateThumb({ app, entry, width, orientation, layout = 0, ...look }: { app: InkTag; entry: CatalogEntry; width: number; orientation: Orientation; layout?: number } & PrintLook) {
  const key = `${entry.id}:${orientation}:${layout}`;
  const [drawn, setDrawn] = useState<{ key: string; img: SkImage | null } | null>(null);
  const img = tplCache.get(key) ?? (drawn?.key === key ? drawn.img : null);
  useEffect(() => {
    if (tplCache.has(key)) return;
    let live = true;
    drawTemplate(app, entry, orientation, layout).then((i) => live && setDrawn({ key, img: i }));
    return () => {
      live = false;
    };
  }, [app, entry, orientation, layout, key]);
  return (
    <BadgeFrame width={width} orientation={orientation} {...look}>
      {img ? <SkiaFill image={img} /> : <Placeholder style={{ flex: 1 }} />}
    </BadgeFrame>
  );
}

/** A template's flood ink and ink line ("GREEN + RED"), from its sample picture. Blue until it's drawn. */
export function useTemplateInk(app: InkTag, entry: CatalogEntry | undefined): { flood: Flood; shares: Shares | null } {
  const [, bump] = useState(0);
  useEffect(() => {
    if (!entry || tplShares.has(entry.id)) return;
    const l = () => bump((n) => n + 1);
    inkListeners.add(l);
    void drawTemplate(app, entry, 'portrait', 0);
    return () => void inkListeners.delete(l);
  }, [app, entry]);
  const shares = entry ? (tplShares.get(entry.id) ?? null) : null;
  return { flood: mainInk(shares), shares };
}
