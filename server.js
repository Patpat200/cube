const express = require('express');
const app = express();
const http = require('http').createServer(app);
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');

// Configuration Socket.io (Limite 5 Mo)
const io = require('socket.io')(http, {
    maxHttpBufferSize: 5 * 1024 * 1024 
});

app.use(express.static(path.join(__dirname, 'public')));

let players = {};
let currentBackground = null; 
let wolfId = null; 

// --- CONFIGURATION ---
// Clés API
const API_USER = process.env.SIGHTENGINE_USER; 
const API_SECRET = process.env.SIGHTENGINE_SECRET;
const API_URL = 'https://api.sightengine.com/1.0/check.json';

// Image de remplacement (Troll/Bloqué)
const BLOCKED_IMG = "https://i.redd.it/58qnz74nf5j41.png";

// Gestion Cooldowns
let uploadCooldowns = {}; 
const COOLDOWN_NORMAL = 15000; // 15 secondes
const COOLDOWN_PENALTY = 60000; // 1 minute (Punition)

let lastTagTime = 0;
const TAG_COOLDOWN = 1000; 
let lastWolfMoveTime = Date.now();

io.on('connection', (socket) => {
    console.log('Nouveau joueur : ' + socket.id);

    socket.emit('currentPlayers', players);
    socket.emit('updateWolf', wolfId);
    if (currentBackground) socket.emit('updateBackground', currentBackground);

    socket.on('joinGame', () => {
        players[socket.id] = {
            x: Math.floor(Math.random() * 500) + 50,
            y: Math.floor(Math.random() * 400) + 50,
            color: '#' + Math.floor(Math.random()*16777215).toString(16)
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

    // --- CHANGEMENT DE FOND (CORRIGÉ & ÉCONOMIQUE) ---
    socket.on('changeBackground', async (imageData) => {
        const now = Date.now();

        // 1. VERIFICATION COOLDOWN
        if (uploadCooldowns[socket.id] && now < uploadCooldowns[socket.id]) {
            const timeLeft = Math.ceil((uploadCooldowns[socket.id] - now) / 1000);
            socket.emit('uploadError', `Attends encore ${timeLeft} secondes avant d'envoyer une image.`);
            return;
        }

        if (!API_USER || !API_SECRET) {
            socket.emit('uploadError', "Erreur config serveur (Clés manquantes).");
            return;
        }

        console.log(`Analyse demandée par ${socket.id}...`);

        try {
            const base64Data = imageData.replace(/^data:image\/\w+;base64,/, "");
            const imageBuffer = Buffer.from(base64Data, 'base64');
            const form = new FormData();
            form.append('media', imageBuffer, 'image.jpg');
            
            // --- CORRECTION ICI : ON NE DEMANDE QUE LA NUDITÉ ---
            form.append('models', 'nudity'); // Coût = 1 opération
            form.append('api_user', API_USER);
            form.append('api_secret', API_SECRET);

            const response = await axios.post(API_URL, form, { headers: form.getHeaders() });
            const result = response.data;
            
            if (result.status === 'success') {
                // --- CORRECTION ICI : ON NE VÉRIFIE QUE LA NUDITÉ ---
                // On a supprimé les vérifications weapon/alcohol/offensive qui faisaient planter
                const isNude = result.nudity.raw > 0.5 || result.nudity.partial > 0.6;
                
                if (isNude) {
                    // --- CAS : IMAGE INTERDITE ---
                    console.log("⛔ Image bloquée (Nudité détectée) !");
                    
                    uploadCooldowns[socket.id] = now + COOLDOWN_PENALTY; // 1 min punition
                    currentBackground = BLOCKED_IMG;
                    io.emit('updateBackground', BLOCKED_IMG);

                    io.emit('serverMessage', {
                        text: "⚠️ Une image interdite a été bloquée ! L'auteur est puni pour 1 minute.",
                        color: "red"
                    });
                    socket.emit('uploadError', "Image interdite ! Tu es bloqué pour 1 minute.");

                } else {
                    // --- CAS : IMAGE VALIDE ---
                    console.log("✅ Image validée.");
                    
                    uploadCooldowns[socket.id] = now + COOLDOWN_NORMAL; // 15 sec attente

                    currentBackground = imageData;
                    io.emit('updateBackground', imageData);
                    
                    socket.emit('serverMessage', {
                        text: "Image changée avec succès !",
                        color: "green"
                    });
                }
            } else {
                console.error("Erreur API SightEngine:", result);
                socket.emit('uploadError', "Erreur de l'API. Réessaie.");
            }
        } catch (error) {
            console.error("Erreur technique API:", error.message);
            socket.emit('uploadError', "Erreur technique.");
        }
    });

    socket.on('changeColor', (newColor) => {
        if (players[socket.id]) {
            players[socket.id].color = newColor; 
            io.emit('updatePlayerColor', { id: socket.id, color: newColor });
        }
    });

    socket.on('disconnect', () => {
        if (players[socket.id]) removePlayer(socket.id);
        delete uploadCooldowns[socket.id];
    });
});

function removePlayer(id) {
    delete players[id];
    io.emit('playerDisconnected', id);
    if (id === wolfId) {
        const ids = Object.keys(players);
        if (ids.length > 0) {
            wolfId = ids[Math.floor(Math.random() * ids.length)];
            lastWolfMoveTime = Date.now();
            io.emit('updateWolf', wolfId);
            lastTagTime = Date.now(); 
        } else {
            wolfId = null;
            io.emit('updateWolf', null);
        }
    }
}

setInterval(() => {
    const ids = Object.keys(players);
    if (wolfId && ids.length > 1) {
        if (Date.now() - lastWolfMoveTime > 15000) { 
            io.to(wolfId).emit('afkKicked');
            removePlayer(wolfId);
        }
    }
}, 1000);

http.listen(2220, '0.0.0.0', () => {
    console.log('Serveur lancé sur le port 2220');
});
