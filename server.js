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
        
        // If room is new, the first person is the Host
        if (!activeRooms[roomCode]) {
            activeRooms[roomCode] = { hostId: socket.id, hostName: username, sockets: {} };
        }
        
        activeRooms[roomCode].sockets[socket.id] = username;
        socket.username = username;
        socket.roomCode = roomCode;

        // Send back an object containing the Host's name AND the user list
        const uniqueUsers = [...new Set(Object.values(activeRooms[roomCode].sockets))];
        io.to(roomCode).emit('room_updated', {
            hostName: activeRooms[roomCode].hostName,
            users: uniqueUsers
        });
    });

    // NEW: Explicitly handle when a user clicks Leave/End
    socket.on('leave_room', () => {
        handleUserExit(socket);
    });

    socket.on('disconnect', () => {
        handleUserExit(socket);
    });

    function handleUserExit(sock) {
        if (sock.roomCode && activeRooms[sock.roomCode]) {
            const room = activeRooms[sock.roomCode];
            
            // If the HOST leaves, destroy the room and kick everyone
            if (room.hostId === sock.id) {
                io.to(sock.roomCode).emit('room_ended');
                delete activeRooms[sock.roomCode];
            } else {
                // If a GUEST leaves, just remove them and update the list
                delete room.sockets[sock.id];
                sock.leave(sock.roomCode); // Disconnect from the socket channel
                
                const uniqueUsers = [...new Set(Object.values(room.sockets))];
                io.to(sock.roomCode).emit('room_updated', {
                    hostName: room.hostName,
                    users: uniqueUsers
                });
                
                if (Object.keys(room.sockets).length === 0) {
                    delete activeRooms[sock.roomCode];
                }
            }
            sock.roomCode = null; // Clear their current room state
        }
    }
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`Syncro Backend Server running on port ${PORT}`);
});
