'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../lib/supabase';

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '11px 14px',
  background: 'var(--bg-base)',
  border: '1px solid var(--border-primary)',
  borderRadius: 10,
  color: 'var(--text-primary)',
  fontSize: 14,
  outline: 'none',
};
const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--text-secondary)',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  marginBottom: 7,
};

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const loginPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) setError(error.message);
    else router.replace('/');
  };

  const sendMagicLink = async () => {
    setLoading(true);
    setError(null);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: typeof window !== 'undefined' ? window.location.origin : undefined },
    });
    setLoading(false);
    if (error) setError(error.message);
    else setSent(true);
  };

  return (
    <main
      id="main"
      style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', padding: 20, background: 'var(--bg-base)' }}
    >
      <div style={{ width: '100%', maxWidth: 380 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <div style={{ width: 30, height: 30, borderRadius: 8, background: 'var(--accent-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: 16 }}>◈</div>
          <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.02em', color: 'var(--text-primary)' }}>Monitorix</h1>
        </div>
        <p style={{ fontSize: 13.5, color: 'var(--text-secondary)', marginBottom: 24 }}>Prihlásenie do dashboardu.</p>

        {sent ? (
          <div style={{ background: 'var(--surface-primary)', border: '1px solid var(--border-primary)', borderRadius: 'var(--radius)', padding: 18, fontSize: 13.5, color: 'var(--text-secondary)', boxShadow: 'var(--shadow-sm)' }}>
            Poslali sme prihlasovací odkaz na <strong style={{ color: 'var(--text-primary)' }}>{email}</strong>. Lokálne ho nájdeš v Mailpite (127.0.0.1:54324).
          </div>
        ) : (
          <form onSubmit={loginPassword} style={{ background: 'var(--surface-primary)', border: '1px solid var(--border-primary)', borderRadius: 'var(--radius)', padding: 22, boxShadow: 'var(--shadow-sm)', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <label htmlFor="email" style={labelStyle}>E-mail</label>
              <input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ty@lopatka.sk" style={inputStyle} />
            </div>
            <div>
              <label htmlFor="password" style={labelStyle}>Heslo</label>
              <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" style={inputStyle} />
            </div>
            <button type="submit" disabled={loading} style={{ padding: '11px 16px', background: 'var(--accent-primary)', color: 'white', border: 'none', borderRadius: 10, cursor: 'pointer', fontSize: 14, fontWeight: 600, opacity: loading ? 0.6 : 1 }}>
              {loading ? 'Prihlasujem…' : 'Prihlásiť heslom'}
            </button>
            <button type="button" onClick={sendMagicLink} disabled={loading || !email} style={{ padding: '10px 16px', background: 'var(--surface-secondary)', color: 'var(--text-secondary)', border: '1px solid var(--border-primary)', borderRadius: 10, cursor: 'pointer', fontSize: 13, fontWeight: 600, opacity: loading || !email ? 0.5 : 1 }}>
              …alebo poslať magic link
            </button>
            {error && (
              <p role="alert" style={{ fontSize: 13, color: 'var(--critical-color)' }}>{error}</p>
            )}
          </form>
        )}
      </div>
    </main>
  );
}
