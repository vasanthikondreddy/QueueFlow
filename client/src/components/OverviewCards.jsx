import { Layers, Ticket, Hourglass, PhoneCall, CheckCircle2, XCircle, Timer, Clock } from 'lucide-react';
import { StatCard } from './ui.jsx';
import { formatDuration } from '../utils/format.js';

export default function OverviewCards({ data, periodLabel, showService = false }) {
  const d = data;
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <StatCard label="Total queues" value={d.totalQueues} icon={Layers} tone="brand" />
      <StatCard label="Tokens created" value={d.tokensCreated} hint={periodLabel} icon={Ticket} tone="slate" />
      <StatCard label="Waiting now" value={d.waiting} icon={Hourglass} tone="amber" />
      <StatCard label="Serving now" value={d.serving} icon={PhoneCall} tone="brand" />
      <StatCard label="Completed" value={d.completed} hint={periodLabel} icon={CheckCircle2} tone="green" />
      <StatCard label="Cancelled" value={d.cancelled} hint={periodLabel} icon={XCircle} tone="red" />
      <StatCard label="Avg waiting time" value={formatDuration(d.avgWaitMs)} hint={d.samples ? `${d.samples} completed · joined → called` : 'No completed services yet'} icon={Timer} tone="amber" />
      {showService && (
        <StatCard label="Avg service duration" value={formatDuration(d.avgServiceMs)} hint="called → completed" icon={Clock} tone="green" />
      )}
    </div>
  );
}
