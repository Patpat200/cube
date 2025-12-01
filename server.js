const express = require('express');
const app = express();
const http = require('http').createServer(app);
const path = require('path');

// Configuration Socket.io
const io = require('socket.io')(http, {
    maxHttpBufferSize: 1e8 // 100Mo pour les images
});

app.use(express.static(path.join(__dirname, 'public')));

let players = {};
let currentBackground = null; 
let wolfId = null; 

// Configuration du jeu
const CUBE_SIZE = 50; 
// Marge de tolérance pour le lag (en pixels). 
// Si le loup est à moins de (50 + 60) = 110px, le serveur accepte le tag.
const TAG_TOLERANCE = 60; 
const MAX_TAG_DIST_SQ = (CUBE_SIZE + TAG_TOLERANCE) ** 2; // Distance au carré pré-calculée pour performance

io.on('connection', (socket) => {
    console.log('Nouveau joueur : ' + socket.id);

    // Création du joueur avec position aléatoire
    players[socket.id] = {
        x: Math.floor(Math.random() * 500) + 50,
        y: Math.floor(Math.random() * 400) + 50,
        color: '#' + Math.floor(Math.random()*16777215).toString(16)
    };

    // Si pas de loup, le nouveau le devient
    if (!wolfId) {
        wolfId = socket.id;
    }

    // Initialisation du client
    socket.emit('currentPlayers', players);
    socket.emit('updateWolf', wolfId);

    if (currentBackground) {
        socket.emit('updateBackground', currentBackground);
    }

    socket.broadcast.emit('newPlayer', { 
        playerId: socket.id, 
        playerInfo: players[socket.id] 
    });

    // --- GESTION DES MOUVEMENTS ---
    socket.on('playerMovement', (movementData) => {
        if (players[socket.id]) {
            players[socket.id].x = movementData.x;
            players[socket.id].y = movementData.y;
            // On renvoie juste la nouvelle pos aux autres (léger)
            socket.broadcast.emit('playerMoved', { 
                playerId: socket.id, 
                x: players[socket.id].x, 
                y: players[socket.id].y 
            });
        }
    });

    // --- GESTION DU LOUP (TAG) OPTIMISÉE ---
    socket.on('tagPlayer', (targetId) => {
        const wolf = players[socket.id];
        const target = players[targetId];

        // 1. Vérifier que c'est bien le loup actuel qui demande le tag
        // 2. Vérifier que la cible existe
        if (socket.id === wolfId && target && wolf) {
            
            // Calcul de distance optimisé (sans racine carrée pour économiser le CPU)
            const dx = wolf.x - target.x;
            const dy = wolf.y - target.y;
            const distSq = (dx * dx) + (dy * dy);

            // Vérification : est-ce qu'ils sont assez proches selon le SERVEUR ?
            if (distSq <= MAX_TAG_DIST_SQ) {
                // TAG VALIDÉ
                wolfId = targetId; 
                io.emit('updateWolf', wolfId); 
            } else {
                // TAG REFUSÉ (Le loup lag trop ou est trop loin sur le serveur)
                // On ne fait rien, le jeu continue comme si le loup avait raté.
                // console.log("Tag refusé pour cause de distance excessive");
            }
        }
    });

    // --- AUTRES ÉVÉNEMENTS ---
    socket.on('changeBackground', (imageData) => {
        currentBackground = imageData;
        io.emit('updateBackground', imageData);
    });

    socket.on('changeColor', (newColor) => {
        if (players[socket.id]) {
            players[socket.id].color = newColor; 
            io.emit('updatePlayerColor', { 
                id: socket.id, 
                color: newColor 
            });
        }
    });

    socket.on('disconnect', () => {
        delete players[socket.id];
        io.emit('playerDisconnected', socket.id);
        
        // Si le loup part, on en choisit un nouveau
        if (socket.id === wolfId) {
            const ids = Object.keys(players);
            if (ids.length > 0) {
                wolfId = ids[Math.floor(Math.random() * ids.length)];
                io.emit('updateWolf', wolfId);
            } else {
                wolfId = null;
            }
        }
        console.log('Joueur déconnecté : ' + socket.id);
    });
});

http.listen(2220, '0.0.0.0', () => {
    console.log('Serveur lancé sur le port 2220');
});
