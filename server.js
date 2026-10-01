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

    // Create Room - Now includes Gradient Index
    socket.on('create_room', (data) => {
        const { roomCode, username, customRoomName, gradientIndex } = data;
        socket.join(roomCode);
        
        activeRooms[roomCode] = { 
            hostId: socket.id, 
            hostName: username, 
            customRoomName: customRoomName || '', 
            gradientIndex: gradientIndex || 0,
            sockets: {} 
        };
        activeRooms[roomCode].sockets[socket.id] = username;
        
        socket.username = username;
        socket.roomCode = roomCode;

        io.to(roomCode).emit('room_updated', {
            hostName: activeRooms[roomCode].hostName,
            customRoomName: activeRooms[roomCode].customRoomName,
            gradientIndex: activeRooms[roomCode].gradientIndex,
            users: [username]
        });
    });

    // Join Room
    socket.on('join_room', (data, callback) => {
        const { roomCode, username } = data;
        
        if (!activeRooms[roomCode]) {
            if (callback) callback({ success: false });
            return;
        }

        socket.join(roomCode);
        activeRooms[roomCode].sockets[socket.id] = username;
        socket.username = username;
        socket.roomCode = roomCode;

        const uniqueUsers = [...new Set(Object.values(activeRooms[roomCode].sockets))];
        io.to(roomCode).emit('room_updated', {
            hostName: activeRooms[roomCode].hostName,
            customRoomName: activeRooms[roomCode].customRoomName,
            gradientIndex: activeRooms[roomCode].gradientIndex,
            users: uniqueUsers
        });
        
        socket.to(roomCode).emit('toast_message', `${username} joined the room`);
        
        if (callback) callback({ success: true });
    });

    // NEW: Real-time Gradient Sync
    socket.on('change_gradient', (data) => {
        const { roomCode, gradientIndex } = data;
        if (activeRooms[roomCode]) {
            activeRooms[roomCode].gradientIndex = gradientIndex;
            io.to(roomCode).emit('gradient_updated', gradientIndex);
        }
    });

    socket.on('leave_room', () => handleUserExit(socket));
    socket.on('disconnect', () => handleUserExit(socket));

    function handleUserExit(sock) {
        if (sock.roomCode && activeRooms[sock.roomCode]) {
            const room = activeRooms[sock.roomCode];
            
            if (room.hostId === sock.id) {
                io.to(sock.roomCode).emit('room_ended');
                delete activeRooms[sock.roomCode];
            } else {
                const exitingUser = sock.username;
                delete room.sockets[sock.id];
                sock.leave(sock.roomCode);
                
                const uniqueUsers = [...new Set(Object.values(room.sockets))];
                io.to(sock.roomCode).emit('room_updated', {
                    hostName: room.hostName,
                    customRoomName: room.customRoomName,
                    gradientIndex: room.gradientIndex,
                    users: uniqueUsers
                });
                
                io.to(sock.roomCode).emit('toast_message', `${exitingUser} left the room`);
                
                if (Object.keys(room.sockets).length === 0) {
                    delete activeRooms[sock.roomCode];
                }
            }
            sock.roomCode = null; 
        }
    }
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`Syncro Backend Server running on port ${PORT}`));
