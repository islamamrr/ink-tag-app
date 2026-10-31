// Development screen: drives the core against a real badge over Bluetooth
// or the simulator badge. Not the product UI, which is planned separately.

import { Canvas, Image as SkiaImage, type SkImage } from '@shopify/react-native-skia';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  Color,
  type ColorName,
  type Converted,
  convertFitted,
  type DitherMethod,
  type FitMode,
  frameToRgba,
  panelAnswering,
  supportsTemp,
  targetSize,
  type Timing,
  userMessage,
} from '../core';
import { type BadgeHandle, connect, type Connection, scan, SIMULATOR } from '../services/badges';
import { type Picture, pickPhoto, renderFitted, toSkImage } from '../services/picture';
import { bluetoothAvailable } from '../services/radio';

const PREVIEW_W = 150;
const PREVIEW_H = 225;
const MAX_LOG = 200;

export default function DebugScreen() {
  const [conn, setConn] = useState<Connection | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [picture, setPicture] = useState<Picture | null>(null);
  const [fit, setFit] = useState<FitMode>('cover');
  const [method, setMethod] = useState<DitherMethod>('floyd-steinberg');
  const [timing, setTiming] = useState<Timing>('fast');
  const [converted, setConverted] = useState<Converted | null>(null);
  const [preview, setPreview] = useState<SkImage | null>(null);
  const [panel, setPanel] = useState<SkImage | null>(null);
  const [progress, setProgress] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const simRef = useRef<Connection['sim']>(undefined);
  const [found, setFound] = useState<BadgeHandle[]>([]);
  const [scanning, setScanning] = useState(false);
  /** The badge the link dropped from, for the Reconnect button. */
  const [lost, setLost] = useState<BadgeHandle | null>(null);
  const scanAbortRef = useRef<AbortController | null>(null);

  const add = useCallback((line: string) => {
    setLog((l) => [line, ...l].slice(0, MAX_LOG));
  }, []);

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      add(`! ${userMessage(e)}`);
    } finally {
      setBusy(null);
    }
  };

  // When the link drops (badge out of range, switched off), offer Reconnect.
  useEffect(() => {
    if (!conn) return;
    return conn.link.onDisconnect(() => {
      add(`! lost connection to ${conn.badge.name}`);
      simRef.current = undefined;
      setConn(null);
      setLost(conn.badge);
    });
  }, [conn, add]);

  const doConnect = (badge: BadgeHandle) =>
    run('Connecting', async () => {
      scanAbortRef.current?.abort();
      const c = await connect(badge, (kind, text) => add(`${kind} ${text}`), {
        timing,
        serial: (line) => add(`  sim ${line}`),
      });
      if (c.sim) c.sim.tag.onDisplay = (frame) => setPanel(toSkImage(frameToRgba(frame)));
      simRef.current = c.sim;
      setLost(null);
      setConn(c);
      add(
        `connected to ${badge.name}: fw ${c.info.firmware}, MTU ${c.link.mtu}, ` +
          `temp control ${supportsTemp(c.info) ? 'yes' : 'no'}`,
      );
      if (panelAnswering(c.info) === false) add('! The panel did not answer at boot: check wiring.');
    });

  const doScan = async () => {
    if (scanning) {
      scanAbortRef.current?.abort();
      return;
    }
    const ctl = new AbortController();
    scanAbortRef.current = ctl;
    setScanning(true);
    setFound([]);
    try {
      const list = await scan({ timeoutMs: 8_000, signal: ctl.signal, onUpdate: setFound });
      add(`scan: ${list.length} badge(s) found`);
    } catch (e) {
      add(`! ${userMessage(e)}`);
    } finally {
      setScanning(false);
      scanAbortRef.current = null;
    }
  };

  const doDisconnect = () =>
    run('Disconnecting', async () => {
      const c = conn;
      setConn(null); // first, so the drop isn't reported as lost
      simRef.current = undefined;
      await c?.client.close();
    });

  /** Converts on the JS thread for now; moving it off-thread is a phase 2 measurement. */
  const reconvert = (p: Picture | null, f: FitMode, m: DitherMethod) => {
    if (!p) return;
    const { width, height } = targetSize('portrait');
    const t0 = Date.now();
    const fitted = renderFitted(p, width, height, f);
    const tFit = Date.now() - t0;
    const c = convertFitted(fitted, { dither: { method: m } });
    setConverted(c);
    setPreview(toSkImage(c.preview));
    add(`converted: fit ${tFit} ms, ${JSON.stringify(c.timings)} ms`);
  };

  const doPick = () =>
    run('Opening photo', async () => {
      const p = await pickPhoto();
      if (p) {
        setPicture(p);
        add(`photo ${p.width}×${p.height}`);
        reconvert(p, fit, method);
      }
    });

  const changeFit = (f: FitMode) => {
    setFit(f);
    reconvert(picture, f, method);
  };

  const changeMethod = (m: DitherMethod) => {
    setMethod(m);
    reconvert(picture, fit, m);
  };

  const doSend = () =>
    run('Sending', async () => {
      if (!conn || !converted) return;
      const ctl = new AbortController();
      abortRef.current = ctl;
      setProgress(0);
      // Keep the screen on: a locked phone can suspend Bluetooth mid-upload.
      await activateKeepAwakeAsync('upload').catch(() => {});
      try {
        const r = await conn.client.upload(converted.frame, {
          signal: ctl.signal,
          onProgress: (sent, total) => setProgress(sent / total),
        });
        add(
          `stored on badge: ${(r.bytesPerSecond / 1024).toFixed(1)} KiB/s, ` +
            `${r.chunkSize}-byte chunks, ${r.attempts} attempt(s)`,
        );
        r.displayed.then((d) => add(`refresh: ${JSON.stringify(d)}`));
      } finally {
        deactivateKeepAwake('upload');
      }
    }).finally(() => (abortRef.current = null));

  const command = (label: string, fn: (c: Connection) => Promise<unknown>) => () =>
    run(label, async () => {
      if (!conn) return;
      const r = await fn(conn);
      if (r !== undefined) add(`${label}: ${JSON.stringify(r, replacer)}`);
    });

  return (
    <ScrollView contentContainerStyle={styles.root}>
      <Text style={styles.title}>Ink Tag · developer screen</Text>
      <Text style={styles.status}>
        {conn
          ? `${conn.badge.name} · fw ${conn.info.firmware} · MTU ${conn.link.mtu}`
          : 'Not connected'}
        {busy ? ` · ${busy}…` : ''}
      </Text>

      {!bluetoothAvailable() && (
        <Text style={styles.warn}>
          Bluetooth isn&apos;t in this build (Expo Go). Only the simulator works; install the
          development build to reach a real badge.
        </Text>
      )}

      {!conn && (
        <>
          <Row>
            <Btn
              label={scanning ? 'Stop scan' : 'Scan for badges'}
              onPress={doScan}
              disabled={!!busy || !bluetoothAvailable()}
            />
            {lost && (
              <Btn label={`Reconnect ${lost.name}`} onPress={() => doConnect(lost)} disabled={!!busy} />
            )}
          </Row>
          {found.length > 0 && (
            <Row>
              {found.map((b) => (
                <Btn
                  key={b.id}
                  label={`${b.name} (${b.rssi ?? '?'} dBm)`}
                  onPress={() => doConnect(b)}
                  disabled={!!busy}
                />
              ))}
            </Row>
          )}
        </>
      )}

      <Row>
        {conn ? (
          <Btn label="Disconnect" onPress={doDisconnect} />
        ) : (
          <Btn label="Connect simulator" onPress={() => doConnect(SIMULATOR)} disabled={!!busy} />
        )}
        <Btn
          label={`Sim speed: ${timing}`}
          onPress={() => setTiming(timing === 'fast' ? 'realistic' : 'fast')}
          disabled={!!conn}
        />
      </Row>

      <Row>
        <Btn label="Pick photo" onPress={doPick} disabled={!!busy} />
        <Btn label={`Fit: ${fit}`} onPress={() => changeFit(fit === 'cover' ? 'contain' : 'cover')} />
        <Btn
          label={`Dither: ${method}`}
          onPress={() =>
            changeMethod(
              method === 'floyd-steinberg' ? 'atkinson' : method === 'atkinson' ? 'none' : 'floyd-steinberg',
            )
          }
        />
      </Row>

      <Row>
        <Preview label="Preview" image={preview} />
        <Preview label="Badge panel (sim)" image={panel} />
      </Row>

      <Row>
        <Btn label="Send" onPress={doSend} disabled={!conn || !converted || !!busy} />
        <Btn label="Cancel" onPress={() => abortRef.current?.abort()} disabled={busy !== 'Sending'} />
        <Text style={styles.status}>{Math.round(progress * 100)}%</Text>
      </Row>

      <Row>
        <Btn label="Info" onPress={command('info', (c) => c.client.info())} disabled={!conn} />
        <Btn label="Show" onPress={command('show', (c) => c.client.show())} disabled={!conn} />
        {(Object.keys(Color) as ColorName[]).map((name) => (
          <Btn
            key={name}
            label={`Clear ${name}`}
            onPress={command(`clear ${name}`, (c) => c.client.clear(Color[name]))}
            disabled={!conn}
          />
        ))}
      </Row>

      {conn?.sim && (
        <Row>
          <Btn
            label="Corrupt next upload"
            onPress={() => {
              simRef.current!.tag.corruptNextUpload = true;
              add('sim: next upload will fail its CRC once');
            }}
          />
          <Btn
            label="Fail next refresh"
            onPress={() => {
              simRef.current!.tag.failNextRefresh = true;
              add('sim: next refresh will time out');
            }}
          />
          <Btn label="Drop link" onPress={() => simRef.current?.link.drop()} />
        </Row>
      )}

      <View style={styles.log}>
        {log.map((line, i) => (
          <Text key={i} style={styles.logLine}>
            {line}
          </Text>
        ))}
      </View>
    </ScrollView>
  );
}

const replacer = (_: string, v: unknown) => (v instanceof Uint8Array ? Array.from(v) : v);

function Row({ children }: { children: React.ReactNode }) {
  return <View style={styles.row}>{children}</View>;
}

function Btn({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[styles.btn, disabled && styles.btnDisabled]}
    >
      <Text style={styles.btnText}>{label}</Text>
    </Pressable>
  );
}

function Preview({ label, image }: { label: string; image: SkImage | null }) {
  return (
    <View>
      <Text style={styles.caption}>{label}</Text>
      <Canvas style={styles.preview}>
        {image && (
          <SkiaImage image={image} x={0} y={0} width={PREVIEW_W} height={PREVIEW_H} fit="contain" />
        )}
      </Canvas>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { padding: 16, paddingTop: 56, gap: 12 },
  title: { fontSize: 20, fontWeight: '600' },
  status: { color: '#555', alignSelf: 'center' },
  warn: { color: '#8a5a00', backgroundColor: '#fff4d6', padding: 8, borderRadius: 6 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  btn: { backgroundColor: '#1d3557', paddingVertical: 8, paddingHorizontal: 12, borderRadius: 6 },
  btnDisabled: { opacity: 0.4 },
  btnText: { color: 'white' },
  caption: { fontSize: 12, color: '#555', marginBottom: 4 },
  preview: { width: PREVIEW_W, height: PREVIEW_H, backgroundColor: '#ddd' },
  log: { backgroundColor: '#111', padding: 8, borderRadius: 6 },
  logLine: { color: '#cfc', fontFamily: 'monospace', fontSize: 11 },
});
