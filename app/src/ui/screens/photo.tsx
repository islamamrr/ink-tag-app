// The photo editor, flooded in the photo's main ink: the badge's outline is
// the crop. Drag the picture to move it, hold it to see the original, zoom
// with the buttons, then a dock for Text, Sticker, Frame and Look (styles,
// sliders, and the Original / On badge compare).

import { useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, Pressable, Text, useWindowDimensions, View } from 'react-native';

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
} from '../../core';
import { pickPhotos } from '../../services/inkTag';
import { Btn, Chip, ChipStrip, Col, Field, IconBtn, InkSwatches, Label, Note, Problem, Row, Screen, T, useText } from '../kit';
import { useNav } from '../nav';
import { DesignPreview, useFloodOnce, usePrepared } from '../pictures';
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
  const set = (p: Partial<EditState>) => setE((x) => ({ ...x, ...p }));

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
  const previewW = orientation === 'portrait' ? Math.min(240, screenW * 0.6) : screenW - 60;

  // Drag the picture under the badge outline.
  const geo = useRef({ zoom: e.zoom, width: previewW, start: e.crop });
  useEffect(() => {
    geo.current.zoom = e.zoom;
    geo.current.width = previewW;
  }, [e.zoom, previewW]);
  // The handlers read geo only while dragging, never during render.
  // eslint-disable-next-line react-hooks/refs
  const [pan] = useState(() =>
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) + Math.abs(g.dy) > 4,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        setE((x) => {
          geo.current.start = x.crop;
          return x;
        });
      },
      onPanResponderMove: (_, g) => {
        const { width, zoom, start } = geo.current;
        const k = 1 / (width * Math.max(1, zoom));
        setE((x) => ({ ...x, crop: { x: clamp(start.x - g.dx * k), y: clamp(start.y - g.dy * k) } }));
      },
    }),
  );

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
      <View style={{ alignItems: 'center', gap: 14, paddingTop: 10 }} {...pan.panHandlers}>
        {design ? (
          <Pressable
            onLongPress={() => setHolding(true)}
            onPressOut={() => setHolding(false)}
            delayLongPress={220}
            accessibilityLabel="Your photo as the badge will show it. Hold to see the original, drag to move it."
          >
            <DesignPreview prepared={prepared ?? last} width={previewW} orientation={orientation} show={show} tilt={-1.5} shadow={INK.black} />
          </Pressable>
        ) : (
          <View style={{ paddingVertical: 40 }}>
            <Btn kind="primary" icon="camera" label={busy ? 'Opening…' : 'Choose a photo'} busy={busy} onPress={choose} />
          </View>
        )}
        {design && (
          <View style={{ backgroundColor: 'rgba(24,24,27,0.25)', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 6 }}>
            <Label>{show === 'photo' ? 'The original, before the six inks' : 'Hold to see the original · drag to move'}</Label>
          </View>
        )}
      </View>

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
          <Stepper label="Zoom" value={`${Math.round(e.zoom * 100)}%`} onMinus={() => set({ zoom: Math.max(1, e.zoom - 0.25) })} onPlus={() => set({ zoom: Math.min(4, e.zoom + 0.25) })} />
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
