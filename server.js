const WebSocket = require('ws');

const PORT = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port: PORT });

// roomCode -> { host: WebSocket, client: WebSocket }
const rooms = new Map();

console.log(`NeoMC relay server started on port ${PORT}`);

// FIX: periodic cleanup of stale empty rooms (safety net)
setInterval(() => {
  for (const [code, room] of rooms.entries()) {
    const hostDead  = !room.host   || room.host.readyState   !== WebSocket.OPEN;
    const clientDead = !room.client || room.client.readyState !== WebSocket.OPEN;
    if (hostDead && clientDead) {
      rooms.delete(code);
      console.log(`[${code}] Stale room cleaned up`);
    }
  }
}, 30000);

wss.on('connection', (ws) => {
  let role     = null;
  let roomCode = null;

  ws.on('message', (data, isBinary) => {
    // First message is always a JSON handshake
    if (role === null) {
      try {
        const msg = JSON.parse(data.toString());
        roomCode = msg.room.toUpperCase();
        role     = msg.type; // 'host' or 'join'

        if (!rooms.has(roomCode)) rooms.set(roomCode, {});
        const room = rooms.get(roomCode);

        if (role === 'host') {
          // FIX: if a host reconnects to an existing room, replace cleanly
          if (room.host && room.host.readyState === WebSocket.OPEN) {
            console.log(`[${roomCode}] Host replaced (previous host still connected)`);
            room.host.close();
          }
          room.host = ws;
          ws.send(JSON.stringify({ status: 'waiting', room: roomCode }));
          console.log(`[${roomCode}] Host connected`);

          // If client was already waiting, notify both
          if (room.client && room.client.readyState === WebSocket.OPEN) {
            room.host.send(JSON.stringify({ status: 'connected' }));
            room.client.send(JSON.stringify({ status: 'connected' }));
            console.log(`[${roomCode}] Both connected (client was waiting)`);
          }

        } else if (role === 'join') {
          // FIX: reject a second client joining the same room
          if (room.client && room.client.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ status: 'room_full' }));
            console.log(`[${roomCode}] Client rejected — room full`);
            ws.close();
            return;
          }
          room.client = ws;
          console.log(`[${roomCode}] Client connected`);

          if (room.host && room.host.readyState === WebSocket.OPEN) {
            room.host.send(JSON.stringify({ status: 'connected' }));
            room.client.send(JSON.stringify({ status: 'connected' }));
            console.log(`[${roomCode}] Both connected`);
          } else {
            // FIX: don't set room.client for a no_host response — close and clean up
            ws.send(JSON.stringify({ status: 'no_host' }));
            console.log(`[${roomCode}] No host found`);
            // client will close itself; close handler will clean up room.client
          }
        }
      } catch (e) {
        console.error('Bad handshake:', e.message);
        ws.close();
      }
      return;
    }

    // After handshake: forward raw data to the other side
    const room = rooms.get(roomCode);
    if (!room) return;

    const other = role === 'host' ? room.client : room.host;
    if (other && other.readyState === WebSocket.OPEN) {
      other.send(data, { binary: isBinary });
    }
  });

  ws.on('close', () => {
    if (!roomCode || !rooms.has(roomCode)) return;
    const room = rooms.get(roomCode);

    // FIX: only delete if this socket is still the one in the room
    // (prevents a reconnecting host/client from wiping the new socket)
    const other = role === 'host' ? room.client : room.host;

    if (role === 'host'   && room.host   === ws) delete room.host;
    if (role === 'join'   && room.client === ws) delete room.client;

    if (!room.host && !room.client) {
      rooms.delete(roomCode);
      console.log(`[${roomCode}] Room closed`);
    }

    // Notify the other side
    if (other && other.readyState === WebSocket.OPEN) {
      other.send(JSON.stringify({ status: 'disconnected' }));
    }
  });

  ws.on('error', (e) => console.error('WS error:', e.message));
});
