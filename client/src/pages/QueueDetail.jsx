import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowUp, ArrowDown, X, UserPlus, PhoneCall, CheckCheck, Users, Wifi, WifiOff, Trash2, Pencil, Power } from 'lucide-react';
import api, { errorCode, errorMessage, unwrap } from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';
import { useNow, useQueueSocket } from '../hooks/useQueueSocket.js';
import { ConfirmDialog, EmptyState, ErrorState, PageSpinner, Spinner, StatusBadge } from '../components/ui.jsx';
import { formatDuration, formatTime } from '../utils/format.js';

const newRequestId = () => (globalThis.crypto?.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
// Errors that mean "your view is out of date" -> refetch
const STALE_CODES = ['STALE_QUEUE', 'ALREADY_SERVING', 'QUEUE_EMPTY', 'INVALID_STATE', 'TOKEN_NOT_MOVABLE', 'MOVE_OUT_OF_BOUNDS', 'CANNOT_CANCEL_SERVING'];

export default function QueueDetail() {
  const { queueId } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const now = useNow();

  const [state, setState] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(null);
  const busyRef = useRef(false); // synchronous guard: blocks repeated clicks before React re-renders
  const [name, setName] = useState('');
  const [formError, setFormError] = useState('');
  const requestIdRef = useRef(null);
  const [confirm, setConfirm] = useState(null); // { kind: 'cancel' | 'delete', token? }
  const [renaming, setRenaming] = useState(null); // string | null

  // Never let an older snapshot overwrite a newer one (socket vs. HTTP race)
  const applyState = useCallback((s) => setState((prev) => (!prev || s.queue.version >= prev.queue.version ? s : prev)), []);

  const load = useCallback(async () => {
    try {
      applyState(unwrap(await api.get(`/queues/${queueId}/tokens`)));
      setLoadError('');
    } catch (err) {
      setLoadError(errorCode(err) === 'QUEUE_NOT_FOUND' || errorCode(err) === 'INVALID_ID' ? 'NOT_FOUND' : errorMessage(err));
    }
  }, [queueId, applyState]);

  useEffect(() => { setState(null); load(); }, [load]);

  const { connected } = useQueueSocket(queueId, {
    onState: applyState,
    onDeleted: () => { toast.info('This queue was deleted.'); navigate('/queues'); },
    onReconnect: load,
  });

  async function run(key, request, success) {
    if (busyRef.current) return null;
    busyRef.current = true;
    setBusy(key);
    try {
      const data = unwrap(await request());
      if (data.state) applyState(data.state);
      if (success) toast.success(success(data));
      return data;
    } catch (err) {
      toast.error(errorMessage(err));
      if (STALE_CODES.includes(errorCode(err))) load();
      return null;
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  }

  async function addPerson(e) {
    e.preventDefault();
    const personName = name.trim();
    if (!personName) return setFormError('Enter a name before adding.');
    setFormError('');
    requestIdRef.current ||= newRequestId(); // same id on retry => the server never creates two tokens
    const data = await run('add', () => api.post(`/queues/${queueId}/tokens`, { personName, requestId: requestIdRef.current }), (d) => `${d.token.tokenNumber} added for ${d.token.personName}`);
    if (data) { setName(''); requestIdRef.current = null; }
  }

  const move = (token, direction) =>
    run(`move-${token.id}`, () => api.patch(`/queues/${queueId}/tokens/reorder`, { tokenId: token.id, direction, version: state.queue.version }));
  const serveNext = () => run('serve', () => api.post(`/queues/${queueId}/serve-next`), (d) => `Now serving ${d.token.tokenNumber} · ${d.token.personName}`);
  const complete = (token) => run('complete', () => api.post(`/queues/${queueId}/tokens/${token.id}/complete`), (d) => `${d.token.tokenNumber} completed`);

  async function confirmAction() {
    if (confirm.kind === 'cancel') {
      await run('cancel', () => api.post(`/queues/${queueId}/tokens/${confirm.token.id}/cancel`), (d) => `${d.token.tokenNumber} cancelled`);
      setConfirm(null);
    } else {
      if (busyRef.current) return;
      busyRef.current = true; setBusy('delete');
      try {
        await api.delete(`/queues/${queueId}`);
        toast.success('Queue deleted');
        navigate('/queues');
      } catch (err) {
        toast.error(errorMessage(err));
        setConfirm(null);
      } finally { busyRef.current = false; setBusy(null); }
    }
  }

  async function saveSettings(patch, success) {
    const data = await run('settings', () => api.put(`/queues/${queueId}`, patch), () => success);
    if (data) { setRenaming(null); load(); }
  }

  if (loadError === 'NOT_FOUND') return <ErrorState message="This queue doesn’t exist or isn’t yours." onRetry={() => navigate('/queues')} />;
  if (loadError && !state) return <ErrorState message={loadError} onRetry={load} />;
  if (!state) return <PageSpinner />;

  const { queue, waiting, serving, history, counts } = state;
  const inactive = queue.status !== 'ACTIVE';
  const anyBusy = busy !== null;
  const canServe = !inactive && !serving && waiting.length > 0;

  return (
    <>
      <Link to="/queues" className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-slate-800"><ArrowLeft className="h-4 w-4" />All queues</Link>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">{queue.name}</h1>
        <StatusBadge status={queue.status} />
        <span className={`ml-auto inline-flex items-center gap-1.5 text-xs font-medium ${connected ? 'text-emerald-600' : 'text-amber-600'}`}>
          {connected ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}{connected ? 'Live' : 'Reconnecting…'}
        </span>
      </div>

      {inactive && <p className="mb-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">This queue is inactive. You can finish current work, but adding people and calling tokens is paused.</p>}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {/* Now serving + call next */}
          <section className="rounded-xl bg-brand-800 p-5 text-white shadow-card sm:p-6" aria-label="Now serving">
            <p className="text-sm font-semibold text-brand-200">Now serving</p>
            {serving ? (
              <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
                <div>
                  <p className="text-6xl font-extrabold leading-none tracking-tight sm:text-7xl" data-testid="serving-token">{serving.tokenNumber}</p>
                  <p className="mt-2 text-lg font-semibold">{serving.personName}</p>
                  <p className="text-sm text-brand-200">Waited {formatDuration(serving.waitTimeMs)} · in service for {formatDuration(now - new Date(serving.servingAt))}</p>
                </div>
                <button className="btn bg-white text-brand-800 hover:bg-brand-50" onClick={() => complete(serving)} disabled={anyBusy}>
                  {busy === 'complete' ? <Spinner className="h-4 w-4" /> : <CheckCheck className="h-4 w-4" />}Complete Service
                </button>
              </div>
            ) : (
              <p className="mt-2 text-2xl font-bold">{waiting.length ? 'Ready for the next person' : 'Nobody is being served'}</p>
            )}
            <button
              onClick={serveNext}
              disabled={!canServe || anyBusy}
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-lg bg-amber-400 px-4 py-3.5 text-base font-extrabold tracking-wide text-slate-900 transition-colors hover:bg-amber-300 disabled:cursor-not-allowed disabled:bg-white/15 disabled:text-white/50"
            >
              {busy === 'serve' ? <Spinner /> : <PhoneCall className="h-5 w-5" />}CALL NEXT TOKEN
            </button>
            {!canServe && !inactive && (
              <p className="mt-2 text-center text-xs text-brand-200">{serving ? 'Complete the current service to call the next token.' : 'Add someone to the queue first.'}</p>
            )}
          </section>

          {/* Add person + waiting list */}
          <section className="card">
            <form onSubmit={addPerson} className="border-b border-slate-100 p-4 sm:p-5">
              <label htmlFor="person" className="label">Add a person</label>
              <div className="flex gap-2">
                <input id="person" className="input" placeholder="Person’s name" maxLength={60} value={name} disabled={inactive}
                  onChange={(e) => { setName(e.target.value); requestIdRef.current = null; setFormError(''); }} />
                <button className="btn-primary shrink-0" disabled={inactive || anyBusy}>
                  {busy === 'add' ? <Spinner className="h-4 w-4" /> : <UserPlus className="h-4 w-4" />}Add Person
                </button>
              </div>
              {formError && <p role="alert" className="mt-2 text-sm text-red-600">{formError}</p>}
            </form>

            <div className="flex items-center justify-between px-4 pb-1 pt-4 sm:px-5">
              <h2 className="text-base font-semibold text-slate-900">Waiting list</h2>
              <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-700">{waiting.length} waiting</span>
            </div>
            {waiting.length === 0 ? (
              <EmptyState icon={Users} title="Nobody is waiting" hint="Add a person above and they’ll get the next token number." />
            ) : (
              <ul className="divide-y divide-slate-100">
                {waiting.map((t, i) => (
                  <li key={t.id} className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm font-bold text-slate-600" title="Position">{t.position}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-slate-900"><span className="mr-2 text-brand-700">{t.tokenNumber}</span>{t.personName}</p>
                      <p className="text-xs text-slate-500">Waiting {formatDuration(now - new Date(t.createdAt))} · joined {formatTime(t.createdAt)}</p>
                    </div>
                    <StatusBadge status={t.status} />
                    <div className="flex items-center">
                      <button className="btn-icon" aria-label={`Move ${t.personName} up`} disabled={i === 0 || anyBusy} onClick={() => move(t, 'up')}><ArrowUp className="h-4 w-4" /></button>
                      <button className="btn-icon" aria-label={`Move ${t.personName} down`} disabled={i === waiting.length - 1 || anyBusy} onClick={() => move(t, 'down')}><ArrowDown className="h-4 w-4" /></button>
                      <button className="btn-icon hover:!bg-red-50 hover:!text-red-600" aria-label={`Cancel ${t.personName}`} disabled={anyBusy} onClick={() => setConfirm({ kind: 'cancel', token: t })}><X className="h-4 w-4" /></button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="space-y-6">
          <section className="grid grid-cols-2 gap-3">
            {[['Waiting', counts.waiting, 'text-amber-600'], ['Serving', counts.serving, 'text-brand-600'], ['Completed', counts.completed, 'text-emerald-600'], ['Cancelled', counts.cancelled, 'text-red-600']].map(([l, v, c]) => (
              <div key={l} className="card p-4"><p className="text-xs font-medium text-slate-500">{l}</p><p className={`text-2xl font-bold ${c}`}>{v}</p></div>
            ))}
          </section>

          <section className="card">
            <h2 className="border-b border-slate-100 px-4 py-3 text-base font-semibold text-slate-900">Recent activity</h2>
            {history.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-slate-500">Completed and cancelled tokens appear here.</p>
            ) : (
              <ul className="max-h-80 divide-y divide-slate-100 overflow-y-auto">
                {history.map((t) => (
                  <li key={t.id} className="flex items-center gap-3 px-4 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-900"><span className="mr-1.5 text-slate-500">{t.tokenNumber}</span>{t.personName}</p>
                      <p className="text-xs text-slate-500">{t.status === 'COMPLETED' ? `Waited ${formatDuration(t.waitTimeMs)} · served in ${formatDuration(t.serviceTimeMs)}` : `Cancelled ${formatTime(t.cancelledAt)}`}</p>
                    </div>
                    <StatusBadge status={t.status} />
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card p-4">
            <h2 className="mb-3 text-base font-semibold text-slate-900">Queue settings</h2>
            {renaming !== null ? (
              <form className="mb-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (renaming.trim()) saveSettings({ name: renaming.trim() }, 'Queue renamed'); }}>
                <input className="input" aria-label="Queue name" maxLength={80} value={renaming} onChange={(e) => setRenaming(e.target.value)} autoFocus />
                <button className="btn-primary" disabled={anyBusy}>Save</button>
                <button type="button" className="btn-ghost" onClick={() => setRenaming(null)}>Cancel</button>
              </form>
            ) : (
              <button className="btn-secondary mb-2 w-full justify-start" onClick={() => setRenaming(queue.name)}><Pencil className="h-4 w-4" />Rename queue</button>
            )}
            <button className="btn-secondary mb-2 w-full justify-start" disabled={anyBusy} onClick={() => saveSettings({ status: inactive ? 'ACTIVE' : 'INACTIVE' }, inactive ? 'Queue activated' : 'Queue deactivated')}>
              <Power className="h-4 w-4" />{inactive ? 'Activate queue' : 'Deactivate queue'}
            </button>
            <button className="btn-secondary w-full justify-start text-red-600 hover:bg-red-50" disabled={anyBusy} onClick={() => setConfirm({ kind: 'delete' })}><Trash2 className="h-4 w-4" />Delete queue</button>
            <p className="mt-3 text-xs text-slate-500">A queue can be deleted only when nobody is waiting or being served.</p>
          </section>
        </div>
      </div>

      {confirm?.kind === 'cancel' && (
        <ConfirmDialog danger title="Cancel this token?" confirmLabel="Cancel token" loading={busy === 'cancel'} onCancel={() => setConfirm(null)} onConfirm={confirmAction}
          message={`${confirm.token.tokenNumber} (${confirm.token.personName}) will be removed from the waiting list. This can’t be undone.`} />
      )}
      {confirm?.kind === 'delete' && (
        <ConfirmDialog danger title="Delete this queue?" confirmLabel="Delete queue" loading={busy === 'delete'} onCancel={() => setConfirm(null)} onConfirm={confirmAction}
          message={`“${queue.name}” and its ${counts.total} token${counts.total === 1 ? '' : 's'} of history will be permanently deleted, including their analytics.`} />
      )}
    </>
  );
}
