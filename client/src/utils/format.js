/** 125000 -> "2m 5s" | 3_900_000 -> "1h 5m" | null -> "—" */
export function formatDuration(ms) {
  if (ms === null || ms === undefined || Number.isNaN(ms)) return '—';
  const total = Math.max(0, Math.round(ms / 1000));
  if (total < 60) return `${total}s`;
  const m = Math.floor(total / 60);
  if (m < 60) return `${m}m ${total % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export const toMinutes = (ms) => (ms === null || ms === undefined ? null : Math.round((ms / 60000) * 10) / 10);

export const formatTime = (iso) => (iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—');

export const formatDate = (iso) => (iso ? new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

/** "2026-11-13T09" -> "09:00" | "2026-11-13" -> "13 Nov" */
export function bucketLabel(key) {
  if (key.includes('T')) return `${key.slice(11, 13)}:00`;
  return new Date(`${key}T00:00:00`).toLocaleDateString([], { day: 'numeric', month: 'short' });
}
