const express = require('express');
const app = express();
const http = require('http').createServer(app);
const path = require('path');

// Configuration Socket.io
const io = require('socket.io')(http, {
    maxHttpBufferSize: 1e8
});

app.use(express.static(path.join(__dirname, 'public')));

let players = {};
let currentBackground = null; 
let wolfId = null; 

// Gestion du Cooldown
let lastTagTime = 0;
const TAG_COOLDOWN = 1000; 

// Suivi du dernier mouvement du loup
let lastWolfMoveTime = Date.now();

io.on('connection', (socket) => {
    console.log('Nouveau spectateur : ' + socket.id);

    // 1. On envoie l'état actuel (background + joueurs) au spectateur
    socket.emit('currentPlayers', players);
    socket.emit('updateWolf', wolfId);
    if (currentBackground) {
        socket.emit('updateBackground', currentBackground);
    }

    // 2. Le joueur demande à rejoindre la partie
    socket.on('joinGame', () => {
        console.log('Joueur rejoint la partie : ' + socket.id);
        
        // Création du joueur
        players[socket.id] = {
            x: Math.floor(Math.random() * 500) + 50,
            y: Math.floor(Math.random() * 400) + 50,
            color: '#' + Math.floor(Math.random()*16777215).toString(16)
        };

        // Gestion du premier loup
        if (!wolfId) {
            wolfId = socket.id;
            lastWolfMoveTime = Date.now();
            io.emit('updateWolf', wolfId);
        }

        // On renvoie ses infos au joueur lui-même
        socket.emit('gameJoined', { 
            id: socket.id, 
            info: players[socket.id] 
        });

        // On prévient les autres
        socket.broadcast.emit('newPlayer', { 
            playerId: socket.id, 
            playerInfo: players[socket.id] 
        });
    });

    socket.on('playerMovement', (movementData) => {
        // Sécurité : on ne bouge que si le joueur existe (a cliqué sur Play)
        if (players[socket.id]) {
            players[socket.id].x = movementData.x;
            players[socket.id].y = movementData.y;

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

    // --- GESTION DU TAG ---
    socket.on('tagPlayer', (targetId) => {
        if (socket.id === wolfId && players[targetId]) {
            const now = Date.now();
            const wolf = players[socket.id];
            const target = players[targetId];
            const CUBE_SIZE = 50; 
            const TOLERANCE = 40; 

            const dx = Math.abs(wolf.x - target.x);
            const dy = Math.abs(wolf.y - target.y);

            if (dx < (CUBE_SIZE + TOLERANCE) && dy < (CUBE_SIZE + TOLERANCE)) {
                if (now - lastTagTime > TAG_COOLDOWN) {
                    wolfId = targetId;
                    lastTagTime = now;
                    lastWolfMoveTime = Date.now();
                    
                    io.emit('updateWolf', wolfId);
                    
                    io.emit('playerTagged', {
                        x: target.x + (CUBE_SIZE / 2),
                        y: target.y + (CUBE_SIZE / 2),
                        color: target.color
                    });
                }
            }
        }
    });

    socket.on('changeBackground', (imageData) => {
        currentBackground = imageData;
        io.emit('updateBackground', imageData);
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

// Fonction utilitaire pour supprimer un joueur proprement
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

// --- BOUCLE ANTI-AFK ---
setInterval(() => {
    const ids = Object.keys(players);
    // On kick si le LOUP est inactif et qu'il y a plus d'1 joueur
    if (wolfId && ids.length > 1) {
        const now = Date.now();
        if (now - lastWolfMoveTime > 15000) { // 15 secondes
            console.log("Loup AFK - Expulsion du joueur : " + wolfId);
            
            // On envoie un message spécifique au joueur AFK pour le remettre au menu
            io.to(wolfId).emit('afkKicked');
            
            // On le supprime du jeu
            removePlayer(wolfId);
        }
    }
}, 1000);

http.listen(2220, '0.0.0.0', () => {
    console.log('Serveur lancé sur le port 2220');
});
