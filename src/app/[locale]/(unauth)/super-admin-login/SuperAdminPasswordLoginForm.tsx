'use client';

import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';

type Props = {
  passwordLoginEnabled: boolean;
  legacyModeSelected: boolean;
};

export function SuperAdminPasswordLoginForm({
  passwordLoginEnabled,
  legacyModeSelected,
}: Props) {
  const router = useRouter();
  const params = useParams();
  const locale = (params?.locale as string) || 'en';
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await fetch('/api/admin/auth/password-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, password }),
      });
      if (!response.ok) {
        setError('Invalid credentials');
        return;
      }
      router.replace(`/${locale}/super-admin`);
      router.refresh();
    } catch {
      setError('Invalid credentials');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-slate-900 to-slate-800">
      <div className="px-6 pb-8 pt-12 text-center">
        <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-500 to-orange-600 shadow-lg">
          <span className="text-3xl" aria-hidden="true">👑</span>
        </div>
        <h1 className="text-2xl font-bold text-white">Super Admin Login</h1>
        <p className="mt-1 text-slate-400">Platform administrator access only</p>
      </div>

      <div className="flex-1 px-6">
        {passwordLoginEnabled
          ? (
              <form onSubmit={handleSubmit} className="mx-auto max-w-sm">
                <label className="mb-2 block text-sm font-medium text-slate-300" htmlFor="super-admin-phone">
                  Phone number
                </label>
                <input
                  id="super-admin-phone"
                  type="tel"
                  autoComplete="username"
                  value={phone}
                  onChange={event => setPhone(event.target.value)}
                  className="mb-4 w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 text-lg text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  placeholder="+1 416 555 0123"
                  required
                />

                <label className="mb-2 block text-sm font-medium text-slate-300" htmlFor="super-admin-password">
                  Password
                </label>
                <input
                  id="super-admin-password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={event => setPassword(event.target.value)}
                  className="mb-4 w-full rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 text-lg text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  required
                />

                {error && (
                  <div className="mb-4 rounded-xl border border-red-800 bg-red-900/50 px-4 py-3" role="alert">
                    <p className="text-sm text-red-300">{error}</p>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading || !phone || !password}
                  className="w-full rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 py-3.5 font-semibold text-white shadow-md transition-all hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loading ? 'Signing in…' : 'Sign In'}
                </button>
              </form>
            )
          : (
              <div className="mx-auto max-w-sm rounded-xl border border-slate-700 bg-slate-800 p-5 text-sm text-slate-300" role="status">
                {legacyModeSelected
                  ? 'Legacy Twilio authentication is retired. Enable password authentication on the server.'
                  : 'Password authentication is not configured for this deployment.'}
              </div>
            )}
      </div>

      <div className="px-6 py-8 text-center text-sm text-slate-500">
        Salon owner?
        {' '}
        <a href={`/${locale}/owner-sign-in`} className="font-medium text-amber-400 hover:underline">
          Go to owner sign in
        </a>
      </div>
    </div>
  );
}
