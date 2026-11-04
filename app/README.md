# Ink Tag phone app

React Native (Expo SDK 58, TypeScript) app that turns a photo into a
six-color frame and sends it to an Ink Tag badge over Bluetooth LE.

Phases 1 and 2 of the plan are in: the protocol client, a simulated badge
and the whole image pipeline (phase 1), and Bluetooth LE to a real badge
through react-native-ble-plx (phase 2), all tested on Node against simulated
badges, plus a developer screen that drives them on a phone.

**v1's features are in too, without the product UI** (see "v1" below): my
badges, adding one by scanning, locking it to this phone (firmware 0.4),
reconnecting at launch, demo badges, photos with crop, adjust and picture
styles, the true preview, text, stickers and frames, nine templates,
progress while sending, the library, Send from Photos, and the screen check.
The product UI is designed separately and will sit on top of the same
service.

## Run it

```bash
cd app
npm install
npm run check        # lint + typecheck + 105 tests, no phone needed
npx expo start       # developer screens; see "On a phone" below
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

**Using it with a badge:** turn the badge on, tap **Scan**, allow "Nearby
devices" (Android 12+; location on Android 11 and older), tap the badge in
the list. The app remembers it: next time **Connect InkTag-XXXX** finds it
with a short scan, and with "Connect to the last badge when the app opens"
ticked it does that by itself at launch. Then **Pick & send**.

What the test screen shows:

- **Badge card:** firmware, MTU and chunk size, whether a picture is stored,
  panel temperature, and whether the panel answered at boot (firmware 0.3+;
  red when it didn't, which means check the ribbon and booster).
- **Problem banner** at the top for any failure: the plain sentence, what to
  try, and the raw error. A panel timeout (no panel or booster wired,
  firmware 0.3.1+) shows here, and the picture stays stored on the badge.
- **Progress card** for every send, show and clear: each stage (erase
  storage, send, check CRC, refresh panel) with its time, the send's
  percentage, speed and time left, retries, and the result line.
- **Recent results:** one line per send, show or clear, pass or fail.
- **Log:** "Summary" shows the app's own lines; "All" adds every command,
  notification and simulator line. **Share** sends the whole log (for
  example to yourself or into a chat) with timestamps. It also goes to the
  dev server's terminal.

Fit, dither, the simulator speed and the log mode are remembered between
launches (a small file in the app's documents folder, through
expo-file-system, which every Expo build already has, so no new development
build is needed).

The test screen also connects to the **simulator badge**, shows the dithered
preview next to what the simulated panel draws, and has buttons to inject
faults (CRC failure, panel timeout, dropped link).

## v1

Scope agreed in the wireframes (2 Nov): everything that works with today's
badge plus locking it to its owner's phone. **Cold weather mode (the
temperature override) moved to the next version**: the firmware and
`TagClient.setTempOverride()` still support it, but no v1 feature uses it.

Everything lives behind one service, `InkTag` (`src/core/model/inkTag.ts`),
plain TypeScript and tested against simulated badges.
`src/services/inkTag.ts` wires it to the phone. The **v1** developer screen
(`src/screens/V1Screen.tsx`, the default tab) drives all of it.

| Feature (wireframes) | Where |
|---|---|
| Add a badge by scanning, nearest first, in plain words | `InkTag.scan()`, `addBadge()`; `model/proximity.ts` |
| Remembers it and reconnects at launch | `model/badges.ts` (saved in `badges.json`), `InkTag.reconnect()` |
| Lock to my phone | `InkTag.addBadge({ lock })`, `setLocked()`, `forget()`; `TagClient.lock/authenticate/unlock`; firmware 0.4 |
| Several badges per phone, each with its name, use and how it hangs | `BadgeRegistry`; `rename()`, `setUse()`, `setOrientation()` |
| Demo mode | `InkTag.addDemoBadge()`: a FakeTag behind the same service |
| Photo to badge: crop, zoom, brightness, contrast, colour boost | `PhotoLayer` (`crop`, `zoom`, `tone`); `design/styles.ts` `toneFor()` |
| True preview | `InkTag.prepare()`: `rendered` (photo) and `converted.preview` (on badge) |
| Picture styles: Smooth, Poster, Sketch | `design/styles.ts` |
| Text, stickers and frames | `TextLayer` (wraps and shrinks to fit), `design/stickers.ts`, `FrameLayer` |
| Templates: name badge, event ticket, contact QR, Wi-Fi QR, quote, status sign | `design/templates.ts`, plus Text, QR code and Collage for the Create tiles, and the "Hello" picture drawn when a badge is added |
| Clear progress while sending, time left, safe to walk away | `model/progress.ts`; learns this phone's real timings |
| Library: history, favourites, collections, send again in one tap | `model/library.ts`; keeps the packed frame so sending again needs no redraw |
| Send from Photos | `services/share.ts` (expo-share-intent: Android `image/*` filter, iOS share extension) |
| Screen check | `model/screenCheck.ts` (panel id at boot + last refresh) |

How a design becomes a picture: a **scene** (`design/scene.ts`) is data
(photos, text, shapes, QR codes, strokes, stickers, frames). `compile()`
lays it out into a few drawing operations in TypeScript, so layout is tested
on a laptop; `services/render.ts` paints them with Skia in the panel's
measured colours, using the bundled Inter font so a design looks the same on
every phone. Then the existing pipeline dithers, rotates and packs it.

Not in this round: Draw (strokes are supported by scenes and the renderer,
but drawing needs the real UI's touch canvas) and keeping lock keys in the
phone's keychain (they're in the app's files for now; expo-secure-store is
the follow-up).

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
  util/sha256.ts     SHA-256 and HMAC for the badge lock
  design/            v1: scene model and layout, QR codes, stickers, styles, templates
  model/             v1: InkTag service, badges, library, progress, screen check, storage
src/services/        phone side: photo decode (Skia), badge connections,
                     radio.ts (react-native-ble-plx + Android permissions),
                     prefs.ts (remembered badge and settings),
                     inkTag.ts (the v1 service on the phone), render.ts (Skia),
                     storage.ts (files), fonts.ts, share.ts (share sheet)
src/screens/         V1Screen (v1 services), DebugScreen (the test screen),
                     devUi.tsx (their plain building blocks)
assets/fonts/        Inter Regular and Bold (SIL OFL, see OFL.txt)
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

- **v1** (`test/v1.test.ts`): SHA-256/HMAC test vectors; the lock (a
  locked badge refuses another phone, wrong keys fail, the key never goes
  over the air); QR payloads and module sizes; text wrapping and shrinking;
  every template inside the badge in both orientations; collage cells;
  styles and sliders; progress and time left; screen check; the library
  (dedupe, favourites, collections, sections, pruning, a broken index); and
  the service end to end on demo badges: add with lock and hello, send, send
  again, redraw, blank, reconnect, someone else's badge, a button reset,
  lock off and on, forget, several badges, old firmware, a dead panel.
- **Skia renderer** (`test/render.skia.test.ts`, on CanvasKit): real font
  widths, solid colours mapping exactly onto the inks, text inside its box,
  every QR module where the matrix says, photo crop/circle/tone, every
  template drawing, and a design through the service to a demo badge with
  its library preview.

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
- The lock needs firmware 0.4 on the badge; older firmware is added
  unlocked and the service says so (`lockUnsupported`). Firmware 0.4 hasn't
  been compiled yet (see firmware/README.md).
- Send from Photos changes native config (share extension, intent filter),
  so it needs a new build, not just a JavaScript reload.
- Not yet: background transfers.
