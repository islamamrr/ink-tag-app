// The Settings tab: app-wide only (each badge's settings live on its page).

import Constants from 'expo-constants';
import { Share } from 'react-native';

import { STYLE_NAMES, STYLES } from '../../core';
import { logText } from '../../services/app';
import { Chips, Col, Label, ListRow, Screen, T, ToggleRow } from '../kit';
import { useNav } from '../nav';
import { useServices } from '../services';

export function SettingsScreen() {
  const { app, state, badge, catalog } = useServices();
  const nav = useNav();
  const prefs = state.prefs();
  return (
    <Screen title="Settings">
      <Label>Sending</Label>
      <Col gap={0}>
        <ToggleRow label="Connect when the app opens" value={prefs.connectOnOpen} onChange={(v) => state.setPrefs({ connectOnOpen: v })} />
        <ListRow label="Default look for photos" right={<Chips options={STYLE_NAMES.map((n) => ({ value: n, label: STYLES[n].label }))} value={prefs.defaultStyle} onChange={(v) => state.setPrefs({ defaultStyle: v })} />} />
        <ListRow label="Send from Photos goes to" value={badge?.name ?? 'No badge yet'} last />
      </Col>
      <Label>Badges</Label>
      <Col gap={0}>
        <ListRow label="Add another badge" onPress={() => nav.push({ name: 'setup' })} />
        <ListRow label="Add a demo badge" detail="Lives on this phone; the whole app works with it" onPress={async () => { const r = await app.addDemoBadge({}); nav.setNotice(`${r.badge.name} added.`); }} last />
      </Col>
      <Label>Help</Label>
      <Col gap={0}>
        <ListRow label="Troubleshooting" onPress={() => nav.push({ name: 'help' })} />
        <ListRow label="Share a log with support" onPress={() => Share.share({ message: logText() || 'The log is empty.' })} />
        <ListRow label="About Ink Tag" value={`v${Constants.expoConfig?.version ?? '?'}`} onPress={() => nav.push({ name: 'about' })} last />
      </Col>
      <Label>For testing</Label>
      <Col gap={0}>
        <ListRow label="Badge test screen" detail="The low-level screen from earlier builds. It disconnects the app first." onPress={() => nav.push({ name: 'debug' })} />
        <ListRow label="Templates" value={`${catalog.entries.length} in ${catalog.packs.length} packs`} last />
      </Col>
    </Screen>
  );
}

export function HelpScreen() {
  const nav = useNav();
  return (
    <Screen title="Troubleshooting" onBack={nav.pop} back="Settings">
      <Col gap={0}>
        <ListRow label="The app can't find the badge" detail="Switch it on and bring it within a metre or two. Check Bluetooth is on and Ink Tag may use Nearby devices." />
        <ListRow label="“Locked to another phone”" detail="Hold the badge's button for 10 seconds while it's on. That resets the lock; then add it again." />
        <ListRow label="“The screen didn't answer”" detail="Check the ribbon cable and the booster board. The picture is still saved on the badge; Redraw tries again." />
        <ListRow label="The screen flashes when it updates" detail="That's normal for six-colour e-paper and takes about 20 seconds (longer in the cold)." />
        <ListRow label="A live template stopped updating" detail="Updates come from the phone, so Ink Tag has to be open and near the badge. It catches up when you open it." last />
      </Col>
    </Screen>
  );
}

export function AboutScreen() {
  const nav = useNav();
  return (
    <Screen title="About Ink Tag" onBack={nav.pop} back="Settings">
      <T>Wireframe build for testing the flow on a real badge. Colours, type and icons come later with the visual design; pictures for the badge already use its six inks.</T>
      <T muted>Version {Constants.expoConfig?.version ?? '?'}</T>
    </Screen>
  );
}
