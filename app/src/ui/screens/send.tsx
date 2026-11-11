// Send: last look, "to: My badge", slide to print, the four stages, the
// drawing wipe once it's safe to walk away, then back to the Gallery. A
// failure says what the badge shows now and that the work isn't lost. It
// keeps the flood ink of the screen it came from.

import { useEffect, useState } from 'react';
import { Animated, Text, useWindowDimensions, View } from 'react-native';

import type { Design } from '../../core';
import { Bar, Btn, Chip, Col, H, Label, ListRow, Problem, Row, Screen, Sheet, T } from '../kit';
import { useNav } from '../nav';
import { DesignPreview, ItemThumb, usePrepared } from '../pictures';
import { Icon, useReduceMotion } from '../print';
import { SlideToInk, Stages, useSender } from '../sending';
import { useServices } from '../services';
import { type Flood, FONT, INK } from '../theme';

export function SendScreen({ design, itemId, flood }: { design?: Design; itemId?: string; flood?: Flood }) {
  const { app, badge } = useServices();
  const nav = useNav();
  const { width } = useWindowDimensions();
  const sender = useSender();
  const [targetId, setTargetId] = useState(badge?.id);
  const [picking, setPicking] = useState(false);
  const [detail, setDetail] = useState(false);
  const { prepared, last } = usePrepared(app, design ?? null, 0);
  const target = targetId ? app.badges.get(targetId) : undefined;
  const item = itemId ? app.library.get(itemId) : undefined;
  const orientation = design?.scene.orientation ?? item?.scene.orientation ?? target?.orientation ?? 'portrait';
  const previewW = orientation === 'portrait' ? Math.min(270, width * 0.66) : width - 70;
  const badges = app.badges.list();

  // Sideways design, upright badge (or the other way): say so before sending.
  const mismatch = target && target.orientation !== orientation;

  const go = () => {
    if (!target) return;
    void sender.send(target.id, itemId ? { itemId } : design!, prepared);
  };

  const finish = () => {
    const secs = sender.startedAt && sender.finishedAt ? Math.round((sender.finishedAt - sender.startedAt) / 1000) : null;
    nav.setNotice(`On ${target?.name ?? 'your badge'}.${secs ? ` Sent in ${secs} s and saved.` : ' Saved to your Gallery.'}`);
    nav.home();
    nav.home('gallery');
  };

  // Done: back to the Gallery shortly after, so the person sees it land.
  useEffect(() => {
    if (sender.phase !== 'done') return;
    const t = setTimeout(finish, 2200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sender.phase]);

  const p = sender.progress;
  const picture = itemId ? (
    <ItemThumb app={app} itemId={itemId} width={previewW} orientation={orientation} tilt={-2} shadow={INK.black} device />
  ) : (
    <DesignPreview prepared={prepared ?? last} width={previewW} orientation={orientation} tilt={-2} shadow={INK.black} device />
  );

  if (sender.phase === 'idle')
    return (
      <Screen
        onBack={nav.pop}
        back="Back to edit"
        title="Last look"
        flood={flood}
        right={target ? <Chip label={`To ${target.name}`} on onPress={() => setPicking(true)} /> : undefined}
        footer={
          target ? (
            <SlideToInk onDone={go} disabled={!itemId && !prepared} />
          ) : (
            <Btn kind="primary" label="Set up my badge" onPress={() => nav.push({ name: 'setup' })} />
          )
        }
      >
        <View style={{ alignItems: 'center', paddingTop: 16, paddingBottom: 8 }}>{picture}</View>
        <T center muted>
          This is how the six inks will look. It&apos;s saved to your Gallery when it&apos;s sent.
        </T>
        {mismatch && (
          <Problem title={`${target.name} hangs ${target.orientation === 'portrait' ? 'upright' : 'sideways'}`}>
            This picture was made {orientation === 'portrait' ? 'upright' : 'sideways'}, so it will look turned on the badge.
          </Problem>
        )}
        <Sheet visible={picking} onClose={() => setPicking(false)} title="Send to">
          {badges.map((b, i) => (
            <ListRow
              key={b.id}
              label={b.name}
              detail={b.kind === 'demo' ? 'Demo badge' : app.connection().badgeId === b.id ? 'Connected' : 'Saved'}
              right={b.id === targetId ? <Icon name="check" size={20} color={INK.blue} stroke={3} /> : undefined}
              onPress={() => {
                setTargetId(b.id);
                setPicking(false);
              }}
              last={i === badges.length - 1}
            />
          ))}
          <Btn
            label="Add another badge"
            onPress={() => {
              setPicking(false);
              nav.push({ name: 'setup' });
            }}
          />
        </Sheet>
      </Screen>
    );

  if (sender.phase === 'failed')
    return (
      <Screen title={target?.name} flood={flood}>
        <View style={{ alignItems: 'center', opacity: 0.6, paddingTop: 10, paddingBottom: 6 }}>{picture}</View>
        <Problem title={sender.oldPictureKept ? 'Not sent' : "The badge didn't finish drawing"}>
          <Col gap={4}>
            <T muted>{sender.oldPictureKept ? 'Nothing changed on its screen. It still shows the last picture.' : sender.error}</T>
            <T muted>The design is saved in your Gallery.</T>
            {detail && <T muted>{sender.error}</T>}
          </Col>
        </Problem>
        <Btn kind="primary" label="Try again" onPress={() => (sender.item ? void sender.send(target!.id, { itemId: sender.item.id }) : go())} />
        <Btn
          label="Send it later"
          onPress={() => {
            nav.setNotice('Saved to your Gallery. Send it from there when the badge is close.');
            nav.home();
            nav.home('gallery');
          }}
        />
        {!detail && <Btn kind="ghost" label="What went wrong?" onPress={() => setDetail(true)} />}
      </Screen>
    );

  const drawing = sender.phase === 'drawing' || sender.phase === 'done';
  return (
    <Screen flood={flood}>
      <Label center>{drawing ? `Drawing on ${target?.name}` : `Sending to ${target?.name}`}</Label>
      <View style={{ alignItems: 'center', paddingTop: 10, paddingBottom: 6 }}>
        <View>
          {picture}
          {drawing && <Wipe seconds={p?.secondsLeft ?? 20} done={sender.phase === 'done'} />}
          {sender.phase === 'done' && <Printed />}
        </View>
      </View>
      {drawing ? (
        <Col gap={10}>
          <H size={30}>{sender.phase === 'done' ? 'On your badge.' : 'Safe to walk away'}</H>
          {sender.phase === 'done' ? (
            <T>Drawn, checked and saved to your Gallery.</T>
          ) : (
            <>
              <T>Sent and checked. The badge is drawing it now.</T>
              <T muted>The screen flashes a few times. That&apos;s normal for this kind of screen and takes about 20 seconds. You can close the app.</T>
            </>
          )}
          <Btn label="Back to Gallery" onPress={finish} />
        </Col>
      ) : (
        <Col gap={14}>
          <Row gap={12} style={{ alignItems: 'flex-end' }}>
            <H size={48} display>
              {Math.round((p?.fraction ?? 0) * 100)}%
            </H>
            {p?.secondsLeft ? (
              <View style={{ paddingBottom: 10 }}>
                <T muted>about {p.secondsLeft} s left</T>
              </View>
            ) : null}
          </Row>
          <Bar value={p?.fraction ?? 0} />
          <Stages p={p} />
          <T muted>Keep the phone close for a few more seconds.</T>
          <Btn label="Cancel" kind="danger" onPress={sender.cancel} />
        </Col>
      )}
    </Screen>
  );
}

const BURST = [INK.red, INK.blue, INK.yellow, INK.green, INK.black, INK.red, INK.yellow, INK.blue, INK.green, INK.black, INK.blue, INK.red];

/** Done: a burst of ink dots and a "Printed" sticker slapped on the corner. */
function Printed() {
  const reduce = useReduceMotion();
  const [t] = useState(() => new Animated.Value(reduce ? 1 : 0));
  useEffect(() => {
    if (reduce) return t.setValue(1);
    const a = Animated.spring(t, { toValue: 1, friction: 6, tension: 120, useNativeDriver: true });
    a.start();
    return () => a.stop();
  }, [reduce, t]);
  const scale = t.interpolate({ inputRange: [0, 1], outputRange: [1.8, 1] });
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
      {!reduce &&
        BURST.map((c, i) => {
          const a = (i / BURST.length) * Math.PI * 2;
          const r = 120 + (i % 3) * 24;
          return (
            <Animated.View
              key={i}
              style={{
                position: 'absolute',
                width: 12 + (i % 3) * 4,
                height: 12 + (i % 3) * 4,
                borderRadius: 10,
                backgroundColor: c,
                opacity: t.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0, 1, 0], extrapolate: 'clamp' }),
                transform: [
                  { translateX: t.interpolate({ inputRange: [0, 1], outputRange: [0, Math.cos(a) * r] }) },
                  { translateY: t.interpolate({ inputRange: [0, 1], outputRange: [0, Math.sin(a) * r] }) },
                ],
              }}
            />
          );
        })}
      <Animated.View
        accessible
        accessibilityLabel="Printed"
        style={{ position: 'absolute', right: -18, top: 18, opacity: t.interpolate({ inputRange: [0, 0.3], outputRange: [0, 1], extrapolate: 'clamp' }), transform: [{ scale }, { rotate: '8deg' }] }}
      >
        <View style={{ position: 'absolute', left: 4, top: 4, right: -4, bottom: -4, backgroundColor: INK.black }} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: INK.yellow, borderWidth: 2.5, borderColor: INK.black, paddingHorizontal: 12, paddingVertical: 7 }}>
          <Icon name="check" size={18} stroke={3.4} />
          <Text style={{ fontFamily: FONT.display, fontSize: 16, color: INK.black, letterSpacing: 0.5 }}>PRINTED</Text>
        </View>
      </Animated.View>
    </View>
  );
}

/** A line that wipes down the picture over the time the panel takes. */
function Wipe({ seconds, done }: { seconds: number; done: boolean }) {
  const [y] = useState(() => new Animated.Value(0));
  useEffect(() => {
    const a = Animated.timing(y, { toValue: 1, duration: Math.max(3, seconds) * 1000, useNativeDriver: false });
    a.start();
    return () => a.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (done) y.setValue(1);
  }, [done, y]);
  const top = y.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });
  return (
    <>
      <Animated.View pointerEvents="none" style={{ position: 'absolute', left: 2, right: 2, top, bottom: 2, backgroundColor: 'rgba(243,239,231,0.6)' }} />
      <Animated.View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top, height: 4, backgroundColor: INK.black }} />
    </>
  );
}
