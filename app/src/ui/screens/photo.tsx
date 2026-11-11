// The photo editor, flooded in the photo's main ink: the badge's screen is
// the crop. Pinch and drag the plain photo (fast, no inks); when the fingers
// lift, it's dithered once. Hold to see the original, double-tap to reset.
// Then a dock for Text, Sticker, Frame and Look (styles, sliders, and the
// Original / On badge compare).

import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, Image as SkiaImage, type SkImage } from '@shopify/react-native-skia';
import { type GestureResponderEvent, PanResponder, Pressable, Text, useWindowDimensions, View } from 'react-native';

import {
  type Adjustments,
  type ColorName,
  type Design,
  emptyScene,
  type FitMode,
  type FrameStyle,
  NO_ADJUSTMENTS,
  type PictureStyle,
  type Scene,
  sceneSize,
  STICKER_NAMES,
  type StickerName,
  STYLE_NAMES,
  STYLES,
  toneFor,
  computeFit,
} from '../../core';
import { pickPhotos } from '../../services/inkTag';
import { photoImage } from '../../services/render';
import { Btn, Chip, ChipStrip, Col, Field, IconBtn, InkSwatches, Label, Meta, Note, Problem, Row, Screen, T, useText } from '../kit';
import { useNav } from '../nav';
import { BadgeFrame, DesignPreview, DEVICE_BEZEL, useFloodOnce, usePrepared } from '../pictures';
import { Icon } from '../print';
import { useServices } from '../services';
import { INK, inkLine } from '../theme';

type Dock = 'photo' | 'text' | 'sticker' | 'frame' | 'look';
const INKS: ColorName[] = ['black', 'white', 'red', 'yellow', 'blue', 'green'];
const FRAMES: (FrameStyle | 'none')[] = ['none', 'line', 'double', 'rounded', 'corners', 'dashed'];
const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v));

interface EditState {
  photo: string | null;
  fit: FitMode;
  zoom: number;
  crop: { x: number; y: number };
  caption: string;
  ink: ColorName;
  sticker: StickerName | null;
  frame: FrameStyle | 'none';
}

/** Reads an earlier photo design back into the editor ("Edit a copy"). */
function fromScene(scene?: Scene): Partial<EditState> {
  if (!scene) return {};
  const out: Partial<EditState> = {};
  for (const l of scene.layers) {
    if (l.type === 'photo') Object.assign(out, { photo: l.photo, fit: l.fit ?? 'cover', zoom: l.zoom ?? 1, crop: l.crop ?? { x: 0.5, y: 0.5 } });
    if (l.type === 'text') Object.assign(out, { caption: l.text, ink: l.color });
    if (l.type === 'sticker') out.sticker = l.sticker;
    if (l.type === 'frame') out.frame = l.style;
  }
  return out;
}

export function PhotoScreen({ photo: initialPhoto, scene, style: s0, fromShare }: { photo?: string; scene?: Scene; style?: PictureStyle; fromShare?: boolean }) {
  const { app, badge, state } = useServices();
  const nav = useNav();
  const { width: screenW } = useWindowDimensions();
  const orientation = badge?.orientation ?? scene?.orientation ?? 'portrait';
  const [e, setE] = useState<EditState>(() => ({
    photo: initialPhoto ?? null,
    fit: 'cover',
    zoom: 1,
    crop: { x: 0.5, y: 0.5 },
    caption: '',
    ink: 'white',
    sticker: null,
    frame: 'none',
    ...fromScene(scene),
  }));
  const [style, setStyle] = useState<PictureStyle>(s0 ?? state.prefs().defaultStyle);
  const [adj, setAdj] = useState<Adjustments>(NO_ADJUSTMENTS);
  const [dock, setDock] = useState<Dock>('photo');
  const [compare, setCompare] = useState(false);
  const [holding, setHolding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // After a pinch or drag, the plain photo stays up until its dither is ready; any other edit ends that.
  const [cropPending, setCropPending] = useState(false);
  const set = (p: Partial<EditState>, fromCrop = false) => {
    setE((x) => ({ ...x, ...p }));
    setCropPending(fromCrop);
  };

  const choose = async () => {
    setBusy(true);
    setError(null);
    try {
      const [id] = await pickPhotos(1);
      if (id) set({ photo: id, zoom: 1, crop: { x: 0.5, y: 0.5 } });
    } catch (err) {
      setError(String((err as Error)?.message ?? err));
    } finally {
      setBusy(false);
    }
  };

  // Open the picker straight away when there's nothing to edit yet.
  const asked = useRef(false);
  useEffect(() => {
    if (!e.photo && !asked.current) {
      asked.current = true;
      void choose();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const design = useMemo((): Design | null => {
    if (!e.photo) return null;
    const sc = emptyScene(orientation);
    const { width: W, height: H } = sceneSize(sc);
    sc.layers.push({ type: 'photo', photo: e.photo, box: { x: 0, y: 0, width: W, height: H }, fit: e.fit, zoom: e.zoom, crop: e.crop, tone: toneFor(adj, style) });
    if (e.caption.trim())
      sc.layers.push({ type: 'text', text: e.caption, box: { x: 24, y: H - 140, width: W - 48, height: 116 }, size: 64, weight: 'bold', color: e.ink, align: 'center', valign: 'bottom', maxLines: 2 });
    if (e.sticker) sc.layers.push({ type: 'sticker', sticker: e.sticker, box: { x: W - 150, y: 30, width: 120, height: 120 }, color: e.ink === 'white' ? 'red' : e.ink });
    if (e.frame !== 'none') sc.layers.push({ type: 'frame', style: e.frame, color: e.ink === 'white' ? 'black' : e.ink });
    return { scene: sc, style, kind: 'photo', title: e.caption.trim() || 'Photo' };
  }, [e, style, adj, orientation]);

  const { prepared, last } = usePrepared(app, design, 250);
  const ink = useFloodOnce(e.photo, prepared);
  const show = holding || (dock === 'look' && compare) ? 'photo' : 'badge';
  const previewW = orientation === 'portrait' ? Math.min(280, screenW * 0.7) : screenW - 50;

  const photoImg = usePhotoImage(e.photo);

  return (
    <Screen
      onBack={nav.pop}
      back="Cancel"
      title={ink ? `Photo · ${inkLine(ink.shares)}` : 'Photo'}
      flood={ink?.flood ?? 'blue'}
      footer={
        <Btn kind="primary" label="Next: print it" disabled={!design || busy} onPress={() => design && nav.push({ name: 'send', design, flood: ink?.flood })} />
      }
    >
      {fromShare && <Note>From Photos{badge ? `, going to ${badge.name}` : ''}.</Note>}
      {error && <Problem title="Couldn't open that photo" onClose={() => setError(null)}>{error}</Problem>}
      <View style={{ alignItems: 'center', gap: 14, paddingTop: 10 }}>
        {design ? (
          <PhotoCrop
            image={photoImg}
            width={previewW}
            orientation={orientation}
            fit={e.fit}
            zoom={e.zoom}
            crop={e.crop}
            inking={cropPending && !prepared}
            onCommit={(zoom, crop) => set({ zoom, crop }, true)}
            onHold={setHolding}
          >
            <DesignPreview prepared={prepared ?? last} width={previewW} orientation={orientation} show={show} tilt={-1.5} shadow={INK.black} device />
          </PhotoCrop>
        ) : (
          <Pressable onPress={choose} disabled={busy} accessibilityRole="button" accessibilityLabel="Choose a photo">
            <BadgeFrame width={previewW} orientation={orientation} tilt={-1.5} shadow={INK.black} device style={{ alignItems: 'center', justifyContent: 'center', gap: 10 }}>
              <View style={{ position: 'absolute', left: 8, top: 8, right: 8, bottom: 8, borderWidth: 2, borderColor: INK.muted, borderStyle: 'dashed' }} />
              <Icon name="camera" size={40} />
              <Meta text={busy ? 'Opening…' : 'Choose a photo'} color={INK.black} align="center" />
            </BadgeFrame>
          </Pressable>
        )}
        {design && (
          <View style={{ backgroundColor: 'rgba(24,24,27,0.25)', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 6 }}>
            <Label>{show === 'photo' ? 'The original, before the six inks' : 'Pinch and drag · hold for the original'}</Label>
          </View>
        )}
      </View>

      {design && (
      <>

      <ChipStrip>
        {(['photo', 'text', 'sticker', 'frame', 'look'] as Dock[]).map((d) => (
          <Chip key={d} label={d[0].toUpperCase() + d.slice(1)} on={dock === d} onPress={() => setDock(d)} />
        ))}
      </ChipStrip>

      {dock === 'photo' && (
        <Col gap={14}>
          <Col gap={8}>
            <Label>Fit</Label>
            <Row gap={8}>
              <Chip label="Fill the badge" on={e.fit === 'cover'} onPress={() => set({ fit: 'cover' })} />
              <Chip label="Whole photo" on={e.fit === 'contain'} onPress={() => set({ fit: 'contain' })} />
            </Row>
          </Col>
          <Row gap={10}>
            <Btn small flex icon="camera" label="Change photo" onPress={choose} busy={busy} />
            <Btn small kind="ghost" label="Reset" onPress={() => set({ zoom: 1, crop: { x: 0.5, y: 0.5 }, fit: 'cover' })} />
          </Row>
        </Col>
      )}
      {dock === 'text' && (
        <Col gap={14}>
          <Field label="Caption (optional)" placeholder="Words on the picture" value={e.caption} onChangeText={(caption) => set({ caption })} />
          <InkChips value={e.ink} onChange={(ink) => set({ ink })} />
        </Col>
      )}
      {dock === 'sticker' && (
        <Col gap={14}>
          <ChipStrip>
            <Chip label="None" on={!e.sticker} onPress={() => set({ sticker: null })} />
            {STICKER_NAMES.map((n) => (
              <Chip key={n} label={n} on={e.sticker === n} onPress={() => set({ sticker: n })} />
            ))}
          </ChipStrip>
          <InkChips value={e.ink} onChange={(ink) => set({ ink })} />
        </Col>
      )}
      {dock === 'frame' && (
        <Col gap={14}>
          <ChipStrip>
            {FRAMES.map((f) => (
              <Chip key={f} label={f === 'none' ? 'None' : f} on={e.frame === f} onPress={() => set({ frame: f })} />
            ))}
          </ChipStrip>
          <InkChips value={e.ink} onChange={(ink) => set({ ink })} />
        </Col>
      )}
      {dock === 'look' && <Look style={style} setStyle={setStyle} adj={adj} setAdj={setAdj} compare={compare} setCompare={setCompare} />}
      </>
      )}
    </Screen>
  );
}

function Look({
  style,
  setStyle,
  adj,
  setAdj,
  compare,
  setCompare,
}: {
  style: PictureStyle;
  setStyle: (s: PictureStyle) => void;
  adj: Adjustments;
  setAdj: (a: Adjustments) => void;
  compare: boolean;
  setCompare: (c: boolean) => void;
}) {
  return (
    <Col gap={14}>
      <Col gap={8}>
        <Label>Dots</Label>
        <Row gap={8} wrap>
          {STYLE_NAMES.map((n) => (
            <Chip key={n} label={STYLES[n].label} on={style === n} onPress={() => setStyle(n)} />
          ))}
        </Row>
        <T muted size={17}>
          {STYLES[style].description}
        </T>
      </Col>
      {(['colour', 'brightness', 'contrast'] as const).map((k) => (
        <Stepper
          key={k}
          label={k === 'colour' ? 'Ink boost' : k}
          value={`${adj[k] > 0 ? '+' : ''}${adj[k]}`}
          onMinus={() => setAdj({ ...adj, [k]: Math.max(-50, adj[k] - 10) })}
          onPlus={() => setAdj({ ...adj, [k]: Math.min(50, adj[k] + 10) })}
        />
      ))}
      <Col gap={8}>
        <Label>Show</Label>
        <Row gap={8}>
          <Chip label="On badge" on={!compare} onPress={() => setCompare(false)} />
          <Chip label="Original" on={compare} onPress={() => setCompare(true)} />
        </Row>
      </Col>
    </Col>
  );
}

/** A label, its value, and − / + buttons. */
function Stepper({ label, value, onMinus, onPlus }: { label: string; value: string; onMinus: () => void; onPlus: () => void }) {
  const tx = useText();
  return (
    <Row gap={10}>
      <View style={{ flex: 1 }}>
        <Label>{label}</Label>
      </View>
      <Text style={[tx.big, { fontSize: 18, lineHeight: 24, minWidth: 64, textAlign: 'center' }]}>{value}</Text>
      <IconBtn icon="minus" tone="card" label={`Less ${label.toLowerCase()}`} onPress={onMinus} />
      <IconBtn icon="plus" tone="card" label={`More ${label.toLowerCase()}`} onPress={onPlus} />
    </Row>
  );
}

function InkChips({ value, onChange }: { value: ColorName; onChange: (c: ColorName) => void }) {
  return (
    <Col gap={8}>
      <Label>Ink</Label>
      <InkSwatches options={INKS} value={value} onChange={onChange} />
    </Col>
  );
}

// ------------------------------------------------------------------ crop

const MAX_ZOOM = 4;

/** The source rect the badge shows for this zoom and crop (computeFit's cover maths, kept local so it runs per frame). */
function windowFor(iw: number, ih: number, aspect: number, zoom: number, crop: { x: number; y: number }) {
  let w = iw;
  let h = ih;
  if (iw / ih > aspect) w = ih * aspect;
  else h = iw / aspect;
  w /= zoom;
  h /= zoom;
  return { x: (iw - w) * crop.x, y: (ih - h) * crop.y, w, h };
}

/** Back from a window's top-left to the 0..1 crop, clamped so the photo always covers the badge. */
function cropFor(iw: number, ih: number, w: number, h: number, x: number, y: number) {
  return { x: iw - w > 0.5 ? clamp(x / (iw - w)) : 0.5, y: ih - h > 0.5 ? clamp(y / (ih - h)) : 0.5 };
}

/** The decoded photo for the live crop view. */
function usePhotoImage(id: string | null) {
  const { app } = useServices();
  const [img, setImg] = useState<{ id: string; image: SkImage | null } | null>(null);
  useEffect(() => {
    if (!id) return;
    let live = true;
    void photoImage(id, (p) => app.library.photo(p)).then((image) => live && setImg({ id, image }));
    return () => {
      live = false;
    };
  }, [app, id]);
  return img?.id === id ? img.image : null;
}

/**
 * Pinch and drag on the plain photo. While fingers are down (and until the
 * dither is ready) the badge shows the photo itself, moved and scaled live on
 * a Skia canvas; nothing is dithered. On release the new zoom and crop are
 * committed once. Otherwise it shows `children`, the dithered preview.
 */
function PhotoCrop({
  image,
  width,
  orientation,
  fit,
  zoom,
  crop,
  inking,
  onCommit,
  onHold,
  children,
}: {
  image: SkImage | null;
  width: number;
  orientation: 'portrait' | 'landscape';
  fit: FitMode;
  zoom: number;
  crop: { x: number; y: number };
  inking: boolean;
  onCommit: (zoom: number, crop: { x: number; y: number }) => void;
  onHold: (h: boolean) => void;
  children: React.ReactNode;
}) {
  const aspect = orientation === 'portrait' ? 2 / 3 : 3 / 2;
  const [live, setLive] = useState<{ zoom: number; crop: { x: number; y: number } } | null>(null);
  const box = useRef<React.ComponentRef<typeof View>>(null);
  // Everything the handlers need, read only inside them.
  const g = useRef({ image, zoom, crop, aspect, fit, onCommit, viewW: 1, viewH: 1, pageX: 0, pageY: 0, start: null as null | { zoom: number; win: { x: number; y: number; w: number; h: number }; mid: { x: number; y: number }; dist: number; touches: number }, cur: null as null | { zoom: number; crop: { x: number; y: number } }, lastTap: 0 });
  useEffect(() => {
    Object.assign(g.current, { image, zoom, crop, aspect, fit, onCommit });
  }, [image, zoom, crop, aspect, fit, onCommit]);

  // The handlers read g only while a finger is down, never during render.
  // eslint-disable-next-line react-hooks/refs
  const [pan] = useState(() => {
    const touchesOf = (ev: GestureResponderEvent) => ev.nativeEvent.touches.length ? ev.nativeEvent.touches : [ev.nativeEvent];
    const midDist = (t: readonly { pageX: number; pageY: number }[]) => {
      const a = t[0];
      const b = t[1] ?? t[0];
      return { mid: { x: (a.pageX + b.pageX) / 2, y: (a.pageY + b.pageY) / 2 }, dist: Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY) };
    };
    const begin = (ev: GestureResponderEvent) => {
      const s = g.current;
      if (!s.image) return;
      const cur = s.cur ?? { zoom: s.zoom, crop: s.crop };
      const t = touchesOf(ev);
      const { mid, dist } = midDist(t);
      s.start = { zoom: cur.zoom, win: windowFor(s.image.width(), s.image.height(), s.aspect, cur.zoom, cur.crop), mid, dist, touches: t.length };
    };
    return PanResponder.create({
      onMoveShouldSetPanResponder: (ev, gs) => g.current.fit === 'cover' && !!g.current.image && (ev.nativeEvent.touches.length > 1 || Math.abs(gs.dx) + Math.abs(gs.dy) > 4),
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (ev) => {
        onHold(false);
        box.current?.measure((_x: number, _y: number, w: number, h: number, px: number, py: number) => Object.assign(g.current, { viewW: w || 1, viewH: h || 1, pageX: px, pageY: py }));
        g.current.cur = null;
        begin(ev);
      },
      onPanResponderMove: (ev) => {
        const s = g.current;
        if (!s.image || !s.start) return;
        const t = touchesOf(ev);
        // A finger added or lifted: restart from here, so nothing jumps.
        if (t.length !== s.start.touches) return begin(ev);
        const iw = s.image.width();
        const ih = s.image.height();
        const { mid, dist } = midDist(t);
        const z = t.length > 1 && s.start.dist > 10 ? Math.max(1, Math.min(MAX_ZOOM, (s.start.zoom * dist) / s.start.dist)) : s.start.zoom;
        const w0 = s.start.win;
        const k = w0.w / s.viewW; // source px per screen point at the start
        // The source point under the fingers' midpoint stays under it.
        const fx = clamp((s.start.mid.x - s.pageX) / s.viewW);
        const fy = clamp((s.start.mid.y - s.pageY) / s.viewH);
        const sx = w0.x + fx * w0.w - (mid.x - s.start.mid.x) * k;
        const sy = w0.y + fy * w0.h - (mid.y - s.start.mid.y) * k;
        const nw = windowFor(iw, ih, s.aspect, z, { x: 0.5, y: 0.5 });
        const next = { zoom: z, crop: cropFor(iw, ih, nw.w, nw.h, sx - fx * nw.w, sy - fy * nw.h) };
        s.cur = next;
        setLive(next);
      },
      onPanResponderRelease: () => {
        const s = g.current;
        s.start = null;
        if (s.cur) s.onCommit(s.cur.zoom, s.cur.crop);
        setLive(null);
      },
      onPanResponderTerminate: () => {
        g.current.start = null;
        setLive(null);
      },
    });
  });

  // Live view: the window of the photo drawn to fill the badge's screen.
  const showLive = !!image && (live || inking);
  let draw: { x: number; y: number; w: number; h: number } | null = null;
  const screenW = width - 2 * Math.max(3, Math.round(width * DEVICE_BEZEL));
  const screenH = screenW / aspect;
  if (showLive && image) {
    const state = live ?? { zoom, crop };
    if (fit === 'cover') {
      const win = windowFor(image.width(), image.height(), aspect, state.zoom, state.crop);
      const k = screenW / win.w;
      draw = { x: -win.x * k, y: -win.y * k, w: image.width() * k, h: image.height() * k };
    } else {
      const { dst } = computeFit(image.width(), image.height(), screenW, screenH, 'contain');
      draw = { x: dst.x, y: dst.y, w: dst.width, h: dst.height };
    }
  }

  const reset = () => onCommit(1, { x: 0.5, y: 0.5 });
  return (
    <View {...pan.panHandlers}>
      <Pressable
        onPress={() => {
          const now = Date.now();
          if (now - g.current.lastTap < 300) reset();
          g.current.lastTap = now;
        }}
        onLongPress={() => !live && onHold(true)}
        onPressOut={() => onHold(false)}
        delayLongPress={260}
        accessibilityLabel="Your photo as the badge will show it. Pinch to zoom, drag to move, double-tap to reset, hold to see the original."
        accessibilityActions={[{ name: 'zoomIn', label: 'Zoom in' }, { name: 'zoomOut', label: 'Zoom out' }, { name: 'reset', label: 'Reset' }]}
        onAccessibilityAction={(ev) => {
          if (ev.nativeEvent.actionName === 'zoomIn') onCommit(Math.min(MAX_ZOOM, zoom + 0.5), crop);
          else if (ev.nativeEvent.actionName === 'zoomOut') onCommit(Math.max(1, zoom - 0.5), crop);
          else reset();
        }}
      >
        <View ref={box}>
          {showLive && draw ? (
            <BadgeFrame width={width} orientation={orientation} tilt={-1.5} shadow={INK.black} device style={{ backgroundColor: INK.white }}>
              <Canvas style={{ width: screenW, height: screenH }}>
                <SkiaImage image={image} x={draw.x} y={draw.y} width={draw.w} height={draw.h} fit="fill" />
              </Canvas>
              {inking && !live && (
                <View style={{ position: 'absolute', right: 6, bottom: 6, backgroundColor: INK.black, paddingHorizontal: 6, paddingVertical: 2 }}>
                  <Meta text="Inking…" color={INK.paper} size={10} />
                </View>
              )}
            </BadgeFrame>
          ) : (
            children
          )}
        </View>
      </Pressable>
    </View>
  );
}
