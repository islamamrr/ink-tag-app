// The Templates tab, where the app opens: the "New" pack shelf, categories,
// the template grid and the blank starts. Plus a pack's page, search, and a
// template's preview before you fill it in.

import { useState } from 'react';
import { Pressable, Text, useWindowDimensions, View } from 'react-native';

import { type CatalogEntry, LIVE_RULES, SCRATCH } from '../../core';
import { Btn, Card, Chip, ChipStrip, Col, Field, G, H, Label, Row, s, Screen, T } from '../kit';
import { type Route, useNav } from '../nav';
import { TemplateThumb } from '../pictures';
import { useServices } from '../services';

/** Where tapping a template goes. */
export const routeFor = (e: CatalogEntry): Route =>
  e.behaviour === 'list'
    ? { name: 'list', id: e.id }
    : e.behaviour === 'board'
      ? { name: 'board', id: e.id }
      : e.behaviour === 'live'
        ? { name: 'live', id: e.id }
        : { name: 'form', id: e.id };

const tag = (e: CatalogEntry) => (e.behaviour === 'live' ? 'Live' : e.behaviour === 'board' ? 'Tap to send' : e.behaviour === 'list' ? 'Tick list' : '');

export function TemplateTile({ e, width }: { e: CatalogEntry; width: number }) {
  const { app, badge } = useServices();
  const nav = useNav();
  const t = tag(e);
  return (
    <Pressable onPress={() => nav.push({ name: 'template', id: e.id })} style={{ width, gap: 4 }} accessibilityRole="button" accessibilityLabel={e.def.title}>
      <TemplateThumb app={app} entry={e} width={width} orientation={badge?.orientation ?? 'portrait'} />
      <Text style={[s.rowLabel, { fontWeight: '600' }]} numberOfLines={1}>
        {e.def.title}
      </Text>
      {t ? <Text style={s.small}>{t}</Text> : null}
    </Pressable>
  );
}

export function Grid({ entries, cols = 2 }: { entries: CatalogEntry[]; cols?: number }) {
  const { width } = useWindowDimensions();
  const gap = 12;
  const w = Math.floor((width - 40 - gap * (cols - 1)) / cols);
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap }}>
      {entries.map((e) => (
        <TemplateTile key={e.id} e={e} width={w} />
      ))}
    </View>
  );
}

/** "Now on My badge: To-do list ›" */
export function NowOnLine() {
  const { app, badge, connected } = useServices();
  const nav = useNav();
  if (!badge) return null;
  const item = badge.shownItemId ? app.library.get(badge.shownItemId) : undefined;
  return (
    <Pressable onPress={() => nav.setTab('badge')} style={[s.row, { borderBottomWidth: 0, minHeight: 40 }]} accessibilityRole="button">
      <Text style={[s.small, { flex: 1 }]} numberOfLines={1}>
        {connected ? '● ' : '○ '}Now on {badge.name}: <Text style={{ color: G.ink, fontWeight: '700' }}>{item?.title ?? (badge.shownAt ? 'blank' : 'nothing yet')}</Text>
      </Text>
      <Text style={s.small}>›</Text>
    </Pressable>
  );
}

export function TemplatesHome() {
  const { catalog } = useServices();
  const nav = useNav();
  const [cat, setCat] = useState<string>('all');
  const pack = catalog.newest();
  const popular = catalog.popular.map((id) => catalog.get(id)!).filter(Boolean);
  const list = cat === 'all' ? catalog.list() : cat === 'live' ? catalog.list({ live: true }) : catalog.list({ category: cat });
  const scratch = catalog.entries.filter((e) => e.category.includes(SCRATCH));

  return (
    <Screen
      title="Templates"
      right={<Btn label="Search" small onPress={() => nav.push({ name: 'search' })} />}
    >
      <NowOnLine />
      {pack && (
        <Card onPress={() => nav.push({ name: 'pack', id: pack.id })}>
          <Label>New</Label>
          <H size={20}>{pack.title}</H>
          <T muted>{pack.description}</T>
          <T bold>{pack.templates.length} templates ›</T>
        </Card>
      )}

      <ChipStrip>
        {[{ id: 'all', title: 'All' }, ...catalog.categories, { id: 'live', title: 'Live' }].map((c) => (
          <Chip key={c.id} label={c.title} on={cat === c.id} onPress={() => setCat(c.id)} />
        ))}
      </ChipStrip>

      {cat === 'all' && popular.length > 0 && (
        <Col>
          <H size={18}>Popular</H>
          <Grid entries={popular} cols={3} />
        </Col>
      )}

      <Col>
        <H size={18}>{cat === 'all' ? 'Everything' : ([...catalog.categories, { id: 'live', title: 'Live' }].find((c) => c.id === cat)?.title ?? '')}</H>
        <Grid entries={list} />
      </Col>

      <Col>
        <H size={18}>Start from scratch</H>
        <Row wrap>
          <Btn label="Photo" onPress={() => nav.push({ name: 'photo' })} />
          {scratch.map((e) => (
            <Btn key={e.id} label={e.def.title} onPress={() => nav.push({ name: 'form', id: e.id })} />
          ))}
        </Row>
      </Col>
    </Screen>
  );
}

export function PackScreen({ id }: { id: string }) {
  const { catalog } = useServices();
  const nav = useNav();
  const pack = catalog.pack(id);
  if (!pack) return <Screen onBack={nav.pop} title="Pack"><T>This pack is gone.</T></Screen>;
  const entries = pack.templates.map((t) => catalog.get(t)!);
  return (
    <Screen onBack={nav.pop} back="Templates" title={pack.title}>
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
    <Screen onBack={nav.pop} back="Templates" title="Search">
      <Field placeholder="Try “wifi”, “clock”, “wedding”" value={q} onChangeText={setQ} autoFocus />
      {q.trim() !== '' && <T muted>{found.length === 1 ? '1 template' : `${found.length} templates`}</T>}
      <Grid entries={found} />
      {q.trim() !== '' && (
        <Card>
          <T bold>Missing something?</T>
          <T muted>Tell us what you&apos;d put on your badge. Popular ideas become the next pack. (Suggestions aren&apos;t sent anywhere yet in this test build.)</T>
        </Card>
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
  if (!e) return <Screen onBack={nav.pop}><T>This template is gone.</T></Screen>;
  const orientation = badge?.orientation ?? 'portrait';
  const w = orientation === 'portrait' ? Math.min(240, width - 120) : width - 80;
  return (
    <Screen
      onBack={nav.pop}
      back="Templates"
      footer={<Btn kind="primary" label="Use this template" onPress={() => nav.replace(routeFor(e))} />}
    >
      <View style={{ alignItems: 'center', gap: 10 }}>
        <TemplateThumb app={app} entry={e} width={w} orientation={orientation} layout={layout} />
        {e.def.layouts > 1 && (
          <Row>
            {Array.from({ length: e.def.layouts }, (_, i) => (
              <Chip key={i} label={`Layout ${i + 1}`} on={layout === i} onPress={() => setLayout(i)} />
            ))}
          </Row>
        )}
      </View>
      <H>{e.def.title}</H>
      <T>{e.def.description}</T>
      <Col gap={4}>
        {e.fills ? <T muted>You fill in: {e.fills.charAt(0).toLowerCase() + e.fills.slice(1)}</T> : null}
        <T muted>Hangs upright or sideways · {e.def.layouts === 1 ? '1 layout' : `${e.def.layouts} layouts`}</T>
        {e.behaviour === 'live' && e.live && <T muted>Live: {e.live.map((r) => LIVE_RULES[r].label.toLowerCase()).join(', ')}. Your phone sends each update.</T>}
        {e.behaviour === 'board' && <T muted>A set of ready pictures. Tap one and it goes to your badge.</T>}
        {e.behaviour === 'list' && <T muted>Tick items in the app, then update your badge.</T>}
      </Col>
    </Screen>
  );
}
