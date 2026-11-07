// Badge pictures on screen: a design's six-colour preview (drawn and
// dithered on the phone, exactly what the badge will show), the library's
// saved thumbnails, and template thumbnails drawn from sample content.

import { Canvas, Image as SkiaImage, type SkImage } from '@shopify/react-native-skia';
import { useEffect, useMemo, useState } from 'react';
import { Image, View, type ViewStyle } from 'react-native';

import { type CatalogEntry, type Design, type InkTag, type Orientation, type Prepared, toBase64 } from '../core';
import { templateDesign } from '../services/app';
import { toSkImage } from '../services/render';
import { G, Placeholder } from './kit';

export const ratio = (o: Orientation) => (o === 'landscape' ? 1.5 : 2 / 3);

/** The badge's outline around a picture, at its real 2:3 (or 3:2) shape. */
export function BadgeFrame({ width, orientation, children, bold, style }: { width: number; orientation: Orientation; children?: React.ReactNode; bold?: boolean; style?: ViewStyle }) {
  const border = width > 120 ? 5 : 3;
  return (
    <View
      style={[
        {
          width,
          aspectRatio: ratio(orientation),
          borderWidth: bold ? border + 2 : border,
          borderColor: G.ink,
          borderRadius: width > 120 ? 12 : 8,
          overflow: 'hidden',
          backgroundColor: '#e6e6e6',
        },
        style,
      ]}
    >
      {children}
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
}: {
  prepared: Prepared | null;
  width: number;
  orientation: Orientation;
  show?: 'badge' | 'photo';
}) {
  const img = useMemo(() => (prepared ? toSkImage(show === 'badge' ? prepared.converted.preview : prepared.rendered) : null), [prepared, show]);
  return <BadgeFrame width={width} orientation={orientation}>{img ? <SkiaFill image={img} /> : <Placeholder style={{ flex: 1, borderWidth: 0 }} label="Drawing…" />}</BadgeFrame>;
}

// ------------------------------------------------------------------ library thumbnails

const thumbCache = new Map<string, string>();

export function ItemThumb({ app, itemId, width, orientation, bold }: { app: InkTag; itemId: string; width: number; orientation: Orientation; bold?: boolean }) {
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
    <BadgeFrame width={width} orientation={o} bold={bold}>
      {uri ? <Image source={{ uri }} style={{ flex: 1 }} resizeMode="cover" accessibilityIgnoresInvertColors /> : <Placeholder style={{ flex: 1, borderWidth: 0 }} />}
    </BadgeFrame>
  );
}

// ------------------------------------------------------------------ template thumbnails

// Drawn one at a time from sample content and cached for the session, so
// scrolling the Templates tab doesn't redraw anything.
const tplCache = new Map<string, SkImage>();
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
      } catch {
        img = null;
      }
      waiting.get(key)?.forEach((r) => r(img));
      waiting.delete(key);
    });
  });
}

export function TemplateThumb({ app, entry, width, orientation, layout = 0 }: { app: InkTag; entry: CatalogEntry; width: number; orientation: Orientation; layout?: number }) {
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
  return <BadgeFrame width={width} orientation={orientation}>{img ? <SkiaFill image={img} /> : <Placeholder style={{ flex: 1, borderWidth: 0 }} />}</BadgeFrame>;
}
