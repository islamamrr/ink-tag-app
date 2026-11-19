// The badge's firmware on its page: a quiet line while the app updates it on
// its own, then how it went. Nothing shows when the badge is up to date.

import { Text, View } from 'react-native';

import type { FirmwareJob, InkTag } from '../core';
import { Bar, Btn, Col } from './kit';
import { FONT, INK } from './theme';

const stageText = (j: FirmwareJob) => {
  switch (j.stage) {
    case 'preparing':
      return 'Getting ready';
    case 'erasing':
      return 'Making room on the badge';
    case 'sending':
      return `Sending${j.total ? ` ${Math.floor((j.sent / j.total) * 100)}%` : ''}`;
    case 'installing':
      return 'Checking and installing';
    default:
      return 'Restarting the badge';
  }
};

const progressOf = (j: FirmwareJob) =>
  j.stage === 'sending' && j.total ? 0.05 + 0.85 * (j.sent / j.total) : j.stage === 'installing' ? 0.92 : j.stage === 'restarting' || j.stage === 'reconnecting' ? 0.97 : 0.02;

function Box({ children, alert }: { children: React.ReactNode; alert?: boolean }) {
  return (
    <View
      style={{ borderWidth: 2, borderColor: INK.black, borderStyle: alert ? 'dashed' : 'solid', backgroundColor: alert ? INK.white : INK.paper, padding: 12 }}
      accessibilityLiveRegion="polite"
      accessibilityRole={alert ? 'alert' : undefined}
    >
      <Col gap={6}>{children}</Col>
    </View>
  );
}

const title = { fontFamily: FONT.black, fontSize: 17, color: INK.black } as const;
const detail = { fontFamily: FONT.bold, fontSize: 15, color: INK.muted } as const;

export function FirmwareLine({ app, badgeId, busy }: { app: InkTag; badgeId: string; busy: boolean }) {
  const job = app.firmwareJob();
  if (job?.badgeId === badgeId)
    return (
      <Box>
        <Text style={title}>Updating the badge to {job.to === '?' ? 'new firmware' : `firmware ${job.to}`}</Text>
        <Text style={detail}>{stageText(job)}. Keep the app open; sending a picture pauses this.</Text>
        <Bar value={progressOf(job)} />
      </Box>
    );

  const result = app.firmwareResult(badgeId);
  const offer = app.firmwareOffer(badgeId);
  const install = () => void app.updateFirmware(badgeId);
  if (result?.status === 'updated')
    return (
      <Box>
        <Text style={title}>Updated to firmware {result.to}</Text>
      </Box>
    );
  if (result?.status === 'rolled-back')
    return (
      <Box alert>
        <Text style={title}>Firmware {result.to} didn&apos;t start</Text>
        <Text style={detail}>The badge went back to {result.from} by itself and works as before. It won&apos;t try {result.to} again unless you ask.</Text>
        <View style={{ alignSelf: 'flex-start' }}>
          <Btn small label="Try again" disabled={busy} onPress={install} />
        </View>
      </Box>
    );
  if (result?.status === 'failed' && offer?.newer)
    return (
      <Box alert>
        <Text style={title}>Couldn&apos;t update the firmware</Text>
        <Text style={detail}>{result.message} The badge still runs {result.from}; nothing changed.</Text>
        <View style={{ alignSelf: 'flex-start' }}>
          <Btn small label="Try again" disabled={busy} onPress={install} />
        </View>
      </Box>
    );
  // Newer firmware the app won't install on its own (it failed to start here before).
  if (offer?.newer && app.badges.get(badgeId)?.skipFirmware === offer.to)
    return (
      <Box>
        <Text style={title}>Firmware {offer.to} is available</Text>
        <Text style={detail}>It didn&apos;t start on this badge last time.</Text>
        <View style={{ alignSelf: 'flex-start' }}>
          <Btn small label="Install" disabled={busy} onPress={install} />
        </View>
      </Box>
    );
  return null;
}
