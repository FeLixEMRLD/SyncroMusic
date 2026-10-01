const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors()); 

const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

const activeRooms = {}; 
const roomTimeouts = {}; // NEW: Holds rooms open during a refresh

app.get('/check-room/:code', (req, res) => {
    const code = req.params.code.toUpperCase();
    if (activeRooms[code]) res.json({ valid: true });
    else res.json({ valid: false });
});

io.on('connection', (socket) => {
    console.log(`User Connected: ${socket.id}`);

    socket.on('create_room', (data) => {
        const { roomCode, username, customRoomName, gradientIndex } = data;
        
        // Clear any deletion timeout if recreating fast
        if (roomTimeouts[roomCode]) clearTimeout(roomTimeouts[roomCode]);
        
        socket.join(roomCode);
        
        activeRooms[roomCode] = { 
            hostId: socket.id, 
            hostName: username, 
            customRoomName: customRoomName || '', 
            gradientIndex: gradientIndex || 0,
            currentVideo: null, 
            currentTimestamp: 0, 
            isPlaying: false,    
            sockets: {} 
        };
        activeRooms[roomCode].sockets[socket.id] = username;
        
        socket.username = username;
        socket.roomCode = roomCode;

        io.to(roomCode).emit('room_updated', generateRoomData(roomCode));
    });

    socket.on('join_room', (data, callback) => {
        const { roomCode, username } = data;
        
        if (!activeRooms[roomCode]) {
            if (callback) callback({ success: false });
            return;
        }

        // Cancel destruction if someone joins/reconnects
        if (roomTimeouts[roomCode]) clearTimeout(roomTimeouts[roomCode]);

        socket.join(roomCode);
        activeRooms[roomCode].sockets[socket.id] = username;
        socket.username = username;
        socket.roomCode = roomCode;

        // If the returning user is the host, reassign their hostId
        if (activeRooms[roomCode].hostName === username) {
            activeRooms[roomCode].hostId = socket.id;
        }

        io.to(roomCode).emit('room_updated', generateRoomData(roomCode));
        socket.to(roomCode).emit('toast_message', `${username} joined the room`);
        
        if (callback) callback({ success: true });
    });

    socket.on('change_gradient', (data) => {
        const { roomCode, gradientIndex } = data;
        if (activeRooms[roomCode]) {
            activeRooms[roomCode].gradientIndex = gradientIndex;
            io.to(roomCode).emit('gradient_updated', gradientIndex);
        }
    });

    socket.on('load_song', (data) => {
        const { roomCode, videoId } = data;
        if (activeRooms[roomCode] && activeRooms[roomCode].hostId === socket.id) {
            activeRooms[roomCode].currentVideo = videoId;
            activeRooms[roomCode].currentTimestamp = 0;
            activeRooms[roomCode].isPlaying = true;
            io.to(roomCode).emit('song_loaded', videoId);
        }
    });

    socket.on('sync_time', (data) => {
        const { roomCode, time, state } = data;
        if (activeRooms[roomCode] && activeRooms[roomCode].hostId === socket.id) {
            activeRooms[roomCode].currentTimestamp = time;
            activeRooms[roomCode].isPlaying = (state === 1);
            socket.to(roomCode).emit('sync_update', { time, state });
        }
    });

    socket.on('leave_room', () => handleUserExit(socket));
    socket.on('disconnect', () => handleUserExit(socket));

    function handleUserExit(sock) {
        if (sock.roomCode && activeRooms[sock.roomCode]) {
            const room = activeRooms[sock.roomCode];
            const exitingUser = sock.username;
            
            delete room.sockets[sock.id];
            sock.leave(sock.roomCode);

            const uniqueUsers = [...new Set(Object.values(room.sockets))];

            if (uniqueUsers.length === 0) {
                // If room is empty (e.g. Host refreshed), wait 5 seconds before destroying it
                roomTimeouts[sock.roomCode] = setTimeout(() => {
                    if (activeRooms[sock.roomCode] && Object.keys(activeRooms[sock.roomCode].sockets).length === 0) {
                        delete activeRooms[sock.roomCode];
                    }
                }, 5000);
            } else {
                io.to(sock.roomCode).emit('room_updated', generateRoomData(sock.roomCode));
                io.to(sock.roomCode).emit('toast_message', `${exitingUser} left the room`);
            }
            sock.roomCode = null; 
        }
    }

    function generateRoomData(code) {
        const room = activeRooms[code];
        return {
            hostName: room.hostName,
            customRoomName: room.customRoomName,
            gradientIndex: room.gradientIndex,
            currentVideo: room.currentVideo,
            currentTimestamp: room.currentTimestamp,
            isPlaying: room.isPlaying,
            users: [...new Set(Object.values(room.sockets))]
        };
    }
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`Syncro Backend Server running on port ${PORT}`));
