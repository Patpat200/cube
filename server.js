require('dotenv').config();
const express = require('express');
const app = express();
app.set('trust proxy', 1);
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

// --- SÉCURITÉ : HELMET ---
app.use(helmet({
    contentSecurityPolicy: false,
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
    console.error("🔴 ERREUR CRITIQUE : JWT_SECRET manquant !");
    process.exit(1);
}

// --- CONNEXION MONGODB ---
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('✅ Connecté à MongoDB'))
    .catch(err => console.error('❌ Erreur MongoDB:', err));

// --- MODÈLES ---

// 1. UTILISATEUR
const UserSchema = new mongoose.Schema({
    pseudo: { type: String, unique: true, required: true },
    password: { type: String, required: true },
    isAdmin: { type: Boolean, default: false },
    isBanned: { type: Boolean, default: false },
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

// 2. LOGS ADMIN
const LogSchema = new mongoose.Schema({
    action: String,
    admin: String,
    target: String,
    details: String,
    timestamp: { type: Date, default: Date.now }
});
const Log = mongoose.model('Log', LogSchema);

// 3. BANS IP
const BannedIpSchema = new mongoose.Schema({
    ip: String,
    reason: String,
    date: { type: Date, default: Date.now }
});
const BannedIP = mongoose.model('BannedIP', BannedIpSchema);

// 4. STATS CONNEXION (Graphiques)
const ConnStatSchema = new mongoose.Schema({
    count: Number,
    timestamp: { type: Date, default: Date.now }
});
const ConnStat = mongoose.model('ConnStat', ConnStatSchema);


const io = require('socket.io')(http, { maxHttpBufferSize: 5 * 1024 * 1024 });

// --- VARIABLES JEU ---
let players = {};
let currentBackground = null; 
let wolfId = null; 
let uploadCooldowns = {}; 

// VARIABLES ADMIN
let maintenanceMode = false;
// Suppression de la variable godModeAdmins

const API_USER = process.env.SIGHTENGINE_USER; 
const API_SECRET = process.env.SIGHTENGINE_SECRET;
const API_URL = 'https://api.sightengine.com/1.0/check.json';
const BLOCKED_IMG = "https://i.redd.it/58qnz74nf5j41.png";
const COOLDOWN_NORMAL = 15000;
const COOLDOWN_PENALTY = 60000;
let lastTagTime = 0;
const TAG_COOLDOWN = 1000; 
let lastWolfMoveTime = Date.now();

// --- HELPERS ---
async function addLog(action, admin, target, details) {
    try { await Log.create({ action, admin, target, details }); } catch(e) { console.error(e); }
}

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

// MIDDLEWARES
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, message: { success: false, message: "Trop de tentatives." } });
const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100, standardHeaders: true, legacyHeaders: false });

app.use(express.json({ limit: '10kb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/api/', apiLimiter); 

function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

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

const verifyAdmin = async (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.sendStatus(401);

    jwt.verify(token, JWT_SECRET, async (err, decoded) => {
        if (err) return res.sendStatus(403);
        try {
            const user = await User.findById(decoded.id);
            if (!user || !user.isAdmin) return res.status(403).json({ success: false, message: "Accès refusé." });
            req.user = user;
            next();
        } catch (e) { res.sendStatus(500); }
    });
};

// --- ROUTES AUTH ---

app.post('/api/register', authLimiter, async (req, res) => {
    const { pseudo, password } = req.body;
    
    // Vérif IP
    const ip = req.ip;
    const banned = await BannedIP.findOne({ ip });
    if (banned) return res.json({ success: false, message: "IP Bannie." });

    if (!pseudo || !password) return res.json({ success: false, message: "Champs manquants." });
    if (pseudo.length > 12) return res.json({ success: false, message: "Pseudo trop long." });
    
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
    
    const ip = req.ip;
    const banned = await BannedIP.findOne({ ip });
    if (banned) return res.json({ success: false, message: "IP Bannie." });
    
    if (maintenanceMode) {
        const u = await User.findOne({ pseudo });
        if (u && !u.isAdmin) return res.json({ success: false, message: "Maintenance en cours." });
    }

    if (!pseudo || !password) return res.json({ success: false, message: "Champs manquants." });
    const safePseudoRegex = new RegExp(`^${escapeRegExp(pseudo)}$`, 'i');

    try {
        const user = await User.findOne({ pseudo: { $regex: safePseudoRegex } });
        if (!user) return res.json({ success: false, message: "Utilisateur inconnu." });
        
        if (user.isBanned) return res.json({ success: false, message: "Ce compte est banni." });

        const match = await bcrypt.compare(password, user.password);
        if (match) {
            const token = jwt.sign({ id: user._id, pseudo: user.pseudo }, JWT_SECRET, { expiresIn: '7d' });
            res.json({ success: true, token: token, pseudo: user.pseudo, isAdmin: user.isAdmin });
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

// --- ROUTES STATS PUBLIQUES ---
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
            id: ach.id, name: ach.name, desc: ach.desc,
            unlocked: user.achievements.includes(ach.id), rewardSkin: ach.rewardSkin
        }));
        
        res.json({ success: true, achievements: list, unlockedSkins: user.unlockedSkins, skinMap: ALL_SKIN_NAMES });
    } catch (e) { res.json({ success: false }); }
});

// --- ROUTES ADMIN ---

// 1. Dashboard
app.get('/api/admin/dashboard', verifyAdmin, async (req, res) => {
    try {
        const totalUsers = await User.countDocuments();
        const onlineCount = Object.keys(players).length;
        const history = await ConnStat.find().sort({ timestamp: -1 }).limit(24);
        const logs = await Log.find().sort({ timestamp: -1 }).limit(50);
        
        res.json({ 
            success: true, 
            totalUsers, 
            onlineCount, 
            history: history.reverse(), 
            logs, 
            maintenance: maintenanceMode 
        });
    } catch(e) { res.status(500).json({ success: false }); }
});

// 2. Liste Users
app.get('/api/admin/users', verifyAdmin, async (req, res) => {
    try {
        const users = await User.find().select('-password');
        res.json({ success: true, users });
    } catch (e) { res.status(500).json({ success: false }); }
});

// 3. Modifier User (Stats, Skins, Ban, Mdp)
app.post('/api/admin/update-user', verifyAdmin, async (req, res) => {
    const { userId, updates } = req.body;
    try {
        const target = await User.findById(userId);
        if(!target) return res.json({ success: false });
        if(target.isAdmin && updates.isBanned) return res.json({ success: false, message: "Impossible de bannir un admin." });

        if (updates.newPassword && updates.newPassword.trim() !== "") {
            updates.password = await bcrypt.hash(updates.newPassword, 10);
            delete updates.newPassword;
        } else { delete updates.newPassword; }

        await User.findByIdAndUpdate(userId, { $set: updates });
        await addLog('UPDATE', req.user.pseudo, target.pseudo, `Modifs: ${Object.keys(updates).join(',')}`);
        
        if (updates.isBanned) {
             const sockets = await io.fetchSockets();
             for (const s of sockets) {
                 if (s.user && s.user.pseudo === target.pseudo) {
                     s.emit('forceLobby', 'banned'); s.disconnect(true);
                 }
             }
        }
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

// 4. Supprimer User
app.delete('/api/admin/user/:id', verifyAdmin, async (req, res) => {
    try {
        const target = await User.findById(req.params.id);
        if(target && target.isAdmin) return res.json({ success: false, message: "Admin protégé." });
        await User.findByIdAndDelete(req.params.id);
        await addLog('DELETE', req.user.pseudo, target ? target.pseudo : '?', "Compte supprimé");
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false }); }
});

// 5. Actions Serveur
app.post('/api/admin/action', verifyAdmin, async (req, res) => {
    const { type, payload } = req.body;
    try {
        if (type === 'MAINTENANCE') {
            maintenanceMode = !maintenanceMode;
            io.emit('serverMessage', { text: maintenanceMode ? "🔒 Serveur en MAINTENANCE" : "🟢 Serveur OUVERT", color: 'orange' });
            if (maintenanceMode) {
                const sockets = await io.fetchSockets();
                for (const s of sockets) {
                    let isAdmin = false;
                    if(s.user) {
                         const u = await User.findById(s.user.id);
                         if(u && u.isAdmin) isAdmin = true;
                    }
                    if(!isAdmin) { s.emit('forceLobby', 'maintenance'); s.disconnect(true); }
                }
            }
            await addLog('MAINTENANCE', req.user.pseudo, 'SERVEUR', `État: ${maintenanceMode}`);
        }
        else if (type === 'BROADCAST') {
            io.emit('serverMessage', { text: `📢 ADMIN : ${payload.message}`, color: 'red' });
            await addLog('BROADCAST', req.user.pseudo, 'ALL', payload.message);
        }
        else if (type === 'WHISPER') {
            const sockets = await io.fetchSockets();
            let found = false;
            for (const s of sockets) {
                if (s.user && s.user.pseudo === payload.targetPseudo) {
                    s.emit('serverMessage', { text: `💬 MP Admin : ${payload.message}`, color: 'purple' });
                    found = true;
                }
            }
            if(!found) return res.json({success:false, message:"Joueur introuvable."});
            await addLog('WHISPER', req.user.pseudo, payload.targetPseudo, payload.message);
        }
        else if (type === 'KICK') {
            const sockets = await io.fetchSockets();
            for (const s of sockets) {
                if ((s.user && s.user.pseudo === payload.targetPseudo) || (!s.user && payload.targetPseudo.startsWith("Cube") && players[s.id])) {
                    s.emit('forceLobby', 'kick'); s.disconnect(true);
                }
            }
            await addLog('KICK', req.user.pseudo, payload.targetPseudo, "Expulsé");
        }
        else if (type === 'BAN_IP') {
            const sockets = await io.fetchSockets();
            let targetIp = null;
            for (const s of sockets) {
                if (s.user && s.user.pseudo === payload.targetPseudo) {
                    targetIp = s.handshake.address;
                    if(s.handshake.headers['x-forwarded-for']) targetIp = s.handshake.headers['x-forwarded-for'].split(',')[0];
                    s.emit('forceLobby', 'banned'); s.disconnect(true);
                    break;
                }
            }
            if (targetIp) {
                await BannedIP.create({ ip: targetIp, reason: "Banni par admin" });
                await addLog('BAN_IP', req.user.pseudo, payload.targetPseudo, `IP: ${targetIp}`);
            } else return res.json({ success: false, message: "IP introuvable." });
        }
        res.json({ success: true });
    } catch(e) { console.error(e); res.status(500).json({ success: false }); }
});



// --- GESTION IP BANNIES (NOUVEAU) ---
app.get('/api/admin/banned-ips', verifyAdmin, async (req, res) => {
    try {
        const list = await BannedIP.find().sort({ date: -1 });
        res.json({ success: true, list });
    } catch(e) { res.status(500).json({ success: false }); }
});

app.post('/api/admin/unban-ip', verifyAdmin, async (req, res) => {
    try {
        const { id } = req.body;
        await BannedIP.findByIdAndDelete(id);
        await addLog('UNBAN_IP', req.user.pseudo, 'IP', 'IP débannie');
        res.json({ success: true });
    } catch(e) { res.status(500).json({ success: false }); }
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
        // Suppression du nettoyage godMode
        io.emit('playerDisconnected', socketId); 
        if (socketId === wolfId) {
            const ids = Object.keys(players);
            if (ids.length > 0) {
                wolfId = ids[Math.floor(Math.random() * ids.length)];
                io.emit('updateWolf', wolfId);
                lastWolfMoveTime = Date.now();
            } else {
                wolfId = null; io.emit('updateWolf', null);
            }
        }
    }
}

io.use(async (socket, next) => {
    let ip = socket.handshake.address;
    if(socket.handshake.headers['x-forwarded-for']) ip = socket.handshake.headers['x-forwarded-for'].split(',')[0];
    const banned = await BannedIP.findOne({ ip });
    if(banned) return next(new Error("IP Bannie"));

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

io.on('connection', async (socket) => {
    if (maintenanceMode) {
        let isAdmin = false;
        if(socket.user) {
             const u = await User.findById(socket.user.id);
             if(u && u.isAdmin) isAdmin = true;
        }
        if (!isAdmin) { socket.emit('forceLobby', 'maintenance'); socket.disconnect(); return; }
    }

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
                const user = await User.findOne({ pseudo: finalPseudo });
                if (user) {
                    if (user.isBanned) { socket.emit('forceLobby', 'banned'); socket.disconnect(); return; }
                    await User.updateOne({ pseudo: finalPseudo }, { $inc: { gamesJoined: 1 } });
                    if (user.currentSkin) userColor = user.currentSkin; 
                }
            } catch (err) { }
        } else { finalPseudo = "Cube" + Math.floor(Math.random() * 1000); }
        players[socket.id] = { x: Math.floor(Math.random() * 500) + 50, y: Math.floor(Math.random() * 400) + 50, color: userColor, pseudo: finalPseudo, pendingDistance: 0 };
        if (!wolfId) { wolfId = socket.id; lastWolfMoveTime = Date.now(); io.emit('updateWolf', wolfId); }
        socket.emit('gameJoined', { id: socket.id, info: players[socket.id] });
        socket.broadcast.emit('newPlayer', { playerId: socket.id, playerInfo: players[socket.id] });
    });

    socket.on('leaveGame', async () => { await removePlayerFromGame(socket.id); });

    // Suppression de socket.on('toggleGodMode')

    socket.on('playerMovement', (movementData) => {
        if (players[socket.id]) {
            const p = players[socket.id];
            const dx = movementData.x - p.x;
            const dy = movementData.y - p.y;
            const dist = Math.sqrt(dx*dx + dy*dy);
            if (!p.pendingDistance) p.pendingDistance = 0;
            p.pendingDistance += dist;
            p.x = movementData.x; p.y = movementData.y;
            if (socket.id === wolfId) lastWolfMoveTime = Date.now();
            socket.broadcast.emit('playerMoved', { playerId: socket.id, x: p.x, y: p.y });
        }
    });

    socket.on('tagPlayer', async (targetId) => {
        if (socket.id === wolfId && players[targetId]) {
            // Suppression de la vérification godModeAdmins
            const now = Date.now();
            const wolf = players[socket.id]; const target = players[targetId];
            const dx = Math.abs(wolf.x - target.x); const dy = Math.abs(wolf.y - target.y);
            if (dx < 90 && dy < 90) {
                if (now - lastTagTime > TAG_COOLDOWN) {
                    wolfId = targetId; lastTagTime = now; lastWolfMoveTime = Date.now(); 
                    io.emit('updateWolf', wolfId); io.emit('playerTagged', { x: target.x + 25, y: target.y + 25, color: target.color });
                    const wolfPseudo = wolf.pseudo; const targetPseudo = target.pseudo;
                    if (wolfPseudo !== "Invité" && !wolfPseudo.startsWith("Cube")) {
                        const uWolf = await User.findOne({ pseudo: wolfPseudo });
                        if (uWolf) { uWolf.tagsInflicted++; await checkAchievements(uWolf, socket.id); await uWolf.save(); }
                    }
                    if (targetPseudo !== "Invité" && !targetPseudo.startsWith("Cube")) {
                        const uTarget = await User.findOne({ pseudo: targetPseudo });
                        if (uTarget) { uTarget.timesTagged++; await checkAchievements(uTarget, targetId); await uTarget.save(); }
                    }
                }
            }
        }
    });

    socket.on('changeBackground', async (imageData) => {
        const now = Date.now();
        if (uploadCooldowns[socket.id] && now < uploadCooldowns[socket.id]) { socket.emit('uploadError', `Attends encore ${Math.ceil((uploadCooldowns[socket.id] - now) / 1000)}s.`); return; }
        if (!API_USER || !API_SECRET) { socket.emit('uploadError', "Analyse d'image désactivée."); return; }
        try {
            const base64Data = imageData.replace(/^data:image\/\w+;base64,/, "");
            let imageBuffer = Buffer.from(base64Data, 'base64');
            const isGif = imageBuffer.toString('ascii', 0, 3) === 'GIF';
            if (isGif) {
                const metadata = await sharp(imageBuffer).metadata();
                imageBuffer = await sharp(imageBuffer, { page: Math.floor(Math.random() * (metadata.pages||1)) }).png().toBuffer();
            }
            const form = new FormData();
            form.append('media', imageBuffer, 'image.jpg');
            form.append('models', 'nudity'); form.append('api_user', API_USER); form.append('api_secret', API_SECRET);
            const response = await axios.post(API_URL, form, { headers: form.getHeaders() });
            if (response.data.status === 'success') {
                if (response.data.nudity.raw > 0.5 || response.data.nudity.partial > 0.6) {
                    uploadCooldowns[socket.id] = now + COOLDOWN_PENALTY; 
                    currentBackground = BLOCKED_IMG; io.emit('updateBackground', BLOCKED_IMG); socket.emit('uploadError', "Image interdite ! Bloqué 1 min.");
                } else {
                    uploadCooldowns[socket.id] = now + COOLDOWN_NORMAL; 
                    currentBackground = imageData; io.emit('updateBackground', imageData);
                    if (socket.user && socket.user.pseudo) {
                         const u = await User.findOne({ pseudo: socket.user.pseudo });
                         if(u) { u.backgroundsChanged++; await checkAchievements(u, socket.id); await u.save(); }
                    }
                }
            }
        } catch (error) { socket.emit('uploadError', "Erreur analyse image."); }
    });

    socket.on('saveSkin', async (data) => { if (socket.user && socket.user.pseudo && data.color) await User.updateOne({ pseudo: socket.user.pseudo }, { $set: { currentSkin: data.color } }); });
    socket.on('redeemCode', async (data) => {
        const { code } = data;
        if (!socket.user || !socket.user.pseudo) { socket.emit('codeError', "Connecte-toi d'abord !"); return; }
        const pseudo = socket.user.pseudo; const cleanCode = code.trim().toUpperCase();
        if (SECRET_CODES[cleanCode]) {
            const reward = SECRET_CODES[cleanCode];
            const user = await User.findOne({ pseudo });
            if (user) {
                if (!user.redeemedCodes) user.redeemedCodes = [];
                if (user.redeemedCodes.includes(cleanCode)) socket.emit('codeError', "Code déjà utilisé !");
                else {
                    user.redeemedCodes.push(cleanCode);
                    if (!user.unlockedSkins.includes(reward.skin)) {
                        user.unlockedSkins.push(reward.skin); await user.save();
                        socket.emit('codeSuccess', `Skin débloqué : ${reward.name}`); socket.emit('updateSkins', user.unlockedSkins);
                    } else { socket.emit('codeError', "Tu as déjà ce skin !"); await user.save(); }
                }
            }
        } else socket.emit('codeError', "Code invalide.");
    });

    socket.on('disconnect', async () => { await removePlayerFromGame(socket.id); delete uploadCooldowns[socket.id]; });
});

setInterval(() => {
    const ids = Object.keys(players);
    if (wolfId && ids.length > 1 && Date.now() - lastWolfMoveTime > 15000) { 
        io.to(wolfId).emit('forceLobby', 'afk'); removePlayerFromGame(wolfId);
    }
}, 1000);

// Stats graphiques (1min) - Optimisé
const saveGraphStats = async () => {
    try {
        const count = Object.keys(players).length;
        const last = await ConnStat.findOne().sort({ timestamp: -1 });

        // Protection anti-spam (moins de 55s)
        if (last && (Date.now() - last.timestamp) < 55000) return;

        // Si le nombre de joueurs est identique au dernier enregistrement, on ignore
        if (last && last.count === count) return;
        
        await ConnStat.create({ count });
    } catch (e) { console.error("Erreur stats:", e); }
};
saveGraphStats(); 
setInterval(saveGraphStats, 60 * 1000);

// Nettoyage automatique des stats > 24h (Toutes les heures)
setInterval(async () => {
    try {
        const limitDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
        await ConnStat.deleteMany({ timestamp: { $lt: limitDate } });
    } catch (e) { console.error("Erreur nettoyage stats:", e); }
}, 60 * 60 * 1000);

// Sauvegarde distances
setInterval(async () => {
    for (const id in players) {
        const p = players[id];
        if (p.pendingDistance > 0 && p.pseudo !== "Invité" && !p.pseudo.startsWith("Cube")) {
            try {
                const user = await User.findOne({ pseudo: p.pseudo });
                if(user) { user.distanceTraveled += Math.round(p.pendingDistance); await checkAchievements(user, id); await user.save(); }
                p.pendingDistance = 0;
            } catch (err) {}
        }
    }
}, 60 * 60 * 1000);

const PORT = process.env.PORT || 2220;
http.listen(PORT, '0.0.0.0', () => console.log(`Serveur lancé sur le port ${PORT}`));