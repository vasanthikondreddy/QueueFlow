import { io } from 'socket.io-client';
import { API_URL } from './client';

let socket = null;

export function connectSocket(token) {
  if (socket) socket.disconnect();
  socket = io(API_URL, { auth: { token }, reconnection: true, reconnectionDelayMax: 5000 });
  return socket;
}

export function disconnectSocket() {
  if (socket) socket.disconnect();
  socket = null;
}
