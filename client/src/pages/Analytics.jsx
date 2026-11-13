import { useCallback, useEffect, useRef, useState } from 'react';
import { BarChart3 } from 'lucide-react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import api, { errorMessage, unwrap } from '../api/client.js';
import { useQueuesChanged } from '../hooks/useQueueSocket.js';
import OverviewCards from '../components/OverviewCards.jsx';
import { EmptyState, ErrorState, PageHeader, PageSpinner } from '../components/ui.jsx';
import { bucketLabel, formatDuration, toMinutes } from '../utils/format.js';

const RANGES = [['today', 'Today'], ['7d', 'Last 7 days'], ['30d', 'Last 30 days']];
const C = { brand: '#4f46e5', brandLight: '#a5b4fc', green: '#10b981', red: '#ef4444', amber: '#f59e0b', grid: '#e2e8f0', axis: '#64748b' };
const axisProps = { stroke: C.axis, fontSize: 12, tickLine: false, axisLine: false };

function ChartCard({ title, subtitle, empty, children }) {
  return (
    <section className="card p-4 sm:p-5">
      <h2 className="text-base font-semibold text-slate-900">{title}</h2>
      {subtitle && <p className="mb-3 text-xs text-slate-500">{subtitle}</p>}
      {empty ? <EmptyState icon={BarChart3} title="No data for this period" hint="Charts fill in as people are added and served." /> : <div className="h-64">{children}</div>}
    </section>
  );
}

const grid = <CartesianGrid stroke={C.grid} strokeDasharray="3 3" vertical={false} />;
const tick = (v) => bucketLabel(v);

export default function Analytics() {
  const [range, setRange] = useState('7d');
  const [queueId, setQueueId] = useState('');
  const [queueOptions, setQueueOptions] = useState([]);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const reqId = useRef(0);

  useEffect(() => { api.get('/queues').then((r) => setQueueOptions(unwrap(r).queues)).catch(() => {}); }, []);

  const load = useCallback(async () => {
    const my = ++reqId.current; // ignore out-of-order responses when filters change quickly
    const params = { range, tzOffset: new Date().getTimezoneOffset(), ...(queueId ? { queueId } : {}) };
    try {
      const [o, t, q] = await Promise.all([api.get('/analytics/overview', { params }), api.get('/analytics/trends', { params }), api.get('/analytics/queues', { params })]);
      if (my !== reqId.current) return;
      setData({ overview: unwrap(o), trends: unwrap(t), queues: unwrap(q).queues });
      setError('');
    } catch (err) {
      if (my === reqId.current) setError(errorMessage(err));
    } finally {
      if (my === reqId.current) setLoading(false);
    }
  }, [range, queueId]);

  useEffect(() => { setLoading(true); load(); }, [load]);
  useQueuesChanged(load);

  const periodLabel = RANGES.find(([k]) => k === range)[1].toLowerCase();
  const filtered = queueId ? data?.queues.filter((q) => q.queueId === queueId) : data?.queues;

  const series = (data?.trends.series || []).map((p) => ({ ...p, waitMin: toMinutes(p.avgWaitMs), serviceMin: toMinutes(p.avgServiceMs) }));
  const totals = data ? { completed: data.overview.completed, cancelled: data.overview.cancelled } : { completed: 0, cancelled: 0 };
  const queueRows = (filtered || []).map((q) => ({ ...q, short: q.name.length > 14 ? `${q.name.slice(0, 13)}…` : q.name }));

  return (
    <>
      <PageHeader title="Analytics" subtitle="Waiting time is how long people wait to be called. Service duration is how long the service itself takes.">
        <select className="input !w-auto" aria-label="Queue filter" value={queueId} onChange={(e) => setQueueId(e.target.value)}>
          <option value="">All queues</option>
          {queueOptions.map((q) => <option key={q.id} value={q.id}>{q.name}</option>)}
        </select>
        <div className="inline-flex rounded-lg border border-slate-300 bg-white p-0.5" role="group" aria-label="Time range">
          {RANGES.map(([k, label]) => (
            <button key={k} onClick={() => setRange(k)} aria-pressed={range === k} className={`rounded-md px-3 py-1.5 text-sm font-semibold transition-colors ${range === k ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>{label}</button>
          ))}
        </div>
      </PageHeader>

      {error && !data ? <ErrorState message={error} onRetry={load} /> : !data ? <PageSpinner /> : (
        <div className={loading ? 'opacity-60 transition-opacity' : ''}>
          <OverviewCards data={data.overview} periodLabel={periodLabel} showService />

          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <ChartCard title="Queue length trend" subtitle="People waiting at the end of each period, and the busiest moment within it." empty={!series.some((p) => p.peakQueueLength > 0)}>
              <ResponsiveContainer>
                <AreaChart data={series}>{grid}<XAxis dataKey="bucket" tickFormatter={tick} {...axisProps} /><YAxis allowDecimals={false} {...axisProps} width={28} />
                  <Tooltip labelFormatter={tick} /><Legend />
                  <Area type="monotone" dataKey="peakQueueLength" name="Peak" stroke={C.brandLight} fill={C.brandLight} fillOpacity={0.25} />
                  <Area type="monotone" dataKey="queueLength" name="End of period" stroke={C.brand} fill={C.brand} fillOpacity={0.2} />
                </AreaChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Tokens created" subtitle={range === 'today' ? 'Per hour' : 'Per day'} empty={!series.some((p) => p.created > 0)}>
              <ResponsiveContainer>
                <BarChart data={series}>{grid}<XAxis dataKey="bucket" tickFormatter={tick} {...axisProps} /><YAxis allowDecimals={false} {...axisProps} width={28} />
                  <Tooltip labelFormatter={tick} /><Bar dataKey="created" name="Tokens created" fill={C.brand} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Completed vs cancelled" subtitle={`Outcome of tokens in the ${periodLabel}`} empty={totals.completed + totals.cancelled === 0}>
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={[{ name: 'Completed', value: totals.completed }, { name: 'Cancelled', value: totals.cancelled }]} dataKey="value" nameKey="name" innerRadius={55} outerRadius={85} paddingAngle={2} label={({ name, value }) => `${name}: ${value}`}>
                    <Cell fill={C.green} /><Cell fill={C.red} />
                  </Pie>
                  <Tooltip /><Legend />
                </PieChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Average waiting time trend" subtitle="Waiting = joined → called. Service = called → completed. Minutes, by completion time." empty={!series.some((p) => p.waitMin !== null)}>
              <ResponsiveContainer>
                <LineChart data={series}>{grid}<XAxis dataKey="bucket" tickFormatter={tick} {...axisProps} /><YAxis {...axisProps} width={32} unit="m" />
                  <Tooltip labelFormatter={tick} formatter={(v) => (v === null ? '—' : `${v} min`)} /><Legend />
                  <Line type="monotone" dataKey="waitMin" name="Waiting time" stroke={C.amber} strokeWidth={2} dot={{ r: 3 }} connectNulls />
                  <Line type="monotone" dataKey="serviceMin" name="Service duration" stroke={C.green} strokeWidth={2} dot={{ r: 3 }} connectNulls />
                </LineChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>

          <section className="card mt-4 p-4 sm:p-5">
            <h2 className="text-base font-semibold text-slate-900">Queue performance comparison</h2>
            <p className="mb-3 text-xs text-slate-500">Outcomes in the {periodLabel}; waiting now is live.</p>
            {queueRows.length === 0 ? <EmptyState icon={BarChart3} title="No queues to compare" hint="Create a queue to see how it performs." /> : (
              <>
                <div className="h-64">
                  <ResponsiveContainer>
                    <BarChart data={queueRows}>{grid}<XAxis dataKey="short" {...axisProps} /><YAxis allowDecimals={false} {...axisProps} width={28} /><Tooltip /><Legend />
                      <Bar dataKey="completed" name="Completed" fill={C.green} radius={[4, 4, 0, 0]} />
                      <Bar dataKey="cancelled" name="Cancelled" fill={C.red} radius={[4, 4, 0, 0]} />
                      <Bar dataKey="waiting" name="Waiting now" fill={C.amber} radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full min-w-[480px] text-left text-sm">
                    <thead className="text-xs text-slate-500"><tr><th className="py-2 font-medium">Queue</th><th className="font-medium">Created</th><th className="font-medium">Completed</th><th className="font-medium">Avg waiting</th><th className="font-medium">Avg service</th></tr></thead>
                    <tbody className="divide-y divide-slate-100">
                      {queueRows.map((q) => (
                        <tr key={q.queueId}><td className="py-2 font-semibold text-slate-900">{q.name}</td><td>{q.created}</td><td>{q.completed}</td><td>{formatDuration(q.avgWaitMs)}</td><td>{formatDuration(q.avgServiceMs)}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </>
  );
}
