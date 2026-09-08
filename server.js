const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }, // In production, restrict this to your actual domain
});

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

const rooms = {}; // { "123456": { "<socketId>": { userName, lat, lng } } }

function generateRoomCode() {
  let code;
  do {
    code = Math.floor(100000 + Math.random() * 900000).toString();
  } while (rooms[code]);
  return code;
}

function getParticipantCount(roomCode) {
  return rooms[roomCode] ? Object.keys(rooms[roomCode]).length : 0;
}

function getParticipantsList(roomCode) {
  const room = rooms[roomCode];
  if (!room) return [];
  return Object.entries(room).map(([socketId, data]) => ({
    id: socketId,
    userName: data.userName,
    lat: data.lat,
    lng: data.lng,
  }));
}

io.on('connection', (socket) => {
  socket.data.roomCode = null;
  socket.data.userName = null;

  socket.on('createRoom', ({ userName }, callback) => {
    if (!userName || typeof userName !== 'string' || !userName.trim()) {
      return callback({ ok: false, error: 'A valid user name is required.' });
    }
    const roomCode = generateRoomCode();
    rooms[roomCode] = {};
    socket.join(roomCode);
    socket.data.roomCode = roomCode;
    socket.data.userName = userName.trim();
    rooms[roomCode][socket.id] = { userName: socket.data.userName, lat: null, lng: null };

    callback({
      ok: true,
      roomCode,
      participantCount: getParticipantCount(roomCode),
      participants: getParticipantsList(roomCode),
    });
    io.to(roomCode).emit('participantCount', getParticipantCount(roomCode));
  });

  socket.on('joinRoom', ({ userName, roomCode }, callback) => {
    if (!userName || typeof userName !== 'string' || !userName.trim()) {
      return callback({ ok: false, error: 'A valid user name is required.' });
    }
    if (!roomCode || !rooms[roomCode]) {
      return callback({ ok: false, error: 'Room not found. Check the code and try again.' });
    }
    socket.join(roomCode);
    socket.data.roomCode = roomCode;
    socket.data.userName = userName.trim();
    rooms[roomCode][socket.id] = { userName: socket.data.userName, lat: null, lng: null };

    callback({
      ok: true,
      roomCode,
      participantCount: getParticipantCount(roomCode),
      participants: getParticipantsList(roomCode).filter((p) => p.id !== socket.id),
    });

    socket.to(roomCode).emit('participantJoined', { id: socket.id, userName: socket.data.userName });
    io.to(roomCode).emit('participantCount', getParticipantCount(roomCode));
  });

  socket.on('locationUpdate', ({ lat, lng, userName }) => {
    const roomCode = socket.data.roomCode;
    if (!roomCode || !rooms[roomCode]) return;
    if (typeof lat !== 'number' || typeof lng !== 'number') return;

    rooms[roomCode][socket.id] = { userName: userName || socket.data.userName, lat, lng };

    socket.to(roomCode).emit('locationUpdate', {
      id: socket.id,
      userName: rooms[roomCode][socket.id].userName,
      lat,
      lng,
    });
  });

  socket.on('disconnect', () => {
    const roomCode = socket.data.roomCode;
    if (!roomCode || !rooms[roomCode]) return;

    delete rooms[roomCode][socket.id];

    if (Object.keys(rooms[roomCode]).length === 0) {
      delete rooms[roomCode];
      return;
    }

    io.to(roomCode).emit('participantLeft', { id: socket.id });
    io.to(roomCode).emit('participantCount', getParticipantCount(roomCode));
  });
});

server.listen(PORT, () => {
  console.log(`Location-sharing server running on http://localhost:${PORT}`);
});