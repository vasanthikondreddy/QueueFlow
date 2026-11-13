import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Waypoints } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { errorMessage } from '../api/client.js';
import { Spinner } from '../components/ui.jsx';

export default function Login() {
  const { login } = useAuth();
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    setError('');
    if (!form.email.trim() || !form.password) return setError('Enter your email and password.');
    setBusy(true);
    try {
      await login(form.email.trim(), form.password);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <AuthShell title="Welcome back" subtitle="Log in to manage your queues.">
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <div>
          <label htmlFor="email" className="label">Email</label>
          <input id="email" type="email" autoComplete="email" className="input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </div>
        <div>
          <label htmlFor="password" className="label">Password</label>
          <input id="password" type="password" autoComplete="current-password" className="input" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        </div>
        <button className="btn-primary w-full" disabled={busy}>{busy && <Spinner className="h-4 w-4" />}Log in</button>
      </form>
      <p className="mt-6 text-center text-sm text-slate-500">
        New to QueueFlow? <Link to="/register" className="font-semibold text-brand-600 hover:text-brand-700">Create an account</Link>
      </p>
    </AuthShell>
  );
}

export function AuthShell({ title, subtitle, children }) {
  return (
    <div className="flex min-h-screen">
      <div className="hidden w-1/2 flex-col justify-between bg-brand-900 p-12 text-white lg:flex">
        <div className="flex items-center gap-2 text-lg font-extrabold"><Waypoints className="h-6 w-6" />QueueFlow</div>
        <div>
          <p className="text-5xl font-extrabold leading-tight tracking-tight">Next in line,<br />without the shouting.</p>
          <p className="mt-4 max-w-md text-brand-200">Create queues, issue tokens, call the next person with one click and see exactly how long people wait.</p>
        </div>
        <div className="flex gap-3 text-sm font-bold">
          {['Q001', 'Q002', 'Q003'].map((t, i) => (
            <span key={t} className={`rounded-lg px-3 py-1.5 ${i === 0 ? 'bg-white text-brand-800' : 'bg-white/10 text-white'}`}>{t}</span>
          ))}
        </div>
      </div>
      <div className="flex flex-1 items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">{title}</h1>
          <p className="mb-6 mt-1 text-sm text-slate-500">{subtitle}</p>
          {children}
        </div>
      </div>
    </div>
  );
}
