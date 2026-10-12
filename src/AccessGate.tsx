import React, { useEffect, useState } from 'react';
import {
  getAccessCode,
  setAccessCode,
  clearAccessCode,
  verifyAccessCode,
  UNAUTHORIZED_EVENT,
} from './db';

type Phase = 'checking' | 'locked' | 'open';

export default function AccessGate({ children }: { children: React.ReactNode }) {
  const [phase, setPhase] = useState<Phase>('checking');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const stored = getAccessCode();
    if (!stored) {
      setPhase('locked');
    } else {
      verifyAccessCode(stored)
        .then((ok) => setPhase(ok ? 'open' : 'locked'))
        .catch((e) => {
          setError(e?.message || 'Could not reach the server.');
          setPhase('locked');
        });
    }
    const onUnauthorized = () => {
      clearAccessCode();
      setError('Access code was rejected. Please enter it again.');
      setPhase('locked');
    };
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (await verifyAccessCode(code.trim())) {
        setAccessCode(code.trim());
        setPhase('open');
      } else {
        setError('Incorrect access code.');
      }
    } catch (err: any) {
      setError(err?.message || 'Could not reach the server.');
    } finally {
      setBusy(false);
    }
  };

  if (phase === 'open') return <>{children}</>;
  if (phase === 'checking') {
    return <div className="min-h-screen flex items-center justify-center text-sm text-[var(--mut)]">Connecting…</div>;
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-5">
      <form
        onSubmit={submit}
        className="w-full max-w-sm bg-[var(--card)] border border-[var(--line)] rounded-lg p-6 shadow-sm"
      >
        <h1 className="text-lg font-semibold mb-1">ClearPass</h1>
        <p className="text-sm text-[var(--mut)] mb-4">Enter the team access code to continue.</p>
        <input
          type="password"
          autoFocus
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Access code"
          className="w-full px-3 py-2 text-sm border border-[var(--line)] rounded mb-3 outline-none focus:ring-2 focus:ring-[rgba(31,95,74,0.35)]"
        />
        {error && <p className="text-xs text-[var(--badt)] mb-3">{error}</p>}
        <button
          type="submit"
          disabled={busy || !code.trim()}
          className="w-full px-3 py-2 text-sm font-medium text-white bg-[var(--acc)] hover:bg-[var(--acc-hover)] rounded disabled:opacity-50 cursor-pointer"
        >
          {busy ? 'Checking…' : 'Unlock'}
        </button>
      </form>
    </div>
  );
}
