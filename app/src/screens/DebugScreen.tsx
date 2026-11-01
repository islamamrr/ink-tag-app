// Development screen: drives the core against a real badge over Bluetooth
// or the simulator badge. Built for testing quickly, not for looks; the
// product UI is planned separately.
//
// The loop it is made for: open the app (it reconnects to the last badge),
// "Pick & send", watch each stage (erase, send, verify, refresh) with its
// timing, read a plain result or problem at the top, repeat.

import { Canvas, Image as SkiaImage, type SkImage } from '@shopify/react-native-skia';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Share, Text, View } from 'react-native';

import {
  BluetoothError,
  CancelledError,
  Color,
  type ColorName,
  type Converted,
  convertFitted,
  DisconnectedError,
  type DisplayOutcome,
  type DitherMethod,
  ErrorCode,
  type FitMode,
  frameToRgba,
  panelAnswering,
  type RadioState,
  supportsTemp,
  TagError,
  type TagInfo,
  targetSize,
  TimeoutError,
  type UploadStage,
  UploadError,
  userMessage,
} from '../core';
import {
  type BadgeHandle,
  connect,
  type Connection,
  findBadge,
  scan,
  SIMULATOR,
} from '../services/badges';
import { type Picture, pickPhoto, renderFitted, toSkImage } from '../services/picture';
import { loadPrefs, type Prefs, savePrefs } from '../services/prefs';
import { bluetoothAvailable, watchBluetooth } from '../services/radio';
import { Banner, Bar, Btn, Card, KV, Row, s } from './devUi';

const PREVIEW_W = 150;
const PREVIEW_H = 225;
const MAX_LOG = 300;
const MAX_HISTORY = 12;

// ------------------------------------------------------------------ types

type LogKind = 'tx' | 'rx' | 'info' | 'error' | 'sim' | 'app';
interface LogLine {
  t: number;
  kind: LogKind;
  text: string;
}

type StageName = UploadStage | 'refreshing';
const STAGE_LABEL: Record<StageName, string> = {
  erasing: 'Erase storage',
  sending: 'Send picture',
  verifying: 'Check CRC',
  refreshing: 'Refresh panel',
};

interface Stage {
  name: StageName;
  start: number;
  end?: number;
  attempt: number;
}

/** One send, show or clear, as the progress card shows it. */
interface Op {
  label: string;
  startedAt: number;
  stages: Stage[];
  sent: number;
  total: number;
  endedAt?: number;
  result?: { ok: boolean; text: string };
}

interface Problem {
  title: string;
  detail?: string;
  hint?: string;
}

interface HistoryItem {
  at: number;
  ok: boolean;
  text: string;
}

const isCancel = (e: unknown) =>
  (e instanceof UploadError ? e.cause : e) instanceof CancelledError;
const secs = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const clock = (t: number) => new Date(t).toTimeString().slice(0, 8);

/** Turns any failure into the banner at the top: what happened, the raw error, what to try. */
function describe(e: unknown): Problem {
  const err = e instanceof UploadError ? e.cause : e;
  const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  let hint: string | undefined;
  if (err instanceof TagError && err.code === ErrorCode.PANEL_TIMEOUT)
    hint =
      'The panel never reported it finished (BUSY stayed put). Expected while no panel or ' +
      'booster is wired. A sent picture is still stored on the badge.';
  else if (err instanceof TimeoutError)
    hint = 'If the badge rebooted (reflash, brown-out), reconnect. Otherwise move closer.';
  else if (err instanceof DisconnectedError)
    hint = 'Tap Reconnect. The badge may have rebooted or gone out of range.';
  else if (err instanceof BluetoothError && err.problem === 'connect-failed')
    hint = 'Check the badge is powered and not connected to another phone or the PC tool.';
  return { title: userMessage(e), detail, hint };
}

// ------------------------------------------------------------------ screen

export default function DebugScreen() {
  const [prefs, setPrefsState] = useState<Prefs>(loadPrefs);
  const setPrefs = useCallback((patch: Partial<Prefs>) => {
    setPrefsState((p) => {
      const next = { ...p, ...patch };
      savePrefs(next);
      return next;
    });
  }, []);

  const [conn, setConn] = useState<Connection | null>(null);
  const [info, setInfo] = useState<TagInfo | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [btState, setBtState] = useState<RadioState | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null);
  const [log, setLog] = useState<LogLine[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);

  const [picture, setPicture] = useState<Picture | null>(null);
  const [converted, setConverted] = useState<Converted | null>(null);
  const [preview, setPreview] = useState<SkImage | null>(null);
  const [panel, setPanel] = useState<SkImage | null>(null);

  const [op, setOp] = useState<Op | null>(null);
  const [now, setNow] = useState(0);
  const [canCancel, setCanCancel] = useState(false);

  const [found, setFound] = useState<BadgeHandle[]>([]);
  const [scanning, setScanning] = useState(false);
  /** The badge the link dropped from, for the Reconnect button. */
  const [lost, setLost] = useState<BadgeHandle | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const scanAbortRef = useRef<AbortController | null>(null);
  const simRef = useRef<Connection['sim']>(undefined);
  const connRef = useRef<Connection | null>(null);
  useEffect(() => {
    connRef.current = conn;
  }, [conn]);

  // ---------------------------------------------------------------- log

  const add = useCallback((kind: LogKind, text: string) => {
    // Also to the console, so the dev server's terminal shows the badge log.
    console.log(`[inktag] ${kind} ${text}`);
    setLog((l) => [{ t: Date.now(), kind, text }, ...l].slice(0, MAX_LOG));
  }, []);

  const remember = (ok: boolean, text: string) =>
    setHistory((h) => [{ at: Date.now(), ok, text }, ...h].slice(0, MAX_HISTORY));

  const fail = useCallback(
    (e: unknown) => {
      const p = describe(e);
      add('error', `${p.title} [${p.detail}]`);
      setProblem(p);
      setNotice(null);
    },
    [add],
  );

  /** Runs one action with the busy label set; failures go to the problem banner. */
  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setProblem(null);
    try {
      await fn();
    } catch (e) {
      if (isCancel(e)) add('app', `cancelled. ${userMessage(e)}`);
      else fail(e);
    } finally {
      setBusy(null);
    }
  };

  // Ticks the elapsed timers while something is running.
  useEffect(() => {
    if (!op || op.endedAt) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [op]);

  // Bluetooth on/off.
  useEffect(() => watchBluetooth(setBtState), []);

  // ---------------------------------------------------------------- connect

  const refreshInfo = useCallback(
    async (c: Connection) => {
      const i = await c.client.info();
      setInfo(i);
      return i;
    },
    [],
  );

  const doConnect = (badge: BadgeHandle) =>
    run(`Connecting to ${badge.name}`, async () => {
      scanAbortRef.current?.abort();
      const c = await connect(
        badge,
        (kind, text) => add(kind, text),
        { timing: prefs.simTiming, serial: (line) => add('sim', line) },
      );
      if (c.sim) c.sim.tag.onDisplay = (frame) => setPanel(toSkImage(frameToRgba(frame)));
      simRef.current = c.sim;
      setLost(null);
      connRef.current = c;
      setConn(c);
      setInfo(c.info);
      if (badge.kind === 'ble') setPrefs({ lastBadge: { id: badge.id, name: badge.name } });
      add(
        'app',
        `connected to ${badge.name}: fw ${c.info.firmware}, MTU ${c.link.mtu}, ` +
          `temp control ${supportsTemp(c.info) ? 'yes' : 'no'}`,
      );
      setNotice({ tone: 'ok', text: `Connected to ${badge.name}` });
    });

  /** Finds the remembered badge with a short scan, then connects. */
  const connectRemembered = () =>
    run(`Looking for ${prefs.lastBadge?.name}`, async () => {
      const last = prefs.lastBadge;
      if (!last) return;
      add('app', `looking for ${last.name}...`);
      const b = await findBadge(last.id, 8_000);
      if (!b) throw new BluetoothError('not-found', `${last.name} not heard in 8 s`);
      await doConnect({ ...b, name: last.name });
    });

  // On launch: reconnect to the last badge if asked to.
  const launched = useRef(false);
  useEffect(() => {
    if (launched.current || btState !== 'on') return;
    launched.current = true;
    if (prefs.autoConnect && prefs.lastBadge && !connRef.current) connectRemembered();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [btState]);

  // When the link drops (badge out of range, switched off, rebooted).
  useEffect(() => {
    if (!conn) return;
    return conn.link.onDisconnect(() => {
      if (connRef.current !== conn) return; // we closed it ourselves
      connRef.current = null;
      add('error', `lost connection to ${conn.badge.name}`);
      simRef.current = undefined;
      setConn(null);
      setLost(conn.badge);
      setProblem({
        title: `Lost connection to ${conn.badge.name}.`,
        hint: 'Tap Reconnect. If you just reflashed or reset the badge, that is expected.',
      });
    });
  }, [conn, add]);

  const doScan = async () => {
    if (scanning) {
      scanAbortRef.current?.abort();
      return;
    }
    const ctl = new AbortController();
    scanAbortRef.current = ctl;
    setScanning(true);
    setFound([]);
    setProblem(null);
    try {
      const list = await scan({ timeoutMs: 8_000, signal: ctl.signal, onUpdate: setFound });
      add('app', `scan: ${list.length} badge(s) found`);
      if (!list.length && !ctl.signal.aborted) fail(new BluetoothError('not-found'));
    } catch (e) {
      fail(e);
    } finally {
      setScanning(false);
      scanAbortRef.current = null;
    }
  };

  const doDisconnect = () =>
    run('Disconnecting', async () => {
      const c = conn;
      connRef.current = null; // first, so the drop isn't reported as lost
      setConn(null);
      setInfo(null);
      simRef.current = undefined;
      await c?.client.close();
      add('app', 'disconnected');
    });

  // ---------------------------------------------------------------- picture

  /** Converts on the JS thread; fine for testing. Returns the frame for Pick & send. */
  const reconvert = (p: Picture | null, f: FitMode, m: DitherMethod): Converted | null => {
    if (!p) return null;
    const { width, height } = targetSize('portrait');
    const t0 = Date.now();
    const fitted = renderFitted(p, width, height, f);
    const tFit = Date.now() - t0;
    const c = convertFitted(fitted, { dither: { method: m } });
    setConverted(c);
    setPreview(toSkImage(c.preview));
    const total = tFit + Object.values(c.timings).reduce((a, b) => a + b, 0);
    add('app', `converted in ${total} ms (fit ${tFit}, ${JSON.stringify(c.timings)})`);
    return c;
  };

  const pick = async () => {
    const p = await pickPhoto();
    if (!p) return null;
    setPicture(p);
    add('app', `photo ${p.width}×${p.height}`);
    return reconvert(p, prefs.fit, prefs.dither);
  };

  const doPick = () => run('Opening photo', async () => void (await pick()));

  const doPickAndSend = () =>
    run('Opening photo', async () => {
      const c = await pick();
      if (c) await sendFrame(c);
    });

  const changeFit = (f: FitMode) => {
    setPrefs({ fit: f });
    reconvert(picture, f, prefs.dither);
  };

  const changeMethod = (m: DitherMethod) => {
    setPrefs({ dither: m });
    reconvert(picture, prefs.fit, m);
  };

  // ---------------------------------------------------------------- progress

  const startOp = (label: string, first?: StageName) => {
    const t = Date.now();
    setNow(t);
    setOp({
      label,
      startedAt: t,
      stages: first ? [{ name: first, start: t, attempt: 1 }] : [],
      sent: 0,
      total: 0,
    });
  };

  const enterStage = (name: StageName, attempt = 1) => {
    const t = Date.now();
    setOp((o) =>
      o && {
        ...o,
        sent: name === 'erasing' ? 0 : o.sent,
        stages: [
          ...o.stages.map((st) => (st.end ? st : { ...st, end: t })),
          { name, start: t, attempt },
        ],
      },
    );
  };

  const endOp = (ok: boolean, text: string) => {
    const t = Date.now();
    setNow(t);
    setOp(
      (o) =>
        o && {
          ...o,
          endedAt: t,
          result: { ok, text },
          stages: o.stages.map((st) => (st.end ? st : { ...st, end: t })),
        },
    );
    remember(ok, text);
    if (ok) setNotice({ tone: 'ok', text });
  };

  /** Turns a refresh outcome into the result line, the banner, and history. */
  const settleRefresh = (label: string, d: DisplayOutcome, startedAt: number, extra = '') => {
    const took = secs(Date.now() - startedAt);
    if (d.status === 'displayed') {
      const temp = d.temperature == null ? 'temp unknown' : `${d.temperature} °C`;
      let text = `${label}: shown in ${took} total, ${temp}${extra}`;
      // Firmware before 0.3.1 reported success even with no panel attached.
      const untrusted = info && panelAnswering(info) === false;
      if (untrusted) text += " (but the panel didn't answer at boot, so don't trust this)";
      endOp(true, text);
      if (untrusted) setNotice({ tone: 'warn', text });
    } else if (d.status === 'failed') {
      endOp(false, `${label}: ${userMessage(d.error)}`);
      fail(d.error);
    } else {
      const why =
        d.reason === 'timeout'
          ? new TimeoutError('DISPLAYED', 150_000)
          : new DisconnectedError();
      endOp(false, `${label}: refresh result unknown (${d.reason})`);
      fail(why);
    }
  };

  // ---------------------------------------------------------------- send

  const sendFrame = async (c: Converted) => {
    const cn = connRef.current;
    if (!cn) throw new Error('Not connected to a badge.');
    setBusy('Sending');
    const ctl = new AbortController();
    abortRef.current = ctl;
    setCanCancel(true);
    const t0 = Date.now();
    startOp('Send');
    // Keep the screen on: a locked phone can suspend Bluetooth mid-upload.
    await activateKeepAwakeAsync('upload').catch(() => {});
    try {
      const r = await cn.client.upload(c.frame, {
        signal: ctl.signal,
        onStage: (st, attempt) => {
          if (attempt > 1 && st === 'erasing') add('app', `retrying (attempt ${attempt})`);
          enterStage(st, attempt);
        },
        onProgress: (sent, total) => setOp((o) => o && { ...o, sent, total }),
      });
      const speed = `${(r.bytesPerSecond / 1024).toFixed(1)} KiB/s`;
      add(
        'app',
        `stored on badge: ${speed}, ${r.chunkSize}-byte chunks, ${r.attempts} attempt(s)`,
      );
      setCanCancel(false);
      enterStage('refreshing');
      setBusy('Panel refreshing');
      const d = await r.displayed;
      settleRefresh('Send', d, t0, `, ${speed}${r.attempts > 1 ? `, ${r.attempts} attempts` : ''}`);
    } catch (e) {
      endOp(false, `Send: ${isCancel(e) ? 'cancelled' : userMessage(e)}`);
      throw e;
    } finally {
      abortRef.current = null;
      setCanCancel(false);
      deactivateKeepAwake('upload');
    }
    await refreshInfo(cn).catch(() => {});
  };

  const doSend = () =>
    run('Sending', async () => {
      if (converted) await sendFrame(converted);
    });

  /** SHOW or CLEAR: one refresh, with the same progress card. */
  const doRefresh = (label: string, fn: (c: Connection) => Promise<number | null>) =>
    run(label, async () => {
      const cn = connRef.current;
      if (!cn) return;
      const t0 = Date.now();
      startOp(label, 'refreshing');
      try {
        const temperature = await fn(cn);
        settleRefresh(label, { status: 'displayed', temperature }, t0);
      } catch (e) {
        if (e instanceof TagError) {
          settleRefresh(label, { status: 'failed', error: e }, t0);
          return;
        }
        endOp(false, `${label}: ${userMessage(e)}`);
        throw e;
      }
      await refreshInfo(cn).catch(() => {});
    });

  const doInfo = () =>
    run('Reading info', async () => {
      if (!conn) return;
      const i = await refreshInfo(conn);
      add('app', `info: ${JSON.stringify(i, replacer)}`);
    });

  const shareLog = () => {
    const text = [...log]
      .reverse()
      .map((l) => `${clock(l.t)} ${l.kind.padEnd(5)} ${l.text}`)
      .join('\n');
    Share.share({ message: text }).catch(() => {});
  };

  // ---------------------------------------------------------------- render

  const panelOk = info ? panelAnswering(info) : undefined;
  const opRunning = !!op && !op.endedAt;
  const visibleLog = prefs.verboseLog
    ? log
    : log.filter((l) => l.kind === 'app' || l.kind === 'error');

  return (
    <ScrollView contentContainerStyle={{ padding: 12, paddingTop: 48, gap: 10, backgroundColor: '#f3f4f6' }}>
      <Text style={{ fontSize: 18, fontWeight: '700' }}>Ink Tag · test screen</Text>
      <Text style={s.small}>
        {conn ? `● ${conn.badge.name}` : '○ Not connected'}
        {busy ? ` · ${busy}…` : ''}
      </Text>

      {!bluetoothAvailable() && (
        <Banner tone="warn" title="No Bluetooth in this build (Expo Go)">
          <Text style={s.body}>Only the simulator works. Open the Ink Tag development build to reach a real badge.</Text>
        </Banner>
      )}
      {bluetoothAvailable() && btState && btState !== 'on' && btState !== 'unknown' && (
        <Banner tone="warn" title={`Bluetooth is ${btState}`}>
          <Text style={s.body}>
            {btState === 'off' ? 'Turn Bluetooth on to reach the badge.' : 'Check the app has Bluetooth permission.'}
          </Text>
        </Banner>
      )}

      {problem && (
        <Banner tone="error" title={problem.title} onClose={() => setProblem(null)}>
          {problem.hint && <Text style={s.body}>{problem.hint}</Text>}
          {problem.detail && <Text style={s.mono}>{problem.detail}</Text>}
        </Banner>
      )}
      {!problem && notice && (
        <Banner tone={notice.tone} title={notice.text} onClose={() => setNotice(null)} />
      )}

      {/* ------------------------------------------------ badge */}
      <Card title="Badge">
        {conn && info ? (
          <>
            <KV k="Name" v={`${conn.badge.name}${conn.sim ? ' (simulator)' : ''}`} />
            <KV k="Firmware" v={`${info.firmware} · protocol v${info.protocol}`} />
            <KV k="MTU" v={`${conn.link.mtu} (chunks ${Math.min(512, conn.link.mtu - 3)} B)`} />
            <KV k="Stored picture" v={info.hasImage ? 'yes' : 'no'} />
            <KV
              k="Panel temp"
              v={`${info.temperature == null ? 'unknown' : `${info.temperature} °C`}${
                info.tempOverride != null ? ` · fixed at ${info.tempOverride} °C` : ''
              }`}
            />
            <KV
              k="Panel at boot"
              v={
                panelOk === undefined
                  ? 'not reported (fw < 0.3)'
                  : panelOk
                    ? `answered (id ${hex(info.panelId!)})`
                    : `NO ANSWER (id ${hex(info.panelId!)}): check panel ribbon / booster`
              }
              tone={panelOk === false ? 'bad' : panelOk ? 'good' : undefined}
            />
            <Row>
              <Btn label="Refresh info" kind="quiet" onPress={doInfo} disabled={!!busy} />
              <Btn label="Disconnect" kind="danger" onPress={doDisconnect} disabled={opRunning} />
            </Row>
          </>
        ) : (
          <>
            <Row>
              {prefs.lastBadge && (
                <Btn
                  label={`Connect ${lost?.name ?? prefs.lastBadge.name}`}
                  kind="primary"
                  onPress={lost && lost.kind === 'simulator' ? () => doConnect(lost) : connectRemembered}
                  disabled={!!busy || scanning || (!bluetoothAvailable() && lost?.kind !== 'simulator')}
                />
              )}
              <Btn
                label={scanning ? 'Stop scan' : 'Scan'}
                onPress={doScan}
                disabled={!!busy || !bluetoothAvailable()}
              />
              <Btn label="Simulator" kind="quiet" onPress={() => doConnect(SIMULATOR)} disabled={!!busy} />
              <Btn
                label={`Sim: ${prefs.simTiming}`}
                kind="quiet"
                onPress={() => setPrefs({ simTiming: prefs.simTiming === 'fast' ? 'realistic' : 'fast' })}
              />
            </Row>
            {scanning && <Text style={s.small}>Scanning for 8 s…</Text>}
            {found.map((b) => (
              <Pressable
                key={b.id}
                onPress={() => doConnect(b)}
                disabled={!!busy}
                style={{ padding: 10, backgroundColor: '#eef2f7', borderRadius: 6 }}
              >
                <Text style={s.body}>
                  {b.name} · {b.rssi ?? '?'} dBm{prefs.lastBadge?.id === b.id ? ' · last used' : ''}
                </Text>
                <Text style={s.small}>{b.id}</Text>
              </Pressable>
            ))}
          </>
        )}
        <Pressable onPress={() => setPrefs({ autoConnect: !prefs.autoConnect })}>
          <Text style={s.small}>
            {prefs.autoConnect ? '☑' : '☐'} Connect to the last badge when the app opens
            {prefs.lastBadge ? ` (${prefs.lastBadge.name})` : ''}
          </Text>
        </Pressable>
      </Card>

      {/* ------------------------------------------------ picture + send */}
      <Card title="Picture">
        <Row>
          <Btn
            label="Pick & send"
            kind="primary"
            onPress={doPickAndSend}
            disabled={!!busy || !conn}
          />
          <Btn label="Pick only" onPress={doPick} disabled={!!busy} />
          <Btn
            label={`Send again`}
            onPress={doSend}
            disabled={!conn || !converted || !!busy}
          />
          <Btn
            label="Cancel"
            kind="danger"
            onPress={() => abortRef.current?.abort()}
            disabled={!canCancel}
          />
        </Row>
        <Row>
          <Btn
            label={`Fit: ${prefs.fit}`}
            kind="quiet"
            onPress={() => changeFit(prefs.fit === 'cover' ? 'contain' : 'cover')}
            disabled={!!busy}
          />
          <Btn
            label={`Dither: ${prefs.dither}`}
            kind="quiet"
            onPress={() =>
              changeMethod(
                prefs.dither === 'floyd-steinberg'
                  ? 'atkinson'
                  : prefs.dither === 'atkinson'
                    ? 'none'
                    : 'floyd-steinberg',
              )
            }
            disabled={!!busy}
          />
        </Row>
        <Row>
          <Preview label="Preview (panel colors)" image={preview} />
          {conn?.sim && <Preview label="Simulated panel" image={panel} />}
        </Row>
      </Card>

      {op && <Progress op={op} now={now} />}

      {/* ------------------------------------------------ commands */}
      <Card title="Badge commands">
        <Row>
          <Btn label="Show stored" onPress={() => doRefresh('Show', (c) => c.client.show())} disabled={!conn || !!busy} />
          {(Object.keys(Color) as ColorName[]).map((name) => (
            <Btn
              key={name}
              label={`Clear ${name}`}
              kind="quiet"
              onPress={() => doRefresh(`Clear ${name}`, (c) => c.client.clear(Color[name]))}
              disabled={!conn || !!busy}
            />
          ))}
        </Row>
        {conn?.sim && (
          <Row>
            <Btn
              label="Sim: corrupt next upload"
              kind="quiet"
              onPress={() => {
                simRef.current!.tag.corruptNextUpload = true;
                add('app', 'sim: next upload will fail its CRC once');
              }}
            />
            <Btn
              label="Sim: panel timeout next"
              kind="quiet"
              onPress={() => {
                simRef.current!.tag.failNextRefresh = true;
                add('app', 'sim: next refresh will fail with panel timeout');
              }}
            />
            <Btn label="Sim: drop link" kind="quiet" onPress={() => simRef.current?.link.drop()} />
          </Row>
        )}
      </Card>

      {/* ------------------------------------------------ history */}
      {history.length > 0 && (
        <Card title="Recent results" right={<Btn label="Clear" kind="quiet" onPress={() => setHistory([])} />}>
          {history.map((h, i) => (
            <Text key={i} style={[s.body, { color: h.ok ? '#217a4b' : '#b23a48' }]}>
              {clock(h.at)} {h.ok ? '✓' : '✗'} {h.text}
            </Text>
          ))}
        </Card>
      )}

      {/* ------------------------------------------------ log */}
      <Card
        title="Log"
        right={
          <Row>
            <Btn
              label={prefs.verboseLog ? 'All' : 'Summary'}
              kind="quiet"
              onPress={() => setPrefs({ verboseLog: !prefs.verboseLog })}
            />
            <Btn label="Share" kind="quiet" onPress={shareLog} disabled={!log.length} />
            <Btn label="Clear" kind="quiet" onPress={() => setLog([])} />
          </Row>
        }
      >
        <View style={{ backgroundColor: '#111', padding: 8, borderRadius: 6 }}>
          {visibleLog.length === 0 && (
            <Text style={{ color: '#888', fontFamily: 'monospace', fontSize: 11 }}>
              {log.length ? 'Nothing here; tap Summary to see everything.' : 'Empty.'}
            </Text>
          )}
          {visibleLog.map((l, i) => (
            <Text key={i} style={{ color: LOG_COLORS[l.kind], fontFamily: 'monospace', fontSize: 11 }}>
              {clock(l.t)} {l.kind === 'app' ? '' : `${l.kind} `}
              {l.text}
            </Text>
          ))}
        </View>
      </Card>
    </ScrollView>
  );
}

const LOG_COLORS: Record<LogKind, string> = {
  app: '#e6e6e6',
  error: '#ff8a8a',
  tx: '#8ab4ff',
  rx: '#9ee6a8',
  info: '#bbbbbb',
  sim: '#d4b5ff',
};

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join(' ');
const replacer = (_: string, v: unknown) => (v instanceof Uint8Array ? hex(v) : v);

/** The stages of the current (or last) send, show or clear, with timings. */
function Progress({ op, now }: { op: Op; now: number }) {
  const end = op.endedAt ?? now;
  const current = op.endedAt ? undefined : op.stages[op.stages.length - 1];
  const sending = [...op.stages].reverse().find((st) => st.name === 'sending');
  const sendMs = sending ? (sending.end ?? now) - sending.start : 0;
  const rate = sendMs > 0 ? op.sent / (sendMs / 1000) : 0;
  const left = rate > 0 && op.total ? (op.total - op.sent) / rate : 0;
  return (
    <Card title={`${op.label} · ${secs(end - op.startedAt)}`}>
      {op.stages.map((st, i) => {
        const active = st === current;
        const mark = active ? '▶' : st.end && (i < op.stages.length - 1 || op.result?.ok) ? '✓' : '✗';
        const dur = secs((st.end ?? now) - st.start);
        const retry = st.attempt > 1 ? ` (attempt ${st.attempt})` : '';
        let extra = '';
        if (st.name === 'sending' && op.total) {
          extra = ` · ${Math.round((op.sent / op.total) * 100)}% · ${(rate / 1024).toFixed(1)} KiB/s`;
          if (active) extra += ` · ${left.toFixed(0)} s left`;
        }
        return (
          <Text key={i} style={[s.body, active && { fontWeight: '700' }]}>
            {mark} {STAGE_LABEL[st.name]}
            {retry} · {dur}
            {extra}
          </Text>
        );
      })}
      {current?.name === 'sending' && op.total > 0 && <Bar value={op.sent / op.total} />}
      {current?.name === 'refreshing' && (
        <Text style={s.small}>A six-color refresh takes tens of seconds; the badge answers when it ends.</Text>
      )}
      {op.result && (
        <Text style={[s.body, { fontWeight: '700', color: op.result.ok ? '#217a4b' : '#b23a48' }]}>
          {op.result.text}
        </Text>
      )}
    </Card>
  );
}

function Preview({ label, image }: { label: string; image: SkImage | null }) {
  return (
    <View>
      <Text style={s.small}>{label}</Text>
      <Canvas style={{ width: PREVIEW_W, height: PREVIEW_H, backgroundColor: '#ddd' }}>
        {image && (
          <SkiaImage image={image} x={0} y={0} width={PREVIEW_W} height={PREVIEW_H} fit="contain" />
        )}
      </Canvas>
    </View>
  );
}
