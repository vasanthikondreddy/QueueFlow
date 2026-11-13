import { useState } from 'react';
import { LogOut } from 'lucide-react';
import api, { errorMessage, unwrap } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { PageHeader, Spinner } from '../components/ui.jsx';
import { formatDate } from '../utils/format.js';

export default function Settings() {
  const { user, setUser, logout } = useAuth();
  const toast = useToast();
  const [name, setName] = useState(user.name);
  const [savingName, setSavingName] = useState(false);
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' });
  const [savingPw, setSavingPw] = useState(false);

  async function saveName(e) {
    e.preventDefault();
    if (savingName) return;
    if (name.trim().length < 2) return toast.error('Name must be at least 2 characters.');
    setSavingName(true);
    try {
      setUser(unwrap(await api.put('/auth/me', { name: name.trim() })).user);
      toast.success('Profile updated');
    } catch (err) { toast.error(errorMessage(err)); } finally { setSavingName(false); }
  }

  async function savePassword(e) {
    e.preventDefault();
    if (savingPw) return;
    setSavingPw(true);
    try {
      await api.post('/auth/change-password', pw);
      setPw({ currentPassword: '', newPassword: '' });
      toast.success('Password changed');
    } catch (err) { toast.error(errorMessage(err)); } finally { setSavingPw(false); }
  }

  return (
    <>
      <PageHeader title="Settings" subtitle="Your profile and security." />
      <div className="grid max-w-2xl gap-6">
        <form onSubmit={saveName} className="card space-y-4 p-5">
          <h2 className="text-base font-semibold text-slate-900">Profile</h2>
          <div><label htmlFor="s-name" className="label">Name</label><input id="s-name" className="input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} /></div>
          <div><label className="label">Email</label><input className="input bg-slate-50" value={user.email} disabled /></div>
          <p className="text-xs text-slate-500">Member since {formatDate(user.createdAt)}</p>
          <button className="btn-primary" disabled={savingName}>{savingName && <Spinner className="h-4 w-4" />}Save changes</button>
        </form>

        <form onSubmit={savePassword} className="card space-y-4 p-5">
          <h2 className="text-base font-semibold text-slate-900">Change password</h2>
          <div><label htmlFor="cur" className="label">Current password</label><input id="cur" type="password" autoComplete="current-password" className="input" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} /></div>
          <div><label htmlFor="new" className="label">New password</label><input id="new" type="password" autoComplete="new-password" className="input" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} /><p className="mt-1 text-xs text-slate-500">At least 8 characters, with a letter and a number.</p></div>
          <button className="btn-primary" disabled={savingPw || !pw.currentPassword || !pw.newPassword}>{savingPw && <Spinner className="h-4 w-4" />}Change password</button>
        </form>

        <div className="card flex items-center justify-between p-5">
          <div><h2 className="text-base font-semibold text-slate-900">Log out</h2><p className="text-sm text-slate-500">End your session on this device.</p></div>
          <button className="btn-secondary" onClick={logout}><LogOut className="h-4 w-4" />Log out</button>
        </div>
      </div>
    </>
  );
}
