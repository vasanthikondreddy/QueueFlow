import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';

/**
 * Joins the queue's room and forwards server-pushed snapshots.
 * Handlers live in refs so listeners are registered exactly once per (socket, queue)
 * and are always removed on cleanup -> no duplicate subscriptions.
 */
export function useQueueSocket(queueId, { onState, onDeleted, onReconnect }) {
  const { socket } = useAuth();
  const [connected, setConnected] = useState(Boolean(socket?.connected));
  const handlers = useRef({});
  handlers.current = { onState, onDeleted, onReconnect };

  useEffect(() => {
    if (!socket || !queueId) return undefined;
    let first = true;
    const join = () => socket.emit('queue:join', queueId, () => {});
    const handleUpdated = (state) => state?.queue?.id === queueId && handlers.current.onState?.(state);
    const handleDeleted = (p) => p?.queueId === queueId && handlers.current.onDeleted?.();
    const handleConnect = () => {
      setConnected(true);
      join();
      if (!first) handlers.current.onReconnect?.(); // missed events while offline -> refetch
      first = false;
    };
    const handleDisconnect = () => setConnected(false);

    socket.on('queue:updated', handleUpdated);
    socket.on('queue:deleted', handleDeleted);
    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    if (socket.connected) { setConnected(true); join(); first = false; }

    return () => {
      socket.off('queue:updated', handleUpdated);
      socket.off('queue:deleted', handleDeleted);
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.emit('queue:leave', queueId);
    };
  }, [socket, queueId]);

  return { connected };
}

/** Re-runs `refetch` whenever any of the manager's queues change (counts on list pages). */
export function useQueuesChanged(refetch) {
  const { socket } = useAuth();
  const ref = useRef(refetch);
  ref.current = refetch;
  useEffect(() => {
    if (!socket) return undefined;
    const h = () => ref.current();
    socket.on('queues:changed', h);
    socket.on('connect', h);
    return () => { socket.off('queues:changed', h); socket.off('connect', h); };
  }, [socket]);
}

/** Ticks every second so waiting durations stay live. */
export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
