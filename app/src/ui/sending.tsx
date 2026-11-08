// Sending to the badge: the hook every screen uses, the four plain stages,
// and "Slide to ink" (one long slide sends, so a stray tap can't).

import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, PanResponder, Text, View } from 'react-native';

import { type Design, type DisplayOutcome, type LibraryItem, type Prepared, type SendProgress, type SendStage, userMessage } from '../core';
import { appLog } from '../services/app';
import { Bar, Col, Row, useSurface, useText } from './kit';
import { Icon, InkDot } from './print';
import { useServices } from './services';
import { FONT, INK } from './theme';

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
  const tx = useText();
  const at = p ? STEPS.findIndex((x) => x.stages.includes(p.stage)) : 0;
  const done = p?.stage === 'done';
  return (
    <Col gap={8}>
      {STEPS.map((x, i) => {
        const state = done || i < at ? 'done' : i === at ? 'now' : 'later';
        const label = i === 2 && p?.stage === 'sending' && p.attempt > 1 ? 'Checking again' : x.label;
        return (
          <Row key={x.label} gap={10}>
            <View style={{ width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: tx.sf.fg, alignItems: 'center', justifyContent: 'center', backgroundColor: state === 'done' ? tx.sf.fg : 'transparent', opacity: state === 'later' ? 0.5 : 1 }}>
              {state === 'done' ? <Icon name="check" size={16} color={tx.sf.ground} stroke={3.2} /> : state === 'now' ? <InkDot color={tx.sf.fg} size={10} /> : null}
            </View>
            <Text style={[state === 'now' ? tx.strong : tx.body, state === 'later' && { opacity: 0.6 }]}>{label}</Text>
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
      <View style={{ borderWidth: 2, borderColor: INK.black, borderStyle: 'dashed', backgroundColor: INK.white, padding: 12, gap: 4 }} accessibilityRole="alert">
        <Text style={{ fontFamily: FONT.black, fontSize: 19, color: INK.black }}>Couldn&apos;t update {badgeName}</Text>
        <Text style={{ fontFamily: FONT.bold, fontSize: 16, color: INK.muted }}>
          {sender.error}
          {sender.oldPictureKept ? ' Nothing changed on its screen.' : ''}
        </Text>
      </View>
    );
  return (
    <View style={{ borderWidth: 2, borderColor: INK.black, backgroundColor: INK.yellow, padding: 12 }} accessibilityLiveRegion="polite">
      <Col gap={6} style={{ flex: 1 }}>
        <Text style={{ fontFamily: FONT.black, fontSize: 19, color: INK.black }}>
          {sender.phase === 'done'
            ? `On ${badgeName}.`
            : sender.phase === 'drawing'
              ? `Drawing on ${badgeName}, safe to walk away`
              : `${p?.label ?? 'Sending'}${p?.secondsLeft ? ` · about ${p.secondsLeft} s left` : ''}`}
        </Text>
        {sender.phase !== 'done' && <Bar value={p?.fraction ?? 0} />}
      </Col>
    </View>
  );
}

// ------------------------------------------------------------------ slide to ink

export function SlideToInk({ label = 'Slide to print', onDone, disabled }: { label?: string; onDone: () => void; disabled?: boolean }) {
  const sf = useSurface();
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
      style={{ opacity: disabled ? 0.5 : 1 }}
    >
      <View style={{ position: 'absolute', left: 4, top: 3, right: -4, bottom: -3, borderRadius: 31, backgroundColor: sf.flood ? sf.second : INK.black }} />
      <View
        style={{
          height: 62,
          borderRadius: 31,
          borderWidth: 2,
          borderColor: INK.black,
          backgroundColor: sf.flood ? sf.card : INK.white,
          justifyContent: 'center',
          overflow: 'hidden',
        }}
      >
        <Text style={{ fontFamily: FONT.black, fontSize: 23, color: INK.black, textAlign: 'center', paddingLeft: 40, includeFontPadding: false }}>{label}</Text>
        <Animated.View
          {...pan.panHandlers}
          style={{
            position: 'absolute',
            left: 3,
            width: knob,
            height: knob,
            borderRadius: knob / 2,
            backgroundColor: INK.blue,
            borderWidth: 2,
            borderColor: INK.black,
            alignItems: 'center',
            justifyContent: 'center',
            transform: [{ translateX: x }],
          }}
        >
          <Icon name="arrow" size={24} color={INK.paper} stroke={2.8} />
        </Animated.View>
      </View>
    </View>
  );
}
