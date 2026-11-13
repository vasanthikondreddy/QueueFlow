import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ListOrdered, Plus } from 'lucide-react';
import api, { errorMessage, unwrap } from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';
import { useQueuesChanged } from '../hooks/useQueueSocket.js';
import { EmptyState, ErrorState, Modal, PageHeader, PageSpinner, Spinner, StatusBadge } from '../components/ui.jsx';
import { formatDate } from '../utils/format.js';

function CreateQueueModal({ onClose, onCreated }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    if (!name.trim()) return setError('Give your queue a name.');
    setBusy(true);
    setError('');
    try {
      const { queue } = unwrap(await api.post('/queues', { name: name.trim() }));
      toast.success(`Queue “${queue.name}” created`);
      onCreated(queue);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Create a queue"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button form="create-queue" className="btn-primary" disabled={busy}>{busy && <Spinner className="h-4 w-4" />}Create queue</button>
        </>
      }
    >
      <form id="create-queue" onSubmit={submit}>
        <label htmlFor="queue-name" className="label">Queue name</label>
        <input id="queue-name" className="input" maxLength={80} placeholder="e.g. Front desk" value={name} onChange={(e) => setName(e.target.value)} />
        {error && <p role="alert" className="mt-2 text-sm text-red-600">{error}</p>}
      </form>
    </Modal>
  );
}

export default function Queues() {
  const [queues, setQueues] = useState(null);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      setQueues(unwrap(await api.get('/queues')).queues);
      setError('');
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);
  useEffect(() => { load(); }, [load]);
  useQueuesChanged(load);

  const newButton = <button className="btn-primary" onClick={() => setCreating(true)}><Plus className="h-4 w-4" />New queue</button>;

  return (
    <>
      <PageHeader title="Queues" subtitle="Every line you manage, with live counts.">{queues?.length > 0 && newButton}</PageHeader>
      {error && !queues ? (
        <ErrorState message={error} onRetry={load} />
      ) : !queues ? (
        <PageSpinner />
      ) : queues.length === 0 ? (
        <div className="card"><EmptyState icon={ListOrdered} title="No queues yet" hint="A queue is a line of people waiting for the same service. Create one to start adding people." action={newButton} /></div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {queues.map((q) => (
            <Link key={q.id} to={`/queues/${q.id}`} className="card block p-5 transition-shadow hover:shadow-md">
              <div className="flex items-start justify-between gap-2">
                <h2 className="truncate text-base font-semibold text-slate-900">{q.name}</h2>
                <StatusBadge status={q.status} />
              </div>
              <p className="mt-1 text-xs text-slate-500">Created {formatDate(q.createdAt)}</p>
              <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                {[['Waiting', q.counts.waiting], ['Serving', q.counts.serving], ['Done', q.counts.completed]].map(([l, v]) => (
                  <div key={l} className="rounded-lg bg-slate-50 py-2"><p className="text-lg font-bold text-slate-900">{v}</p><p className="text-xs text-slate-500">{l}</p></div>
                ))}
              </div>
            </Link>
          ))}
        </div>
      )}
      {creating && <CreateQueueModal onClose={() => setCreating(false)} onCreated={() => { setCreating(false); load(); }} />}
    </>
  );
}
