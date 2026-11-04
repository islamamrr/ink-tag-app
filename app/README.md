# Ink Tag phone app

React Native (Expo SDK 58, TypeScript) app that turns a photo into a
six-color frame and sends it to an Ink Tag badge over Bluetooth LE.

Phases 1 and 2 of the plan are in: the protocol client, a simulated badge
and the whole image pipeline (phase 1), and Bluetooth LE to a real badge
through react-native-ble-plx (phase 2), all tested on Node against simulated
badges, plus a developer screen that drives them on a phone. The product UI
is planned separately.

## Run it

```bash
cd app
npm install
npm run check        # lint + typecheck + 56 tests, no phone needed
npx expo start       # developer screen; see "On a phone" below
```

### On a phone

Bluetooth is a native module Expo Go can't load, so the app needs a
**development build** (your own Expo Go with Ink Tag's native code in it).
Expo Go still opens the developer screen, but only the simulator works there
and the screen says so.

**Android, built in the cloud (no Android Studio needed):**

```bash
npm install
npx eas-cli@latest login                     # free Expo account
npx eas-cli@latest build --profile development --platform android
```

The first build asks to create the EAS project and an Android keystore; say
yes to both. It takes 10 to 20 minutes and ends with a link and a QR code to
an `.apk`. Open it on the phone and install it (allow "install unknown
apps" for the browser when asked). Then, on the laptop:

```bash
npx expo start --dev-client
```

and open the Ink Tag app on the phone; it finds the dev server on the same
Wi-Fi (or scan the QR code from the terminal). JavaScript changes reload
without a new build. A new build is only needed when native packages or
`app.json` change.

**Android, built locally:** with Android Studio installed and the phone in
USB debugging mode, `npx expo run:android` builds, installs and starts it.

**Android, standalone APK (no laptop needed):** the development build above
loads its JavaScript from the laptop. To get an app that runs on its own,
either download the APK from the **Android APK** workflow in GitHub Actions
(Actions tab, open a run, "Artifacts" at the bottom; "Run workflow" starts a
new one), or build it on EAS with
`npx eas-cli@latest build --profile preview --platform android`.
Both use the same package id as the development build but a different
signing key, so uninstall the development build first. The GitHub APK is
signed with the standard React Native debug key: fine for testing and
handing to friends, not for the Play Store.

**iPhone:** an iOS development build needs a paid Apple Developer account.
`npx eas-cli@latest device:create` registers the phone, then
`npx eas-cli@latest build --profile development --platform ios`.
Or `npx expo run:ios --device` on a Mac with Xcode.

**Using it with a badge:** turn the badge on, tap **Scan for badges**, allow
"Nearby devices" (Android 12+; location on Android 11 and older), tap the
badge in the list. The status line shows the firmware and the MTU. Then
pick a photo and **Send**. The log shows the transfer speed, chunk size and
retries.

The developer screen also connects to the **simulator badge**, picks a photo,
shows the dithered preview next to what the simulated panel draws, and runs
send, cancel, show, clear and info, with buttons to inject faults (CRC failure,
dead panel, dropped link). Timings for each pipeline step go to the log.

## Layout

```
src/core/            plain TypeScript, no React Native imports (ESLint enforces it)
  protocol/          constants, encoders, INFO parser, errors, CRC-32, TagClient
  transport/link.ts  the Link interface BLE and the simulator both implement
  transport/radio.ts the slice of a BLE stack the app uses (Radio)
  transport/bleLink.ts  Link over a Radio: connect retries, MTU, write pacing
  transport/scan.ts  finds badges by service UUID, nearest first
  sim/               FakeTag + SimLink, a port of devtool/fake_device.py;
                     FakeRadio, a pretend BLE stack with FakeTags behind it
  util/base64.ts     base64 for the Bluetooth bridge (Hermes has no Buffer)
  imaging/           palette, fit, tone, dither, frame pack/rotate/preview, pipeline
src/services/        phone side: photo decode (Skia), badge connections,
                     radio.ts (react-native-ble-plx + Android permissions)
src/screens/         DebugScreen, the developer screen
test/                Jest tests; test/golden holds files made by the Python tool
tools/make_golden.py regenerates test/golden from firmware/tools/inktag.py
```

## What the tests prove

- **Protocol** (`test/codec.test.ts`): every command's bytes, INFO from
  firmware 0.1 (17 bytes), 0.2 (18) and 0.3 (21), panel id wiring check,
  CRC-32 equal to zlib.
- **Client against the simulator** (`test/client.test.ts`): upload, show,
  clear, temperature override, firmware 0.1 refusing TEMP, CRC mismatch
  retried once in safe mode, a second CRC failure, disconnect mid-upload
  (reports the badge is blank), cancel (sends ABORT), dead panel, disconnect
  during the refresh, wrong protocol version, timeouts, and commands queued
  behind a refresh.
- **Bluetooth against a fake radio** (`test/ble.test.ts`): base64; scanning
  by service UUID (other devices ignored, one entry per badge, nearest
  first, missing names, stop early, Bluetooth off or not allowed, radio still
  starting); a full upload through BleLink at MTU 517 and at iOS's 185;
  writes kept in flight but never overtaken by END; connect retried after
  Android-style failures and given up after three; a device without the
  Ink Tag service refused; a slow notification subscription; a chunk lost on
  air (bad length) retried with responses; out of range mid-upload; reconnect
  and upload again; close; and a drop during the refresh.
- **Imaging against the Python tool** (`test/imaging.test.ts`): rotate + pack
  byte for byte equal to `inktag.py` on a test photo, the same CRC, the same
  preview pixels, the vendor's DTM1 sample frame round-trips, and dithering in
  RGB mode within 2 points of Pillow's color shares per color (it lands within
  0.2).

## CI

`.github/workflows/app-ci.yml` runs lint, typecheck and tests on every push.
It expects the app in an `app/` folder at the root of the repository, so move
the workflow to the repository's own `.github/workflows/` when the project goes
into git.

## Decisions worth knowing

- **Bluetooth layering**: `src/core` never imports react-native-ble-plx. It
  defines a small `Radio` interface; `src/services/radio.ts` implements it
  with ble-plx and `FakeRadio` implements it for tests. So `BleLink`, the
  part with the logic, runs in Jest on a laptop.
- **Connecting**: Android asks for MTU 517 (the badge's maximum) and a
  high-priority connection (7.5 to 15 ms interval, which the badge also
  asks for). iOS picks its own MTU, usually 185 or more. A failed connect is
  retried twice (Android's "133" errors are common on a first connect). The
  app checks the badge really has the Ink Tag service before using it, then
  waits 300 ms for the notification subscription to land, and asks for INFO
  a second time if the first answer was lost.
- **Write pacing**: up to 4 writes without response are in flight at once,
  and every 32nd chunk asks for a response, so the phone's queue stays full
  without running far ahead. Control writes wait for the data in flight, so
  END can never overtake the last chunk.
- **Chunk size** is MTU − 3 but never more than 512 bytes, the largest value
  a GATT write may carry. Android refuses longer writes ("Operation was
  rejected"); the first real-badge test hit exactly that at MTU 517.
- **Refused writes**: if the phone's stack refuses writes while the link
  stays up, the upload is retried once with a response on every write. A
  failed upload sends ABORT, so the badge doesn't stay stuck waiting for data
  (it answers SHOW/CLEAR with "bad state" until then), and no write error is
  left behind for the next command.
- **Lost chunks**: a write without response can vanish on air. The badge
  then answers END with "bad length" (or "CRC mismatch" if bytes were
  damaged); either way the upload is retried once with a response on every
  write.
- **Permissions**: Android 12+ asks for "Nearby devices" only, flagged as
  never used for location; Android 11 and older need location, Android's
  rule for BLE scans. iOS asks on first use with the text in `app.json`.
- **Screen stays on during an upload** (expo-keep-awake), since a locked
  phone may suspend Bluetooth.

- **Upload success is RECEIVED**, not DISPLAYED: the picture is stored in
  flash by then. `upload()` resolves at RECEIVED and returns a `displayed`
  promise that reports the refresh (done, panel error, or unknown if the phone
  left). Other commands wait until the refresh ends, as on the badge.
- **Retries**: CRC mismatch retries once with a response on every write;
  "bad state" on BEGIN sends ABORT and retries once.
- **Dithering** picks the nearest color in Oklab by default and diffuses
  error in sRGB, serpentine Floyd–Steinberg. Atkinson and no dithering are
  options; `metric: 'rgb'` matches the Python tool. Oklab gives noticeably
  different results from Pillow (more yellow, less of the dull green on the
  test image); which looks better can only be judged on the real panel.
- **Rotation** is one constant, `PANEL_ROTATION` in `src/core/imaging/frame.ts`.
  Flip it to `'cw'` if pictures come out upside down on the real badge.
- **Palette** is the measured Spectra 6 palette from `firmware/tools/inktag.py`;
  a test fails if the two drift apart.
- **Photo decode**: expo-image-manipulator bakes in EXIF orientation and caps
  the long edge at 1600 px, then Skia crops/scales into a 528 × 792 surface.
- **Identity**: app name "Ink Tag" and bundle id `dev.inktag.app` are
  placeholders. The bundle id can't change after the first store release, so
  set the final brand before then.

## Not done yet / to check on a phone

- Nothing has run on a phone yet. The bundle builds for Android and iOS
  (`npx expo export`) and `expo prebuild` writes the Bluetooth permissions
  into the Android manifest, but no native build has been made here (no
  Android SDK in the build environment), so the first EAS build is the
  first real compile. react-native-ble-plx 3.5 is an old-style native
  module and runs through React Native's compatibility layer for the New
  Architecture; if the build or the module fails, that is the first place
  to look.
- Real-badge numbers to collect: MTU and transfer speed on Android and
  iPhone, whether 4 writes in flight ever loses chunks (the log says
  "retrying with a response"), and how long a connect takes.
- Android stops scans silently if an app starts more than 5 in 30 seconds.
  Don't hammer Scan.
- Speed: on a laptop the dither takes about 0.4 s and tone about 0.2 s.
  Hermes on a low-end Android phone will be several times slower; the
  developer screen logs the timings. If it's too slow, move the conversion off
  the JS thread (worklets) or into a small native module, as the plan says.
- Not yet: remembering the last badge across app restarts, connecting to it
  automatically, background transfers, and pairing/ownership (needs
  firmware support, see PROTOCOL.md).
