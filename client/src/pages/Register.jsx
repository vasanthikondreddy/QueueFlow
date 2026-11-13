import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { errorMessage } from '../api/client.js';
import { Spinner } from '../components/ui.jsx';
import { AuthShell } from './Login.jsx';

export function validateRegistration({ name, email, password }) {
  if (name.trim().length < 2) return 'Name must be at least 2 characters.';
  if (!/^\S+@\S+\.\S+$/.test(email.trim())) return 'Enter a valid email address.';
  if (password.length < 8) return 'Password must be at least 8 characters.';
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return 'Password must contain a letter and a number.';
  return '';
}

export default function Register() {
  const { register } = useAuth();
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    const problem = validateRegistration(form);
    if (problem) return setError(problem);
    setError('');
    setBusy(true);
    try {
      await register(form.name.trim(), form.email.trim(), form.password);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <AuthShell title="Create your account" subtitle="Start managing queues in under a minute.">
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <div><label htmlFor="name" className="label">Full name</label><input id="name" autoComplete="name" className="input" value={form.name} onChange={set('name')} /></div>
        <div><label htmlFor="email" className="label">Email</label><input id="email" type="email" autoComplete="email" className="input" value={form.email} onChange={set('email')} /></div>
        <div>
          <label htmlFor="password" className="label">Password</label>
          <input id="password" type="password" autoComplete="new-password" className="input" value={form.password} onChange={set('password')} />
          <p className="mt-1 text-xs text-slate-500">At least 8 characters, with a letter and a number.</p>
        </div>
        <button className="btn-primary w-full" disabled={busy}>{busy && <Spinner className="h-4 w-4" />}Create account</button>
      </form>
      <p className="mt-6 text-center text-sm text-slate-500">
        Already have an account? <Link to="/login" className="font-semibold text-brand-600 hover:text-brand-700">Log in</Link>
      </p>
    </AuthShell>
  );
}
