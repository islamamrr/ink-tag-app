// The Gallery tab: what's on the badge now, everything you've made with
// Favourites and collections, and the + button. A Gallery item: send again,
// edit a copy, add to a collection, favourite, delete.

import { useState } from 'react';
import { Alert, Pressable, ScrollView, Text, useWindowDimensions, View } from 'react-native';

import { type LibraryFilter, type LibraryItem, SCRATCH } from '../../core';
import { Btn, Card, Chip, ChipStrip, Col, EmptyState, Field, H, IconBtn, Label, ListRow, Meta, Note, Row, Screen, Sheet, T, useText } from '../kit';
import { useNav } from '../nav';
import { BadgeFrame, ItemThumb } from '../pictures';
import { Icon, InkDot } from '../print';
import { ago, useServices } from '../services';
import { FONT, INK, tiltFor } from '../theme';
import { Grid } from './templates';

/** "Now on My badge" with one badge; a strip of badges with two or more. */
function NowOn() {
  const { app, badge, connected } = useServices();
  const nav = useNav();
  const tx = useText();
  const badges = app.badges.list();
  const conn = app.connection();
  if (!badge) return null;
  if (badges.length > 1)
    return (
      <Col gap={8}>
        <Label>On your badges</Label>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -20 }} contentContainerStyle={{ gap: 16, paddingHorizontal: 20, paddingVertical: 6 }}>
          {badges.map((b, i) => {
            const on = conn.badgeId === b.id && conn.status === 'connected';
            return (
              <Pressable key={b.id} onPress={() => nav.push({ name: 'badgePage', id: b.id })} style={{ alignItems: 'center', gap: 6, width: 72 }} accessibilityRole="button" accessibilityLabel={b.name}>
                {b.shownItemId ? (
                  <ItemThumb app={app} itemId={b.shownItemId} width={54} orientation={b.orientation} tilt={tiltFor(i)} />
                ) : (
                  <BadgeFrame width={54} orientation={b.orientation} tilt={tiltFor(i)} />
                )}
                <Row gap={4}>
                  <InkDot color={on ? INK.green : b.kind === 'demo' ? INK.blue : INK.muted} size={8} />
                  <Text style={[tx.strong, { fontSize: 16 }]} numberOfLines={1}>
                    {b.name}
                  </Text>
                </Row>
              </Pressable>
            );
          })}
          <Pressable onPress={() => nav.push({ name: 'setup' })} style={{ alignItems: 'center', gap: 6, width: 72 }} accessibilityRole="button" accessibilityLabel="Add a badge">
            <BadgeFrame width={54} orientation="portrait" style={{ alignItems: 'center', justifyContent: 'center', borderStyle: 'dashed', backgroundColor: INK.paper }}>
              <Icon name="plus" size={22} />
            </BadgeFrame>
            <Text style={tx.small}>Add</Text>
          </Pressable>
        </ScrollView>
      </Col>
    );
  const item = badge.shownItemId ? app.library.get(badge.shownItemId) : undefined;
  return (
    <Card onPress={() => nav.setTab('badge')} style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }} label={`Now on ${badge.name}`}>
      {item ? <ItemThumb app={app} itemId={item.id} width={54} orientation={badge.orientation} tilt={-2} device /> : <BadgeFrame width={54} orientation={badge.orientation} tilt={-2} device style={{ backgroundColor: INK.paper }} />}
      <View style={{ flex: 1, gap: 3 }}>
        <Meta text={`Now on ${badge.name}`} />
        <Text style={[tx.strong, { fontFamily: FONT.black, fontSize: 22 }]} numberOfLines={1}>
          {item?.title ?? (badge.shownAt ? 'Blank' : 'Nothing yet')}
        </Text>
        <Row gap={6}>
          <InkDot color={connected ? INK.green : badge.kind === 'demo' ? INK.blue : INK.muted} size={8} />
          <Text style={tx.small}>
            {connected ? 'Connected' : badge.kind === 'demo' ? 'Demo badge' : 'Not nearby'}
            {badge.shownAt ? ` · sent ${ago(badge.shownAt)}` : ' · blank for now'}
          </Text>
        </Row>
      </View>
      <Icon name="next" size={18} stroke={2.6} />
    </Card>
  );
}

export function GalleryScreen() {
  const { app, catalog, badge } = useServices();
  const nav = useNav();
  const tx = useText();
  const { width } = useWindowDimensions();
  const [filter, setFilter] = useState<LibraryFilter>({ kind: 'all' });
  const [creating, setCreating] = useState(false);
  const items = app.library.list(filter);
  const all = app.library.list();
  const collections = app.library.collections();
  const tileW = Math.floor((width - 40 - 16) / 2);
  const starters = ['name-badge', 'todo', 'clock', 'status-board'].map((id) => catalog.get(id)!).filter(Boolean);

  return (
    <View style={{ flex: 1 }}>
      <Screen title="Gallery" right={all.length ? <Label muted>{all.length} PRINTED</Label> : undefined}>
        {nav.notice && <Note onClose={() => nav.setNotice(null)}>{nav.notice}</Note>}
        <NowOn />
        {all.length === 0 ? (
          <Col gap={12}>
            <EmptyState title="Nothing printed yet">Everything you send lands here, ready to send again. Start with one of these, or a photo.</EmptyState>
            <Grid entries={starters} />
            <Btn kind="primary" icon="camera" label="Print a photo" onPress={() => nav.push({ name: 'photo' })} />
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
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 16, rowGap: 20 }}>
              {items.map((it, i) => {
                const onBadge = badge?.shownItemId === it.id;
                return (
                  <Pressable
                    key={it.id}
                    onPress={() => nav.push({ name: 'item', id: it.id })}
                    style={({ pressed }) => [{ width: tileW, gap: 6 }, pressed && { opacity: 0.75 }]}
                    accessibilityRole="button"
                    accessibilityLabel={`${it.title}${onBadge ? ', on your badge' : ''}${it.favourite ? ', favourite' : ''}`}
                  >
                    <View>
                      <ItemThumb app={app} itemId={it.id} width={tileW} orientation={it.scene.orientation} tilt={tiltFor(i)} sticker={onBadge ? 'ON BADGE' : undefined} />
                      {it.favourite && (
                        <View style={{ position: 'absolute', left: 8, top: 8, width: 30, height: 30, borderRadius: 15, backgroundColor: INK.paper, borderWidth: 2, borderColor: INK.black, alignItems: 'center', justifyContent: 'center' }}>
                          <Icon name="heart" size={16} color={INK.red} fill />
                        </View>
                      )}
                    </View>
                    <Text style={[tx.strong, { marginTop: 2 }]} numberOfLines={1}>
                      {it.title}
                    </Text>
                    <Text style={[tx.meta, { marginTop: -4 }]}>{(it.sends.length ? `Sent ${ago(it.sends[it.sends.length - 1].at)}` : 'Not sent').toUpperCase()}</Text>
                  </Pressable>
                );
              })}
            </View>
            {items.length === 0 && (
              <EmptyState icon={filter.kind === 'favourites' ? 'heart' : 'badge'} title={filter.kind === 'favourites' ? 'No favourites yet' : 'Nothing in here yet'}>
                {filter.kind === 'favourites' ? 'Open a print and tap the heart to keep it here.' : 'Open a print and add it to this collection.'}
              </EmptyState>
            )}
          </>
        )}
        <View style={{ height: 70 }} />
      </Screen>
      <Pressable onPress={() => setCreating(true)} accessibilityRole="button" accessibilityLabel="Make something" style={{ position: 'absolute', right: 20, bottom: 20 }}>
        {({ pressed }) => (
          <View>
            <View style={{ position: 'absolute', left: 4, top: 4, width: 62, height: 62, borderRadius: 31, backgroundColor: INK.black }} />
            <View
              style={[
                { width: 62, height: 62, borderRadius: 31, backgroundColor: INK.blue, borderWidth: 2, borderColor: INK.black, alignItems: 'center', justifyContent: 'center' },
                pressed && { transform: [{ translateX: 3 }, { translateY: 3 }] },
              ]}
            >
              <Icon name="plus" size={30} color={INK.paper} stroke={3} />
            </View>
          </View>
        )}
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
  const onBadge = badge?.shownItemId === it.id;
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
      title={`${kindLabel(it)} · ${it.style}`}
      right={<IconBtn icon="heart" fill={it.favourite} label={it.favourite ? 'Remove from favourites' : 'Add to favourites'} onPress={() => app.library.setFavourite(it.id, !it.favourite)} />}
    >
      <View style={{ alignItems: 'center', paddingTop: 12, paddingBottom: 6 }}>
        <ItemThumb app={app} itemId={it.id} width={o === 'portrait' ? Math.min(240, width * 0.6) : width - 70} orientation={o} tilt={-2} shadow={INK.black} device sticker={onBadge ? 'ON BADGE' : undefined} />
      </View>
      <Col gap={4}>
        <H size={30}>{it.title}</H>
        <Label muted>{it.sends.length ? `Sent ${it.sends.length === 1 ? 'once' : `${it.sends.length} times`}, last ${ago(last.at)}` : 'Not sent yet'}</Label>
      </Col>
      <Btn kind="primary" label={badge ? `Print to ${badge.name}` : 'Set up a badge to print'} onPress={() => (badge ? nav.push({ name: 'send', itemId: it.id }) : nav.push({ name: 'setup' }))} />
      <Row gap={10}>
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
              right={inIt ? <Icon name="check" size={20} color={INK.blue} stroke={3} /> : undefined}
              onPress={() => (inIt ? app.library.removeFromCollection(c.id, it.id) : app.library.addToCollection(c.id, it.id))}
            />
          );
        })}
        <Row gap={10}>
          <View style={{ flex: 1 }}>
            <Field placeholder="New collection" value={newName} onChangeText={setNewName} accessibilityLabel="New collection name" />
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
