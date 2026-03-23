const WebSocket = require('ws');

const PORT = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port: PORT });

// roomCode -> { host: WebSocket, client: WebSocket }
const rooms = new Map();

console.log(`NeoMC relay server started on port ${PORT}`);

wss.on('connection', (ws) => {
  let role = null;
  let roomCode = null;

  ws.on('message', (data, isBinary) => {
    // First message is always a JSON handshake
    if (role === null) {
      try {
        const msg = JSON.parse(data.toString());
        roomCode = msg.room.toUpperCase();
        role = msg.type; // 'host' or 'join'

        if (!rooms.has(roomCode)) rooms.set(roomCode, {});
        const room = rooms.get(roomCode);

        if (role === 'host') {
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
          room.client = ws;
          console.log(`[${roomCode}] Client connected`);

          if (room.host && room.host.readyState === WebSocket.OPEN) {
            room.host.send(JSON.stringify({ status: 'connected' }));
            room.client.send(JSON.stringify({ status: 'connected' }));
            console.log(`[${roomCode}] Both connected`);
          } else {
            ws.send(JSON.stringify({ status: 'no_host' }));
            console.log(`[${roomCode}] No host found`);
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
    const other = role === 'host' ? room.client : room.host;

    if (role === 'host') delete room.host;
    else if (role === 'join') delete room.client;

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
