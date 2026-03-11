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

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const TRAINING_DATA_FILE = path.join(__dirname, 'public', 'training_data.json');
const DEFAULT_TRAINING_DATA = { ISL: [], ASL: [] };

// GET /api/training-data — read stored training data
app.get('/api/training-data', (req, res) => {
    try {
        if (!fs.existsSync(TRAINING_DATA_FILE)) {
            return res.json(DEFAULT_TRAINING_DATA);
        }
        const raw = fs.readFileSync(TRAINING_DATA_FILE, 'utf8');
        res.json(JSON.parse(raw));
    } catch (err) {
        console.error('Error reading training data:', err);
        res.status(500).json({ error: 'Failed to read training data' });
    }
});

// POST /api/training-data — save training data
app.post('/api/training-data', (req, res) => {
    try {
        const data = req.body;
        fs.writeFileSync(TRAINING_DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
        res.json({ success: true });
    } catch (err) {
        console.error('Error saving training data:', err);
        res.status(500).json({ error: 'Failed to save training data' });
    }
});

// POST /api/upload-sign-card — upload a sign card image
app.post('/api/upload-sign-card', (req, res) => {
    try {
        const { lang, label, imageBase64, extension } = req.body;

        if (!lang || !label || !imageBase64 || !extension) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const safeLabel = label.toLowerCase().trim().replace(/[^a-z0-9-]/g, '-');
        const langFolder = lang.toLowerCase();

        // Remove valid 'data:image/...;base64,' prefix
        const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
        const imageBuffer = Buffer.from(base64Data, 'base64');

        const uploadsDir = path.join(__dirname, 'public', 'signs-images', langFolder);

        // Ensure directory exists
        if (!fs.existsSync(uploadsDir)) {
            fs.mkdirSync(uploadsDir, { recursive: true });
        }

        // Clean up previous image formats for this label to avoid duplicates showing up incorrectly
        const formats = ['jpg', 'jpeg', 'png', 'gif', 'webp'];
        formats.forEach(ext => {
            const oldFilePath = path.join(uploadsDir, `${safeLabel}.${ext}`);
            if (fs.existsSync(oldFilePath)) {
                fs.unlinkSync(oldFilePath);
            }
        });

        const targetFilePath = path.join(uploadsDir, `${safeLabel}.${extension}`);
        fs.writeFileSync(targetFilePath, imageBuffer);

        res.json({ success: true, path: `/signs-images/${langFolder}/${safeLabel}.${extension}` });

    } catch (err) {
        console.error('Error saving sign card image:', err);
        res.status(500).json({ error: 'Failed to save sign card image' });
    }
});

// POST /api/delete-sign-card — delete a sign card image
app.post('/api/delete-sign-card', (req, res) => {
    try {
        const { lang, label } = req.body;

        if (!lang || !label) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const safeLabel = label.toLowerCase().trim().replace(/[^a-z0-9-]/g, '-');
        const langFolder = lang.toLowerCase();

        const uploadsDir = path.join(__dirname, 'public', 'signs-images', langFolder);

        let deleted = false;

        // Check and delete any matching format
        if (fs.existsSync(uploadsDir)) {
            const formats = ['jpg', 'jpeg', 'png', 'gif', 'webp'];
            formats.forEach(ext => {
                const filePath = path.join(uploadsDir, `${safeLabel}.${ext}`);
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                    deleted = true;
                }
            });
        }

        res.json({ success: true, deleted });

    } catch (err) {
        console.error('Error deleting sign card image:', err);
        res.status(500).json({ error: 'Failed to delete sign card image' });
    }
});

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
