// The My badge tab (Badges once there are two): status, the screen tools
// and the badge's own settings. And first run: Welcome, then three short
// setup screens (Bluetooth, find, set up), with help when nothing is found.

import { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, Text, useWindowDimensions, View } from 'react-native';

import { LockedError, type NearbyBadge, type Orientation, userMessage } from '../../core';
import { Btn, Card, Chip, Col, Field, G, H, Label, ListRow, Problem, Row, s, Screen, Sheet, T, ToggleRow } from '../kit';
import { useNav } from '../nav';
import { BadgeFrame, ItemThumb, TemplateThumb } from '../pictures';
import { ago, useServices } from '../services';

// ------------------------------------------------------------------ tab root

export function BadgeTab() {
  const { app } = useServices();
  const nav = useNav();
  const badges = app.badges.list();
  if (badges.length === 0)
    return (
      <Screen title="My badge">
        <BadgeFrame width={100} orientation="portrait" style={{ alignSelf: 'center', backgroundColor: G.white }} />
        <T center>No badge yet.</T>
        <Btn kind="primary" label="Set up my badge" onPress={() => nav.push({ name: 'setup' })} />
        <DemoButton />
      </Screen>
    );
  if (badges.length === 1) return <BadgePage id={badges[0].id} root />;
  const conn = app.connection();
  return (
    <Screen title="Badges">
      {badges.map((b) => (
        <Card key={b.id} onPress={() => nav.push({ name: 'badgePage', id: b.id })} style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
          {b.shownItemId ? <ItemThumb app={app} itemId={b.shownItemId} width={54} orientation={b.orientation} /> : <BadgeFrame width={54} orientation={b.orientation} style={{ backgroundColor: G.white }} />}
          <View style={{ flex: 1 }}>
            <Text style={[s.rowLabel, { fontWeight: '800' }]}>{b.name}</Text>
            <Text style={s.small}>
              {conn.badgeId === b.id && conn.status === 'connected' ? '● Connected' : b.kind === 'demo' ? 'Demo badge' : `○ Last seen ${ago(b.lastSeenAt)}`}
            </Text>
          </View>
          <Text style={s.small}>›</Text>
        </Card>
      ))}
      <Btn label="Add another badge" onPress={() => nav.push({ name: 'setup' })} />
    </Screen>
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

  const status = connected ? '● Connected' : connecting ? 'Connecting…' : b.kind === 'demo' ? 'Demo badge' : '○ Not nearby';
  const screen = b.screen;

  return (
    <Screen title={root ? 'My badge' : b.name} onBack={root ? undefined : nav.pop} back="Badges" right={<Text style={s.small}>{status}</Text>}>
      {(failed || problem) && (
        <Problem title={problem ? 'That didn’t work' : `Can't reach ${b.name}`} action="Try again" onAction={() => run('connect', () => app.connect(id))}>
          {problem ?? `${conn.error ? userMessage(conn.error) : ''} Last seen ${ago(b.lastSeenAt)}. It's still showing its last picture. Bring it closer or switch it on.`}
        </Problem>
      )}
      {!connected && !connecting && !failed && !problem && b.kind === 'ble' && (
        <Btn label={`Connect to ${b.name}`} onPress={() => run('connect', () => app.connect(id))} busy={busy === 'connect'} />
      )}
      {notice && <T muted>{notice}</T>}

      <Row gap={16}>
        {item ? <ItemThumb app={app} itemId={item.id} width={Math.min(110, width * 0.28)} orientation={b.orientation} /> : <BadgeFrame width={Math.min(110, width * 0.28)} orientation={b.orientation} style={{ backgroundColor: G.white }} />}
        <Col gap={3} style={{ flex: 1 }}>
          <Text style={[s.rowLabel, { fontWeight: '800', fontSize: 18 }]}>{b.name}</Text>
          <Text style={s.small}>{item ? item.title : b.shownAt ? 'Blank' : 'Nothing sent yet'}</Text>
          <Text style={s.small}>{b.ownerKey ? 'Locked to this phone' : 'Any phone can change it'}</Text>
          {b.shownAt ? <Text style={s.small}>Sent {ago(b.shownAt)}</Text> : null}
          {conn.badgeId === id && conn.info?.temperature != null ? <Text style={s.small}>Screen {conn.info.temperature} °C</Text> : null}
          {screen && screen.status !== 'unknown' && <Text style={s.small}>{screen.message}</Text>}
          {job?.badgeId === id && <Text style={s.small}>Live: {job.templateId}</Text>}
        </Col>
      </Row>

      <Row>
        <Btn flex small label="Redraw" busy={busy === 'redraw'} disabled={!!busy} onPress={() => run('redraw', () => app.redraw(id), 'Redrawn.')} />
        <Btn flex small label="Check screen" busy={busy === 'check'} disabled={!!busy} onPress={() => run('check', async () => setNotice((await app.checkScreen(id)).message))} />
        <Btn flex small label="Blank" busy={busy === 'blank'} disabled={!!busy} onPress={() => run('blank', () => app.blank(id), 'The screen is white. The stored picture is kept; Redraw brings it back.')} />
      </Row>

      <Col gap={0}>
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
      </Col>
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

export function Welcome({ onSetup }: { onSetup: () => void }) {
  const { app, catalog } = useServices();
  const { width } = useWindowDimensions();
  const ids = ['name-badge', 'todo', 'clock', 'wifi-qr', 'status-board', 'countdown'];
  const w = Math.floor((width - 40 - 16) / 3);
  return (
    <Screen>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {ids.map((id) => catalog.get(id)).filter(Boolean).map((e) => (
          <TemplateThumb key={e!.id} app={app} entry={e!} width={w} orientation="portrait" />
        ))}
      </View>
      <H size={30}>Pick something{'\n'}to wear.</H>
      <T>Name tags, lists, clocks, QR codes and signs, ready to send to your badge.</T>
      <Btn kind="primary" label="Set up my badge" onPress={onSetup} />
      <DemoButton label="Look around with a demo badge" />
    </Screen>
  );
}

type Step = 'explain' | 'find' | 'help' | 'setup';
const FIND_MS = 20_000;

export function SetupScreen({ onClose }: { onClose: () => void }) {
  const { app, state } = useServices();
  const nav = useNav();
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
  const header = <Text style={s.small}>Step {stepNo} of 3</Text>;

  if (step === 'explain')
    return (
      <Screen onBack={onClose} back="Back" right={header} footer={<><Btn kind="primary" label="Continue" onPress={startScan} /><DemoButton label="Use the demo badge for now" /></>}>
        <Row gap={22} style={{ justifyContent: 'center', height: 180 }}>
          <View style={{ width: 64, height: 120, borderWidth: 3, borderColor: G.ink, borderRadius: 14 }} />
          <Text style={[s.h1, { color: G.mid }]}>· · ·</Text>
          <BadgeFrame width={70} orientation="portrait" />
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
              <Text style={[s.rowLabel, { fontWeight: '800' }]}>{nearest.name}</Text>
              <Text style={s.small}>{nearest.proximity.label} · new</Text>
            </View>
            <Btn kind="primary" small label="This one" onPress={() => (setChosen(nearest), setStep('setup'))} />
          </Card>
        ) : (
          <View style={s.problem}>
            <T bold>Looking…</T>
            <T muted>Searching for up to 20 seconds.</T>
          </View>
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
        <H>{app.bluetooth ? "We can't find a badge yet" : 'Bluetooth isn’t available in this build'}</H>
        {error && <Problem title="What happened">{error}</Problem>}
        {app.bluetooth ? (
          <Col gap={0}>
            <ListRow label="1. Is it switched on?" detail="The screen keeps its picture even when off." />
            <ListRow label="2. Bring it closer" detail="Within a metre or two works best." />
            <ListRow label="3. Is it locked to another phone?" detail="Hold its button for 10 s to reset it." last />
          </Col>
        ) : (
          <T>This copy of the app can&apos;t use Bluetooth (for example in Expo Go). The demo badge works everywhere.</T>
        )}
      </Screen>
    );

  return (
    <Screen onBack={back} back="Back" right={header} footer={<Btn kind="primary" label="Finish" busy={busy} onPress={finish} />}>
      <Row gap={14}>
        <BadgeFrame width={64} orientation={orientation} />
        <View>
          <Text style={[s.rowLabel, { fontWeight: '800', fontSize: 18 }]}>{chosen?.name}</Text>
          <Text style={s.small}>{chosen?.proximity.label}</Text>
        </View>
      </Row>
      {error && <Problem title="Couldn't add it">{error}</Problem>}
      <Field label="What should we call it?" value={name} onChangeText={setName} />
      <Text style={s.small}>How does it hang?</Text>
      <Row gap={10}>
        {(['portrait', 'landscape'] as Orientation[]).map((o) => (
          <Pressable
            key={o}
            onPress={() => setOrientation(o)}
            accessibilityRole="radio"
            accessibilityState={{ selected: orientation === o }}
            style={[{ flex: 1, height: 96, borderWidth: 2, borderColor: G.ink, borderRadius: 12, alignItems: 'center', justifyContent: 'center', gap: 6 }, orientation === o && { backgroundColor: G.chipOn, borderWidth: 3 }]}
          >
            <View style={{ width: o === 'portrait' ? 30 : 44, height: o === 'portrait' ? 44 : 30, borderWidth: 2, borderColor: G.ink, borderRadius: 4 }} />
            <Text style={s.btnText}>{o === 'portrait' ? 'Upright' : 'Sideways'}</Text>
          </Pressable>
        ))}
      </Row>
      <ToggleRow label="Only this phone can change it" detail="Hold the badge's button 10 s to undo" value={lock} onChange={setLock} />
      <Label>Finish draws “Hello” on the badge</Label>
    </Screen>
  );
}
