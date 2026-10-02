const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const ytSearch = require('yt-search'); 

const app = express();
app.use(cors()); 

const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

const activeRooms = {}; 
const roomTimeouts = {}; 
const searchCache = new Map(); 

app.get('/search', async (req, res) => {
    const query = req.query.q;
    if (!query) return res.json({ items: [] });
    
    if (searchCache.has(query.toLowerCase())) {
        return res.json({ items: searchCache.get(query.toLowerCase()) });
    }

    try {
        const results = await ytSearch(query);
        const videos = results.videos.slice(0, 5).map(v => ({
            id: v.videoId, title: v.title, thumbnail: v.thumbnail, author: v.author.name
        }));
        searchCache.set(query.toLowerCase(), videos);
        res.json({ items: videos });
    } catch (e) {
        console.error("Search Engine Error:", e);
        res.status(500).json({ error: 'Search failed' });
    }
});

app.get('/check-room/:code', (req, res) => {
    const code = req.params.code.toUpperCase();
    if (activeRooms[code]) res.json({ valid: true });
    else res.json({ valid: false });
});

io.on('connection', (socket) => {
    console.log(`User Connected: ${socket.id}`);

    socket.on('create_room', (data) => {
        const { roomCode, username, pfp, customRoomName, gradientIndex } = data;
        if (roomTimeouts[roomCode]) clearTimeout(roomTimeouts[roomCode]);
        
        socket.join(roomCode);
        activeRooms[roomCode] = { 
            hostId: socket.id, hostName: username, customRoomName: customRoomName || '', 
            gradientIndex: gradientIndex || 'dynamic', currentVideo: null, currentTimestamp: 0, 
            isPlaying: false, sockets: {} 
        };
        activeRooms[roomCode].sockets[socket.id] = { username, pfp };
        socket.username = username; socket.roomCode = roomCode;

        io.to(roomCode).emit('room_updated', generateRoomData(roomCode));
    });

    socket.on('join_room', (data, callback) => {
        const { roomCode, username, pfp } = data;
        if (!activeRooms[roomCode]) {
            if (callback) callback({ success: false });
            return;
        }

        if (roomTimeouts[roomCode]) clearTimeout(roomTimeouts[roomCode]);
        socket.join(roomCode);
        activeRooms[roomCode].sockets[socket.id] = { username, pfp };
        socket.username = username; socket.roomCode = roomCode;

        if (activeRooms[roomCode].hostName === username) activeRooms[roomCode].hostId = socket.id;

        io.to(roomCode).emit('room_updated', generateRoomData(roomCode));
        socket.to(roomCode).emit('toast_message', `${username} joined the room`);
        if (callback) callback({ success: true });
    });

    // RESTORED: Profile Updates
    socket.on('update_profile', (data) => {
        const { username, pfp } = data;
        socket.username = username;
        if (socket.roomCode && activeRooms[socket.roomCode]) {
            if (activeRooms[socket.roomCode].hostId === socket.id) {
                activeRooms[socket.roomCode].hostName = username;
            }
            activeRooms[socket.roomCode].sockets[socket.id] = { username, pfp };
            io.to(socket.roomCode).emit('room_updated', generateRoomData(socket.roomCode));
        }
    });

    // RESTORED: Chat Messaging
    socket.on('chat_message', (data) => {
        const { roomCode, text, pfp } = data;
        io.to(roomCode).emit('chat_message', { username: socket.username, text, pfp });
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
            if (state !== 'AD') activeRooms[roomCode].isPlaying = (state === 1);
            socket.to(roomCode).emit('sync_update', { time, state });
        }
    });

    socket.on('leave_room', () => handleUserExit(socket));
    socket.on('disconnect', () => handleUserExit(socket));

    function handleUserExit(sock) {
        if (sock.roomCode && activeRooms[sock.roomCode]) {
            const room = activeRooms[sock.roomCode];
            const exitingUser = sock.username;
            
            // STRICT HOST KILL
            if (room.hostId === sock.id) {
                io.to(sock.roomCode).emit('room_ended');
                delete activeRooms[sock.roomCode];
            } else {
                delete room.sockets[sock.id];
                sock.leave(sock.roomCode);

                const uniqueUsers = [...new Set(Object.values(room.sockets).map(u => u.username))];

                if (uniqueUsers.length === 0) {
                    roomTimeouts[sock.roomCode] = setTimeout(() => {
                        if (activeRooms[sock.roomCode] && Object.keys(activeRooms[sock.roomCode].sockets).length === 0) {
                            delete activeRooms[sock.roomCode];
                        }
                    }, 5000);
                } else {
                    io.to(sock.roomCode).emit('room_updated', generateRoomData(sock.roomCode));
                    io.to(sock.roomCode).emit('toast_message', `${exitingUser} left the room`);
                }
            }
            sock.roomCode = null; 
        }
    }

    function generateRoomData(code) {
        const room = activeRooms[code];
        // RESTORED: Passing PFP back to the frontend correctly
        const userArray = Object.values(room.sockets).map(s => ({
            name: s.username, pfp: s.pfp
        }));
        
        const uniqueUsers = Array.from(new Map(userArray.map(item => [item.name, item])).values());

        return {
            hostName: room.hostName, customRoomName: room.customRoomName,
            gradientIndex: room.gradientIndex, currentVideo: room.currentVideo,
            currentTimestamp: room.currentTimestamp, isPlaying: room.isPlaying,
            users: uniqueUsers
        };
    }
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`Syncro Backend Server running on port ${PORT}`));
