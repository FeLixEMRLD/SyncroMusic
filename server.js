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

app.get('/search', async (req, res) => {
    const query = req.query.q;
    if (!query) return res.json({ items: [] });
    try {
        const r = await ytSearch(query);
        const videos = r.videos.slice(0, 8);
        const results = videos.map(v => ({
            id: v.videoId,
            title: v.title,
            thumbnail: v.thumbnail,
            author: v.author.name
        }));
        res.json({ items: results });
    } catch (e) {
        console.error("Search error:", e);
        res.status(500).json({ error: 'Search failed.' });
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
        const { roomCode, username, color, customRoomName, gradientIndex } = data;
        if (roomTimeouts[roomCode]) clearTimeout(roomTimeouts[roomCode]);
        
        socket.join(roomCode);
        activeRooms[roomCode] = { 
            hostId: socket.id, hostName: username, customRoomName: customRoomName || '', 
            gradientIndex: gradientIndex || 'dynamic', currentVideo: null,
            currentTitle: 'Waiting for host...', currentThumbnail: null,
            sockets: {} 
        };
        activeRooms[roomCode].sockets[socket.id] = { username, color, inAd: false, time: 0, state: -1 };
        socket.username = username; socket.roomCode = roomCode;

        io.to(roomCode).emit('room_updated', generateRoomData(roomCode));
    });

    socket.on('join_room', (data, callback) => {
        const { roomCode, username, color } = data;
        if (!activeRooms[roomCode]) {
            if (callback) callback({ success: false });
            return;
        }

        if (roomTimeouts[roomCode]) clearTimeout(roomTimeouts[roomCode]);
        socket.join(roomCode);
        activeRooms[roomCode].sockets[socket.id] = { username, color, inAd: false, time: 0, state: -1 };
        socket.username = username; socket.roomCode = roomCode;

        if (activeRooms[roomCode].hostName === username) activeRooms[roomCode].hostId = socket.id;

        io.to(roomCode).emit('room_updated', generateRoomData(roomCode));
        socket.to(roomCode).emit('toast_message', `${username} joined the room`);
        if (callback) callback({ success: true });
    });

    socket.on('update_profile', (data) => {
        const { username, color } = data;
        socket.username = username;
        if (socket.roomCode && activeRooms[socket.roomCode]) {
            if (activeRooms[socket.roomCode].hostId === socket.id) {
                activeRooms[socket.roomCode].hostName = username;
            }
            if (activeRooms[socket.roomCode].sockets[socket.id]) {
                activeRooms[socket.roomCode].sockets[socket.id].username = username;
                activeRooms[socket.roomCode].sockets[socket.id].color = color;
            }
            io.to(socket.roomCode).emit('room_updated', generateRoomData(socket.roomCode));
        }
    });

    socket.on('change_gradient', (data) => {
        const { roomCode, gradientIndex } = data;
        if (activeRooms[roomCode]) {
            activeRooms[roomCode].gradientIndex = gradientIndex;
            io.to(roomCode).emit('gradient_updated', gradientIndex);
        }
    });

    socket.on('load_song', (videoData) => {
        const roomCode = socket.roomCode;
        if (activeRooms[roomCode] && activeRooms[roomCode].hostId === socket.id) {
            const id = videoData.id || videoData;
            activeRooms[roomCode].currentVideo = id;
            activeRooms[roomCode].currentTitle = videoData.title || 'Playing Song';
            activeRooms[roomCode].currentThumbnail = videoData.thumbnail || `https://img.youtube.com/vi/${id}/hqdefault.jpg`;
            
            Object.keys(activeRooms[roomCode].sockets).forEach(sockId => {
                activeRooms[roomCode].sockets[sockId].inAd = false;
            });
            
            io.to(roomCode).emit('song_loaded', {
                id: activeRooms[roomCode].currentVideo,
                title: activeRooms[roomCode].currentTitle,
                thumbnail: activeRooms[roomCode].currentThumbnail
            });
        }
    });

    // CRITICAL FIX: The Sync Loop
    socket.on('player_status', (data) => {
        const roomCode = data.roomCode;
        const room = activeRooms[roomCode];
        if (!room || !room.sockets[socket.id]) return;

        const user = room.sockets[socket.id];
        
        const expectedVid = room.currentVideo;
        if (expectedVid && data.actualVideoId && data.actualVideoId !== expectedVid) {
            user.inAd = true;
        } else {
            user.inAd = false;
        }
        
        user.time = data.time;
        user.state = data.state;

        const usersInAd = Object.values(room.sockets).filter(u => u.inAd).map(u => u.username);

        if (usersInAd.length > 0) {
            io.to(roomCode).emit('global_ad_wait', { waitingOn: usersInAd });
        } 
        // THIS LINE FIXES THE STUTTER: The server now ONLY broadcasts sync commands if the Host sends them.
        else if (socket.id === room.hostId && expectedVid) {
            io.to(roomCode).emit('sync_update', {
                time: user.time,
                state: user.state,
                hostTimestamp: data.timestamp
            });
        }
    });

    socket.on('leave_room', () => handleUserExit(socket));
    socket.on('disconnect', () => handleUserExit(socket));

    function handleUserExit(sock) {
        if (sock.roomCode && activeRooms[sock.roomCode]) {
            const room = activeRooms[sock.roomCode];
            const exitingUser = sock.username;
            
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
        const userArray = Object.values(room.sockets).map(s => ({
            name: s.username, color: s.color
        }));
        const uniqueUsers = Array.from(new Map(userArray.map(item => [item.name, item])).values());

        return {
            hostName: room.hostName, customRoomName: room.customRoomName,
            gradientIndex: room.gradientIndex, currentVideo: room.currentVideo,
            currentTitle: room.currentTitle, currentThumbnail: room.currentThumbnail,
            users: uniqueUsers
        };
    }
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`Syncro Backend Server running on port ${PORT}`));
