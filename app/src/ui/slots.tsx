// The pictures a badge keeps (firmware 0.6+): seven slots in its flash. The
// app fills them on its own (a picture already kept is only redrawn, with no
// upload); here the owner sees what's kept, draws one, or removes one.

import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, useWindowDimensions, View } from 'react-native';

import { userMessage } from '../core';
import { Btn, Col, Label, Problem, Row, Sheet, T, useText } from './kit';
import { BadgeFrame, ItemThumb } from './pictures';
import { Icon } from './print';
import { ago, useServices } from './services';
import { FONT, INK } from './theme';

const PER_ROW = 4;
const GAP = 12;

export function SlotsSection({ badgeId, connected }: { badgeId: string; connected: boolean }) {
  const { app } = useServices();
  const { width } = useWindowDimensions();
  const tx = useText();
  const [open, setOpen] = useState<number | null>(null);
  const [working, setWorking] = useState<'show' | 'remove' | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const read = useRef<string | null>(null);

  // Read the slots once per connection. Not while a firmware update or a send
  // is running: the update would stop for it, and a send reads them anyway.
  const conn = app.connection();
  const sending = app.sending();
  const idle = !app.firmwareJob() && (!sending || sending.stage === 'done' || sending.stage === 'failed');
  useEffect(() => {
    const key = connected ? `${badgeId}:${conn.info?.firmware}` : null;
    if (!key || !idle || read.current === key) return;
    read.current = key;
    app.syncSlots(badgeId).catch(() => {});
  }, [app, badgeId, connected, idle, conn.info?.firmware]);

  const b = app.badges.get(badgeId);
  const s = app.slots(badgeId);
  if (!b || !s) return null;
  const used = s.slots.filter(Boolean).length;
  const w = Math.floor((width - 40 - GAP * (PER_ROW - 1)) / PER_ROW);
  const rec = open !== null ? s.slots[open] : null;
  const item = rec?.itemId ? app.library.get(rec.itemId) : undefined;

  const act = async (what: 'show' | 'remove', fn: () => Promise<unknown>) => {
    setWorking(what);
    setProblem(null);
    try {
      await fn();
      setOpen(null);
    } catch (e) {
      setProblem(userMessage(e));
    } finally {
      setWorking(null);
    }
  };

  return (
    <Col gap={10}>
      <Label>{`Kept on the badge · ${used} of ${s.count}`}</Label>
      <T muted>
        {connected
          ? 'Pictures you send stay here. Sending one again only redraws it, with no upload.'
          : 'As of the last connection. Connect to change them.'}
      </T>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: GAP }}>
        {s.slots.map((r, i) => {
          const on = s.current === i;
          const label = r ? (r.itemId && app.library.get(r.itemId)?.title) || 'Unknown picture' : 'Empty';
          return (
            <Pressable
              key={i}
              disabled={!r}
              onPress={() => (setProblem(null), setOpen(i))}
              accessibilityRole="button"
              accessibilityLabel={`Slot ${i + 1}: ${label}${on ? ', on screen' : ''}`}
              style={{ width: w, alignItems: 'center', gap: 4 }}
            >
              {r?.itemId && app.library.get(r.itemId) ? (
                <ItemThumb app={app} itemId={r.itemId} width={w - 6} orientation={b.orientation} bold={on} shadow={on ? INK.blue : undefined} />
              ) : (
                <BadgeFrame
                  width={w - 6}
                  orientation={b.orientation}
                  bold={on}
                  shadow={on ? INK.blue : undefined}
                  style={{ backgroundColor: INK.paper, alignItems: 'center', justifyContent: 'center', borderStyle: r ? 'solid' : 'dashed' }}
                >
                  {r ? <Text style={{ fontFamily: FONT.black, fontSize: 20, color: INK.black }}>?</Text> : null}
                </BadgeFrame>
              )}
              <Text style={[tx.small, { fontFamily: on ? FONT.monoBold : FONT.mono, fontSize: 11 }]} numberOfLines={1}>
                {on ? 'ON SCREEN' : r ? `SLOT ${i + 1}` : 'EMPTY'}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Sheet visible={open !== null && !!rec} onClose={() => setOpen(null)} title={`Slot ${(open ?? 0) + 1}`}>
        {rec && open !== null && (
          <Col gap={12}>
            <Row gap={14} style={{ alignItems: 'flex-start' }}>
              {item ? (
                <ItemThumb app={app} itemId={item.id} width={90} orientation={b.orientation} tilt={-2} shadow={INK.black} />
              ) : (
                <BadgeFrame width={90} orientation={b.orientation} tilt={-2} style={{ backgroundColor: INK.paper }} />
              )}
              <Col gap={4} style={{ flex: 1 }}>
                <Text style={[tx.strong, { fontFamily: FONT.black, fontSize: 20 }]}>{item?.title ?? 'Unknown picture'}</Text>
                <T muted>
                  {item
                    ? `${s.current === open ? 'On screen now. ' : ''}${rec.usedAt ? `Used ${ago(rec.usedAt)}.` : ''}`
                    : "Not in this phone's Gallery. Another phone or the computer tool put it there."}
                </T>
              </Col>
            </Row>
            {problem && <Problem title="That didn’t work">{problem}</Problem>}
            <Btn
              kind="primary"
              icon="redraw"
              label={s.current === open ? 'Draw it again' : 'Show it now'}
              busy={working === 'show'}
              disabled={!connected || !!working}
              onPress={() => act('show', () => app.showSlot(badgeId, open))}
            />
            <Btn
              kind="ghost"
              label="Remove from the badge"
              busy={working === 'remove'}
              disabled={!connected || !!working}
              onPress={() => act('remove', () => app.deleteSlot(badgeId, open))}
            />
            {!connected && (
              <Row gap={6}>
                <Icon name="bluetooth" size={16} />
                <T muted>Connect to the badge to change its pictures.</T>
              </Row>
            )}
            {s.current === open && <T muted>Removing it frees the slot; the screen keeps showing it until the next picture.</T>}
          </Col>
        )}
      </Sheet>
    </Col>
  );
}

/** Slot numbers on the current badge that hold this library item. */
export function keptIn(slots: { slots: ({ itemId?: string } | null)[] } | null, itemId: string): number[] {
  if (!slots) return [];
  return slots.slots.flatMap((r, i) => (r?.itemId === itemId ? [i] : []));
}
