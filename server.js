const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    cors: { origin: "*" },
    transports: ['websocket', 'polling'] // Prioritize websockets
});
const path = require('path');
const fs = require('fs');



// --- Production Middleware ---
// Redirect HTTP to HTTPS (Required for Camera/Mic/Speech to work)
app.use((req, res, next) => {
    if (req.headers['x-forwarded-proto'] === 'http') {
        return res.redirect(`https://${req.headers.host}${req.url}`);
    }
    next();
});

app.use(express.json({ limit: '50mb' })); // Allow large payloads for training data

// --- API for Local Data Storage ---
const getFilePath = (lang) => {
    const safeLang = (lang || 'ISL').replace(/[^a-zA-Z0-9]/g, ''); // Sanitize
    return path.join(__dirname, 'public', `training_data_${safeLang}.json`);
};

app.get('/api/data', (req, res) => {
    const filePath = getFilePath(req.query.lang);
    if (fs.existsSync(filePath)) {
        fs.readFile(filePath, 'utf8', (err, data) => {
            if (err) {
                console.error("Error reading data file:", err);
                return res.status(500).json({ error: "Failed to read data" });
            }
            try {
                const json = JSON.parse(data);
                res.json(json);
            } catch (e) {
                console.error("Error parsing data file:", e);
                res.json([]); // Return empty if corrupted
            }
        });
    } else {
        res.json([]); // No data yet
    }
});

app.post('/api/data', (req, res) => {
    const filePath = getFilePath(req.query.lang);
    const data = req.body;
    fs.writeFile(filePath, JSON.stringify(data, null, 2), (err) => {
        if (err) {
            console.error("Error writing data file:", err);
            return res.status(500).json({ error: "Failed to save data" });
        }
        console.log(`Saved ${data.length} training samples to ${filePath}`);
        res.json({ success: true, count: data.length });
    });
});

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
