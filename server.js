const express = require('express');
const app = express();
const http = require('http').createServer(app);
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');

// Configuration Socket.io
// On peut accepter des images un peu plus grosses (5 Mo) car ce n'est pas nous qui analysons
const io = require('socket.io')(http, {
    maxHttpBufferSize: 5 * 1024 * 1024 
});

app.use(express.static(path.join(__dirname, 'public')));

let players = {};
let currentBackground = null; 
let wolfId = null; 


// --- CONFIGURATION API DE MODÉRATION ---
// On récupère les clés depuis les variables d'environnement (sécurisé)
const API_USER = process.env.SIGHTENGINE_USER; 
const API_SECRET = process.env.SIGHTENGINE_SECRET;
const API_URL = 'https://api.sightengine.com/1.0/check.json';

// Petit check de sécurité au démarrage pour t'aider à débugger
if (!API_USER || !API_SECRET) {
    console.warn("⚠️ ATTENTION : Les clés API SightEngine ne sont pas configurées !");
}

// Gestion du jeu
let lastTagTime = 0;
const TAG_COOLDOWN = 1000; 
let lastWolfMoveTime = Date.now();

io.on('connection', (socket) => {
    console.log('Nouveau spectateur : ' + socket.id);

    // Envoi de l'état actuel (Lobby)
    socket.emit('currentPlayers', players);
    socket.emit('updateWolf', wolfId);
    if (currentBackground) {
        socket.emit('updateBackground', currentBackground);
    }

    // Le joueur clique sur "JOUER"
    socket.on('joinGame', () => {
        console.log('Joueur rejoint la partie : ' + socket.id);
        
        players[socket.id] = {
            x: Math.floor(Math.random() * 500) + 50,
            y: Math.floor(Math.random() * 400) + 50,
            color: '#' + Math.floor(Math.random()*16777215).toString(16)
        };

        // Si c'est le premier joueur, il devient loup
        if (!wolfId) {
            wolfId = socket.id;
            lastWolfMoveTime = Date.now();
            io.emit('updateWolf', wolfId);
        }

        // On le notifie lui et les autres
        socket.emit('gameJoined', { id: socket.id, info: players[socket.id] });
        socket.broadcast.emit('newPlayer', { playerId: socket.id, playerInfo: players[socket.id] });
    });

    // Mouvement
    socket.on('playerMovement', (movementData) => {
        if (players[socket.id]) {
            players[socket.id].x = movementData.x;
            players[socket.id].y = movementData.y;

            // Si le loup bouge, on reset son chrono AFK
            if (socket.id === wolfId) {
                lastWolfMoveTime = Date.now();
            }

            socket.broadcast.emit('playerMoved', { 
                playerId: socket.id, 
                x: players[socket.id].x, 
                y: players[socket.id].y 
            });
        }
    });

    // Tag (Touché)
    socket.on('tagPlayer', (targetId) => {
        if (socket.id === wolfId && players[targetId]) {
            const now = Date.now();
            const wolf = players[socket.id];
            const target = players[targetId];
            
            // Vérification distance
            const dx = Math.abs(wolf.x - target.x);
            const dy = Math.abs(wolf.y - target.y);

            if (dx < 90 && dy < 90) { // Tolérance simple
                if (now - lastTagTime > TAG_COOLDOWN) {
                    wolfId = targetId;
                    lastTagTime = now;
                    lastWolfMoveTime = Date.now(); // Reset pour le nouveau loup
                    
                    io.emit('updateWolf', wolfId);
                    io.emit('playerTagged', {
                        x: target.x + 25,
                        y: target.y + 25,
                        color: target.color
                    });
                }
            }
        }
    });

    // --- CHANGEMENT DE FOND AVEC MODÉRATION API ---
    socket.on('changeBackground', async (imageData) => {
        // 1. Vérification si les clés sont configurées
        if (API_USER === 'TON_API_USER') {
            socket.emit('uploadError', "Serveur mal configuré (Clés API manquantes).");
            return;
        }

        console.log(`Analyse image demandée par ${socket.id}...`);

        try {
            // 2. Préparation de l'image pour l'envoi
            // On retire l'en-tête base64 pour avoir le buffer pur
            const base64Data = imageData.replace(/^data:image\/\w+;base64,/, "");
            const imageBuffer = Buffer.from(base64Data, 'base64');

            // Création du formulaire virtuel
            const form = new FormData();
            form.append('media', imageBuffer, 'image.jpg');
            // On demande de vérifier : nudité, armes, alcool, offensive, etc.
            form.append('models', 'nudity,wad,offensive,scam'); 
            form.append('api_user', API_USER);
            form.append('api_secret', API_SECRET);

            // 3. Envoi à l'API
            const response = await axios.post(API_URL, form, {
                headers: form.getHeaders()
            });

            const result = response.data;
            
            // 4. Analyse de la réponse (Logique SightEngine)
            if (result.status === 'success') {
                // Scores de 0 à 1. Si > 0.5, c'est détecté.
                
                // Vérification Nudité (Raw = explicite, Partial = maillot/sous-vêtement)
                const isNude = result.nudity.raw > 0.5 || result.nudity.partial > 0.6;
                
                // Vérification Violence/Armes/Drogues
                const isWeapon = result.weapon > 0.5;
                const isAlcohol = result.alcohol > 0.5;
                const isOffensive = result.offensive.prob > 0.5;

                if (isNude || isWeapon || isAlcohol || isOffensive) {
                    console.log("⛔ Image bloquée par l'API !");
                    socket.emit('uploadError', "Image refusée : Contenu inapproprié détecté.");
                } else {
                    console.log("✅ Image validée par l'API.");
                    currentBackground = imageData;
                    io.emit('updateBackground', imageData);
                }
            } else {
                console.error("Erreur API :", result);
                // Par sécurité, en cas d'erreur API, on peut choisir de bloquer ou laisser passer.
                // Ici on bloque et on demande de réessayer.
                socket.emit('uploadError', "Erreur de vérification externe. Réessaie.");
            }

        } catch (error) {
            console.error("Erreur requête API:", error.message);
            socket.emit('uploadError', "Problème de connexion au service de modération.");
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
            removePlayer(socket.id);
        }
        console.log('Déconnexion : ' + socket.id);
    });
});

// Suppression propre d'un joueur
function removePlayer(id) {
    delete players[id];
    io.emit('playerDisconnected', id);
    
    // Si c'était le loup, on en désigne un nouveau
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

// --- SYSTÈME ANTI-AFK ---
setInterval(() => {
    const ids = Object.keys(players);
    // On kick si le LOUP est inactif et qu'il y a plus d'1 joueur
    if (wolfId && ids.length > 1) {
        const now = Date.now();
        // 30 secondes sans mouvement
        if (now - lastWolfMoveTime > 30000) { 
            console.log("Loup AFK - Expulsion du joueur : " + wolfId);
            
            // On prévient le joueur qu'il est kické
            io.to(wolfId).emit('afkKicked');
            
            // On le supprime
            removePlayer(wolfId);
        }
    }
}, 1000);

http.listen(2220, '0.0.0.0', () => {
    console.log('Serveur lancé sur le port 2220');
});
