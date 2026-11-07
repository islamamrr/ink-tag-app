// Send: last look, "to: My badge", slide to ink, the four stages, the
// drawing wipe once it's safe to walk away, then back to the Gallery. A
// failure says what the badge shows now and that the work isn't lost.

import { useEffect, useState } from 'react';
import { Animated, Text, useWindowDimensions, View } from 'react-native';

import type { Design } from '../../core';
import { Bar, Btn, Chip, Col, G, H, ListRow, Problem, Row, s, Screen, Sheet, T } from '../kit';
import { useNav } from '../nav';
import { DesignPreview, ItemThumb, usePrepared } from '../pictures';
import { SlideToInk, Stages, useSender } from '../sending';
import { useServices } from '../services';

export function SendScreen({ design, itemId }: { design?: Design; itemId?: string }) {
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
  const previewW = orientation === 'portrait' ? Math.min(260, width * 0.62) : width - 40;
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
    const t = setTimeout(finish, 1200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sender.phase]);

  const p = sender.progress;
  const picture = itemId ? (
    <ItemThumb app={app} itemId={itemId} width={previewW} orientation={orientation} />
  ) : (
    <DesignPreview prepared={prepared ?? last} width={previewW} orientation={orientation} />
  );

  if (sender.phase === 'idle')
    return (
      <Screen
        onBack={nav.pop}
        back="Back to edit"
        right={target ? <Chip label={`to: ${target.name} ▾`} onPress={() => setPicking(true)} /> : undefined}
        footer={
          target ? (
            <SlideToInk onDone={go} disabled={!itemId && !prepared} />
          ) : (
            <Btn kind="primary" label="Set up my badge" onPress={() => nav.push({ name: 'setup' })} />
          )
        }
      >
        <View style={{ alignItems: 'center' }}>{picture}</View>
        <T center muted>
          This is how the six colours will look. It&apos;s saved to your Gallery when it&apos;s sent.
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
              right={<Text style={s.t}>{b.id === targetId ? '✓' : ''}</Text>}
              onPress={() => {
                setTargetId(b.id);
                setPicking(false);
              }}
              last={i === badges.length - 1}
            />
          ))}
          <ListRow label="Shared with me" detail="Later: badges other people share with you" last />
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
      <Screen title={target?.name}>
        <View style={{ alignItems: 'center', opacity: 0.6 }}>{picture}</View>
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
    <Screen title={drawing ? `Drawing on ${target?.name}` : `Sending to ${target?.name}`}>
      <View style={{ alignItems: 'center' }}>
        <View>
          {picture}
          {drawing && <Wipe seconds={p?.secondsLeft ?? 20} done={sender.phase === 'done'} />}
        </View>
      </View>
      {drawing ? (
        <Col>
          <H size={20}>{sender.phase === 'done' ? 'On your badge.' : 'Safe to walk away'}</H>
          <T>Sent and checked. The badge is drawing it now.</T>
          <T muted>The screen flashes a few times. That&apos;s normal for this kind of screen and takes about 20 seconds. You can close the app.</T>
          <Btn label="Back to Gallery" onPress={finish} />
        </Col>
      ) : (
        <Col gap={12}>
          <Row>
            <H size={28}>{Math.round((p?.fraction ?? 0) * 100)}%</H>
            {p?.secondsLeft ? <T muted>about {p.secondsLeft} s left</T> : null}
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
      <Animated.View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top, bottom: 0, backgroundColor: 'rgba(255,255,255,0.55)' }} />
      <Animated.View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top, height: 3, backgroundColor: G.ink }} />
    </>
  );
}
