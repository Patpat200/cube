require('dotenv').config();
const express = require('express');
const app = express();
const http = require('http').createServer(app);
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const sharp = require('sharp');
const jwt = require('jsonwebtoken');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const { ACHIEVEMENTS, SECRET_CODES } = require('./gameConfig');

// --- SÉCURITÉ : HELMET (Headers HTTP) ---
app.use(helmet({
    contentSecurityPolicy: false, // Désactivé pour éviter de bloquer les scripts inline de ton projet actuel
}));

// --- CONFIGURATION SKINS ---
const ALL_SKIN_NAMES = {};
ACHIEVEMENTS.forEach(ach => {
    if (ach.rewardSkin && ach.skinName) ALL_SKIN_NAMES[ach.rewardSkin] = ach.skinName;
});
Object.values(SECRET_CODES).forEach(code => {
    if (code.skin && code.name) ALL_SKIN_NAMES[code.skin] = code.name;
});

// --- SÉCURITÉ : SECRET JWT ---
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    console.error("🔴 ERREUR CRITIQUE : La variable JWT_SECRET est absente du fichier .env !");
    console.error("Le serveur ne peut pas démarrer de manière sécurisée.");
    process.exit(1);
}

// --- CONNEXION MONGODB ---
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('✅ Connecté à MongoDB'))
    .catch(err => console.error('❌ Erreur MongoDB:', err));

// --- MODÈLE UTILISATEUR ---
const UserSchema = new mongoose.Schema({
    pseudo: { type: String, unique: true, required: true },
    password: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
    tagsInflicted: { type: Number, default: 0 },
    timesTagged: { type: Number, default: 0 },
    gamesJoined: { type: Number, default: 0 },
    distanceTraveled: { type: Number, default: 0 },
    backgroundsChanged: { type: Number, default: 0 },
    currentSkin: { type: String, default: null },
    achievements: { type: [String], default: [] }, 
    unlockedSkins: { type: [String], default: [] },
    redeemedCodes: { type: [String], default: [] }
});
const User = mongoose.model('User', UserSchema);

const io = require('socket.io')(http, { maxHttpBufferSize: 5 * 1024 * 1024 });

// --- SÉCURITÉ : RATE LIMITING (Limitation de débit) ---
// Limiter les requêtes API générales
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limite chaque IP à 100 requêtes par fenêtre
    standardHeaders: true,
    legacyHeaders: false,
});
// Limiter drastiquement les tentatives de connexion/inscription (Brute-force protection)
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // Max 10 tentatives de création de compte ou login
    message: { success: false, message: "Trop de tentatives, réessayez plus tard." }
});

app.use(express.json({ limit: '10kb' })); // Limite la taille du body JSON
app.use(express.static(path.join(__dirname, 'public')));
app.use('/api/', apiLimiter); 

// --- FONCTION UTILITAIRE : Échapper les Regex (Anti-Injection NoSQL) ---
function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // Échappe les caractères spéciaux
}

// --- VARIABLES JEU ---
let players = {};
let currentBackground = null; 
let wolfId = null; 
let uploadCooldowns = {}; 

const API_USER = process.env.SIGHTENGINE_USER; 
const API_SECRET = process.env.SIGHTENGINE_SECRET;
const API_URL = 'https://api.sightengine.com/1.0/check.json';
const BLOCKED_IMG = "https://i.redd.it/58qnz74nf5j41.png";
const COOLDOWN_NORMAL = 15000;
const COOLDOWN_PENALTY = 60000;
let lastTagTime = 0;
const TAG_COOLDOWN = 1000; 
let lastWolfMoveTime = Date.now();

// --- HELPER: VÉRIFIER SUCCÈS ---
async function checkAchievements(user, socketId) {
    let changed = false;
    let newUnlocks = [];
    for (const ach of ACHIEVEMENTS) {
        if (!user.achievements.includes(ach.id)) {
            if (ach.condition(user)) {
                user.achievements.push(ach.id);
                if (ach.rewardSkin && !user.unlockedSkins.includes(ach.rewardSkin)) {
                    user.unlockedSkins.push(ach.rewardSkin);
                }
                newUnlocks.push(ach);
                changed = true;
            }
        }
    }
    if (changed) {
        await user.save();
        if (socketId) {
            newUnlocks.forEach(ach => {
                io.to(socketId).emit('achievementUnlocked', { name: ach.name, desc: ach.desc });
            });
            io.to(socketId).emit('updateSkins', user.unlockedSkins);
        }
    }
}

// --- HELPER: MIDDLEWARE AUTH API ---
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.sendStatus(401);
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.sendStatus(403);
        req.user = user;
        next();
    });
}

// --- ROUTES API ---

app.post('/api/register', authLimiter, async (req, res) => {
    const { pseudo, password } = req.body;
    if (!pseudo || !password) return res.json({ success: false, message: "Champs manquants." });
    if (pseudo.length > 12) return res.json({ success: false, message: "Pseudo trop long." });
    
    // Nettoyage regex pour sécurité
    const safePseudoRegex = new RegExp(`^${escapeRegExp(pseudo)}$`, 'i');

    try {
        const existingUser = await User.findOne({ pseudo: { $regex: safePseudoRegex } });
        if (existingUser) return res.json({ success: false, message: "Pseudo pris." });
        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = new User({ pseudo, password: hashedPassword });
        await newUser.save();
        res.json({ success: true });
    } catch (error) { res.json({ success: false, message: "Erreur serveur." }); }
});

app.post('/api/login', authLimiter, async (req, res) => {
    const { pseudo, password } = req.body;
    if (!pseudo || !password) return res.json({ success: false, message: "Champs manquants." });

    // Nettoyage regex pour sécurité
    const safePseudoRegex = new RegExp(`^${escapeRegExp(pseudo)}$`, 'i');

    try {
        const user = await User.findOne({ pseudo: { $regex: safePseudoRegex } });
        if (!user) return res.json({ success: false, message: "Utilisateur inconnu." });
        const match = await bcrypt.compare(password, user.password);
        if (match) {
            const token = jwt.sign({ id: user._id, pseudo: user.pseudo }, JWT_SECRET, { expiresIn: '7d' });
            res.json({ success: true, token: token, pseudo: user.pseudo });
        }
        else res.json({ success: false, message: "Mot de passe incorrect." });
    } catch (error) { res.json({ success: false, message: "Erreur serveur." }); }
});

app.get('/api/me', authenticateToken, async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('-password -__v');
        if (!user) return res.sendStatus(404);
        res.json({ success: true, pseudo: user.pseudo, stats: user });
    } catch (e) { res.sendStatus(500); }
});

app.get('/api/stats/:pseudo', async (req, res) => {
    try {
        const user = await User.findOne({ pseudo: req.params.pseudo }).select('-password -__v -_id');
        if (!user) return res.json({ success: false });
        const ratio = user.timesTagged === 0 ? user.tagsInflicted : (user.tagsInflicted / user.timesTagged).toFixed(2);
        const statsObj = user.toObject();
        statsObj.ratio = ratio;
        statsObj.distanceTraveled = Math.round(statsObj.distanceTraveled || 0);
        res.json({ success: true, stats: statsObj });
    } catch (e) { res.json({ success: false }); }
});

app.get('/api/leaderboard', async (req, res) => {
    try {
        const hunters = await User.find().sort({ tagsInflicted: -1 }).limit(10).select('pseudo tagsInflicted');
        const travelers = await User.find().sort({ distanceTraveled: -1 }).limit(10).select('pseudo distanceTraveled');
        res.json({ success: true, hunters, travelers });
    } catch (e) { res.json({ success: false }); }
});

app.get('/api/my-achievements/:pseudo', async (req, res) => {
    try {
        const user = await User.findOne({ pseudo: req.params.pseudo }).select('achievements unlockedSkins');
        if (!user) return res.json({ success: false });
        
        const list = ACHIEVEMENTS.map(ach => ({
            id: ach.id,
            name: ach.name,
            desc: ach.desc,
            unlocked: user.achievements.includes(ach.id),
            rewardSkin: ach.rewardSkin
        }));
        
        res.json({ 
            success: true, 
            achievements: list, 
            unlockedSkins: user.unlockedSkins,
            skinMap: ALL_SKIN_NAMES 
        });
    } catch (e) { res.json({ success: false }); }
});

// --- SOCKET.IO ---
async function removePlayerFromGame(socketId) {
    if (players[socketId]) {
        const p = players[socketId];
        if (p.pendingDistance > 0 && p.pseudo !== "Invité" && !p.pseudo.startsWith("Cube")) {
            try {
                const user = await User.findOne({ pseudo: p.pseudo });
                if(user) {
                    user.distanceTraveled = (user.distanceTraveled || 0) + Math.round(p.pendingDistance);
                    await checkAchievements(user, null);
                    await user.save();
                }
            } catch(e) { console.error(e); }
        }
        delete players[socketId];
        io.emit('playerDisconnected', socketId); 
        if (socketId === wolfId) {
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
}

io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (token) {
        jwt.verify(token, JWT_SECRET, (err, decoded) => {
            if (err) socket.user = null; else socket.user = decoded;
            next();
        });
    } else {
        socket.user = null;
        next();
    }
});

io.on('connection', (socket) => {
    socket.emit('currentPlayers', players);
    socket.emit('updateWolf', wolfId);
    if (currentBackground) socket.emit('updateBackground', currentBackground);

    socket.on('joinGame', async () => {
        if(players[socket.id]) return;
        let finalPseudo = "Invité";
        let userColor = '#' + Math.floor(Math.random()*16777215).toString(16);
        if (socket.user && socket.user.pseudo) {
            finalPseudo = socket.user.pseudo;
            try {
                const user = await User.findOne({ pseudo: finalPseudo }).select('currentSkin');
                if (user) {
                    await User.updateOne({ pseudo: finalPseudo }, { $inc: { gamesJoined: 1 } });
                    if (user.currentSkin) userColor = user.currentSkin; 
                }
            } catch (err) { console.error("Erreur chargement user:", err); }
        } else {
            finalPseudo = "Cube" + Math.floor(Math.random() * 1000);
        }
        players[socket.id] = {
            x: Math.floor(Math.random() * 500) + 50,
            y: Math.floor(Math.random() * 400) + 50,
            color: userColor,
            pseudo: finalPseudo,
            pendingDistance: 0
        };
        if (!wolfId) { wolfId = socket.id; lastWolfMoveTime = Date.now(); io.emit('updateWolf', wolfId); }
        socket.emit('gameJoined', { id: socket.id, info: players[socket.id] });
        socket.broadcast.emit('newPlayer', { playerId: socket.id, playerInfo: players[socket.id] });
    });

    socket.on('leaveGame', async () => { await removePlayerFromGame(socket.id); });

    socket.on('playerMovement', (movementData) => {
        if (players[socket.id]) {
            const p = players[socket.id];
            const dx = movementData.x - p.x;
            const dy = movementData.y - p.y;
            const dist = Math.sqrt(dx*dx + dy*dy);
            if (!p.pendingDistance) p.pendingDistance = 0;
            p.pendingDistance += dist;
            p.x = movementData.x;
            p.y = movementData.y;
            if (socket.id === wolfId) lastWolfMoveTime = Date.now();
            socket.broadcast.emit('playerMoved', { playerId: socket.id, x: p.x, y: p.y });
        }
    });

    socket.on('tagPlayer', async (targetId) => {
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
                    const wolfPseudo = wolf.pseudo;
                    const targetPseudo = target.pseudo;
                    if (wolfPseudo !== "Invité" && !wolfPseudo.startsWith("Cube")) {
                        const uWolf = await User.findOne({ pseudo: wolfPseudo });
                        if (uWolf) {
                            uWolf.tagsInflicted = (uWolf.tagsInflicted || 0) + 1;
                            await checkAchievements(uWolf, socket.id);
                            await uWolf.save();
                        }
                    }
                    if (targetPseudo !== "Invité" && !targetPseudo.startsWith("Cube")) {
                        const uTarget = await User.findOne({ pseudo: targetPseudo });
                        if (uTarget) {
                            uTarget.timesTagged = (uTarget.timesTagged || 0) + 1;
                            await checkAchievements(uTarget, targetId); 
                            await uTarget.save();
                        }
                    }
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
            let imageBuffer = Buffer.from(base64Data, 'base64');
            const isGif = imageBuffer.toString('ascii', 0, 3) === 'GIF';
            if (isGif) {
                const metadata = await sharp(imageBuffer).metadata();
                const totalFrames = metadata.pages || 1;
                const randomFrameIndex = Math.floor(Math.random() * totalFrames);
                imageBuffer = await sharp(imageBuffer, { page: randomFrameIndex }).png().toBuffer();
            }
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
                    if (socket.user && socket.user.pseudo) {
                         const u = await User.findOne({ pseudo: socket.user.pseudo });
                         if(u) {
                             u.backgroundsChanged = (u.backgroundsChanged || 0) + 1;
                             await checkAchievements(u, socket.id);
                             await u.save();
                         }
                    }
                }
            }
        } catch (error) { socket.emit('uploadError', "Erreur analyse image."); }
    });

    socket.on('saveSkin', async (data) => {
        if (socket.user && socket.user.pseudo && data.color) {
             await User.updateOne({ pseudo: socket.user.pseudo }, { $set: { currentSkin: data.color } });
        }
    });

    socket.on('redeemCode', async (data) => {
        const { code } = data;
        if (!socket.user || !socket.user.pseudo) {
            socket.emit('codeError', "Connecte-toi d'abord !");
            return;
        }
        const pseudo = socket.user.pseudo;
        const cleanCode = code.trim().toUpperCase();
        if (SECRET_CODES[cleanCode]) {
            const reward = SECRET_CODES[cleanCode];
            const user = await User.findOne({ pseudo });
            if (user) {
                if (!user.redeemedCodes) user.redeemedCodes = [];
                if (user.redeemedCodes.includes(cleanCode)) {
                    socket.emit('codeError', "Code déjà utilisé !");
                } else {
                    user.redeemedCodes.push(cleanCode);
                    if (!user.unlockedSkins.includes(reward.skin)) {
                        user.unlockedSkins.push(reward.skin);
                        await user.save();
                        socket.emit('codeSuccess', `Skin débloqué : ${reward.name}`);
                        socket.emit('updateSkins', user.unlockedSkins);
                    } else {
                        socket.emit('codeError', "Tu as déjà ce skin !");
                        await user.save(); 
                    }
                }
            }
        } else {
            socket.emit('codeError', "Code invalide.");
        }
    });

    socket.on('disconnect', async () => {
        await removePlayerFromGame(socket.id);
        delete uploadCooldowns[socket.id];
    });
});

setInterval(() => {
    const ids = Object.keys(players);
    if (wolfId && ids.length > 1) {
        if (Date.now() - lastWolfMoveTime > 15000) { 
            console.log(`Loup AFK (${wolfId}) -> Kick.`);
            io.to(wolfId).emit('forceLobby', 'afk'); 
            removePlayerFromGame(wolfId);
        }
    }
}, 1000);

setInterval(async () => {
    console.log("💾 Sauvegarde auto distances...");
    for (const id in players) {
        const p = players[id];
        if (p.pendingDistance > 0 && p.pseudo !== "Invité" && !p.pseudo.startsWith("Cube")) {
            try {
                const user = await User.findOne({ pseudo: p.pseudo });
                if(user) {
                    user.distanceTraveled = (user.distanceTraveled || 0) + Math.round(p.pendingDistance);
                    await checkAchievements(user, id);
                    await user.save(); 
                }
                p.pendingDistance = 0;
            } catch (err) { console.error(`Erreur save dist ${p.pseudo}:`, err); }
        }
    }
}, 60 * 60 * 1000);

const PORT = process.env.PORT || 2220;
http.listen(PORT, '0.0.0.0', () => {
    console.log(`Serveur lancé sur le port ${PORT}`);
});
