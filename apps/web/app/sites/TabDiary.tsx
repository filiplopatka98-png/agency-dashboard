'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';

type Entry = { id: number; happened_at: string; text: string };

const card = {
  background: 'var(--surface-primary)',
  border: '1px solid var(--border-primary)',
  borderRadius: 'var(--radius)',
  boxShadow: 'var(--shadow-sm)',
} as const;

const todayIso = () => new Date().toISOString().slice(0, 10);

export function TabDiary({ siteId, orgId }: { siteId: string; orgId: string | null }) {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [text, setText] = useState('');
  const [date, setDate] = useState(todayIso());
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  // Ref namiesto `saving` stavu — dva rýchle Entery môžu obidva vidieť starú
  // hodnotu stavu (React state update je async), kým ref je synchrónne pravdivý
  // hneď po prvom volaní add().
  const savingRef = useRef(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('work_log')
      .select('id, happened_at, text')
      .eq('site_id', siteId)
      .order('happened_at', { ascending: false })
      .limit(100);
    if (error) {
      setLoadErr(`Načítanie zlyhalo: ${error.message}`);
      setEntries(null);
      return;
    }
    setLoadErr(null);
    setEntries((data ?? []) as Entry[]);
  }, [siteId]);

  useEffect(() => {
    void load();
  }, [load]);

  const add = async () => {
    if (savingRef.current) return; // re-entrancy guard proti duplicitnému odoslaniu
    const t = text.trim();
    if (!t || !orgId) return;
    savingRef.current = true;
    setSaving(true);
    setErr(null);
    try {
      const { error } = await supabase.from('work_log').insert({ site_id: siteId, org_id: orgId, happened_at: date, text: t });
      if (error) {
        setErr(`Uloženie zlyhalo: ${error.message}`);
        return;
      }
      setText('');
      setDate(todayIso());
    } catch (e) {
      // Neočakávaná klientská výnimka (nie Postgrest chyba) — zobraz v tom istom banneri.
      setErr(`Uloženie zlyhalo: ${e instanceof Error ? e.message : String(e)}`);
      return;
    } finally {
      // finally namiesto priradenia hneď po await — guard sa uvoľní aj keď insert vyhodí výnimku.
      savingRef.current = false;
      setSaving(false);
    }
    // Zámerne MIMO try/catch vyššie: insert už prebehol úspešne, takže zlyhanie
    // reloadu (napr. sieť) nesmie nahlásiť "Uloženie zlyhalo" — to by bola lož,
    // ktorá pozve na retry a v klientskom reporte vyrobí duplicitný riadok.
    // load() si chybu rieši sama (setLoadErr) a nehádže.
    await load();
  };

  const del = async (id: number) => {
    if (!window.confirm('Vymazať tento záznam?')) return;
    const { error } = await supabase.from('work_log').delete().eq('id', id);
    if (error) {
      setErr(`Vymazanie zlyhalo: ${error.message}`);
      return;
    }
    setErr(null);
    await load();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ ...card, padding: 20 }}>
        <h3 style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)', marginBottom: 4 }}>Pracovný denník</h3>
        <p style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginBottom: 14 }}>
          Zapíš, čo si na webe spravil. Záznamy sa objavia v mesačnom reporte pre klienta — tvojím hlasom, tak ako ich napíšeš.
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            style={{ padding: '10px 12px', background: 'var(--bg-base)', border: '1px solid var(--border-primary)', borderRadius: 10, color: 'var(--text-primary)', fontSize: 13.5 }}
          />
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void add(); }}
            placeholder="napr. Optimalizovali sme obrázky v e-shope"
            style={{ flex: 1, minWidth: 220, padding: '10px 12px', background: 'var(--bg-base)', border: '1px solid var(--border-primary)', borderRadius: 10, color: 'var(--text-primary)', fontSize: 13.5 }}
          />
          <button
            onClick={() => void add()}
            disabled={saving || !text.trim()}
            style={{ padding: '10px 18px', background: saving || !text.trim() ? 'var(--text-tertiary)' : 'var(--accent-primary)', color: '#fff', border: 'none', borderRadius: 10, fontSize: 13.5, fontWeight: 600, cursor: saving || !text.trim() ? 'default' : 'pointer' }}
          >
            {saving ? 'Ukladám…' : 'Pridať'}
          </button>
        </div>
        {err && <div style={{ marginTop: 10, fontSize: 13, color: 'var(--critical-color)', background: 'var(--critical-bg)', padding: '9px 13px', borderRadius: 10 }}>{err}</div>}
      </div>

      <div style={{ ...card, overflow: 'hidden' }}>
        {loadErr ? (
          <div style={{ margin: 16, fontSize: 13, color: 'var(--critical-color)', background: 'var(--critical-bg)', padding: '9px 13px', borderRadius: 10 }}>{loadErr}</div>
        ) : entries === null ? (
          <div style={{ padding: 20, fontSize: 13, color: 'var(--text-tertiary)' }}>Načítavam…</div>
        ) : entries.length === 0 ? (
          <div style={{ padding: '28px 18px', textAlign: 'center', fontSize: 13, color: 'var(--text-secondary)' }}>
            Zatiaľ žiadne záznamy. Prvý pridaj vyššie — objaví sa v najbližšom mesačnom reporte.
          </div>
        ) : (
          entries.map((e, i) => (
            <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 18px', borderBottom: i < entries.length - 1 ? '1px solid var(--border-primary)' : 'none' }}>
              <span style={{ fontSize: 12, color: 'var(--text-tertiary)', fontFamily: "'Geist Mono', monospace", whiteSpace: 'nowrap' }}>
                {new Date(e.happened_at).toLocaleDateString('sk-SK', { day: 'numeric', month: 'numeric', year: '2-digit' })}
              </span>
              <span style={{ flex: 1, fontSize: 13.5, color: 'var(--text-primary)' }}>{e.text}</span>
              <button
                onClick={() => void del(e.id)}
                style={{ background: 'transparent', border: 'none', color: 'var(--text-tertiary)', fontSize: 12, cursor: 'pointer' }}
              >
                Vymazať
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
