// Sending to the badge: the hook every screen uses, the four plain stages,
// and "Slide to ink" (one long slide sends, so a stray tap can't).

import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, PanResponder, Text, View } from 'react-native';

import { type Design, type DisplayOutcome, type LibraryItem, type Prepared, type SendProgress, type SendStage, userMessage } from '../core';
import { appLog } from '../services/app';
import { Bar, Col, G, Row, s, T } from './kit';
import { useServices } from './services';

export type Phase = 'idle' | 'sending' | 'drawing' | 'done' | 'failed';

export interface Sender {
  phase: Phase;
  progress: SendProgress | null;
  error: string | null;
  /** The badge kept its old picture (the failure happened before it was stored). */
  oldPictureKept: boolean;
  item: LibraryItem | null;
  startedAt: number | null;
  finishedAt: number | null;
  send(badgeId: string, what: Design | { itemId: string }, prepared?: Prepared | null): Promise<LibraryItem | null>;
  cancel(): void;
  reset(): void;
}

export function useSender(): Sender {
  const { app } = useServices();
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState<SendProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [oldPictureKept, setKept] = useState(true);
  const [item, setItem] = useState<LibraryItem | null>(null);
  const [startedAt, setStarted] = useState<number | null>(null);
  const [finishedAt, setFinished] = useState<number | null>(null);
  const abort = useRef<AbortController | null>(null);

  const send = useCallback(
    async (badgeId: string, what: Design | { itemId: string }, prepared?: Prepared | null) => {
      abort.current = new AbortController();
      setPhase('sending');
      setError(null);
      setKept(true);
      setStarted(Date.now());
      setFinished(null);
      await activateKeepAwakeAsync('inktag-send').catch(() => {});
      try {
        const r = await app.send(badgeId, what, {
          onProgress: setProgress,
          signal: abort.current.signal,
          prepared: prepared ?? undefined,
        });
        setItem(r.item);
        setPhase('drawing');
        r.displayed.then((o: DisplayOutcome) => {
          setFinished(Date.now());
          if (o.status === 'failed') {
            setKept(false);
            setError(`The picture is saved on the badge, but its screen didn't redraw. ${userMessage(o.error)}`);
            setPhase('failed');
          } else setPhase('done');
          deactivateKeepAwake('inktag-send');
        });
        return r.item;
      } catch (e) {
        appLog(`send failed: ${userMessage(e)}`);
        setError(userMessage(e));
        setPhase('failed');
        deactivateKeepAwake('inktag-send');
        return null;
      }
    },
    [app],
  );

  return {
    phase,
    progress,
    error,
    oldPictureKept,
    item,
    startedAt,
    finishedAt,
    send,
    cancel: () => abort.current?.abort(),
    reset: () => {
      setPhase('idle');
      setProgress(null);
      setError(null);
    },
  };
}

// ------------------------------------------------------------------ stages

const STEPS: { label: string; stages: SendStage[] }[] = [
  { label: 'Getting the badge ready', stages: ['preparing', 'connecting', 'erasing'] },
  { label: 'Sending the picture', stages: ['sending'] },
  { label: 'Checking it arrived', stages: ['verifying'] },
  { label: 'Drawing on the screen', stages: ['refreshing'] },
];

export function Stages({ p }: { p: SendProgress | null }) {
  const at = p ? STEPS.findIndex((x) => x.stages.includes(p.stage)) : 0;
  const done = p?.stage === 'done';
  return (
    <Col gap={6}>
      {STEPS.map((x, i) => {
        const state = done || i < at ? '✓' : i === at ? '●' : '○';
        const label = i === 2 && p?.stage === 'sending' && p.attempt > 1 ? 'Checking again' : x.label;
        return (
          <Row key={x.label}>
            <Text style={[s.t, { width: 22, color: state === '○' ? G.mid : G.ink }]}>{state}</Text>
            <Text style={[s.t, state === '●' && { fontWeight: '700', color: G.ink }, state === '○' && s.muted]}>{label}</Text>
          </Row>
        );
      })}
    </Col>
  );
}

/** A compact line for screens that send in place (lists, boards, live). */
export function SendLine({ sender, badgeName }: { sender: Sender; badgeName: string }) {
  const p = sender.progress;
  if (sender.phase === 'idle') return null;
  if (sender.phase === 'failed')
    return (
      <View style={s.problem}>
        <T bold>Couldn&apos;t update {badgeName}</T>
        <T muted>{sender.error}</T>
        {sender.oldPictureKept && <T muted>Nothing changed on its screen.</T>}
      </View>
    );
  return (
    <View style={s.note}>
      <Col gap={6} style={{ flex: 1 }}>
        <T bold>
          {sender.phase === 'done'
            ? `On ${badgeName}.`
            : sender.phase === 'drawing'
              ? `Drawing on ${badgeName}, safe to walk away`
              : `${p?.label ?? 'Sending'}${p?.secondsLeft ? ` · about ${p.secondsLeft} s left` : ''}`}
        </T>
        {sender.phase !== 'done' && <Bar value={p?.fraction ?? 0} />}
      </Col>
    </View>
  );
}

// ------------------------------------------------------------------ slide to ink

export function SlideToInk({ label = 'Slide to ink', onDone, disabled }: { label?: string; onDone: () => void; disabled?: boolean }) {
  const [w, setW] = useState(0);
  const [x] = useState(() => new Animated.Value(0));
  const knob = 52;
  const max = Math.max(0, w - knob - 8);
  // The responder is made once; it reads the latest values from here.
  const latest = useRef({ max, onDone, disabled });
  useEffect(() => {
    latest.current = { max, onDone, disabled };
  }, [max, onDone, disabled]);

  // The handlers read `latest` only while sliding, never during render.
  // eslint-disable-next-line react-hooks/refs
  const [pan] = useState(() =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => !latest.current.disabled,
      onMoveShouldSetPanResponder: () => !latest.current.disabled,
      onPanResponderTerminationRequest: () => false,
      onPanResponderMove: (_, g) => x.setValue(Math.max(0, Math.min(latest.current.max, g.dx))),
      onPanResponderRelease: (_, g) => {
        const m = latest.current.max;
        if (g.dx >= m * 0.9) {
          Animated.timing(x, { toValue: m, duration: 80, useNativeDriver: false }).start(() => {
            latest.current.onDone();
            x.setValue(0);
          });
        } else Animated.spring(x, { toValue: 0, useNativeDriver: false }).start();
      },
    }),
  );

  return (
    <View
      onLayout={(e) => setW(e.nativeEvent.layout.width)}
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityActions={[{ name: 'activate', label }]}
      onAccessibilityAction={() => !disabled && onDone()}
      style={{
        height: 60,
        borderRadius: 30,
        borderWidth: 2,
        borderColor: G.ink,
        backgroundColor: disabled ? G.soft : G.pale,
        justifyContent: 'center',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <Text style={[s.btnText, { textAlign: 'center' }]}>{label}</Text>
      <Animated.View
        {...pan.panHandlers}
        style={{
          position: 'absolute',
          left: 3,
          width: knob,
          height: knob,
          borderRadius: knob / 2,
          backgroundColor: G.ink,
          alignItems: 'center',
          justifyContent: 'center',
          transform: [{ translateX: x }],
        }}
      >
        <Text style={{ color: G.white, fontSize: 22, fontWeight: '700' }}>→</Text>
      </Animated.View>
    </View>
  );
}
