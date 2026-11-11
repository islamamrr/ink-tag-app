// The My badge tab (Badges once there are two): status, the screen tools
// and the badge's own settings. And first run: Welcome, then three short
// setup screens (Bluetooth, find, set up), with help when nothing is found.

import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Text, useWindowDimensions, View } from 'react-native';

import { LockedError, type NearbyBadge, type Orientation, userMessage } from '../../core';
import { Btn, Card, Chip, Col, Field, Group, H, Label, ListRow, Problem, Row, Screen, Sheet, T, ToggleRow, useText, Wordmark } from '../kit';
import { useNav } from '../nav';
import { BadgeFrame, ItemThumb, TemplateThumb } from '../pictures';
import { Dots, Icon, InkDot } from '../print';
import { ago, useServices } from '../services';
import { FONT, INK, tiltFor } from '../theme';

// ------------------------------------------------------------------ tab root

export function BadgeTab() {
  const { app } = useServices();
  const nav = useNav();
  const badges = app.badges.list();
  if (badges.length === 0)
    return (
      <Screen title="My badge">
        <View style={{ alignItems: 'center', paddingVertical: 16 }}>
          <BadgeFrame width={110} orientation="portrait" tilt={-3} shadow={INK.blue} style={{ backgroundColor: INK.paper, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="plus" size={30} />
          </BadgeFrame>
        </View>
        <H size={28} center>
          No badge yet
        </H>
        <T center muted>
          Set yours up, or look around with a demo badge that lives on this phone.
        </T>
        <Btn kind="primary" label="Set up my badge" onPress={() => nav.push({ name: 'setup' })} />
        <DemoButton />
      </Screen>
    );
  if (badges.length === 1) return <BadgePage id={badges[0].id} root />;
  const conn = app.connection();
  return (
    <Screen title="Badges">
      {badges.map((b, i) => (
        <BadgeCard key={b.id} id={b.id} index={i} connected={conn.badgeId === b.id && conn.status === 'connected'} />
      ))}
      <Btn label="Add another badge" onPress={() => nav.push({ name: 'setup' })} />
    </Screen>
  );
}

function BadgeCard({ id, index, connected }: { id: string; index: number; connected: boolean }) {
  const { app } = useServices();
  const nav = useNav();
  const tx = useText();
  const b = app.badges.get(id)!;
  return (
    <Card onPress={() => nav.push({ name: 'badgePage', id })} style={{ flexDirection: 'row', gap: 14, alignItems: 'center' }} label={b.name}>
      {b.shownItemId ? <ItemThumb app={app} itemId={b.shownItemId} width={54} orientation={b.orientation} tilt={tiltFor(index)} /> : <BadgeFrame width={54} orientation={b.orientation} tilt={tiltFor(index)} style={{ backgroundColor: INK.paper }} />}
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[tx.strong, { fontFamily: FONT.black, fontSize: 22 }]}>{b.name}</Text>
        <Row gap={6}>
          <InkDot color={connected ? INK.green : b.kind === 'demo' ? INK.blue : INK.muted} size={8} />
          <Text style={tx.small}>{connected ? 'Connected' : b.kind === 'demo' ? 'Demo badge' : `Last seen ${ago(b.lastSeenAt)}`}</Text>
        </Row>
      </View>
      <Icon name="next" size={18} stroke={2.6} />
    </Card>
  );
}

function DemoButton({ label = 'Use a demo badge' }: { label?: string }) {
  const { app, state } = useServices();
  const nav = useNav();
  const [busy, setBusy] = useState(false);
  return (
    <Btn
      label={label}
      busy={busy}
      onPress={async () => {
        setBusy(true);
        try {
          const r = await app.addDemoBadge({});
          await state.setPrefs({ welcomed: true });
          nav.setNotice(`${r.badge.name} added. It lives on this phone and shows "Hello".`);
          nav.home('templates');
        } finally {
          setBusy(false);
        }
      }}
    />
  );
}

// ------------------------------------------------------------------ one badge

export function BadgePage({ id, root }: { id: string; root?: boolean }) {
  const { app, live } = useServices();
  const nav = useNav();
  const { width } = useWindowDimensions();
  const tx = useText();
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const b = app.badges.get(id);
  if (!b)
    return (
      <Screen onBack={nav.pop}>
        <T>This badge was removed.</T>
      </Screen>
    );
  const conn = app.connection();
  const connected = conn.badgeId === id && conn.status === 'connected';
  const connecting = conn.badgeId === id && conn.status === 'connecting';
  const failed = conn.badgeId === id && conn.status === 'failed';
  const item = b.shownItemId ? app.library.get(b.shownItemId) : undefined;
  const sent = app.library.list().filter((x) => x.sends.some((s) => s.badgeId === id)).length;
  const job = live.current();

  const run = async (label: string, fn: () => Promise<unknown>, done?: string) => {
    setBusy(label);
    setProblem(null);
    setNotice(null);
    try {
      await fn();
      if (done) setNotice(done);
    } catch (e) {
      setProblem(userMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const forget = () =>
    Alert.alert(`Forget ${b.name}?`, b.ownerKey ? 'If it is nearby it is unlocked first, so another phone can use it.' : 'You can add it again later.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Forget',
        style: 'destructive',
        onPress: () =>
          run('forget', async () => {
            if (job?.badgeId === id) await live.stop();
            const r = await app.forget(id);
            nav.setNotice(r.unlocked ? `${b.name} forgotten.` : `${b.name} forgotten. It was out of reach, so it's still locked: hold its button 10 s to reset it.`);
            if (!root) nav.pop();
          }),
      },
    ]);

  const status = connected ? 'Connected' : connecting ? 'Connecting…' : b.kind === 'demo' ? 'Demo badge' : 'Not nearby';
  const screen = b.screen;
  const facts = [
    item ? `Showing ${item.title}` : b.shownAt ? 'Blank' : 'Nothing sent yet',
    b.shownAt ? `Sent ${ago(b.shownAt)}` : null,
    b.ownerKey ? 'Locked to this phone' : 'Any phone can change it',
    conn.badgeId === id && conn.info?.temperature != null ? `Screen ${conn.info.temperature} °C` : null,
    screen && screen.status !== 'unknown' ? screen.message : null,
    job?.badgeId === id ? `Live: ${job.templateId}` : null,
  ].filter(Boolean) as string[];

  return (
    <Screen
      title={root ? 'My badge' : b.name}
      onBack={root ? undefined : nav.pop}
      back="Badges"
      right={
        <Row gap={6} style={{ borderWidth: 2, borderColor: INK.black, backgroundColor: INK.white, paddingHorizontal: 10, height: 34, borderRadius: 17 }}>
          <InkDot color={connected ? INK.green : connecting ? INK.yellow : b.kind === 'demo' ? INK.blue : INK.muted} size={9} />
          <Text style={{ fontFamily: FONT.monoBold, fontSize: 11, color: INK.black }}>{status.toUpperCase()}</Text>
        </Row>
      }
    >
      {(failed || problem) && (
        <Problem title={problem ? 'That didn’t work' : `Can't reach ${b.name}`} action="Try again" onAction={() => run('connect', () => app.connect(id))}>
          {problem ?? `${conn.error ? userMessage(conn.error) : ''} Last seen ${ago(b.lastSeenAt)}. It's still showing its last picture. Bring it closer or switch it on.`}
        </Problem>
      )}
      {!connected && !connecting && !failed && !problem && b.kind === 'ble' && (
        <Btn label={`Connect to ${b.name}`} onPress={() => run('connect', () => app.connect(id))} busy={busy === 'connect'} />
      )}
      {notice && <T muted>{notice}</T>}

      <Row gap={18} style={{ alignItems: 'flex-start', paddingTop: 6 }}>
        {item ? (
          <ItemThumb app={app} itemId={item.id} width={Math.min(130, width * 0.34)} orientation={b.orientation} tilt={-2} shadow={INK.black} device />
        ) : (
          <BadgeFrame width={Math.min(130, width * 0.34)} orientation={b.orientation} tilt={-2} shadow={INK.black} device style={{ backgroundColor: INK.paper }} />
        )}
        <Col gap={6} style={{ flex: 1 }}>
          {root && <H size={28}>{b.name}</H>}
          {facts.map((f) => (
            <Text key={f} style={[tx.body, { fontSize: 17, lineHeight: 20 }]}>
              {f}
            </Text>
          ))}
        </Col>
      </Row>

      <Row gap={8}>
        <Btn flex small label="Redraw" busy={busy === 'redraw'} disabled={!!busy} onPress={() => run('redraw', () => app.redraw(id), 'Redrawn.')} />
        <Btn flex small label="Check" busy={busy === 'check'} disabled={!!busy} onPress={() => run('check', async () => setNotice((await app.checkScreen(id)).message))} />
        <Btn flex small label="Blank" busy={busy === 'blank'} disabled={!!busy} onPress={() => run('blank', () => app.blank(id), 'The screen is white. The stored picture is kept; Redraw brings it back.')} />
      </Row>

      <Group>
        <ListRow label="Name" value={b.name} onPress={() => setRenaming(b.name)} />
        <ListRow
          label="Hangs"
          right={
            <Row gap={6}>
              {(['portrait', 'landscape'] as Orientation[]).map((o) => (
                <Chip key={o} label={o === 'portrait' ? 'Upright' : 'Sideways'} on={b.orientation === o} onPress={() => app.setOrientation(id, o)} />
              ))}
            </Row>
          }
        />
        <ToggleRow
          label="Only this phone can change it"
          detail="Hold the badge's button 10 s to undo"
          value={!!b.ownerKey}
          disabled={!!busy || b.kind === 'demo'}
          onChange={(on) => run('lock', () => app.setLocked(id, on), on ? 'Locked to this phone.' : 'Unlocked. Any phone can change it now.')}
        />
        <ListRow label="Sent to this badge" value={String(sent)} onPress={() => nav.setTab('gallery')} />
        <ListRow label={b.kind === 'demo' ? 'Kind' : 'Badge'} value={b.kind === 'demo' ? 'Demo, on this phone' : `${b.advertisedName} · firmware ${b.firmware ?? '?'}`} />
        <ListRow label="Forget this badge" onPress={forget} last />
      </Group>
      {root && <Btn kind="ghost" label="Add another badge" onPress={() => nav.push({ name: 'setup' })} />}

      <Sheet visible={renaming !== null} onClose={() => setRenaming(null)} title="Name">
        <Field value={renaming ?? ''} onChangeText={setRenaming} autoFocus />
        <Btn
          kind="primary"
          label="Save"
          disabled={!renaming?.trim()}
          onPress={async () => {
            await app.rename(id, renaming ?? '');
            setRenaming(null);
          }}
        />
      </Sheet>
    </Screen>
  );
}

// ------------------------------------------------------------------ first run

/** First run: flooded blue, a scatter of prints, and the two ways in. */
export function Welcome({ onSetup }: { onSetup: () => void }) {
  const { app, catalog } = useServices();
  const { width } = useWindowDimensions();
  const ids = ['name-badge', 'todo', 'clock', 'wifi-qr', 'status-board', 'countdown'];
  const w = Math.floor((width - 40 - 28) / 3);
  return (
    <Screen flood="blue" footer={<><Btn kind="primary" label="Set up my badge" onPress={onSetup} /><DemoButton label="Look around with a demo badge" /></>}>
      <View style={{ alignSelf: 'flex-start', backgroundColor: INK.paper, paddingHorizontal: 12, paddingTop: 2, borderWidth: 2, borderColor: INK.black, transform: [{ rotate: '-2deg' }], marginTop: 8 }}>
        <Wordmark size={24} />
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 14, rowGap: 16, paddingVertical: 10 }}>
        {ids
          .map((id) => catalog.get(id))
          .filter(Boolean)
          .map((e, i) => (
            <TemplateThumb key={e!.id} app={app} entry={e!} width={w} orientation="portrait" tilt={tiltFor(i) * 2} shadow={INK.black} />
          ))}
      </View>
      <H size={38}>Pick something to wear.</H>
      <T>Name tags, lists, clocks, QR codes, signs and your own photos, printed in the badge&apos;s six inks.</T>
    </Screen>
  );
}

type Step = 'explain' | 'find' | 'help' | 'setup';
const FIND_MS = 20_000;

export function SetupScreen({ onClose }: { onClose: () => void }) {
  const { app, state } = useServices();
  const nav = useNav();
  const tx = useText();
  const [step, setStep] = useState<Step>(app.bluetooth ? 'explain' : 'help');
  const [found, setFound] = useState<NearbyBadge[]>([]);
  const [showOthers, setShowOthers] = useState(false);
  const [chosen, setChosen] = useState<NearbyBadge | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(app.badges.suggestName());
  const [orientation, setOrientation] = useState<Orientation>('portrait');
  const [lock, setLock] = useState(true);
  const [busy, setBusy] = useState(false);
  const scan = useRef<AbortController | null>(null);

  const startScan = () => {
    setError(null);
    setFound([]);
    setStep('find');
    scan.current?.abort();
    const ctl = new AbortController();
    scan.current = ctl;
    app
      .scan({ timeoutMs: FIND_MS, signal: ctl.signal, onUpdate: (l) => setFound(l.filter((b) => !b.saved)) })
      .then((l) => {
        if (ctl.signal.aborted) return;
        const fresh = l.filter((b) => !b.saved);
        setFound(fresh);
        if (!fresh.length) setStep('help');
      })
      .catch((e) => {
        if (ctl.signal.aborted) return;
        setError(userMessage(e));
        setStep('help');
      });
  };
  useEffect(() => () => scan.current?.abort(), []);

  const finish = async () => {
    if (!chosen) return;
    setBusy(true);
    setError(null);
    try {
      const r = await app.addBadge(chosen, { name, orientation, lock });
      await state.setPrefs({ welcomed: true });
      nav.setNotice(
        `${r.badge.name} is set up${r.badge.ownerKey ? ' and locked to this phone' : ''}${r.lockUnsupported ? ' (its firmware is too old to lock)' : ''}. It shows "Hello".`,
      );
      onClose();
    } catch (e) {
      setError(e instanceof LockedError ? 'This badge is locked to another phone. Hold its button for 10 seconds to reset it, then try again.' : userMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const back = () => {
    scan.current?.abort();
    if (step === 'setup') setStep('find');
    else if (step === 'find' || (step === 'help' && app.bluetooth)) setStep('explain');
    else onClose();
  };

  const nearest = found[0];
  const stepNo = step === 'explain' ? 1 : step === 'setup' ? 3 : 2;
  const header = <Label muted>{`Step ${stepNo} of 3`}</Label>;

  if (step === 'explain')
    return (
      <Screen onBack={onClose} back="Back" right={header} footer={<><Btn kind="primary" label="Continue" onPress={startScan} /><DemoButton label="Use the demo badge for now" /></>}>
        <Row gap={18} style={{ justifyContent: 'center', height: 200 }}>
          <View style={{ width: 70, height: 128, borderWidth: 2.5, borderColor: INK.black, borderRadius: 14, backgroundColor: INK.white, transform: [{ rotate: '-4deg' }], alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="bluetooth" size={30} color={INK.blue} stroke={2.6} />
          </View>
          <View style={{ width: 70, height: 30 }}>
            <Dots width={70} height={30} spacing={10} radius={2.6} color={INK.blue} style={{ left: 0, top: 0 }} />
          </View>
          <BadgeFrame width={76} orientation="portrait" tilt={3} shadow={INK.red} style={{ backgroundColor: INK.paper }} />
        </Row>
        <H>Your phone talks to the badge over Bluetooth</H>
        <T>Next, your phone will ask to find nearby devices. Ink Tag only looks for badges, and never uses your location.</T>
      </Screen>
    );

  if (step === 'find')
    return (
      <Screen onBack={back} back="Back" right={header}>
        <H>Find your badge</H>
        <T>Turn it on. The closest one shows here.</T>
        {nearest ? (
          <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={{ flex: 1 }}>
              <T bold>{nearest.name}</T>
              <Label muted>{`${nearest.proximity.label} · new`}</Label>
            </View>
            <Btn kind="primary" small label="This one" onPress={() => (setChosen(nearest), setStep('setup'))} />
          </Card>
        ) : (
          <Card shadow={null} style={{ borderStyle: 'dashed', flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            <ActivityIndicator color={INK.blue} />
            <View style={{ flex: 1 }}>
              <T bold>Looking…</T>
              <T muted>Searching for up to 20 seconds.</T>
            </View>
          </Card>
        )}
        {found.length > 1 && <Btn kind="ghost" label={showOthers ? 'Hide the others' : `${found.length - 1} other badge${found.length > 2 ? 's' : ''} nearby`} onPress={() => setShowOthers((x) => !x)} />}
        {showOthers &&
          found.slice(1).map((b) => (
            <ListRow key={b.id} label={b.name} detail={b.proximity.label} onPress={() => (setChosen(b), setStep('setup'))} />
          ))}
      </Screen>
    );

  if (step === 'help')
    return (
      <Screen onBack={back} back="Back" right={app.bluetooth ? header : undefined} footer={<>{app.bluetooth && <Btn kind="primary" label="Search again" onPress={startScan} />}<DemoButton label="Use the demo badge for now" /></>}>
        <H>{app.bluetooth ? "We can't find a badge yet" : 'Bluetooth isn’t available here'}</H>
        {error && <Problem title="What happened">{error}</Problem>}
        {app.bluetooth ? (
          <Group>
            <ListRow label="1. Is it switched on?" detail="The screen keeps its picture even when off." />
            <ListRow label="2. Bring it closer" detail="Within a metre or two works best." />
            <ListRow label="3. Is it locked to another phone?" detail="Hold its button for 10 s to reset it." last />
          </Group>
        ) : (
          <T>This version of the app can&apos;t use Bluetooth. You can still look around with the demo badge.</T>
        )}
      </Screen>
    );

  return (
    <Screen onBack={back} back="Back" right={header} footer={<Btn kind="primary" label="Finish" busy={busy} onPress={finish} />}>
      <Row gap={16}>
        <BadgeFrame width={64} orientation={orientation} tilt={-3} shadow={INK.blue} style={{ backgroundColor: INK.paper }} />
        <View style={{ gap: 2 }}>
          <H size={26}>{chosen?.name ?? ''}</H>
          <Label muted>{chosen?.proximity.label ?? ''}</Label>
        </View>
      </Row>
      {error && <Problem title="Couldn't add it">{error}</Problem>}
      <Field label="What should we call it?" value={name} onChangeText={setName} />
      <Label>How does it hang?</Label>
      <Row gap={14}>
        {(['portrait', 'landscape'] as Orientation[]).map((o) => {
          const on = orientation === o;
          return (
            <Pressable key={o} onPress={() => setOrientation(o)} accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={o === 'portrait' ? 'Upright' : 'Sideways'} style={{ flex: 1 }}>
              {on && <View style={{ position: 'absolute', left: 4, top: 4, right: -4, bottom: -4, backgroundColor: INK.blue }} />}
              <View style={{ height: 104, borderWidth: 2, borderColor: INK.black, alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: on ? INK.yellow : INK.white }}>
                <View style={{ width: o === 'portrait' ? 30 : 46, height: o === 'portrait' ? 46 : 30, borderWidth: 2, borderColor: INK.black, backgroundColor: INK.paper }} />
                <Text style={[tx.strong, { fontFamily: FONT.black, fontSize: 20 }]}>{o === 'portrait' ? 'Upright' : 'Sideways'}</Text>
              </View>
            </Pressable>
          );
        })}
      </Row>
      <Group>
        <ToggleRow label="Only this phone can change it" detail="Hold the badge's button 10 s to undo" value={lock} onChange={setLock} last />
      </Group>
      <Label>Finish draws “Hello” on the badge</Label>
    </Screen>
  );
}
