'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../lib/supabase';

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
    <main id="main" className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-4">
      <h1 className="mb-1 text-xl font-semibold">Agency Dashboard</h1>
      <p className="mb-6 text-sm text-muted">Prihlásenie.</p>

      {sent ? (
        <p className="rounded-lg border border-border bg-card p-4 text-sm">
          Poslali sme prihlasovací odkaz na <strong>{email}</strong>. Lokálne ho nájdeš v Mailpite
          (http://127.0.0.1:54324).
        </p>
      ) : (
        <form onSubmit={loginPassword} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-sm" htmlFor="email">
              E-mail
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="rounded-lg border border-border bg-card px-3 py-2"
              placeholder="ty@lopatka.sk"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-sm" htmlFor="password">
              Heslo
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="rounded-lg border border-border bg-card px-3 py-2"
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="rounded-lg px-3 py-2 font-medium text-white disabled:opacity-50"
            style={{ background: 'var(--accent)' }}
          >
            {loading ? 'Prihlasujem…' : 'Prihlásiť heslom'}
          </button>

          <button
            type="button"
            onClick={sendMagicLink}
            disabled={loading || !email}
            className="rounded-lg border border-border px-3 py-2 text-sm disabled:opacity-50"
          >
            …alebo poslať magic link
          </button>

          {error && (
            <p className="text-sm" style={{ color: 'var(--dot-down)' }} role="alert">
              {error}
            </p>
          )}
        </form>
      )}
    </main>
  );
}
