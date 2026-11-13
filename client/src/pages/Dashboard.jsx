import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ListOrdered, Plus } from 'lucide-react';
import api, { errorMessage, unwrap } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useQueuesChanged } from '../hooks/useQueueSocket.js';
import OverviewCards from '../components/OverviewCards.jsx';
import { EmptyState, ErrorState, PageHeader, PageSpinner, StatusBadge } from '../components/ui.jsx';

export default function Dashboard() {
  const { user } = useAuth();
  const [overview, setOverview] = useState(null);
  const [queues, setQueues] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const tz = new Date().getTimezoneOffset();
      const [o, q] = await Promise.all([api.get('/analytics/overview', { params: { range: 'today', tzOffset: tz } }), api.get('/queues')]);
      setOverview(unwrap(o));
      setQueues(unwrap(q).queues);
      setError('');
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useQueuesChanged(load);

  if (error && !overview) return <ErrorState message={error} onRetry={load} />;
  if (!overview || !queues) return <PageSpinner />;

  return (
    <>
      <PageHeader title={`Hello, ${user.name.split(' ')[0]}`} subtitle="Here is how your queues are doing today.">
        <Link to="/queues" className="btn-primary"><Plus className="h-4 w-4" />New queue</Link>
      </PageHeader>
      <OverviewCards data={overview} periodLabel="today" />

      <div className="card mt-6">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-900">Your queues</h2>
          <Link to="/queues" className="text-sm font-semibold text-brand-600 hover:text-brand-700">View all</Link>
        </div>
        {queues.length === 0 ? (
          <EmptyState icon={ListOrdered} title="No queues yet" hint="Create your first queue to start issuing tokens." action={<Link to="/queues" className="btn-primary">Create a queue</Link>} />
        ) : (
          <ul className="divide-y divide-slate-100">
            {queues.slice(0, 6).map((q) => (
              <li key={q.id}>
                <Link to={`/queues/${q.id}`} className="flex items-center gap-4 px-5 py-3.5 hover:bg-slate-50">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-900">{q.name}</p>
                    <p className="text-xs text-slate-500">{q.counts.waiting} waiting · {q.counts.completed} completed</p>
                  </div>
                  <StatusBadge status={q.status} />
                  <ArrowRight className="h-4 w-4 text-slate-400" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
