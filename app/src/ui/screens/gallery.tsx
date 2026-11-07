// The Gallery tab: what's on the badge now, everything you've made with
// Favourites and collections, and the + button. A Gallery item: send again,
// edit a copy, add to a collection, favourite, delete.

import { useState } from 'react';
import { Alert, Pressable, Text, useWindowDimensions, View } from 'react-native';

import { type LibraryFilter, type LibraryItem, SCRATCH } from '../../core';
import { Btn, Card, Chip, ChipStrip, Col, Field, G, H, Label, ListRow, Note, Row, s, Screen, Sheet, T } from '../kit';
import { useNav } from '../nav';
import { BadgeFrame, ItemThumb } from '../pictures';
import { ago, useServices } from '../services';
import { Grid } from './templates';

/** "Now on My badge" with one badge; a strip of badges with two or more. */
function NowOn() {
  const { app, badge, connected } = useServices();
  const nav = useNav();
  const badges = app.badges.list();
  const conn = app.connection();
  if (!badge) return null;
  if (badges.length > 1)
    return (
      <Col gap={6}>
        <Label>On your badges</Label>
        <ChipStrip>
          {badges.map((b) => {
            const on = conn.badgeId === b.id && conn.status === 'connected';
            return (
              <Pressable key={b.id} onPress={() => nav.push({ name: 'badgePage', id: b.id })} style={{ alignItems: 'center', gap: 4, opacity: on || b.kind === 'demo' ? 1 : 0.5 }} accessibilityRole="button">
                {b.shownItemId ? <ItemThumb app={app} itemId={b.shownItemId} width={54} orientation={b.orientation} /> : <BadgeFrame width={54} orientation={b.orientation} />}
                <Text style={[s.small, { color: G.ink, fontWeight: '700' }]} numberOfLines={1}>
                  {b.name}
                </Text>
              </Pressable>
            );
          })}
          <Pressable onPress={() => nav.push({ name: 'setup' })} style={{ alignItems: 'center', gap: 4 }} accessibilityRole="button">
            <BadgeFrame width={54} orientation="portrait" style={{ backgroundColor: G.white, alignItems: 'center', justifyContent: 'center', borderWidth: 2 }}>
              <Text style={{ fontSize: 22 }}>+</Text>
            </BadgeFrame>
            <Text style={s.small}>Add</Text>
          </Pressable>
        </ChipStrip>
      </Col>
    );
  const item = badge.shownItemId ? app.library.get(badge.shownItemId) : undefined;
  return (
    <Card onPress={() => nav.setTab('badge')} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      {item ? <ItemThumb app={app} itemId={item.id} width={54} orientation={badge.orientation} /> : <BadgeFrame width={54} orientation={badge.orientation} style={{ backgroundColor: G.white }} />}
      <View style={{ flex: 1, gap: 2 }}>
        <Label>Now on {badge.name}</Label>
        <Text style={[s.rowLabel, { fontWeight: '800' }]}>{item?.title ?? (badge.shownAt ? 'Blank' : 'Nothing yet')}</Text>
        <Text style={s.small}>
          {connected ? 'Connected' : badge.kind === 'demo' ? 'Demo badge' : 'Not nearby'}
          {badge.shownAt ? ` · sent ${ago(badge.shownAt)}` : ' · blank for now'}
        </Text>
      </View>
    </Card>
  );
}

export function GalleryScreen() {
  const { app, catalog, badge } = useServices();
  const nav = useNav();
  const { width } = useWindowDimensions();
  const [filter, setFilter] = useState<LibraryFilter>({ kind: 'all' });
  const [creating, setCreating] = useState(false);
  const items = app.library.list(filter);
  const all = app.library.list();
  const collections = app.library.collections();
  const tileW = Math.floor((width - 40 - 12) / 2);
  const starters = ['name-badge', 'todo', 'clock', 'status-board'].map((id) => catalog.get(id)!).filter(Boolean);

  return (
    <View style={{ flex: 1 }}>
      <Screen title="Gallery">
        {nav.notice && (
          <Note onClose={() => nav.setNotice(null)}>
            {nav.notice}
          </Note>
        )}
        <NowOn />
        {all.length === 0 ? (
          <Col>
            <H size={18}>Start with one of these</H>
            <Grid entries={starters} />
            <Btn label="Use a photo" onPress={() => nav.push({ name: 'photo' })} />
          </Col>
        ) : (
          <>
            <ChipStrip>
              <Chip label="All" on={filter.kind === 'all'} onPress={() => setFilter({ kind: 'all' })} />
              <Chip label="Favourites" on={filter.kind === 'favourites'} onPress={() => setFilter({ kind: 'favourites' })} />
              {collections.map((c) => (
                <Chip key={c.id} label={c.name} on={filter.kind === 'collection' && filter.id === c.id} onPress={() => setFilter({ kind: 'collection', id: c.id })} />
              ))}
            </ChipStrip>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
              {items.map((it) => (
                <Pressable key={it.id} onPress={() => nav.push({ name: 'item', id: it.id })} style={{ width: tileW, gap: 4 }} accessibilityRole="button" accessibilityLabel={it.title}>
                  <View>
                    <ItemThumb app={app} itemId={it.id} width={tileW} orientation={it.scene.orientation} bold={badge?.shownItemId === it.id} />
                    {it.favourite && <Text style={{ position: 'absolute', right: 10, top: 6, fontSize: 16 }}>♥</Text>}
                  </View>
                  <Text style={[s.rowLabel, { fontWeight: '600' }]} numberOfLines={1}>
                    {it.title}
                  </Text>
                  <Text style={s.small}>{it.sends.length ? `Sent ${ago(it.sends[it.sends.length - 1].at)}` : 'Not sent'}</Text>
                </Pressable>
              ))}
            </View>
            {items.length === 0 && <T muted>Nothing here yet.</T>}
          </>
        )}
        <View style={{ height: 70 }} />
      </Screen>
      <Pressable
        onPress={() => setCreating(true)}
        accessibilityRole="button"
        accessibilityLabel="Make something"
        style={{ position: 'absolute', right: 20, bottom: 20, width: 60, height: 60, borderRadius: 30, backgroundColor: G.ink, alignItems: 'center', justifyContent: 'center' }}
      >
        <Text style={{ color: G.white, fontSize: 30, fontWeight: '700', marginTop: -2 }}>+</Text>
      </Pressable>
      <Sheet visible={creating} onClose={() => setCreating(false)} title="Make something">
        {[
          { label: 'Photo', go: () => nav.push({ name: 'photo' }) },
          { label: 'Name tag', go: () => nav.push({ name: 'form', id: 'name-badge' }) },
          ...catalog.entries.filter((e) => e.category.includes(SCRATCH)).map((e) => ({ label: e.def.title, go: () => nav.push({ name: 'form', id: e.id }) })),
          {
            label: 'All templates',
            go: () => {
              nav.setTab('templates');
            },
          },
        ].map((x, i, a) => (
          <ListRow
            key={x.label}
            label={x.label}
            onPress={() => {
              setCreating(false);
              x.go();
            }}
            last={i === a.length - 1}
          />
        ))}
      </Sheet>
    </View>
  );
}

const kindLabel = (it: LibraryItem) => (it.kind === 'photo' ? 'Photo' : it.kind === 'template' ? 'Template' : it.kind === 'qr' ? 'QR code' : it.kind[0].toUpperCase() + it.kind.slice(1));

export function ItemScreen({ id }: { id: string }) {
  const { app, badge, catalog } = useServices();
  const nav = useNav();
  const { width } = useWindowDimensions();
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const it = app.library.get(id);
  if (!it)
    return (
      <Screen onBack={nav.pop} back="Gallery">
        <T>This picture is gone.</T>
      </Screen>
    );
  const o = it.scene.orientation;
  const last = it.sends[it.sends.length - 1];
  const editCopy = () => {
    if (it.template && catalog.get(it.template.id)) {
      const e = catalog.get(it.template.id)!;
      const name = e.behaviour === 'form' ? 'form' : e.behaviour;
      if (name === 'form') nav.push({ name: 'form', id: e.id, values: it.template.values, layout: it.template.layout });
      else nav.push({ name, id: e.id });
    } else nav.push({ name: 'photo', scene: it.scene, style: it.style });
  };
  const remove = () =>
    Alert.alert('Delete from Gallery?', 'The badge keeps showing it if it is on there now.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await app.library.remove(it.id);
          nav.pop();
        },
      },
    ]);
  return (
    <Screen
      onBack={nav.pop}
      back="Gallery"
      right={<Btn small label={it.favourite ? '♥ Favourite' : '♡ Favourite'} onPress={() => app.library.setFavourite(it.id, !it.favourite)} />}
    >
      <View style={{ alignItems: 'center' }}>
        <ItemThumb app={app} itemId={it.id} width={o === 'portrait' ? Math.min(220, width * 0.55) : width - 40} orientation={o} />
      </View>
      <Col gap={2}>
        <H size={20}>{it.title}</H>
        <T muted>
          {kindLabel(it)} · {it.style[0].toUpperCase() + it.style.slice(1)} ·{' '}
          {it.sends.length ? `sent ${it.sends.length === 1 ? 'once' : `${it.sends.length} times`}, last ${ago(last.at)}` : 'not sent yet'}
        </T>
      </Col>
      <Btn kind="primary" label={badge ? `Send again to ${badge.name}` : 'Set up a badge to send'} onPress={() => (badge ? nav.push({ name: 'send', itemId: it.id }) : nav.push({ name: 'setup' }))} />
      <Row>
        <Btn flex label="Edit a copy" onPress={editCopy} />
        <Btn flex label="Add to…" onPress={() => setAdding(true)} />
      </Row>
      <Btn kind="ghost" label="Delete from Gallery" onPress={remove} />
      <Sheet visible={adding} onClose={() => setAdding(false)} title="Add to a collection">
        {app.library.collections().map((c) => {
          const inIt = c.itemIds.includes(it.id);
          return (
            <ListRow
              key={c.id}
              label={c.name}
              detail={`${c.itemIds.length} pictures`}
              right={<Text style={s.t}>{inIt ? '✓' : ''}</Text>}
              onPress={() => (inIt ? app.library.removeFromCollection(c.id, it.id) : app.library.addToCollection(c.id, it.id))}
            />
          );
        })}
        <Row>
          <View style={{ flex: 1 }}>
            <Field placeholder="New collection" value={newName} onChangeText={setNewName} />
          </View>
          <Btn
            label="Create"
            disabled={!newName.trim()}
            onPress={async () => {
              await app.library.createCollection(newName.trim(), [it.id]);
              setNewName('');
            }}
          />
        </Row>
      </Sheet>
    </Screen>
  );
}
