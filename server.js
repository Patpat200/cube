const express = require('express');
const app = express();
const http = require('http').createServer(app);
const path = require('path');

// Configuration Socket.io (Max buffer 10Mo pour les images)
const io = require('socket.io')(http, {
    maxHttpBufferSize: 1e7 
});

app.use(express.static(path.join(__dirname, 'public')));

let players = {};
let currentBackground = null; 
let wolfId = null; // [NOUVEAU] Stocke l'ID du loup actuel

io.on('connection', (socket) => {
    console.log('Nouveau joueur : ' + socket.id);

    // Création du joueur
    players[socket.id] = {
        x: Math.floor(Math.random() * 500) + 50,
        y: Math.floor(Math.random() * 400) + 50,
        color: '#' + Math.floor(Math.random()*16777215).toString(16)
    };

    // [NOUVEAU] Si pas de loup, le nouveau devient le loup
    if (!wolfId) {
        wolfId = socket.id;
    }

    // Envoyer la liste des joueurs
    socket.emit('currentPlayers', players);
    
    // [NOUVEAU] Dire au nouveau qui est le loup
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
            socket.broadcast.emit('playerMoved', { 
                playerId: socket.id, 
                x: players[socket.id].x, 
                y: players[socket.id].y 
            });
        }
    });

    // --- [NOUVEAU] GESTION DU LOUP (TAG) ---
    socket.on('tagPlayer', (targetId) => {
        // Sécurité : seul le loup actuel peut toucher quelqu'un
        if (socket.id === wolfId && players[targetId]) {
            wolfId = targetId; // Le touché devient le loup
            io.emit('updateWolf', wolfId); // On prévient tout le monde
        }
    });

    // --- GESTION DU FOND D'ÉCRAN ---
    socket.on('changeBackground', (imageData) => {
        currentBackground = imageData;
        io.emit('updateBackground', imageData);
    });

    // --- GESTION DE LA COULEUR ---
    socket.on('changeColor', (newColor) => {
        if (players[socket.id]) {
            players[socket.id].color = newColor; 
            io.emit('updatePlayerColor', { 
                id: socket.id, 
                color: newColor 
            });
        }
    });

    // --- DÉCONNEXION ---
    socket.on('disconnect', () => {
        delete players[socket.id];
        io.emit('playerDisconnected', socket.id);
        
        // [NOUVEAU] Si le loup part, on en désigne un autre au hasard
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
