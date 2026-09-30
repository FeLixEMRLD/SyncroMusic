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

// NEW: Endpoint for phones/new tabs to check if a room actually exists
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

    // User Creates or Joins a Room
    socket.on('join_room', (data) => {
        const { roomCode, username } = data;
        
        socket.join(roomCode);
        
        // Initialize room if it doesn't exist
        if (!activeRooms[roomCode]) {
            activeRooms[roomCode] = { host: socket.id, users: [] };
        }
        
        // ANTI-DUPLICATION: Only add the user if they aren't already in the list
        if (!activeRooms[roomCode].users.includes(username)) {
            activeRooms[roomCode].users.push(username);
        }

        // Store data on the socket for when they disconnect
        socket.username = username;
        socket.roomCode = roomCode;

        console.log(`${username} joined room: ${roomCode}`);
        
        // Tell everyone in the room to update their Listener List
        io.to(roomCode).emit('room_updated', activeRooms[roomCode].users);
    });

    // Clean up when someone leaves or reloads
    socket.on('disconnect', () => {
        console.log(`User Disconnected: ${socket.id}`);
        
        if (socket.roomCode && activeRooms[socket.roomCode]) {
            // Remove them from the room array
            activeRooms[socket.roomCode].users = activeRooms[socket.roomCode].users.filter(user => user !== socket.username);
            
            // Tell the remaining users to update their list
            io.to(socket.roomCode).emit('room_updated', activeRooms[socket.roomCode].users);
            
            // If the room is empty, delete it from the server
            if (activeRooms[socket.roomCode].users.length === 0) {
                delete activeRooms[socket.roomCode];
            }
        }
    });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`Syncro Backend Server running on port ${PORT}`);
});
