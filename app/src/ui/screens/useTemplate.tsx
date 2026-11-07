// Using a template, by its behaviour:
//   form  fill in, see the preview change, Next goes to Send
//   list  tick items, "Update my badge" resends in place
//   board tap one of the ready pictures and it's sent straight away
//   live  pick how often, the phone keeps the badge up to date

import { useEffect, useMemo, useState } from 'react';
import { Pressable, Text, useWindowDimensions, View } from 'react-native';

import { type CatalogEntry, type Design, LIVE_RULES, type LiveRule, parseList, type PictureStyle, STYLE_NAMES, STYLES, type Values } from '../../core';
import { templateDesign } from '../../services/app';
import { FieldEditor } from '../fields';
import { Btn, Card, Chip, Chips, Col, G, Label, Problem, Row, s, Screen, T } from '../kit';
import { useNav } from '../nav';
import { DesignPreview, usePrepared } from '../pictures';
import { SendLine, useSender } from '../sending';
import { clock, useServices } from '../services';

function useTemplate(id: string, initial?: { values?: Values; layout?: number }) {
  const { catalog, state } = useServices();
  const e = catalog.get(id);
  const draft = state.draft(id);
  const [values, setValues] = useState<Values>(() => initial?.values ?? draft?.values ?? { ...(e?.sample ?? {}) });
  const [layout, setLayout] = useState(() => initial?.layout ?? draft?.layout ?? 0);
  // Keep the form between visits (lists and boards rely on it).
  useEffect(() => {
    if (!e) return;
    const t = setTimeout(() => void state.saveDraft(id, values, layout), 400);
    return () => clearTimeout(t);
  }, [e, id, values, layout, state]);
  return { e, values, setValues, layout, setLayout };
}

const notToday = (t: number) => new Date(t).toDateString() !== new Date().toDateString();

function Gone({ onBack }: { onBack: () => void }) {
  return (
    <Screen onBack={onBack}>
      <T>This template is gone.</T>
    </Screen>
  );
}

function LayoutChips({ e, layout, setLayout }: { e: CatalogEntry; layout: number; setLayout: (n: number) => void }) {
  if (e.def.layouts < 2) return null;
  return (
    <Col gap={6}>
      <Text style={s.small}>Layout</Text>
      <Row>
        {Array.from({ length: e.def.layouts }, (_, i) => (
          <Chip key={i} label={String(i + 1)} on={layout === i} onPress={() => setLayout(i)} />
        ))}
      </Row>
    </Col>
  );
}

/** Asks for a badge when there's none yet. */
function NeedBadge() {
  const nav = useNav();
  return (
    <Problem title="No badge yet" action="Set up my badge" onAction={() => nav.push({ name: 'setup' })}>
      Add your badge (or the demo badge) to send this.
    </Problem>
  );
}

function usePreviewSize() {
  const { width } = useWindowDimensions();
  const { badge } = useServices();
  const o = badge?.orientation ?? 'portrait';
  return { orientation: o, width: o === 'portrait' ? Math.min(200, width * 0.5) : Math.min(320, width - 40) };
}

// ------------------------------------------------------------------ form

export function FormScreen({ id, values: v0, layout: l0 }: { id: string; values?: Values; layout?: number }) {
  const { app, badge } = useServices();
  const nav = useNav();
  const { e, values, setValues, layout, setLayout } = useTemplate(id, { values: v0, layout: l0 });
  const [style, setStyle] = useState<PictureStyle>('poster');
  const [busy, setBusy] = useState(false);
  const { orientation, width } = usePreviewSize();
  const design = useMemo((): Design | null => (e ? { ...templateDesign(e, values, { layout, orientation }), style } : null), [e, values, layout, orientation, style]);
  const { prepared, last } = usePrepared(app, design);
  if (!e || !design) return <Gone onBack={nav.pop} />;
  const hasPhoto = e.def.fields.some((f) => f.kind === 'photo');
  const missing = e.def.fields.filter((f) => f.required && !values[f.key] && !f.default).map((f) => f.label);
  return (
    <Screen
      onBack={nav.pop}
      back="Cancel"
      title={e.def.title}
      footer={
        <>
          {missing.length > 0 && <T muted>Still needed: {missing.join(', ')}</T>}
          <Btn kind="primary" label="Next" disabled={busy || missing.length > 0} onPress={() => nav.push({ name: 'send', design })} />
        </>
      }
    >
      <View style={{ alignItems: 'center' }}>
        <DesignPreview prepared={prepared ?? last} width={width} orientation={orientation} />
      </View>
      <LayoutChips e={e} layout={layout} setLayout={setLayout} />
      {e.def.fields.map((f) => (
        <FieldEditor key={f.key} f={f} values={values} onChange={setValues} onBusy={setBusy} />
      ))}
      {hasPhoto && (
        <Col gap={6}>
          <Text style={s.small}>Look</Text>
          <Chips options={STYLE_NAMES.map((n) => ({ value: n, label: STYLES[n].label }))} value={style} onChange={setStyle} />
          <T muted>{STYLES[style].description}</T>
        </Col>
      )}
      {!badge && <NeedBadge />}
    </Screen>
  );
}

// ------------------------------------------------------------------ list

export function ListScreen({ id }: { id: string }) {
  const { app, badge } = useServices();
  const nav = useNav();
  const { e, values, setValues, layout, setLayout } = useTemplate(id);
  const sender = useSender();
  const [showStyle, setShowStyle] = useState(false);
  const { orientation, width } = usePreviewSize();
  const design = useMemo(() => (e ? templateDesign(e, values, { layout, orientation }) : null), [e, values, layout, orientation]);
  const { prepared, last } = usePrepared(app, design);
  if (!e || !design) return <Gone onBack={nav.pop} />;
  const listField = e.def.fields.find((f) => f.kind === 'list');
  const others = e.def.fields.filter((f) => f !== listField && f.key !== 'accent' && f.key !== 'done');
  const styleFields = e.def.fields.filter((f) => f.key === 'accent' || f.key === 'done');
  const busy = sender.phase === 'sending';
  return (
    <Screen
      onBack={nav.pop}
      back="Back"
      title={e.def.title}
      footer={
        badge ? (
          <>
            <SendLine sender={sender} badgeName={badge.name} />
            <Btn kind="primary" label={busy ? 'Updating…' : `Update ${badge.name}`} busy={busy} onPress={() => sender.send(badge.id, design, prepared)} />
          </>
        ) : (
          <NeedBadge />
        )
      }
    >
      {others.map((f) => (
        <FieldEditor key={f.key} f={f} values={values} onChange={setValues} />
      ))}
      {listField && <FieldEditor f={listField} values={values} onChange={setValues} />}
      <Btn kind="ghost" label={showStyle ? 'Hide style' : 'Style'} onPress={() => setShowStyle((x) => !x)} />
      {showStyle && (
        <Col gap={14}>
          <LayoutChips e={e} layout={layout} setLayout={setLayout} />
          {styleFields.map((f) => (
            <FieldEditor key={f.key} f={f} values={values} onChange={setValues} />
          ))}
        </Col>
      )}
      <Label>On the badge it will look like</Label>
      <View style={{ alignItems: 'center' }}>
        <DesignPreview prepared={prepared ?? last} width={width} orientation={orientation} />
      </View>
    </Screen>
  );
}

// ------------------------------------------------------------------ board

export function BoardScreen({ id }: { id: string }) {
  const { app, badge, state } = useServices();
  const nav = useNav();
  const { e, values, setValues, layout, setLayout } = useTemplate(id);
  const sender = useSender();
  const [editing, setEditing] = useState(false);
  const [sendingLabel, setSendingLabel] = useState<string | null>(null);
  const { orientation, width } = usePreviewSize();
  const from = e?.boardFrom ?? 'statuses';
  const options = parseList(values[from]);
  const shown = state.board(id);
  const current = useMemo(() => (e ? templateDesign(e, values, { layout, orientation }) : null), [e, values, layout, orientation]);
  const { prepared, last } = usePrepared(app, editing ? current : null);
  if (!e || !current) return <Gone onBack={nav.pop} />;

  const tap = async (label: string, color?: string) => {
    if (!badge || sender.phase === 'sending') return;
    const next = { ...values, status: label, statusColor: color ?? 'black' };
    setValues(next);
    setSendingLabel(label);
    const item = await sender.send(badge.id, templateDesign(e, next, { layout, orientation }));
    // eslint-disable-next-line react-hooks/purity -- runs on tap, not while rendering
    if (item) await state.setBoard(id, { label, badgeId: badge.id, at: Date.now() });
  };

  return (
    <Screen
      onBack={nav.pop}
      back="Back"
      title={e.def.title}
      right={<Btn small label={editing ? 'Done' : 'Edit'} onPress={() => setEditing((x) => !x)} />}
      footer={
        badge ? (
          <>
            <SendLine sender={sender} badgeName={badge.name} />
            {shown && shown.badgeId === badge.id && <T muted>On {badge.name}: {shown.label} · since {clock(shown.at)}</T>}
          </>
        ) : (
          <NeedBadge />
        )
      }
    >
      {editing ? (
        <>
          {e.def.fields.map((f) => (
            <FieldEditor key={f.key} f={f} values={values} onChange={setValues} />
          ))}
          <T muted>Inks: black, red, yellow, green, blue. Write “Label | blue”.</T>
          <LayoutChips e={e} layout={layout} setLayout={setLayout} />
          <View style={{ alignItems: 'center' }}>
            <DesignPreview prepared={prepared ?? last} width={width} orientation={orientation} />
          </View>
        </>
      ) : (
        <>
          <T muted>Tap one to put it on your badge.</T>
          <View style={{ gap: 10 }}>
            {options.map((o) => {
              const on = shown?.label === o.text;
              const busy = sender.phase === 'sending' && sendingLabel === o.text;
              return (
                <Pressable
                  key={o.text}
                  onPress={() => tap(o.text, o.color)}
                  disabled={!badge || sender.phase === 'sending'}
                  accessibilityRole="button"
                  style={({ pressed }) => [
                    { minHeight: 64, borderWidth: on ? 3 : 2, borderColor: G.ink, borderRadius: 14, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: on ? G.chipOn : G.white },
                    pressed && { opacity: 0.7 },
                    sender.phase === 'sending' && !busy && { opacity: 0.4 },
                  ]}
                >
                  <Text style={[s.rowLabel, { flex: 1, fontSize: 18, fontWeight: '700' }]}>{o.text}</Text>
                  <Text style={s.small}>{busy ? 'Sending…' : on ? 'On the badge' : (o.color ?? 'black')}</Text>
                </Pressable>
              );
            })}
          </View>
          <Btn kind="ghost" label="+ Add your own" onPress={() => setEditing(true)} />
        </>
      )}
    </Screen>
  );
}

// ------------------------------------------------------------------ live

export function LiveScreen({ id }: { id: string }) {
  const { app, badge, live } = useServices();
  const nav = useNav();
  const { e, values, setValues, layout, setLayout } = useTemplate(id);
  const rules = e?.live ?? ['morning'];
  const [rule, setRule] = useState<LiveRule>(() => {
    const j = live.current();
    return j?.templateId === id && rules.includes(j.rule) ? j.rule : rules[0];
  });
  const [starting, setStarting] = useState(false);
  const { orientation, width } = usePreviewSize();
  const design = useMemo(
    () => (e ? templateDesign(e, { ...values, dateOnly: rule === 'morning' ? 'true' : undefined }, { layout, orientation }) : null),
    [e, values, layout, orientation, rule],
  );
  const { prepared, last } = usePrepared(app, design);
  if (!e || !design) return <Gone onBack={nav.pop} />;
  const job = live.current();
  const mine = job && job.templateId === id && job.badgeId === badge?.id ? job : null;
  const other = job && !mine ? job : null;

  const start = async () => {
    if (!badge) return;
    setStarting(true);
    try {
      await live.start({ badgeId: badge.id, templateId: id, values, layout, rule });
    } finally {
      setStarting(false);
    }
  };

  return (
    <Screen
      onBack={nav.pop}
      back="Back"
      title={e.def.title}
      footer={
        !badge ? (
          <NeedBadge />
        ) : mine ? (
          <>
            <Card>
              <Label>Live on {badge.name}</Label>
              <T bold>{LIVE_RULES[mine.rule].label}</T>
              <T muted>
                {mine.lastAt ? `Last update ${clock(mine.lastAt)}. ` : ''}Next at {clock(mine.nextAt)}
                {notToday(mine.nextAt) ? ' tomorrow' : ''}.
              </T>
              {mine.lastError && <T muted>Last try didn&apos;t reach the badge: {mine.lastError}</T>}
            </Card>
            <Row>
              <Btn flex label="Apply changes" busy={starting} onPress={start} />
              <Btn flex kind="danger" label="Stop" onPress={() => live.stop()} />
            </Row>
          </>
        ) : (
          <>
            {other && <T muted>Starting this stops the live {other.templateId} template.</T>}
            <Btn kind="primary" label={`Start on ${badge.name}`} busy={starting} onPress={start} />
          </>
        )
      }
    >
      <View style={{ alignItems: 'center' }}>
        <DesignPreview prepared={prepared ?? last} width={width} orientation={orientation} />
      </View>
      <T>{e.def.description}</T>
      <Col gap={6}>
        <Text style={s.small}>Update it</Text>
        {rules.map((r) => (
          <Pressable
            key={r}
            onPress={() => setRule(r)}
            accessibilityRole="radio"
            accessibilityState={{ selected: rule === r }}
            style={{ borderWidth: rule === r ? 3 : 2, borderColor: G.ink, borderRadius: 12, padding: 12, backgroundColor: rule === r ? G.chipOn : G.white }}
          >
            <Text style={[s.rowLabel, { fontWeight: '700' }]}>{LIVE_RULES[r].label}</Text>
            <Text style={s.small}>{LIVE_RULES[r].detail}</Text>
          </Pressable>
        ))}
      </Col>
      <LayoutChips e={e} layout={layout} setLayout={setLayout} />
      {e.def.fields.map((f) => (
        <FieldEditor key={f.key} f={f} values={values} onChange={setValues} />
      ))}
      <View style={s.problem}>
        <T muted>
          Your phone sends each update, so the badge only changes while it&apos;s near the phone and Ink Tag is open. If the app was closed,
          it catches up as soon as you open it. Each update flashes the screen for about 20 seconds.
        </T>
      </View>
    </Screen>
  );
}
