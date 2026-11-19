// Badge pictures on screen: a design's six-colour preview (drawn and
// dithered on the phone, exactly what the badge will show), the library's
// saved thumbnails, and template thumbnails drawn from sample content. Each
// sits in a print frame: black outline, hard shadow, a slight tilt.

import { type SkImage } from '@shopify/react-native-skia';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Text, View, type ViewStyle } from 'react-native';

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
  /** Show it on the drawn badge (bezel, lanyard slot) instead of as a bare print. For hero pictures. */
  device?: boolean;
}

/** The badge's outline around a picture, at its real 2:3 (or 3:2) shape, as a print. */
export function BadgeFrame({ width, orientation, children, bold, style, tilt = 0, shadow, sticker, device }: { width: number; orientation: Orientation; children?: React.ReactNode; bold?: boolean; style?: ViewStyle } & PrintLook) {
  if (device)
    return (
      <BadgeDevice width={width} orientation={orientation} tilt={tilt} shadow={shadow} sticker={sticker} style={style}>
        {children}
      </BadgeDevice>
    );
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

// The drawn badge. Generic for now: match these to the real enclosure.
/** Side bezel, as a share of the device's width. */
export const DEVICE_BEZEL = 0.055;
/** Top bezel (holds the lanyard slot), as a multiple of the side bezel. */
export const DEVICE_TOP = 2.6;
/** Corner radius, as a share of the device's width. */
export const DEVICE_RADIUS = 0.07;
/** The lanyard clip above the body, as shares of the device's width. */
export const DEVICE_CLIP = { width: 0.2, height: 0.09 };

/**
 * The badge itself: the picture on its screen inside a paper-white body with
 * rounded corners, a punched lanyard slot and a clip above it, black outline
 * and a hard shadow. Used where one picture is the hero; grids keep the bare
 * BadgeFrame. `width` is the body's width.
 */
export function BadgeDevice({ width, orientation, children, tilt = 0, shadow = INK.black, sticker, style }: { width: number; orientation: Orientation; children?: React.ReactNode; style?: ViewStyle } & PrintLook) {
  const bezel = Math.max(3, Math.round(width * DEVICE_BEZEL));
  const top = Math.round(bezel * DEVICE_TOP);
  const radius = Math.round(width * DEVICE_RADIUS);
  const screenW = width - bezel * 2;
  const slotW = Math.round(width * 0.26);
  const slotH = Math.max(4, Math.round(top * 0.26));
  const clipW = Math.round(width * DEVICE_CLIP.width);
  const clipH = Math.max(6, Math.round(width * DEVICE_CLIP.height));
  const off = width > 160 ? 5 : width > 80 ? 4 : 3;
  const line = width > 80 ? 2 : 1.5;
  return (
    <View style={{ width, paddingTop: clipH, transform: tilt ? [{ rotate: `${tilt}deg` }] : undefined }}>
      {shadow && <View style={{ position: 'absolute', left: off, top: clipH + off, right: -off, bottom: -off, borderRadius: radius, backgroundColor: shadow }} />}
      {/* The clip: a metal tab with a ring, through the slot. */}
      <View style={{ position: 'absolute', top: 0, left: (width - clipW) / 2, width: clipW, height: clipH + top * 0.55, borderRadius: clipW * 0.18, borderWidth: line, borderColor: INK.black, backgroundColor: INK.paper, alignItems: 'center', paddingTop: clipH * 0.22 }}>
        <View style={{ width: clipW * 0.38, height: clipH * 0.42, borderRadius: clipH, borderWidth: line, borderColor: INK.black, backgroundColor: INK.white }} />
      </View>
      <View style={{ backgroundColor: INK.white, borderWidth: line, borderColor: INK.black, borderRadius: radius, paddingHorizontal: bezel - line, paddingTop: top - line, paddingBottom: bezel - line }}>
        <View style={{ position: 'absolute', top: Math.round((top - slotH) * 0.45) - line, left: (width - slotW) / 2 - line, width: slotW, height: slotH, borderRadius: slotH / 2, backgroundColor: INK.black }} />
        <View style={[{ width: screenW - 0.01, aspectRatio: ratio(orientation), borderWidth: 1, borderColor: INK.black, overflow: 'hidden', backgroundColor: INK.paper }, style]}>{children}</View>
      </View>
      {sticker && (
        <View style={{ position: 'absolute', right: -6, top: clipH + top, backgroundColor: INK.red, borderWidth: 2, borderColor: INK.black, paddingHorizontal: 7, paddingVertical: 2, transform: [{ rotate: '4deg' }] }}>
          <Text style={{ fontFamily: 'SpaceMono-Bold', fontSize: 10, color: INK.paper }}>{sticker}</Text>
        </View>
      )}
    </View>
  );
}

/** A picture filling its frame, fading in when it arrives (or changes from nothing). */
function FadeImage({ uri }: { uri: string }) {
  const [fade] = useState(() => new Animated.Value(0));
  const seen = useRef(false);
  useEffect(() => {
    if (seen.current) return;
    seen.current = true;
    Animated.timing(fade, { toValue: 1, duration: 150, useNativeDriver: true }).start();
  }, [fade]);
  return <Animated.Image source={{ uri }} style={{ flex: 1, opacity: fade }} resizeMode="stretch" fadeDuration={0} accessibilityIgnoresInvertColors />;
}

/** PNG data URIs for drawn pictures, so no screen needs a live Skia canvas per picture. */
const uris = new WeakMap<SkImage, string>();
function uriFor(image: SkImage) {
  let u = uris.get(image);
  if (!u) {
    u = `data:image/png;base64,${image.encodeToBase64()}`;
    uris.set(image, u);
  }
  return u;
}

function SkiaFill({ image }: { image: SkImage }) {
  const uri = useMemo(() => uriFor(image), [image]);
  return <FadeImage uri={uri} />;
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
  const img = useMemo(() => (prepared ? toSkImage(show === 'badge' ? prepared.converted.display : prepared.rendered) : null), [prepared, show]);
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
    app.thumbnail(itemId).then((b) => {
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
      {uri ? <FadeImage uri={uri} /> : <Placeholder style={{ flex: 1 }} />}
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
        img = toSkImage(p.converted.display);
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
