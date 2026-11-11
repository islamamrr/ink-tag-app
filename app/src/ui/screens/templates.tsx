// The Print tab, where the app opens: what's on the badge, "Print a photo"
// and your recent photos already in the badge's inks, then the templates
// ("Or start from a print"): the newest pack, categories, popular,
// everything and the blank starts. Plus a pack's page, search, and a
// template's preview, flooded in the template's main ink.

import { useState } from 'react';
import { Pressable, ScrollView, Text, useWindowDimensions, View } from 'react-native';

import { type CatalogEntry, LIVE_RULES, SCRATCH } from '../../core';
import { Btn, Card, Chip, ChipStrip, Col, EmptyState, Field, H, IconBtn, Label, Meta, Note, Row, Screen, Section, T, useSurface, useText } from '../kit';
import { type Route, useNav } from '../nav';
import { ItemThumb, TemplateThumb, useTemplateInk } from '../pictures';
import { Dots, HardShadow, Icon, InkDot, OffsetText } from '../print';
import { useServices } from '../services';
import { FONT, INK, inkLine, SHADOW, SPACE, tiltFor, TYPE } from '../theme';

/** Where tapping a template goes. */
export const routeFor = (e: CatalogEntry): Route =>
  e.behaviour === 'list'
    ? { name: 'list', id: e.id }
    : e.behaviour === 'board'
      ? { name: 'board', id: e.id }
      : e.behaviour === 'live'
        ? { name: 'live', id: e.id }
        : { name: 'form', id: e.id };

/** Every tile has a tag line, so rows of tiles line up. */
const tag = (e: CatalogEntry) => (e.behaviour === 'live' ? 'Live' : e.behaviour === 'board' ? 'Tap to send' : e.behaviour === 'list' ? 'Tick list' : 'Fill in');

export function TemplateTile({ e, width, index = 0 }: { e: CatalogEntry; width: number; index?: number }) {
  const { app, badge } = useServices();
  const nav = useNav();
  const tx = useText();
  const t = tag(e);
  return (
    <Pressable onPress={() => nav.push({ name: 'template', id: e.id })} style={({ pressed }) => [{ width, gap: 6 }, pressed && { opacity: 0.75 }]} accessibilityRole="button" accessibilityLabel={e.def.title}>
      <TemplateThumb app={app} entry={e} width={width} orientation={badge?.orientation ?? 'portrait'} tilt={tiltFor(index)} />
      <Text style={[tx.strong, { fontSize: width < 110 ? 17 : 19, marginTop: 2 }]} numberOfLines={1}>
        {e.def.title}
      </Text>
      <View style={{ marginTop: -4 }}>
        <Meta text={t} size={width < 110 ? TYPE.labelS : TYPE.label} color={e.behaviour === 'live' ? (tx.sf.flood ? tx.sf.fg : LIVE_GREEN) : undefined} />
      </View>
    </Pressable>
  );
}

export function Grid({ entries, cols = 2 }: { entries: CatalogEntry[]; cols?: number }) {
  const { width } = useWindowDimensions();
  const gap = cols > 2 ? 14 : 16;
  const w = Math.floor((width - 40 - gap * (cols - 1)) / cols);
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: gap, rowGap: 18 }}>
      {entries.map((e, i) => (
        <TemplateTile key={e.id} e={e} width={w} index={i} />
      ))}
    </View>
  );
}

/** A darker green for "LIVE" on paper: the green ink is too light for 10 px text. */
const LIVE_GREEN = '#1E6B3E';

/** The "On your badge" strip: what it shows now, and whether it's nearby. */
export function NowOnLine() {
  const { app, badge, connected } = useServices();
  const nav = useNav();
  const tx = useText();
  if (!badge) return null;
  const item = badge.shownItemId ? app.library.get(badge.shownItemId) : undefined;
  const what = item?.title ?? (badge.shownAt ? 'Blank' : 'Nothing yet');
  const status = connected ? 'Near' : badge.kind === 'demo' ? 'Demo' : 'Away';
  const portrait = badge.orientation === 'portrait';
  return (
    <Pressable
      onPress={() => nav.setTab('badge')}
      accessibilityRole="button"
      accessibilityLabel={`On ${badge.name}: ${what}. ${connected ? 'Connected' : 'Not connected'}`}
    >
      {({ pressed }) => (
        <HardShadow x={SHADOW.card} y={SHADOW.card}>
          <View
            style={[
              { minHeight: 60, borderWidth: 2, borderColor: INK.black, backgroundColor: INK.white, flexDirection: 'row', alignItems: 'center', gap: 12, paddingLeft: 10, paddingRight: 12, paddingVertical: 7 },
              pressed && { transform: [{ translateX: 3 }, { translateY: 3 }] },
            ]}
          >
            {item ? (
              <ItemThumb app={app} itemId={item.id} width={portrait ? 30 : 48} orientation={badge.orientation} />
            ) : (
              <View style={{ width: portrait ? 30 : 48, aspectRatio: portrait ? 2 / 3 : 1.5, borderWidth: 2, borderColor: INK.black, backgroundColor: INK.paper, overflow: 'hidden' }}>
                <Hatch />
              </View>
            )}
            <View style={{ flex: 1, gap: 1 }}>
              <Meta text={`On ${badge.name}`} />
              <Text style={[tx.strong, { fontSize: 21, lineHeight: 23, color: INK.black }]} numberOfLines={1}>
                {what}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 2, borderColor: INK.black, borderRadius: 14, paddingHorizontal: 9, paddingVertical: 3 }}>
              <InkDot color={connected ? INK.green : badge.kind === 'demo' ? INK.blue : INK.muted} size={8} />
              <Text style={{ fontFamily: FONT.monoBold, fontSize: 11, color: INK.black }}>{status.toUpperCase()}</Text>
            </View>
          </View>
        </HardShadow>
      )}
    </Pressable>
  );
}

/** Diagonal hatching: a screen with nothing on it yet. */
function Hatch() {
  return (
    <View style={{ flex: 1, overflow: 'hidden' }}>
      {Array.from({ length: 10 }, (_, i) => (
        <View key={i} style={{ position: 'absolute', left: -20 + i * 8, top: -10, width: 1.5, height: 90, backgroundColor: 'rgba(24,24,27,0.3)', transform: [{ rotate: '35deg' }] }} />
      ))}
    </View>
  );
}

/** The big blue "Print a photo" block. */
function PhotoBlock({ onPress }: { onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel="Print a photo, in the badge's six inks">
      {({ pressed }) => (
        <HardShadow x={SHADOW.card} y={SHADOW.card}>
          <View
            style={[
              { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: INK.blue, borderWidth: 2, borderColor: INK.black, paddingVertical: 18, paddingLeft: 16, paddingRight: 14, overflow: 'hidden' },
              pressed && { transform: [{ translateX: 3 }, { translateY: 3 }] },
            ]}
          >
            {/* Dots stay in the corner and fade out before the words. */}
            <Dots width={96} height={96} spacing={8} radius={2.3} color={INK.yellow} ground={INK.blue} fadeTo={96} round style={{ right: -26, top: -26 }} />
            <View style={{ width: 54, height: 54, borderRadius: 27, backgroundColor: INK.paper, borderWidth: 2, borderColor: INK.black, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="camera" size={26} />
            </View>
            <View style={{ flex: 1, gap: 4 }}>
              <OffsetText style={{ fontFamily: FONT.display, fontSize: TYPE.displayS, lineHeight: 23, color: INK.paper }} second="rgba(228,64,47,0.85)" dx={2} dy={2}>
                Print a photo
              </OffsetText>
              <Text style={{ fontFamily: FONT.bold, fontSize: TYPE.body, lineHeight: 20, color: '#E6ECFF' }}>In the badge&apos;s six inks</Text>
            </View>
            <Icon name="next" size={22} color={INK.paper} stroke={2.8} />
          </View>
        </HardShadow>
      )}
    </Pressable>
  );
}

export function TemplatesHome() {
  const { app, catalog } = useServices();
  const nav = useNav();
  const [cat, setCat] = useState<string>('all');
  const pack = catalog.newest();
  const popular = catalog.popular.map((id) => catalog.get(id)!).filter(Boolean);
  const list = cat === 'all' ? catalog.list() : cat === 'live' ? catalog.list({ live: true }) : catalog.list({ category: cat });
  const scratch = catalog.entries.filter((e) => e.category.includes(SCRATCH));
  const cats = [{ id: 'all', title: 'All' }, ...catalog.categories, { id: 'live', title: 'Live' }];
  const photos = app.library
    .list()
    .filter((i) => i.kind === 'photo')
    .slice(0, 10);

  return (
    <Screen brand right={<IconBtn icon="search" tone="yellow" label="Search templates" onPress={() => nav.push({ name: 'search' })} />}>
      {nav.notice && <Note onClose={() => nav.setNotice(null)}>{nav.notice}</Note>}
      <NowOnLine />
      <PhotoBlock onPress={() => nav.push({ name: 'photo' })} />
      <ChipStrip>
        <View style={{ justifyContent: 'center', paddingRight: 2 }}>
          <Meta text="Start blank" />
        </View>
        {scratch.map((e) => (
          <Chip key={e.id} label={e.def.title} onPress={() => nav.push({ name: 'form', id: e.id })} />
        ))}
      </ChipStrip>

      {photos.length > 0 && (
        <Col gap={10}>
          <Section title="Your photos, in ink" link="All photos" onLink={() => nav.setTab('gallery')} />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -20 }} contentContainerStyle={{ gap: 14, paddingHorizontal: 20, paddingVertical: 8, alignItems: 'center' }}>
            {photos.map((it, i) => (
              <Pressable key={it.id} onPress={() => nav.push({ name: 'photo', scene: it.scene, style: it.style })} accessibilityRole="button" accessibilityLabel={`${it.title}, print again`}>
                <ItemThumb app={app} itemId={it.id} width={it.scene.orientation === 'portrait' ? 84 : 126} orientation={it.scene.orientation} tilt={tiltFor(i + 1)} />
              </Pressable>
            ))}
          </ScrollView>
        </Col>
      )}

      <Row style={{ justifyContent: 'space-between', alignItems: 'flex-end', marginTop: SPACE.s }}>
        <H size={TYPE.headingL}>Or start from a print</H>
        <Meta text={`${catalog.entries.length} prints`} />
      </Row>

      {pack && (
        <Card onPress={() => nav.push({ name: 'pack', id: pack.id })} label={`New: ${pack.title}`} style={{ paddingVertical: 12 }}>
          <Row gap={12}>
            <Col gap={4} style={{ flex: 1 }}>
              <Row gap={10}>
                <H size={TYPE.headingL - 2}>{pack.title}</H>
                <View style={{ backgroundColor: INK.yellow, borderWidth: 2, borderColor: INK.black, paddingHorizontal: 6, paddingVertical: 1, transform: [{ rotate: '-2deg' }] }}>
                  <Meta text="New pack" size={TYPE.labelS} color={INK.black} />
                </View>
              </Row>
              <Text style={{ fontFamily: FONT.bold, fontSize: 17, lineHeight: 19, color: INK.muted }} numberOfLines={1}>
                {pack.tagline ?? pack.description}
              </Text>
              <Meta text={`${pack.templates.length} templates`} color={INK.blue} />
            </Col>
            <Icon name="next" size={22} stroke={2.8} />
          </Row>
        </Card>
      )}

      <ChipStrip>
        {cats.map((c) => (
          <Chip key={c.id} label={c.title} on={cat === c.id} onPress={() => setCat(c.id)} />
        ))}
      </ChipStrip>

      {cat === 'all' && popular.length > 0 && (
        <Col gap={10}>
          <Label>Popular</Label>
          <Grid entries={popular} cols={3} />
        </Col>
      )}

      <Col gap={10}>
        <Label>{cat === 'all' ? 'Everything' : (cats.find((c) => c.id === cat)?.title ?? '')}</Label>
        <Grid entries={list} />
      </Col>

    </Screen>
  );
}

export function PackScreen({ id }: { id: string }) {
  const { catalog } = useServices();
  const nav = useNav();
  const pack = catalog.pack(id);
  if (!pack)
    return (
      <Screen onBack={nav.pop} title="Pack">
        <T>This pack is gone.</T>
      </Screen>
    );
  const entries = pack.templates.map((t) => catalog.get(t)!);
  return (
    <Screen onBack={nav.pop} back="Print" title={`Pack · ${entries.length} prints`}>
      <H size={32}>{pack.title}</H>
      <T muted>
        {pack.description} Added {new Date(pack.added).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}.
      </T>
      <Grid entries={entries} />
    </Screen>
  );
}

export function SearchScreen() {
  const { catalog } = useServices();
  const nav = useNav();
  const [q, setQ] = useState('');
  const found = catalog.search(q);
  return (
    <Screen onBack={nav.pop} back="Print" title="Search">
      <Field placeholder="Try “wifi”, “clock”, “wedding”" value={q} onChangeText={setQ} autoFocus accessibilityLabel="Search templates" />
      {q.trim() !== '' && <Label muted>{found.length === 1 ? '1 print' : `${found.length} prints`}</Label>}
      <Grid entries={found} />
      {q.trim() !== '' && found.length === 0 && (
        <EmptyState icon="search" title="No prints match that">
          Try a shorter word, like “name”, “sign” or “list”.
        </EmptyState>
      )}
    </Screen>
  );
}

export function TemplatePreview({ id }: { id: string }) {
  const { app, catalog, badge } = useServices();
  const nav = useNav();
  const { width } = useWindowDimensions();
  const [layout, setLayout] = useState(0);
  const e = catalog.get(id);
  const ink = useTemplateInk(app, e);
  if (!e)
    return (
      <Screen onBack={nav.pop}>
        <T>This template is gone.</T>
      </Screen>
    );
  const orientation = badge?.orientation ?? 'portrait';
  const w = orientation === 'portrait' ? Math.min(270, width * 0.66) : width - 70;
  const meta = inkLine(ink.shares) || e.def.title;
  return (
    <Screen onBack={nav.pop} back="Print" title={meta} flood={ink.flood} footer={<Btn kind="primary" label="Use this template" onPress={() => nav.replace(routeFor(e))} />}>
      <View style={{ alignItems: 'center', gap: 18, paddingTop: 14, paddingBottom: 4 }}>
        <TemplateThumb app={app} entry={e} width={w} orientation={orientation} layout={layout} tilt={-2} shadow={INK.black} device />
        {e.def.layouts > 1 && (
          <Row gap={8}>
            {Array.from({ length: e.def.layouts }, (_, i) => (
              <Chip key={i} label={`Layout ${i + 1}`} on={layout === i} onPress={() => setLayout(i)} />
            ))}
          </Row>
        )}
      </View>
      <H>{e.def.title}</H>
      <T>{e.def.description}</T>
      <Facts e={e} />
    </Screen>
  );
}

function Facts({ e }: { e: CatalogEntry }) {
  const sf = useSurface();
  const facts: [string, string][] = [];
  if (e.fills) facts.push(['You fill in', e.fills]);
  facts.push(['Hangs', `Upright or sideways · ${e.def.layouts === 1 ? '1 layout' : `${e.def.layouts} layouts`}`]);
  if (e.behaviour === 'live' && e.live) facts.push(['Live', `${e.live.map((r) => LIVE_RULES[r].label).join(', ')}. Your phone sends each update.`]);
  if (e.behaviour === 'board') facts.push(['Tap to send', 'A set of ready pictures. Tap one and it goes to your badge.']);
  if (e.behaviour === 'list') facts.push(['Tick list', 'Tick items in the app, then update your badge.']);
  return (
    <Col gap={12} style={{ borderTopWidth: 2, borderTopColor: sf.fg, paddingTop: 12 }}>
      {facts.map(([k, v]) => (
        <Col key={k} gap={2}>
          <Label>{k}</Label>
          <T>{v}</T>
        </Col>
      ))}
    </Col>
  );
}
