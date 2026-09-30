const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors()); // Allows your GitHub Pages site to talk to this server

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*", // We will restrict this to your GitHub Pages URL later for security
        methods: ["GET", "POST"]
    }
});

// Store active rooms in server memory
const activeRooms = {}; 

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
        activeRooms[roomCode].users.push(username);

        console.log(`${username} joined room: ${roomCode}`);
        
        // Tell everyone in the room to update their Listener List
        io.to(roomCode).emit('room_updated', activeRooms[roomCode].users);
    });

    // Handle Disconnects
    socket.on('disconnect', () => {
        console.log(`User Disconnected: ${socket.id}`);
        // Logic to remove user from their room will go here
    });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`Syncro Backend Server running on port ${PORT}`);
});
