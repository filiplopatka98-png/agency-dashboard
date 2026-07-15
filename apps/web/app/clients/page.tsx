'use client';

import { useEffect, useState } from 'react';
import { Shell } from '../components/Shell';
import { loadDashboard, type SiteVM } from '../lib/data';
import { supabase, type Client } from '../lib/supabase';

function statusMeta(status: string): { text: string; color: string; bg: string } {
  switch (status) {
    case 'paused':
      return { text: 'Pozastavený', color: 'var(--warning-color)', bg: 'var(--warning-bg)' };
    case 'archived':
      return { text: 'Deaktivovaný', color: 'var(--text-tertiary)', bg: 'var(--surface-secondary)' };
    case 'active':
    default:
      return { text: 'Aktívny', color: 'var(--ok-color)', bg: 'var(--ok-bg)' };
  }
}

type Form = {
  name: string;
  company: string;
  contract_type: string;
  monthly_fee_eur: string;
  email: string;
  phone: string;
  ico: string;
  notion_page_id: string;
};

const EMPTY: Form = { name: '', company: '', contract_type: '', monthly_fee_eur: '', email: '', phone: '', ico: '', notion_page_id: '' };

function fromClient(c: Client): Form {
  return {
    name: c.name ?? '',
    company: c.company ?? '',
    contract_type: c.contract_type ?? '',
    monthly_fee_eur: c.monthly_fee_eur != null ? String(c.monthly_fee_eur) : '',
    email: c.email ?? '',
    phone: c.phone ?? '',
    ico: c.ico ?? '',
    notion_page_id: c.notion_page_id ?? '',
  };
}

const input: React.CSSProperties = {
  width: '100%',
  padding: '10px 13px',
  background: 'var(--bg-base)',
  border: '1px solid var(--border-primary)',
  borderRadius: 10,
  color: 'var(--text-primary)',
  fontSize: 14,
  outline: 'none',
};
const lbl: React.CSSProperties = { display: 'block', fontSize: 11.5, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 };
const card: React.CSSProperties = { background: 'var(--surface-primary)', border: '1px solid var(--border-primary)', borderRadius: 'var(--radius)', padding: 18, boxShadow: 'var(--shadow-sm)' };
const btn = (primary: boolean): React.CSSProperties => ({
  padding: '9px 16px',
  background: primary ? 'var(--accent-primary)' : 'var(--surface-primary)',
  color: primary ? 'white' : 'var(--text-secondary)',
  border: primary ? 'none' : '1px solid var(--border-primary)',
  borderRadius: 10,
  cursor: 'pointer',
  fontSize: 13.5,
  fontWeight: 600,
});

function ClientsView() {
  const [clients, setClients] = useState<Client[] | null>(null);
  const [sites, setSites] = useState<SiteVM[]>([]);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Client | null | 'new'>(null); // null=zavreté, 'new'=nový, Client=edit
  const [form, setForm] = useState<Form>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const reload = async () => {
    const { clients, sites } = await loadDashboard();
    setClients(clients);
    setSites(sites);
  };

  useEffect(() => {
    let active = true;
    (async () => {
      const [dash, mem] = await Promise.all([loadDashboard(), supabase.from('memberships').select('org_id').limit(1).maybeSingle()]);
      if (!active) return;
      setClients(dash.clients);
      setSites(dash.sites);
      setOrgId(mem.data?.org_id ?? null);
    })();
    return () => {
      active = false;
    };
  }, []);

  const openNew = () => {
    setForm(EMPTY);
    setErr(null);
    setEditing('new');
  };
  const openEdit = (c: Client) => {
    setForm(fromClient(c));
    setErr(null);
    setEditing(c);
  };

  const set = (k: keyof Form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    if (!form.name.trim()) {
      setErr('Názov klienta je povinný.');
      return;
    }
    setSaving(true);
    setErr(null);
    const fee = form.monthly_fee_eur.trim() === '' ? null : Number(form.monthly_fee_eur.replace(',', '.'));
    if (fee !== null && Number.isNaN(fee)) {
      setErr('Paušál musí byť číslo.');
      setSaving(false);
      return;
    }
    const payload = {
      name: form.name.trim(),
      company: form.company.trim() || null,
      contract_type: form.contract_type.trim() || null,
      monthly_fee_eur: fee,
      email: form.email.trim() || null,
      phone: form.phone.trim() || null,
      ico: form.ico.trim() || null,
      notion_page_id: form.notion_page_id.trim() || null,
    };
    if (editing === 'new' && !orgId) {
      setErr('Organizácia sa nenačítala — obnov stránku a skús znova.');
      setSaving(false);
      return;
    }
    const res =
      editing === 'new'
        ? await supabase.from('clients').insert({ ...payload, org_id: orgId as string, status: 'active' })
        : await supabase.from('clients').update(payload).eq('id', (editing as Client).id);
    setSaving(false);
    if (res.error) {
      setErr(`Uloženie zlyhalo: ${res.error.message}`);
      return;
    }
    setEditing(null);
    await reload();
  };

  const setStatus = async (c: Client, status: string) => {
    const res = await supabase.from('clients').update({ status }).eq('id', c.id);
    if (!res.error) await reload();
  };

  // Trvalé vymazanie — povolené len ak klient nemá priradené weby (FK guard v UI aj v DB).
  const del = async (c: Client) => {
    const count = sites.filter((s) => s.clientId === c.id).length;
    if (count > 0) {
      setNotice(`„${c.company || c.name}" má ${count} priradených ${count === 1 ? 'web' : count <= 4 ? 'weby' : 'webov'} — vymazať sa nedá. Najprv ich prehoď na iného klienta (Weby → detail webu → Upraviť → Klient), potom klienta vymaž.`);
      return;
    }
    if (!window.confirm(`Natrvalo vymazať klienta „${c.company || c.name}"? Nedá sa vrátiť.`)) return;
    const res = await supabase.from('clients').delete().eq('id', c.id);
    if (res.error) {
      setNotice(`Mazanie zlyhalo: ${res.error.message}`);
      return;
    }
    setNotice(null);
    await reload();
  };

  return (
    <div style={{ minHeight: '100vh', padding: '32px 24px 64px', background: 'var(--bg-base)' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 22, gap: 16, flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ fontSize: 30, fontWeight: 800, letterSpacing: '-0.025em', marginBottom: 6 }}>Klienti</h1>
            <div style={{ fontSize: 14, color: 'var(--text-secondary)' }}>Prehľad zmlúv a priradených webov</div>
          </div>
          <button onClick={openNew} style={btn(true)}>+ Pridať klienta</button>
        </div>

        {notice && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 16, fontSize: 13, color: 'var(--warning-color)', background: 'var(--warning-bg)', border: '1px solid var(--warning-border)', borderRadius: 10, padding: '11px 14px' }}>
            <span>{notice}</span>
            <button onClick={() => setNotice(null)} style={{ background: 'transparent', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer', fontSize: 16, flexShrink: 0 }}>✕</button>
          </div>
        )}

        {clients === null ? (
          <div style={{ fontSize: 14, color: 'var(--text-secondary)' }}>Načítavam…</div>
        ) : clients.length === 0 ? (
          <div style={{ ...card, padding: '48px 18px', textAlign: 'center', fontSize: 14, color: 'var(--text-tertiary)' }}>
            Zatiaľ žiadni klienti — pridaj prvého tlačidlom vyššie.
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
            {clients.map((c) => {
              const meta = statusMeta(c.status);
              const archived = c.status === 'archived';
              const count = sites.filter((s) => s.clientId === c.id).length;
              return (
                <div key={c.id} className="mx-card-soft" style={{ ...card, opacity: archived ? 0.6 : 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 13, marginBottom: 14 }}>
                    <div style={{ width: 42, height: 42, borderRadius: 11, background: 'var(--accent-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 800, color: 'var(--accent-primary)', fontFamily: "'Geist Mono', monospace" }}>
                      {(c.name.trim().charAt(0) || '?').toUpperCase()}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-primary)' }}>{c.company || c.name}</div>
                      <div style={{ fontSize: 12.5, color: 'var(--text-tertiary)' }}>
                        {c.contract_type ? `${c.contract_type} · ` : ''}
                        {c.monthly_fee_eur != null ? `${c.monthly_fee_eur} €/mes` : '—'}
                      </div>
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 600, color: meta.color, background: meta.bg, padding: '3px 10px', borderRadius: 20, whiteSpace: 'nowrap' }}>{meta.text}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderTop: '1px solid var(--border-primary)', borderBottom: '1px solid var(--border-primary)', marginBottom: 12 }}>
                    <span style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>Webov v správe</span>
                    <span style={{ fontSize: 18, fontWeight: 800, fontFamily: "'Geist Mono', monospace", fontVariantNumeric: 'tabular-nums', color: 'var(--text-primary)' }}>{count}</span>
                  </div>
                  {c.slug && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, padding: '9px 11px', background: 'var(--surface-secondary)', borderRadius: 9 }}>
                      <span style={{ fontSize: 11.5, color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>Verejný stav</span>
                      <code style={{ flex: 1, minWidth: 0, fontSize: 11.5, color: 'var(--text-secondary)', fontFamily: "'Geist Mono', monospace", overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>/status/{c.slug}</code>
                      <button
                        onClick={() => { try { navigator.clipboard.writeText(`${window.location.origin}/status/${c.slug}`); setNotice(`Skopírované: /status/${c.slug}`); setTimeout(() => setNotice(null), 2000); } catch { /* ignore */ } }}
                        style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--accent-primary)', background: 'transparent', border: '1px solid var(--border-primary)', borderRadius: 7, padding: '4px 9px', cursor: 'pointer', whiteSpace: 'nowrap' }}
                      >
                        Kopírovať
                      </button>
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => openEdit(c)} style={{ ...btn(false), flex: 1, textAlign: 'center' }}>Upraviť</button>
                    {archived ? (
                      <button onClick={() => setStatus(c, 'active')} style={{ ...btn(false), flex: 1, color: 'var(--ok-color)' }}>Obnoviť</button>
                    ) : (
                      <button onClick={() => setStatus(c, 'archived')} style={{ ...btn(false), flex: 1, color: 'var(--critical-color)' }} title={count > 0 ? 'Weby ostanú, len sa odpojí zmluva' : ''}>Deaktivovať</button>
                    )}
                  </div>
                  <button
                    onClick={() => del(c)}
                    title={count > 0 ? 'Najprv prehoď weby na iného klienta' : 'Trvalé vymazanie klienta'}
                    style={{ marginTop: 8, width: '100%', background: 'transparent', border: 'none', color: count > 0 ? 'var(--text-tertiary)' : 'var(--critical-color)', fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: '4px' }}
                  >
                    Vymazať klienta{count > 0 ? ` (najprv prehoď ${count} ${count === 1 ? 'web' : 'weby'})` : ''}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {editing !== null && (
        <div onClick={() => !saving && setEditing(null)} style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ ...card, padding: 0, width: 'min(520px, 100%)', maxHeight: '90vh', overflow: 'auto' }}>
            <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border-primary)' }}>
              <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: '-0.02em', color: 'var(--text-primary)' }}>{editing === 'new' ? 'Nový klient' : 'Upraviť klienta'}</div>
            </div>
            <div style={{ padding: 24, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              {([
                ['name', 'Názov *', 'napr. Krivošík'],
                ['company', 'Firma', 'napr. Krivošík s.r.o.'],
                ['contract_type', 'Typ zmluvy', 'napr. Standard'],
                ['monthly_fee_eur', 'Paušál (€/mes)', 'napr. 39'],
                ['email', 'E-mail', 'kontakt@…'],
                ['phone', 'Telefón', '+421…'],
                ['ico', 'IČO', '12345678'],
                ['notion_page_id', 'Notion page ID', 'voliteľné'],
              ] as const).map(([k, label, ph]) => (
                <div key={k} style={{ gridColumn: k === 'name' || k === 'company' || k === 'notion_page_id' ? '1 / -1' : 'auto' }}>
                  <label style={lbl}>{label}</label>
                  <input style={input} value={form[k]} placeholder={ph} inputMode={k === 'monthly_fee_eur' ? 'decimal' : undefined} onInput={(e) => set(k, (e.target as HTMLInputElement).value)} />
                </div>
              ))}
              {err && <div style={{ gridColumn: '1 / -1', fontSize: 13, color: 'var(--critical-color)', background: 'var(--critical-bg)', padding: '9px 13px', borderRadius: 10 }}>{err}</div>}
            </div>
            <div style={{ padding: '16px 24px', borderTop: '1px solid var(--border-primary)', display: 'flex', gap: 10, justifyContent: 'flex-end', background: 'var(--surface-secondary)' }}>
              <button onClick={() => setEditing(null)} disabled={saving} style={btn(false)}>Zrušiť</button>
              <button onClick={save} disabled={saving} style={{ ...btn(true), opacity: saving ? 0.6 : 1 }}>{saving ? 'Ukladám…' : editing === 'new' ? 'Pridať klienta' : 'Uložiť'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ClientsPage() {
  return (
    <Shell>
      <ClientsView />
    </Shell>
  );
}
