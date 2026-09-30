const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors()); 

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*", 
        methods: ["GET", "POST"]
    }
});

// Store active rooms in server memory
const activeRooms = {}; 

app.get('/check-room/:code', (req, res) => {
    const code = req.params.code.toUpperCase();
    if (activeRooms[code]) {
        res.json({ valid: true });
    } else {
        res.json({ valid: false });
    }
});

io.on('connection', (socket) => {
    console.log(`User Connected: ${socket.id}`);

    socket.on('join_room', (data) => {
        const { roomCode, username } = data;
        
        socket.join(roomCode);
        
        if (!activeRooms[roomCode]) {
            activeRooms[roomCode] = { host: socket.id, sockets: {} };
        }
        
        // Track by unique socket ID to prevent race conditions on page reload
        activeRooms[roomCode].sockets[socket.id] = username;
        socket.username = username;
        socket.roomCode = roomCode;

        // Broadcast a clean array of unique usernames
        const uniqueUsers = [...new Set(Object.values(activeRooms[roomCode].sockets))];
        io.to(roomCode).emit('room_updated', uniqueUsers);
    });

    socket.on('disconnect', () => {
        console.log(`User Disconnected: ${socket.id}`);
        
        if (socket.roomCode && activeRooms[socket.roomCode]) {
            // Delete this specific connection's memory
            delete activeRooms[socket.roomCode].sockets[socket.id];
            
            const uniqueUsers = [...new Set(Object.values(activeRooms[socket.roomCode].sockets))];
            io.to(socket.roomCode).emit('room_updated', uniqueUsers);
            
            // If zero connections remain, destroy the room
            if (Object.keys(activeRooms[socket.roomCode].sockets).length === 0) {
                delete activeRooms[socket.roomCode];
            }
        }
    });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`Syncro Backend Server running on port ${PORT}`);
});
