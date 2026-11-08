// The Settings tab: app-wide only (each badge's settings live on its page).

import Constants from 'expo-constants';
import { Share, View } from 'react-native';

import { STYLE_NAMES, STYLES } from '../../core';
import { logText } from '../../services/app';
import { Chips, Group, H, Label, ListRow, Screen, T, ToggleRow, Wordmark } from '../kit';
import { useNav } from '../nav';
import { useServices } from '../services';

export function SettingsScreen() {
  const { app, state, badge, catalog } = useServices();
  const nav = useNav();
  const prefs = state.prefs();
  return (
    <Screen title="Settings">
      <Label>Sending</Label>
      <Group>
        <ToggleRow label="Connect when the app opens" value={prefs.connectOnOpen} onChange={(v) => state.setPrefs({ connectOnOpen: v })} />
        <ListRow label="Default dots for photos" />
        <View style={{ paddingBottom: 14, marginTop: -6 }}>
          <Chips options={STYLE_NAMES.map((n) => ({ value: n, label: STYLES[n].label }))} value={prefs.defaultStyle} onChange={(v) => state.setPrefs({ defaultStyle: v })} />
        </View>
        <ListRow label="Send from Photos goes to" value={badge?.name ?? 'No badge yet'} last />
      </Group>
      <Label>Badges</Label>
      <Group>
        <ListRow label="Add another badge" onPress={() => nav.push({ name: 'setup' })} />
        <ListRow label="Add a demo badge" detail="Lives on this phone; the whole app works with it" onPress={async () => { const r = await app.addDemoBadge({}); nav.setNotice(`${r.badge.name} added.`); }} last />
      </Group>
      <Label>Help</Label>
      <Group>
        <ListRow label="Troubleshooting" onPress={() => nav.push({ name: 'help' })} />
        <ListRow label="Share a log with support" onPress={() => Share.share({ message: logText() || 'The log is empty.' })} />
        <ListRow label="About Ink Tag" value={`v${Constants.expoConfig?.version ?? '?'}`} onPress={() => nav.push({ name: 'about' })} last />
      </Group>
      <Label>For testing</Label>
      <Group>
        <ListRow label="Badge test screen" detail="The low-level screen from earlier builds. It disconnects the app first." onPress={() => nav.push({ name: 'debug' })} />
        <ListRow label="Templates" value={`${catalog.entries.length} in ${catalog.packs.length} packs`} last />
      </Group>
    </Screen>
  );
}

export function HelpScreen() {
  const nav = useNav();
  return (
    <Screen title="Troubleshooting" onBack={nav.pop} back="Settings">
      <Group>
        <ListRow label="The app can't find the badge" detail="Switch it on and bring it within a metre or two. Check Bluetooth is on and Ink Tag may use Nearby devices." />
        <ListRow label="“Locked to another phone”" detail="Hold the badge's button for 10 seconds while it's on. That resets the lock; then add it again." />
        <ListRow label="“The screen didn't answer”" detail="Check the ribbon cable and the booster board. The picture is still saved on the badge; Redraw tries again." />
        <ListRow label="The screen flashes when it updates" detail="That's normal for six-colour e-paper and takes about 20 seconds (longer in the cold)." />
        <ListRow label="A live template stopped updating" detail="Updates come from the phone, so Ink Tag has to be open and near the badge. It catches up when you open it." last />
      </Group>
    </Screen>
  );
}

export function AboutScreen() {
  const nav = useNav();
  return (
    <Screen title="About" onBack={nav.pop} back="Settings">
      <View style={{ alignSelf: 'flex-start', paddingVertical: 10 }}>
        <Wordmark size={34} />
      </View>
      <H size={26}>Printed in six inks</H>
      <T>The badge shows six inks: black, white, red, yellow, blue and green. The app is printed in the same inks, like a risograph: paper, black, and one colour at a time.</T>
      <T muted>Test build for trying the flow on a real badge.</T>
      <Label muted>{`Version ${Constants.expoConfig?.version ?? '?'}`}</Label>
    </Screen>
  );
}
