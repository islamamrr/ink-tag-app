// v1 services screen: drives every v1 feature of the InkTag service from a
// phone, without the product UI (designed separately). Badges (scan, add
// with lock, demo, reconnect, redraw, blank, screen check, lock, forget),
// Create (every template, photos with style, adjust, crop, text, stickers
// and frames, the true preview), Send with progress, and the Library.

import { Canvas, Image as SkiaImage, type SkImage } from '@shopify/react-native-skia';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image, ScrollView, Switch, Text, TextInput, View } from 'react-native';

import {
  type Adjustments,
  type Design,
  emptyScene,
  type FrameStyle,
  frameToRgba,
  type InkTag,
  type LibraryFilter,
  type LibraryItem,
  type NearbyBadge,
  NO_ADJUSTMENTS,
  type PictureStyle,
  type Prepared,
  type SavedBadge,
  type Scene,
  type SendProgress,
  STICKER_NAMES,
  type StickerName,
  STYLE_NAMES,
  STYLES,
  TEMPLATES,
  toBase64,
  toneFor,
  type Values,
  userMessage,
  withDefaults,
  template as templateDef,
  type ColorName,
} from '../core';
import { getInkTag, importPhoto, onServiceLog, pickPhotos } from '../services/inkTag';
import { toSkImage } from '../services/render';
import type { SharedPhoto } from '../services/share';
import { Banner, Bar, Btn, Card, KV, Row, s } from './devUi';

type Tab = 'badges' | 'create' | 'library';
type Mode = { kind: 'photo' } | { kind: 'template'; id: string };

const PREVIEW_W = 176;
const PREVIEW_H = 264;
const INKS: ColorName[] = ['black', 'white', 'red', 'yellow', 'blue', 'green'];
const FRAMES: (FrameStyle | 'none')[] = ['none', 'line', 'double', 'rounded', 'corners', 'dashed'];

function useInkTag() {
  const [app, setApp] = useState<InkTag | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [, force] = useState(0);
  useEffect(() => {
    let unsub = () => {};
    getInkTag()
      .then((a) => {
        setApp(a);
        unsub = a.subscribe(() => force((n) => n + 1));
      })
      .catch(setError);
    return () => unsub();
  }, []);
  return { app, error };
}

const ago = (t?: number) => {
  if (!t) return 'never';
  const m = Math.round((Date.now() - t) / 60_000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
};

export default function V1Screen({ shared, onSharedUsed }: { shared?: SharedPhoto | null; onSharedUsed?: () => void }) {
  const { app, error } = useInkTag();
  const [tab, setTab] = useState<Tab>('badges');
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);

  useEffect(
    () =>
      onServiceLog((kind, text) => {
        console.log(`[inktag:v1] ${kind} ${text}`);
        setLog((l) => [...l.slice(-80), `${kind} ${text}`]);
      }),
    [],
  );

  // Reconnect to the last badge at launch.
  const reconnected = useRef(false);
  useEffect(() => {
    if (!app || reconnected.current) return;
    reconnected.current = true;
    app.reconnect().then((ok) => {
      const b = app.badges.current();
      if (b) setNotice(ok ? `Reconnected to ${b.name}` : `${b.name} is not nearby`);
    });
  }, [app]);

  const run = useCallback(async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    setProblem(null);
    try {
      await fn();
    } catch (e) {
      setProblem(userMessage(e));
      console.warn('[inktag:v1]', e);
    } finally {
      setBusy(null);
    }
  }, []);

  if (error) return <Banner tone="error" title={`Couldn't start: ${userMessage(error)}`} />;
  if (!app) return <Text style={{ padding: 48 }}>Loading…</Text>;

  const current = app.badges.current();
  const conn = app.connection();

  return (
    <ScrollView contentContainerStyle={{ padding: 12, paddingTop: 12, gap: 10, backgroundColor: '#f3f4f6' }}>
      <Row>
        {(['badges', 'create', 'library'] as Tab[]).map((t) => (
          <Btn key={t} label={t[0].toUpperCase() + t.slice(1)} kind={tab === t ? 'primary' : 'quiet'} onPress={() => setTab(t)} />
        ))}
      </Row>
      <Text style={s.small}>
        {current ? `${conn.badgeId === current.id && conn.status === 'connected' ? '●' : '○'} ${current.name}` : 'No badge yet'}
        {busy ? ` · ${busy}…` : ''}
        {!app.bluetooth ? ' · no Bluetooth in this build: demo badges only' : ''}
      </Text>
      {problem && <Banner tone="error" title={problem} onClose={() => setProblem(null)} />}
      {!problem && notice && <Banner tone="info" title={notice} onClose={() => setNotice(null)} />}

      {tab === 'badges' && <BadgesTab app={app} run={run} busy={!!busy} setNotice={setNotice} />}
      {tab === 'create' && (
        <CreateTab app={app} run={run} busy={!!busy} badge={current} shared={shared} onSharedUsed={onSharedUsed} />
      )}
      {tab === 'library' && <LibraryTab app={app} run={run} busy={!!busy} badge={current} />}

      <Card title="Service log">
        <Text style={s.mono}>{log.slice(-25).join('\n') || '—'}</Text>
      </Card>
    </ScrollView>
  );
}

type Run = (label: string, fn: () => Promise<unknown>) => Promise<void>;

// ------------------------------------------------------------------ badges

function BadgesTab({ app, run, busy, setNotice }: { app: InkTag; run: Run; busy: boolean; setNotice: (s: string) => void }) {
  const [nearby, setNearby] = useState<NearbyBadge[] | null>(null);
  const [name, setName] = useState('');
  const [lock, setLock] = useState(true);
  const conn = app.connection();

  const scan = () =>
    run('Scanning', async () => {
      setNearby([]);
      await app.scan({ timeoutMs: 6000, onUpdate: setNearby }).then(setNearby);
    });
  const add = (b?: NearbyBadge) =>
    run('Adding', async () => {
      const setup = { name: name.trim() || undefined, lock };
      const r = b ? await app.addBadge(b, setup) : await app.addDemoBadge(setup);
      setNotice(
        `Added ${r.badge.name}${r.badge.ownerKey ? ', locked to this phone' : ''}${r.lockUnsupported ? ' (firmware too old to lock)' : ''}. It shows "Hello".`,
      );
      setNearby(null);
    });

  return (
    <>
      <Card title="Add a badge">
        <TextInput style={input} placeholder="Badge name (optional)" value={name} onChangeText={setName} />
        <Row>
          <Switch value={lock} onValueChange={setLock} />
          <Text style={s.body}>Only my phone can change it</Text>
        </Row>
        <Row>
          <Btn label="Scan" onPress={scan} disabled={busy || !app.bluetooth} />
          <Btn label="Add demo badge" kind="quiet" onPress={() => add()} disabled={busy} />
        </Row>
        {nearby?.map((b) => (
          <Row key={b.id}>
            <Text style={[s.body, { flex: 1 }]}>
              {b.name} · {b.proximity.label}
              {b.saved ? ` · already added as ${b.saved.name}` : ''}
            </Text>
            <Btn label="Add" onPress={() => add(b)} disabled={busy} />
          </Row>
        ))}
        {nearby?.length === 0 && !busy && <Text style={s.small}>Nothing found. Is the badge on and close by?</Text>}
      </Card>

      {app.badges.list().map((b) => (
        <BadgeCard key={b.id} app={app} badge={b} run={run} busy={busy} connected={conn.badgeId === b.id && conn.status === 'connected'} />
      ))}
    </>
  );
}

function BadgeCard({ app, badge, run, busy, connected }: { app: InkTag; badge: SavedBadge; run: Run; busy: boolean; connected: boolean }) {
  const [rename, setRename] = useState(badge.name);
  const shown = badge.shownItemId ? app.library.get(badge.shownItemId) : undefined;
  return (
    <Card title={badge.name} right={<Text style={s.small}>{connected ? '● connected' : '○'}</Text>}>
      <KV k="Kind" v={badge.kind === 'demo' ? 'demo (simulated)' : `${badge.advertisedName} · fw ${badge.firmware ?? '?'}`} />
      <KV k="Use · hangs" v={`${badge.use} · ${badge.orientation}`} />
      <KV k="On the badge" v={shown ? `${shown.title}, ${ago(badge.shownAt)}` : badge.shownAt ? `blank, ${ago(badge.shownAt)}` : 'nothing yet'} />
      <KV k="Lock" v={badge.ownerKey ? 'locked to this phone' : 'off'} />
      <KV k="Screen" v={badge.screen?.message ?? 'not checked'} tone={badge.screen && badge.screen.status !== 'ok' && badge.screen.status !== 'unknown' ? 'bad' : undefined} />
      <KV k="Last connected" v={ago(badge.lastConnectedAt)} />
      <Row>
        <Btn label={connected ? 'Disconnect' : 'Connect'} kind="quiet" disabled={busy} onPress={() => run(connected ? 'Disconnecting' : 'Connecting', () => (connected ? app.disconnect() : app.connect(badge.id)))} />
        <Btn label="Redraw" kind="quiet" disabled={busy} onPress={() => run('Redrawing', () => app.redraw(badge.id))} />
        <Btn label="Blank" kind="quiet" disabled={busy} onPress={() => run('Blanking', () => app.blank(badge.id))} />
        <Btn label="Screen check" kind="quiet" disabled={busy} onPress={() => run('Checking', () => app.checkScreen(badge.id))} />
      </Row>
      <Row>
        <Btn label={badge.ownerKey ? 'Unlock' : 'Lock to this phone'} kind="quiet" disabled={busy} onPress={() => run('Changing lock', () => app.setLocked(badge.id, !badge.ownerKey))} />
        <Btn label={badge.orientation === 'portrait' ? 'Hang sideways' : 'Hang upright'} kind="quiet" disabled={busy} onPress={() => run('Saving', () => app.setOrientation(badge.id, badge.orientation === 'portrait' ? 'landscape' : 'portrait'))} />
        <Btn label="Forget" kind="danger" disabled={busy} onPress={() => run('Forgetting', () => app.forget(badge.id))} />
      </Row>
      <Row>
        <TextInput style={[input, { flex: 1 }]} value={rename} onChangeText={setRename} />
        <Btn label="Rename" kind="quiet" disabled={busy || rename === badge.name} onPress={() => run('Renaming', () => app.rename(badge.id, rename))} />
      </Row>
      {badge.kind === 'demo' && <DemoPanel app={app} badgeId={badge.id} />}
    </Card>
  );
}

/** What a demo badge's simulated screen shows. */
function DemoPanel({ app, badgeId }: { app: InkTag; badgeId: string }) {
  const [img, setImg] = useState<SkImage | null>(null);
  const drawn = useRef<Uint8Array | null>(null);
  useEffect(() => {
    const t = setInterval(() => {
      const shown = app.demoTag(badgeId)?.shown;
      if (!shown || shown === drawn.current) return;
      drawn.current = shown;
      setImg(toSkImage(frameToRgba(shown, app.badges.get(badgeId)?.orientation ?? 'portrait')));
    }, 500);
    return () => clearInterval(t);
  }, [app, badgeId]);
  return img ? <Preview image={img} label="Demo badge screen" landscape={app.badges.get(badgeId)?.orientation === 'landscape'} /> : null;
}

// ------------------------------------------------------------------ create

function CreateTab({
  app,
  run,
  busy,
  badge,
  shared,
  onSharedUsed,
}: {
  app: InkTag;
  run: Run;
  busy: boolean;
  badge?: SavedBadge;
  shared?: SharedPhoto | null;
  onSharedUsed?: () => void;
}) {
  const orientation = badge?.orientation ?? 'portrait';
  const [mode, setMode] = useState<Mode>({ kind: 'photo' });
  const [values, setValues] = useState<Values>({});
  const [layout, setLayout] = useState(0);
  const [style, setStyle] = useState<PictureStyle>('smooth');
  const [adj, setAdj] = useState<Adjustments>(NO_ADJUSTMENTS);
  // Photo mode
  const [photo, setPhoto] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [crop, setCrop] = useState({ x: 0.5, y: 0.5 });
  const [caption, setCaption] = useState('');
  const [sticker, setSticker] = useState<StickerName | null>(null);
  const [frame, setFrame] = useState<FrameStyle | 'none'>('none');
  const [ink, setInk] = useState<ColorName>('white');
  // Preview and sending
  const [preparedFor, setPreparedFor] = useState<{ design: Design; prepared: Prepared } | null>(null);
  const [showBadge, setShowBadge] = useState(true);
  const [progress, setProgress] = useState<SendProgress | null>(null);
  const abort = useRef<AbortController | null>(null);

  // A photo shared from another app opens here.
  useEffect(() => {
    if (!shared) return;
    run('Importing shared photo', async () => {
      setMode({ kind: 'photo' });
      setPhoto(await importPhoto(shared.uri));
      onSharedUsed?.();
    });
  }, [shared, run, onSharedUsed]);

  const design: Design | null = useMemo(() => {
    if (mode.kind === 'template') {
      const t = templateDef(mode.id);
      const scene = t.build(withDefaults(t, values), { orientation, layout: Math.min(layout, t.layouts - 1) });
      // The Adjust sliders and the style's tone apply to the template's photos.
      for (const l of scene.layers) if (l.type === 'photo') l.tone = toneFor(adj, style);
      return { scene, style, kind: mode.id === 'text' ? 'text' : mode.id === 'qr' ? 'qr' : mode.id === 'collage' ? 'collage' : 'template', title: t.title, template: { id: t.id, values, layout } };
    }
    if (!photo) return null;
    const scene: Scene = emptyScene(orientation);
    const W = orientation === 'portrait' ? 528 : 792;
    const H = orientation === 'portrait' ? 792 : 528;
    scene.layers.push({ type: 'photo', photo, box: { x: 0, y: 0, width: W, height: H }, fit: 'cover', zoom, crop, tone: toneFor(adj, style) });
    if (caption.trim())
      scene.layers.push({ type: 'text', text: caption, box: { x: 24, y: H - 140, width: W - 48, height: 116 }, size: 64, weight: 'bold', color: ink, align: 'center', valign: 'bottom', maxLines: 2 });
    if (sticker) scene.layers.push({ type: 'sticker', sticker, box: { x: W - 150, y: 30, width: 120, height: 120 }, color: ink === 'white' ? 'red' : ink });
    if (frame !== 'none') scene.layers.push({ type: 'frame', style: frame, color: ink === 'white' ? 'black' : ink });
    return { scene, style, kind: 'photo', title: 'Photo' };
  }, [mode, values, layout, style, adj, photo, zoom, crop, caption, sticker, frame, ink, orientation]);

  // Redraw the preview shortly after each change.
  useEffect(() => {
    if (!design) return;
    const t = setTimeout(() => {
      app.prepare(design).then((prepared) => setPreparedFor({ design, prepared })).catch(() => {});
    }, 350);
    return () => clearTimeout(t);
  }, [app, design]);
  const prepared = preparedFor && preparedFor.design === design ? preparedFor.prepared : null;

  const send = () =>
    run('Sending', async () => {
      if (!badge || !design) return;
      abort.current = new AbortController();
      await activateKeepAwakeAsync('inktag-send').catch(() => {});
      try {
        const r = await app.send(badge.id, design, { onProgress: setProgress, signal: abort.current.signal, prepared: prepared ?? undefined });
        r.displayed.then(() => setProgress(app.sending()));
      } finally {
        deactivateKeepAwake('inktag-send');
      }
    });

  const t = mode.kind === 'template' ? templateDef(mode.id) : null;
  const previewImg = prepared ? toSkImage(showBadge ? prepared.converted.preview : prepared.rendered) : null;

  return (
    <>
      <Card title="Make">
        <Row>
          <Btn label="Photo" kind={mode.kind === 'photo' ? 'primary' : 'quiet'} onPress={() => setMode({ kind: 'photo' })} />
          {TEMPLATES.map((x) => (
            <Btn key={x.id} label={x.title} kind={mode.kind === 'template' && mode.id === x.id ? 'primary' : 'quiet'} onPress={() => { setMode({ kind: 'template', id: x.id }); setLayout(0); }} />
          ))}
        </Row>
      </Card>

      {mode.kind === 'photo' ? (
        <Card title="Photo">
          <Row>
            <Btn label={photo ? 'Change photo' : 'Pick photo'} onPress={() => run('Importing', async () => { const [id] = await pickPhotos(1); if (id) { setPhoto(id); setZoom(1); setCrop({ x: 0.5, y: 0.5 }); } })} disabled={busy} />
            <Btn label="Zoom +" kind="quiet" onPress={() => setZoom((z) => Math.min(4, z + 0.25))} />
            <Btn label="Zoom −" kind="quiet" onPress={() => setZoom((z) => Math.max(1, z - 0.25))} />
          </Row>
          <Row>
            {(['←', '→', '↑', '↓'] as const).map((d) => (
              <Btn key={d} label={d} kind="quiet" onPress={() => setCrop((c) => ({ x: Math.max(0, Math.min(1, c.x + (d === '←' ? -0.1 : d === '→' ? 0.1 : 0))), y: Math.max(0, Math.min(1, c.y + (d === '↑' ? -0.1 : d === '↓' ? 0.1 : 0))) }))} />
            ))}
            <Text style={s.small}>zoom {zoom.toFixed(2)} · crop {crop.x.toFixed(1)}, {crop.y.toFixed(1)}</Text>
          </Row>
          <TextInput style={input} placeholder="Text on the picture (optional)" value={caption} onChangeText={setCaption} />
          <Row>
            <Text style={s.small}>Ink</Text>
            {INKS.map((c) => <Btn key={c} label={c} kind={ink === c ? 'primary' : 'quiet'} onPress={() => setInk(c)} />)}
          </Row>
          <Row>
            <Text style={s.small}>Sticker</Text>
            <Btn label="none" kind={!sticker ? 'primary' : 'quiet'} onPress={() => setSticker(null)} />
            {STICKER_NAMES.map((n) => <Btn key={n} label={n} kind={sticker === n ? 'primary' : 'quiet'} onPress={() => setSticker(n)} />)}
          </Row>
          <Row>
            <Text style={s.small}>Frame</Text>
            {FRAMES.map((f) => <Btn key={f} label={f} kind={frame === f ? 'primary' : 'quiet'} onPress={() => setFrame(f)} />)}
          </Row>
        </Card>
      ) : (
        t && (
          <Card title={t.title}>
            <Text style={s.small}>{t.description}</Text>
            {t.layouts > 1 && (
              <Row>
                <Text style={s.small}>Layout</Text>
                {Array.from({ length: t.layouts }, (_, i) => <Btn key={i} label={String(i + 1)} kind={layout === i ? 'primary' : 'quiet'} onPress={() => setLayout(i)} />)}
              </Row>
            )}
            {t.fields.map((f) => {
              const v = values[f.key] ?? f.default;
              if (f.kind === 'choice')
                return (
                  <Row key={f.key}>
                    <Text style={s.small}>{f.label}</Text>
                    {f.options!.map((o) => <Btn key={o.value} label={o.label} kind={v === o.value ? 'primary' : 'quiet'} onPress={() => setValues((x) => ({ ...x, [f.key]: o.value }))} />)}
                  </Row>
                );
              if (f.kind === 'toggle')
                return (
                  <Row key={f.key}>
                    <Switch value={v === true} onValueChange={(on) => setValues((x) => ({ ...x, [f.key]: on }))} />
                    <Text style={s.body}>{f.label}</Text>
                  </Row>
                );
              if (f.kind === 'photo')
                return (
                  <Row key={f.key}>
                    <Text style={s.small}>{f.label}: {v ? 'chosen' : 'none'}</Text>
                    <Btn label="Pick" kind="quiet" onPress={() => run('Importing', async () => { const [id] = await pickPhotos(1); if (id) setValues((x) => ({ ...x, [f.key]: id })); })} />
                    {!!v && <Btn label="Remove" kind="quiet" onPress={() => setValues((x) => ({ ...x, [f.key]: undefined }))} />}
                  </Row>
                );
              return (
                <TextInput
                  key={f.key}
                  style={input}
                  placeholder={`${f.label}${f.placeholder ? ` (${f.placeholder})` : ''}`}
                  value={typeof v === 'string' ? v : ''}
                  multiline={f.kind === 'multiline'}
                  secureTextEntry={false}
                  autoCapitalize={f.kind === 'url' || f.kind === 'email' || f.kind === 'password' ? 'none' : 'sentences'}
                  keyboardType={f.kind === 'phone' ? 'phone-pad' : f.kind === 'email' ? 'email-address' : f.kind === 'url' ? 'url' : 'default'}
                  onChangeText={(text) => setValues((x) => ({ ...x, [f.key]: text }))}
                />
              );
            })}
          </Card>
        )
      )}

      <Card title="Style and adjust">
        <Row>
          {STYLE_NAMES.map((n) => <Btn key={n} label={STYLES[n].label} kind={style === n ? 'primary' : 'quiet'} onPress={() => setStyle(n)} />)}
        </Row>
        <Text style={s.small}>{STYLES[style].description}</Text>
        {(['brightness', 'contrast', 'colour'] as const).map((k) => (
          <Row key={k}>
            <Text style={[s.small, { width: 90 }]}>{k === 'colour' ? 'Colour boost' : k[0].toUpperCase() + k.slice(1)} {adj[k] > 0 ? '+' : ''}{adj[k]}</Text>
            <Btn label="−" kind="quiet" onPress={() => setAdj((a) => ({ ...a, [k]: Math.max(-50, a[k] - 10) }))} />
            <Btn label="+" kind="quiet" onPress={() => setAdj((a) => ({ ...a, [k]: Math.min(50, a[k] + 10) }))} />
          </Row>
        ))}
      </Card>

      <Card title="Preview" right={<Row><Btn label="Photo" kind={!showBadge ? 'primary' : 'quiet'} onPress={() => setShowBadge(false)} /><Btn label="On badge" kind={showBadge ? 'primary' : 'quiet'} onPress={() => setShowBadge(true)} /></Row>}>
        {design ? (
          previewImg ? <Preview image={previewImg} label={showBadge ? 'What the six-colour screen will show' : 'Before converting to six colours'} landscape={orientation === 'landscape'} /> : <Text style={s.small}>Drawing…</Text>
        ) : (
          <Text style={s.small}>Pick a photo or a template.</Text>
        )}
        {prepared && <Text style={s.small}>dither {prepared.converted.timings.dither} ms · {Object.entries(prepared.converted.shares).map(([k, v]) => `${k} ${(v * 100).toFixed(0)}%`).join(' · ')}</Text>}
        <Row>
          <Btn label={badge ? `Send to ${badge.name}` : 'Add a badge first'} kind="primary" disabled={busy || !badge || !design} onPress={send} />
          {busy && progress && progress.stage !== 'refreshing' && <Btn label="Cancel" kind="danger" onPress={() => abort.current?.abort()} />}
        </Row>
        {progress && <ProgressView p={progress} />}
      </Card>
    </>
  );
}

function ProgressView({ p }: { p: SendProgress }) {
  return (
    <View style={{ gap: 4 }}>
      <Bar value={p.fraction} />
      <Text style={s.body}>
        {p.label}
        {p.stage === 'sending' ? ` · ${Math.round((p.sent / Math.max(1, p.total)) * 100)}%` : ''}
        {p.secondsLeft ? ` · about ${p.secondsLeft} s left` : ''}
      </Text>
      {p.safeToLeave && p.stage !== 'done' && <Text style={s.small}>The badge has the picture. You can walk away; it finishes on its own.</Text>}
    </View>
  );
}

// ------------------------------------------------------------------ library

function LibraryTab({ app, run, busy, badge }: { app: InkTag; run: Run; busy: boolean; badge?: SavedBadge }) {
  const [filter, setFilter] = useState<LibraryFilter>({ kind: 'all' });
  const [newCollection, setNewCollection] = useState('');
  const collections = app.library.collections();
  const sections = app.library.sections(filter);
  return (
    <>
      <Card title="Library">
        <Row>
          <Btn label="All" kind={filter.kind === 'all' ? 'primary' : 'quiet'} onPress={() => setFilter({ kind: 'all' })} />
          <Btn label="Favourites" kind={filter.kind === 'favourites' ? 'primary' : 'quiet'} onPress={() => setFilter({ kind: 'favourites' })} />
          {collections.map((c) => (
            <Btn key={c.id} label={`${c.name} (${c.itemIds.length})`} kind={filter.kind === 'collection' && filter.id === c.id ? 'primary' : 'quiet'} onPress={() => setFilter({ kind: 'collection', id: c.id })} />
          ))}
        </Row>
        <Row>
          <TextInput style={[input, { flex: 1 }]} placeholder="New collection" value={newCollection} onChangeText={setNewCollection} />
          <Btn label="Create" kind="quiet" disabled={!newCollection.trim()} onPress={() => run('Saving', async () => { await app.library.createCollection(newCollection); setNewCollection(''); })} />
        </Row>
      </Card>
      {sections.map((sec) => (
        <Card key={sec.title || 'collection'} title={sec.title || 'In this collection'}>
          {sec.items.map((item) => (
            <LibraryRow key={item.id} app={app} item={item} run={run} busy={busy} badge={badge} inCollection={filter.kind === 'collection' ? filter.id : undefined} />
          ))}
        </Card>
      ))}
      {!sections.length && <Text style={s.small}>Nothing here yet. Send a picture and it appears here.</Text>}
    </>
  );
}

function LibraryRow({ app, item, run, busy, badge, inCollection }: { app: InkTag; item: LibraryItem; run: Run; busy: boolean; badge?: SavedBadge; inCollection?: string }) {
  const [uri, setUri] = useState<string | null>(null);
  useEffect(() => {
    app.library.preview(item.id).then((b) => b && setUri(`data:image/png;base64,${toBase64(b)}`));
  }, [app, item.id]);
  const collections = app.library.collections();
  return (
    <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
      {uri ? <Image source={{ uri }} style={{ width: 60, height: 90, backgroundColor: '#ddd' }} resizeMode="contain" /> : <View style={{ width: 60, height: 90, backgroundColor: '#ddd' }} />}
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={s.body}>
          {item.favourite ? '★ ' : ''}
          {item.title} · {item.style} · sent {item.sends.length}×
        </Text>
        <Row>
          <Btn label="Send again" kind="primary" disabled={busy || !badge} onPress={() => run('Sending', async () => { await app.send(badge!.id, { itemId: item.id }); })} />
          <Btn label={item.favourite ? 'Unfavourite' : 'Favourite'} kind="quiet" onPress={() => run('Saving', () => app.library.setFavourite(item.id, !item.favourite))} />
          {inCollection ? (
            <Btn label="Remove from collection" kind="quiet" onPress={() => run('Saving', () => app.library.removeFromCollection(inCollection, item.id))} />
          ) : (
            collections.map((c) => <Btn key={c.id} label={`+ ${c.name}`} kind="quiet" onPress={() => run('Saving', () => app.library.addToCollection(c.id, item.id))} />)
          )}
          <Btn label="Delete" kind="danger" onPress={() => run('Deleting', () => app.library.remove(item.id))} />
        </Row>
      </View>
    </View>
  );
}

// ------------------------------------------------------------------ bits

function Preview({ image, label, landscape }: { image: SkImage; label: string; landscape?: boolean }) {
  const w = landscape ? PREVIEW_H : PREVIEW_W;
  const h = landscape ? PREVIEW_W : PREVIEW_H;
  return (
    <View style={{ gap: 4 }}>
      <Canvas style={{ width: w, height: h, backgroundColor: '#ddd' }}>
        <SkiaImage image={image} x={0} y={0} width={w} height={h} fit="contain" />
      </Canvas>
      <Text style={s.small}>{label}</Text>
    </View>
  );
}

const input = { borderWidth: 1, borderColor: '#ccc', borderRadius: 6, padding: 8, backgroundColor: 'white', color: '#222' } as const;

