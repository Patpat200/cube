require('dotenv').config();
const express = require('express');
const app = express();
const http = require('http').createServer(app);
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');

// --- CONNEXION MONGODB ---
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('✅ Connecté à MongoDB'))
    .catch(err => console.error('❌ Erreur MongoDB:', err));

// --- MODÈLE UTILISATEUR ---
const UserSchema = new mongoose.Schema({
    pseudo: { type: String, unique: true, required: true },
    password: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model('User', UserSchema);

// Configuration Socket.io
const io = require('socket.io')(http, {
    maxHttpBufferSize: 5 * 1024 * 1024 
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- VARIABLES JEU ---
let players = {};
let currentBackground = null; 
let wolfId = null; 

const API_USER = process.env.SIGHTENGINE_USER; 
const API_SECRET = process.env.SIGHTENGINE_SECRET;
const API_URL = 'https://api.sightengine.com/1.0/check.json';
const BLOCKED_IMG = "https://i.redd.it/58qnz74nf5j41.png";

let uploadCooldowns = {}; 
const COOLDOWN_NORMAL = 15000;
const COOLDOWN_PENALTY = 60000;
let lastTagTime = 0;
const TAG_COOLDOWN = 1000; 
let lastWolfMoveTime = Date.now();


// --- ROUTES AUTH ---
app.post('/api/register', async (req, res) => {
    const { pseudo, password } = req.body;
    if (!pseudo || !password) return res.json({ success: false, message: "Champs manquants." });
    if (pseudo.length > 12) return res.json({ success: false, message: "Pseudo trop long." });

    try {
        const existingUser = await User.findOne({ pseudo: { $regex: new RegExp(`^${pseudo}$`, 'i') } });
        if (existingUser) return res.json({ success: false, message: "Pseudo pris." });

        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = new User({ pseudo, password: hashedPassword });
        await newUser.save();
        res.json({ success: true });
    } catch (error) { res.json({ success: false, message: "Erreur serveur." }); }
});

app.post('/api/login', async (req, res) => {
    const { pseudo, password } = req.body;
    try {
        const user = await User.findOne({ pseudo: { $regex: new RegExp(`^${pseudo}$`, 'i') } });
        if (!user) return res.json({ success: false, message: "Utilisateur inconnu." });

        const match = await bcrypt.compare(password, user.password);
        if (match) res.json({ success: true, pseudo: user.pseudo });
        else res.json({ success: false, message: "Mot de passe incorrect." });
    } catch (error) { res.json({ success: false, message: "Erreur serveur." }); }
});


// --- SOCKET.IO ---
io.on('connection', (socket) => {
    console.log('Nouveau socket : ' + socket.id);

    socket.emit('currentPlayers', players);
    socket.emit('updateWolf', wolfId);
    if (currentBackground) socket.emit('updateBackground', currentBackground);

    socket.on('joinGame', (pseudoSent) => {
        let finalPseudo = "Invité";
        if (pseudoSent && typeof pseudoSent === 'string' && pseudoSent.trim().length > 0) {
            finalPseudo = pseudoSent.trim().substring(0, 12);
        } else {
            finalPseudo = "Cube" + Math.floor(Math.random() * 1000);
        }

        players[socket.id] = {
            x: Math.floor(Math.random() * 500) + 50,
            y: Math.floor(Math.random() * 400) + 50,
            color: '#' + Math.floor(Math.random()*16777215).toString(16),
            pseudo: finalPseudo 
        };

        if (!wolfId) {
            wolfId = socket.id;
            lastWolfMoveTime = Date.now();
            io.emit('updateWolf', wolfId);
        }

        socket.emit('gameJoined', { id: socket.id, info: players[socket.id] });
        socket.broadcast.emit('newPlayer', { playerId: socket.id, playerInfo: players[socket.id] });
    });

    socket.on('playerMovement', (movementData) => {
        if (players[socket.id]) {
            players[socket.id].x = movementData.x;
            players[socket.id].y = movementData.y;
            if (socket.id === wolfId) lastWolfMoveTime = Date.now();
            socket.broadcast.emit('playerMoved', { playerId: socket.id, x: players[socket.id].x, y: players[socket.id].y });
        }
    });

    socket.on('tagPlayer', (targetId) => {
        if (socket.id === wolfId && players[targetId]) {
            const now = Date.now();
            const wolf = players[socket.id];
            const target = players[targetId];
            const dx = Math.abs(wolf.x - target.x);
            const dy = Math.abs(wolf.y - target.y);

            if (dx < 90 && dy < 90) {
                if (now - lastTagTime > TAG_COOLDOWN) {
                    wolfId = targetId;
                    lastTagTime = now;
                    lastWolfMoveTime = Date.now(); 
                    io.emit('updateWolf', wolfId);
                    io.emit('playerTagged', { x: target.x + 25, y: target.y + 25, color: target.color });
                }
            }
        }
    });

    socket.on('changeBackground', async (imageData) => {
        const now = Date.now();
        if (uploadCooldowns[socket.id] && now < uploadCooldowns[socket.id]) {
            const timeLeft = Math.ceil((uploadCooldowns[socket.id] - now) / 1000);
            socket.emit('uploadError', `Attends encore ${timeLeft}s.`);
            return;
        }
        if (!API_USER || !API_SECRET) {
            socket.emit('uploadError', "Analyse d'image désactivée.");
            return;
        }

        try {
            const base64Data = imageData.replace(/^data:image\/\w+;base64,/, "");
            const imageBuffer = Buffer.from(base64Data, 'base64');
            const form = new FormData();
            form.append('media', imageBuffer, 'image.jpg');
            form.append('models', 'nudity'); 
            form.append('api_user', API_USER);
            form.append('api_secret', API_SECRET);

            const response = await axios.post(API_URL, form, { headers: form.getHeaders() });
            const result = response.data;
            
            if (result.status === 'success') {
                const isNude = result.nudity.raw > 0.5 || result.nudity.partial > 0.6;
                if (isNude) {
                    uploadCooldowns[socket.id] = now + COOLDOWN_PENALTY; 
                    currentBackground = BLOCKED_IMG;
                    io.emit('updateBackground', BLOCKED_IMG);
                    socket.emit('uploadError', "Image interdite ! Bloqué 1 min.");
                } else {
                    uploadCooldowns[socket.id] = now + COOLDOWN_NORMAL; 
                    currentBackground = imageData;
                    io.emit('updateBackground', imageData);
                }
            }
        } catch (error) {
            socket.emit('uploadError', "Erreur analyse image.");
        }
    });

    socket.on('changeColor', (newColor) => {
        if (players[socket.id]) {
            players[socket.id].color = newColor; 
            io.emit('updatePlayerColor', { id: socket.id, color: newColor });
        }
    });

    socket.on('disconnect', () => {
        if (players[socket.id]) {
            delete players[socket.id];
            io.emit('playerDisconnected', socket.id);
            if (socket.id === wolfId) {
                const ids = Object.keys(players);
                if (ids.length > 0) {
                    wolfId = ids[Math.floor(Math.random() * ids.length)];
                    io.emit('updateWolf', wolfId);
                    lastWolfMoveTime = Date.now();
                } else {
                    wolfId = null;
                    io.emit('updateWolf', null);
                }
            }
        }
        delete uploadCooldowns[socket.id];
    });
});

// --- GESTION AFK ---
setInterval(() => {
    const ids = Object.keys(players);
    if (wolfId && ids.length > 1) {
        if (Date.now() - lastWolfMoveTime > 15000) { 
            console.log(`Loup AFK (${wolfId}) -> Expulsion.`);
            
            // 1. On prévient le client
            io.to(wolfId).emit('afkKicked');
            
            // 2. On attend un tout petit peu (100ms) pour être sûr qu'il reçoive le message
            setTimeout(() => {
                const socketDuLoup = io.sockets.sockets.get(wolfId);
                if (socketDuLoup) {
                    socketDuLoup.disconnect(true);
                }
            }, 100);
        }
    }
}, 1000);

const PORT = process.env.PORT || 2220;
http.listen(PORT, '0.0.0.0', () => {
    console.log(`Serveur lancé sur le port ${PORT}`);
});
