const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    cors: { origin: "*" }
});
const path = require('path');

app.use(express.static(path.join(__dirname, 'public')));

io.on("connection", socket => {
    console.log(`User connected: ${socket.id}`);

    socket.on("join-room", room => {
        socket.join(room);
        const clients = io.sockets.adapter.rooms.get(room) ? io.sockets.adapter.rooms.get(room).size : 0;
        console.log(`User ${socket.id} joined room ${room}. Total clients: ${clients}`);
        socket.to(room).emit("user-joined", socket.id);
    });

    socket.on("offer", data => {
        socket.to(data.room).emit("offer", data);
    });

    socket.on("answer", data => {
        socket.to(data.room).emit("answer", data);
    });

    socket.on("ice", data => {
        socket.to(data.room).emit("ice", data);
    });

    socket.on("sign-message", data => {
        socket.to(data.room).emit("sign-message", data);
    });

    socket.on("chat-message", data => {
        const room = data.room;
        const clients = io.sockets.adapter.rooms.get(room) ? io.sockets.adapter.rooms.get(room).size : 0;
        console.log(`Chat message in room ${room} from ${socket.id}. Clients in room: ${clients}`);
        socket.to(room).emit("chat-message", data);
    });

    socket.on("speech-message", data => {
        socket.to(data.room).emit("speech-message", data);
    });

    socket.on("volume-level", data => {
        socket.to(data.room).emit("volume-level", data);
    });

    socket.on("emoji-pop", data => {
        socket.to(data.room).emit("emoji-pop", data);
    });

    socket.on("disconnecting", () => {
        socket.rooms.forEach(room => {
            if (room !== socket.id) {
                socket.to(room).emit("user-left", socket.id);
            }
        });
    });

    socket.on("disconnect", () => {
        console.log(`User disconnected: ${socket.id}`);
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
