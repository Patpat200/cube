require("dotenv").config();
const express = require("express");
const app = express();
app.set("trust proxy", 1);
app.disable("x-powered-by");
const http = require("http").createServer(app);
const path = require("path");
const axios = require("axios");
const FormData = require("form-data");
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const sharp = require("sharp");
const jwt = require("jsonwebtoken");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

const nodemailer = require("nodemailer");

const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = Number(process.env.SMTP_PORT) || 587;
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const MAIL_FROM = process.env.MAIL_FROM;
const BREVO_API_KEY = process.env.BREVO_API_KEY;
const BREVO_API_URL = "https://api.brevo.com/v3/smtp/email";
const SMTP_REQUIRE_TLS =
    String(process.env.SMTP_REQUIRE_TLS || "").toLowerCase() === "true";
const SMTP_FAMILY = Number(process.env.SMTP_FAMILY);
const SMTP_VERIFY_ON_START =
    String(process.env.SMTP_VERIFY_ON_START || "").toLowerCase() === "true";
const SMTP_SECURE =
    String(process.env.SMTP_SECURE || "").toLowerCase() === "true" ||
    SMTP_PORT === 465;

const SMTP_MAILER_ENABLED = Boolean(
    SMTP_HOST && SMTP_PORT && SMTP_USER && SMTP_PASS && MAIL_FROM,
);
const BREVO_API_ENABLED = Boolean(BREVO_API_KEY && MAIL_FROM);

const mailer = SMTP_MAILER_ENABLED
    ? nodemailer.createTransport({
          host: SMTP_HOST,
          port: SMTP_PORT,
          secure: SMTP_SECURE,
          requireTLS: SMTP_REQUIRE_TLS,
          auth: {
              user: SMTP_USER,
              pass: SMTP_PASS,
          },
          ...(SMTP_FAMILY === 4 || SMTP_FAMILY === 6
              ? { family: SMTP_FAMILY }
              : {}),
          tls: {
              servername: SMTP_HOST,
          },
          connectionTimeout: 10_000,
          greetingTimeout: 10_000,
          socketTimeout: 15_000,
      })
    : null;

if (!SMTP_MAILER_ENABLED && !BREVO_API_ENABLED) {
    console.warn(
        "⚠️ Email non configuré (SMTP ou BREVO_API_KEY manquant). Réinitialisation email désactivée.",
    );
}

if (SMTP_MAILER_ENABLED && mailer && SMTP_VERIFY_ON_START) {
    mailer
        .verify()
        .then(() => {
            console.log("✅ SMTP OK (connexion de vérification réussie).");
        })
        .catch((err) => {
            const code = err && err.code ? String(err.code) : "UNKNOWN";
            const message = err && err.message ? String(err.message) : "";
            console.warn(
                `⚠️ SMTP verify failed: ${code}${message ? ` - ${message}` : ""}`,
            );
        });
}

function getSmtpErrorDetails(err) {
    const code = err && err.code ? String(err.code) : "UNKNOWN";
    const message = err && err.message ? String(err.message) : "";
    const command = err && err.command ? String(err.command) : "";
    const responseCode =
        err && err.responseCode ? String(err.responseCode) : "";

    return {
        code,
        message,
        command,
        responseCode,
    };
}

async function sendResetEmailWithBrevoApi(toEmail, pseudo, resetUrl) {
    const response = await axios.post(
        BREVO_API_URL,
        {
            sender: {
                email: MAIL_FROM,
                name: "Cube Tag",
            },
            to: [{ email: toEmail, name: pseudo || undefined }],
            subject: "🔑 Réinitialisation de ton mot de passe — Cube Tag",
            htmlContent: `
            <div style="font-family:Arial,sans-serif;max-width:500px;margin:auto;background:#111;color:#fff;padding:30px;border-radius:12px;">
                <h2 style="color:#00d4ff;">Cube Tag</h2>
                <p>Bonjour <strong>${pseudo}</strong>,</p>
                <p>Tu as demandé une réinitialisation de mot de passe.</p>
                <a href="${resetUrl}" style="display:inline-block;margin:20px 0;padding:12px 24px;background:#00d4ff;color:#000;border-radius:8px;text-decoration:none;font-weight:bold;">
                    Réinitialiser mon mot de passe
                </a>
                <p style="color:#888;font-size:12px;">Ce lien expire dans 1 heure. Si tu n'as pas fait cette demande, ignore cet email.</p>
            </div>
        `,
        },
        {
            headers: {
                "api-key": BREVO_API_KEY,
                "content-type": "application/json",
                accept: "application/json",
            },
            timeout: 15_000,
        },
    );

    return response.data;
}

async function sendResetEmail(toEmail, pseudo, token) {
    if (!SMTP_MAILER_ENABLED && !BREVO_API_ENABLED) {
        throw new Error("MAILER_DISABLED");
    }

    const baseUrl =
        process.env.SITE_URL ||
        process.env.RENDER_EXTERNAL_URL ||
        "http://localhost:2220";
    const resetUrl = `${baseUrl.replace(/\/$/, "")}/reset-password?token=${token}`;

    if (SMTP_MAILER_ENABLED && mailer) {
        try {
            await mailer.sendMail({
                from: `"Cube Tag" <${MAIL_FROM}>`,
                to: toEmail,
                subject: "🔑 Réinitialisation de ton mot de passe — Cube Tag",
                html: `
            <div style="font-family:Arial,sans-serif;max-width:500px;margin:auto;background:#111;color:#fff;padding:30px;border-radius:12px;">
                <h2 style="color:#00d4ff;">Cube Tag</h2>
                <p>Bonjour <strong>${pseudo}</strong>,</p>
                <p>Tu as demandé une réinitialisation de mot de passe.</p>
                <a href="${resetUrl}" style="display:inline-block;margin:20px 0;padding:12px 24px;background:#00d4ff;color:#000;border-radius:8px;text-decoration:none;font-weight:bold;">
                    Réinitialiser mon mot de passe
                </a>
                <p style="color:#888;font-size:12px;">Ce lien expire dans 1 heure. Si tu n'as pas fait cette demande, ignore cet email.</p>
            </div>
        `,
            });
            return;
        } catch (smtpErr) {
            if (!BREVO_API_ENABLED) throw smtpErr;
            const { code } = getSmtpErrorDetails(smtpErr);
            console.warn(
                `⚠️ SMTP indisponible (${code}), tentative via API Brevo HTTPS...`,
            );
        }
    }

    if (BREVO_API_ENABLED) {
        try {
            await sendResetEmailWithBrevoApi(toEmail, pseudo, resetUrl);
            return;
        } catch (apiErr) {
            const status = apiErr && apiErr.response && apiErr.response.status;
            const statusText =
                apiErr && apiErr.response && apiErr.response.statusText;
            const details =
                apiErr && apiErr.response && apiErr.response.data
                    ? JSON.stringify(apiErr.response.data)
                    : "";
            const error = new Error(
                `BREVO_API_FAILED${status ? ` (${status}${statusText ? ` ${statusText}` : ""})` : ""}${details ? ` - ${details}` : ""}`,
            );
            error.code = status ? `BREVO_HTTP_${status}` : "BREVO_HTTP_UNKNOWN";
            throw error;
        }
    }
}

const {
    ACHIEVEMENTS,
    SECRET_CODES,
    POWERUP_TYPES,
    ROOM_CONFIG,
    XP_CONFIG,
    OBSTACLES,
    PORTALS,
    SHOP_SKINS,
    COIN_REWARDS,
} = require("./gameConfig");
// --- SÉCURITÉ : HELMET ---
app.use(
    helmet({
        contentSecurityPolicy: false,
    }),
);
app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    next();
});

// --- CONFIGURATION SKINS ---
const ALL_SKIN_NAMES = {};
ACHIEVEMENTS.forEach((ach) => {
    if (ach.rewardSkin && ach.skinName)
        ALL_SKIN_NAMES[ach.rewardSkin] = ach.skinName;
});
Object.values(SECRET_CODES).forEach((code) => {
    if (code.skin && code.name) ALL_SKIN_NAMES[code.skin] = code.name;
});

// --- SÉCURITÉ : SECRET JWT ---
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    console.error("🔴 ERREUR CRITIQUE : JWT_SECRET manquant !");
    process.exit(1);
}

// --- CONNEXION MONGODB ---
mongoose
    .connect(process.env.MONGO_URI)
    .then(() => console.log("✅ Connecté à MongoDB"))
    .catch((err) => console.error("❌ Erreur MongoDB:", err));

// --- MODÈLES ---

// 1. UTILISATEUR
const UserSchema = new mongoose.Schema({
    pseudo: { type: String, unique: true, required: true },
    email: {
        type: String,
        default: null,
        sparse: true,
        unique: true,
        lowercase: true,
        trim: true,
    },
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
    redeemedCodes: { type: [String], default: [] },
    xp: { type: Number, default: 0 },
    level: { type: Number, default: 1 },
    coins: { type: Number, default: 0 },
});
const User = mongoose.model("User", UserSchema);

const ResetTokenSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, required: true },
    token: { type: String, required: true },
    expiresAt: { type: Date, required: true },
});
const ResetToken = mongoose.model("ResetToken", ResetTokenSchema);

// 2. LOGS ADMIN
const LogSchema = new mongoose.Schema({
    action: String,
    admin: String,
    target: String,
    details: String,
    timestamp: { type: Date, default: Date.now },
});
const Log = mongoose.model("Log", LogSchema);

// 3. BANS IP
const BannedIpSchema = new mongoose.Schema({
    ip: String,
    reason: String,
    date: { type: Date, default: Date.now },
});
const BannedIP = mongoose.model("BannedIP", BannedIpSchema);

// 4. STATS CONNEXION (Graphiques)
const ConnStatSchema = new mongoose.Schema({
    count: Number,
    timestamp: { type: Date, default: Date.now },
});
const ConnStat = mongoose.model("ConnStat", ConnStatSchema);

// SKIN CRÉATIONS
const SkinSubmissionSchema = new mongoose.Schema({
    authorPseudo: { type: String, required: true },
    name: { type: String, required: true },
    description: { type: String, default: "" },
    cssCode: { type: String, required: true },
    previewData: { type: String, required: true }, // base64 snapshot
    status: { type: String, default: "pending" }, // pending / approved / rejected
    linkedAchId: { type: String, default: null },
    linkedAchName: { type: String, default: null },
    linkedAchDesc: { type: String, default: null },
    createdAt: { type: Date, default: Date.now },
});
const SkinSubmission = mongoose.model("SkinSubmission", SkinSubmissionSchema);

const io = require("socket.io")(http, { maxHttpBufferSize: 5 * 1024 * 1024 });

// --- VARIABLES JEU ---
let players = {};
let currentBackground = null;
let wolfId = null;
let uploadCooldowns = {};
let chatCooldowns = {};

// --- ROOMS ---
let rooms = {};
ROOM_CONFIG.rooms.forEach((name) => {
    rooms[name] = {
        players: {},
        wolfId: null,
        lastWolfMoveTime: Date.now(),
        background: null,
    };
});

// --- POWER-UPS ---
let activePowerups = {}; // { roomName: [{ id, type, x, y, spawnTime }] }
ROOM_CONFIG.rooms.forEach((name) => {
    activePowerups[name] = [];
});

// --- INFECTION MODE ---
let infectionMode = {}; // { roomName: bool }
ROOM_CONFIG.rooms.forEach((name) => {
    infectionMode[name] = false;
});

// --- MANCHES ---
const ROUND_DURATION = 5 * 60 * 1000; // 5 minutes
let roundTimers = {};

function generateObstacles() {
    const obs = [];
    const count = 4 + Math.floor(Math.random() * 5); // 4 à 8 obstacles
    for (let i = 0; i < count; i++) {
        const isHorizontal = Math.random() > 0.5;
        obs.push({
            x: Math.floor(Math.random() * 900) + 80,
            y: Math.floor(Math.random() * 450) + 80,
            w: isHorizontal ? 60 + Math.floor(Math.random() * 80) : 20,
            h: isHorizontal ? 20 : 60 + Math.floor(Math.random() * 80),
        });
    }
    return obs;
}

function generatePortals() {
    const margin = 80;
    const maxX = 1200 - margin;
    const maxY = 650 - margin;
    return [
        {
            id: "A",
            x: Math.floor(Math.random() * (maxX / 2)),
            y: Math.floor(Math.random() * maxY) + margin,
            pairId: "B",
        },
        {
            id: "B",
            x: Math.floor(Math.random() * (maxX / 2)) + maxX / 2,
            y: Math.floor(Math.random() * maxY) + margin,
            pairId: "A",
        },
    ];
}

// Obstacles dynamiques par room
let roomObstacles = {};
ROOM_CONFIG.rooms.forEach((name) => {
    roomObstacles[name] = generateObstacles();
});

let roomPortals = {};
ROOM_CONFIG.rooms.forEach((name) => {
    roomPortals[name] = generatePortals();
});

async function startRound(roomName) {
    const room = rooms[roomName];
    if (!room) return;

    // Nouveaux obstacles
    roomObstacles[roomName] = generateObstacles();
    roomPortals[roomName] = generatePortals();
    io.to(roomName).emit("newRound", {
        obstacles: roomObstacles[roomName],
        portals: roomPortals[roomName],
        timeLeft: ROUND_DURATION,
    });

    // Timer compte à rebours (envoi chaque seconde)
    let timeLeft = ROUND_DURATION;
    if (roundTimers[roomName]) clearInterval(roundTimers[roomName]);
    roundTimers[roomName] = setInterval(async () => {
        timeLeft -= 1000;
        io.to(roomName).emit("roundTimer", Math.max(0, timeLeft));
        if (timeLeft <= 0) {
            clearInterval(roundTimers[roomName]);
            // Scores de la manche
            const scores = Object.values(room.players)
                .sort((a, b) => (b.roundTags || 0) - (a.roundTags || 0))
                .slice(0, 3)
                .map((p) => ({ pseudo: p.pseudo, tags: p.roundTags || 0 }));
            io.to(roomName).emit("roundEnd", { scores });
            // Récompense coins au gagnant de la manche

            if (scores.length > 0 && scores[0].tags > 0) {
                await grantCoins(scores[0].pseudo, COIN_REWARDS.roundWin);
                await grantXP(scores[0].pseudo, 100);
            }

            // Reset scores manche
            Object.values(room.players).forEach((p) => {
                p.roundTags = 0;
            });
            // Nouvelle manche après 5s
            setTimeout(() => startRound(roomName), 5000);
        }
    }, 1000);
}

// --- CHAT ---
const chatHistory = {}; // { roomName: [ {pseudo, msg, ts} ] }
ROOM_CONFIG.rooms.forEach((name) => {
    chatHistory[name] = [];
});

// --- STREAKS ---
const tagStreaks = {}; // { pseudo: count }

// Helper : trouver la room d'un socket
function getRoomOfSocket(socketId) {
    for (const rName in rooms) {
        if (rooms[rName].players[socketId]) return rName;
    }
    return null;
}

// Helper : spawn power-up aléatoire dans une room
function spawnPowerup(roomName) {
    const room = rooms[roomName];
    if (!room || Object.keys(room.players).length < 2) return;
    if (activePowerups[roomName].length >= 3) return;
    const type =
        POWERUP_TYPES[Math.floor(Math.random() * POWERUP_TYPES.length)];
    const pu = {
        uid: Date.now() + Math.random(),
        type: type.id,
        label: type.label,
        color: type.color,
        duration: type.duration,
        x: Math.floor(Math.random() * 1100) + 50,
        y: Math.floor(Math.random() * 550) + 50,
    };
    activePowerups[roomName].push(pu);
    io.to(roomName).emit("spawnPowerup", pu);
}

// Helper : gain XP
async function grantXP(pseudo, amount) {
    if (!pseudo || pseudo === "Invité" || pseudo.startsWith("Cube")) return;
    try {
        const user = await User.findOne({ pseudo });
        if (!user) return;
        user.xp = (user.xp || 0) + amount;
        const newLevel = Math.floor(Math.sqrt(user.xp / 100)) + 1;
        const oldLevel = user.level || 1;
        user.level = newLevel;
        await user.save();
        const socket = [...io.sockets.sockets.values()].find(
            (s) => s.user && s.user.pseudo === pseudo,
        );
        if (socket) {
            socket.emit("xpUpdate", { xp: user.xp, level: user.level });
            if (newLevel > oldLevel)
                socket.emit("serverMessage", {
                    text: `🎉 Niveau ${newLevel} atteint !`,
                    color: "#ffd700",
                });
        }
    } catch (e) {
        console.error(e);
    }
}

async function grantCoins(pseudo, amount) {
    if (!pseudo || pseudo === "Invité" || pseudo.startsWith("Cube")) return;
    try {
        const user = await User.findOne({ pseudo });
        if (!user) return;
        user.coins = (user.coins || 0) + amount;
        await user.save();
        const socket = [...io.sockets.sockets.values()].find(
            (s) => s.user && s.user.pseudo === pseudo,
        );
        if (socket) socket.emit("coinsUpdate", user.coins);
    } catch (e) {
        console.error(e);
    }
}

// VARIABLES ADMIN
let maintenanceMode = false;
// Suppression de la variable godModeAdmins

const API_USER = process.env.SIGHTENGINE_USER;
const API_SECRET = process.env.SIGHTENGINE_SECRET;
const API_URL = "https://api.sightengine.com/1.0/check.json";
const BLOCKED_IMG = "https://i.redd.it/58qnz74nf5j41.png";
const COOLDOWN_NORMAL = 15000;
const COOLDOWN_PENALTY = 60000;
let lastTagTime = 0;
const TAG_COOLDOWN = 1000;
let lastWolfMoveTime = Date.now();

// --- HELPERS ---
async function addLog(action, admin, target, details) {
    try {
        await Log.create({ action, admin, target, details });
    } catch (e) {
        console.error(e);
    }
}

async function checkAchievements(user, socketId) {
    let changed = false;
    let newUnlocks = [];
    for (const ach of ACHIEVEMENTS) {
        if (!user.achievements.includes(ach.id)) {
            if (ach.condition(user)) {
                user.achievements.push(ach.id);
                if (
                    ach.rewardSkin &&
                    !user.unlockedSkins.includes(ach.rewardSkin)
                ) {
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
            newUnlocks.forEach((ach) => {
                io.to(socketId).emit("achievementUnlocked", {
                    name: ach.name,
                    desc: ach.desc,
                });
            });
            io.to(socketId).emit("updateSkins", user.unlockedSkins);
        }
    }
}

// MIDDLEWARES
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { success: false, message: "Trop de tentatives." },
});
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
});

app.use(express.json({ limit: "10kb" }));
app.use(express.static(path.join(__dirname, "public")));
app.use("/api/", apiLimiter);

function escapeRegExp(string) {
    return String(string).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const PSEUDO_REGEX = /^[A-Za-z0-9_-]{3,12}$/;

function sanitizeBasicText(value, maxLen = 120) {
    if (typeof value !== "string") return "";
    return value
        .replace(/[\u0000-\u001F\u007F]/g, "")
        .replace(/[<>"'`]/g, "")
        .trim()
        .slice(0, maxLen);
}

function normalizePseudo(value) {
    if (typeof value !== "string") return null;
    const pseudo = value.trim();
    if (!PSEUDO_REGEX.test(pseudo)) return null;
    return pseudo;
}

function normalizePassword(value) {
    if (typeof value !== "string") return null;
    const password = value.trim();
    if (password.length < 8 || password.length > 72) return null;
    return password;
}

function normalizeLegacyPseudoForLogin(value) {
    if (typeof value !== "string") return null;
    const pseudo = value.trim();
    if (!pseudo || pseudo.length > 30) return null;
    if (/[\u0000-\u001F\u007F]/.test(pseudo)) return null;
    return pseudo;
}

function normalizeLegacyPasswordForLogin(value) {
    if (typeof value !== "string") return null;
    const password = value.trim();
    if (!password || password.length > 200) return null;
    return password;
}

function isValidEmail(value) {
    if (typeof value !== "string") return false;
    const email = value.trim().toLowerCase();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isSafeCurrentSkinValue(value) {
    if (typeof value !== "string") return false;
    const skin = value.trim();
    if (!skin || skin.length > 220) return false;

    if (/^#[0-9a-f]{3,8}$/i.test(skin)) return true;
    if (/^skin-[a-z0-9_-]{2,80}$/i.test(skin)) return true;
    if (/^skin-custom-[a-f0-9]{8}$/i.test(skin)) return true;
    if (/^https?:\/\/[^\s]+$/i.test(skin)) return true;
    if (/^\/[^\s]*$/i.test(skin)) return true;
    if (
        /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=\r\n]+$/i.test(
            skin,
        )
    )
        return true;

    return false;
}

function isSafeBackgroundDataUrl(value) {
    if (typeof value !== "string") return false;
    if (value.length === 0 || value.length > 2_000_000) return false;
    return /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=\r\n]+$/i.test(
        value,
    );
}

function isValidPreviewDataUrl(value) {
    if (typeof value !== "string") return false;
    if (value.length > 250000) return false;
    if (
        /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=\r\n]+$/i.test(
            value,
        )
    ) {
        return true;
    }

    if (/^css:[A-Za-z0-9+/=]*$/i.test(value) && value.length <= 8000) {
        return true;
    }

    return false;
}

function sanitizeCssComment(value) {
    return sanitizeBasicText(value, 60)
        .replace(/\*\//g, "")
        .replace(/\r?\n/g, " ");
}

function isValidCustomSkinCss(cssCode) {
    if (typeof cssCode !== "string") return false;
    if (cssCode.length === 0 || cssCode.length > 5000) return false;

    const lowered = cssCode.replace(/\/\*[\s\S]*?\*\//g, "").toLowerCase();

    if (!lowered.includes(".skin-preview")) return false;

    const blockedPatterns = [
        /javascript\s*:/i,
        /expression\s*\(/i,
        /url\s*\(/i,
        /@import\b/i,
        /@charset\b/i,
        /@namespace\b/i,
        /behavior\s*:/i,
        /-moz-binding\s*:/i,
        /<\/?script/i,
    ];

    return !blockedPatterns.some((pattern) => pattern.test(lowered));
}

function authenticateToken(req, res, next) {
    const authHeader = req.headers["authorization"];
    const token = authHeader && authHeader.split(" ")[1];
    if (!token) return res.sendStatus(401);
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.sendStatus(403);
        req.user = user;
        next();
    });
}

const verifyAdmin = async (req, res, next) => {
    const authHeader = req.headers["authorization"];
    const token = authHeader && authHeader.split(" ")[1];
    if (!token) return res.sendStatus(401);

    jwt.verify(token, JWT_SECRET, async (err, decoded) => {
        if (err) return res.sendStatus(403);
        try {
            const user = await User.findById(decoded.id);
            if (!user || !user.isAdmin)
                return res
                    .status(403)
                    .json({ success: false, message: "Accès refusé." });
            req.user = user;
            next();
        } catch (e) {
            res.sendStatus(500);
        }
    });
};

// --- ROUTES AUTH ---

app.post("/api/register", authLimiter, async (req, res) => {
    const pseudo = normalizePseudo(req.body?.pseudo);
    const password = normalizePassword(req.body?.password);

    // Vérif IP
    const ip = req.ip;
    const banned = await BannedIP.findOne({ ip });
    if (banned) return res.json({ success: false, message: "IP Bannie." });

    if (!pseudo || !password)
        return res.json({
            success: false,
            message: "Pseudo ou mot de passe invalide.",
        });

    const safePseudoRegex = new RegExp(`^${escapeRegExp(pseudo)}$`, "i");

    try {
        const existingUser = await User.findOne({
            pseudo: { $regex: safePseudoRegex },
        });
        if (existingUser)
            return res.json({ success: false, message: "Pseudo pris." });
        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = new User({ pseudo, password: hashedPassword });
        await newUser.save();
        res.json({ success: true });
    } catch (error) {
        res.json({ success: false, message: "Erreur serveur." });
    }
});

app.post("/api/login", authLimiter, async (req, res) => {
    const pseudo = normalizeLegacyPseudoForLogin(req.body?.pseudo);
    const password = normalizeLegacyPasswordForLogin(req.body?.password);

    if (!pseudo || !password)
        return res.json({
            success: false,
            message: "Pseudo ou mot de passe invalide.",
        });

    const ip = req.ip;
    const banned = await BannedIP.findOne({ ip });
    if (banned) return res.json({ success: false, message: "IP Bannie." });

    if (maintenanceMode) {
        const u = await User.findOne({ pseudo });
        if (u && !u.isAdmin)
            return res.json({
                success: false,
                message: "Maintenance en cours.",
            });
    }

    const safePseudoRegex = new RegExp(`^${escapeRegExp(pseudo)}$`, "i");

    try {
        const user = await User.findOne({
            pseudo: { $regex: safePseudoRegex },
        });
        if (!user)
            return res.json({
                success: false,
                message: "Utilisateur inconnu.",
            });

        if (user.isBanned)
            return res.json({
                success: false,
                message: "Ce compte est banni.",
            });

        const match = await bcrypt.compare(password, user.password);
        if (match) {
            const token = jwt.sign(
                { id: user._id, pseudo: user.pseudo },
                JWT_SECRET,
                { expiresIn: "7d" },
            );
            res.json({
                success: true,
                token: token,
                pseudo: user.pseudo,
                isAdmin: user.isAdmin,
            });
        } else res.json({ success: false, message: "Mot de passe incorrect." });
    } catch (error) {
        res.json({ success: false, message: "Erreur serveur." });
    }
});

app.get("/api/me", authenticateToken, async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select("-password -__v");
        if (!user) return res.sendStatus(404);
        res.json({ success: true, pseudo: user.pseudo, stats: user });
    } catch (e) {
        res.sendStatus(500);
    }
});

// --- ROUTES STATS PUBLIQUES ---
app.get("/api/stats/:pseudo", async (req, res) => {
    try {
        const user = await User.findOne({ pseudo: req.params.pseudo }).select(
            "-password -__v -_id",
        );
        if (!user) return res.json({ success: false });
        const ratio =
            user.timesTagged === 0
                ? user.tagsInflicted
                : (user.tagsInflicted / user.timesTagged).toFixed(2);
        const statsObj = user.toObject();
        statsObj.ratio = ratio;
        statsObj.distanceTraveled = Math.round(statsObj.distanceTraveled || 0);
        res.json({ success: true, stats: statsObj });
    } catch (e) {
        res.json({ success: false });
    }
});

app.get("/api/leaderboard", async (req, res) => {
    try {
        const hunters = await User.find()
            .sort({ tagsInflicted: -1 })
            .limit(10)
            .select("pseudo tagsInflicted");
        const travelers = await User.find()
            .sort({ distanceTraveled: -1 })
            .limit(10)
            .select("pseudo distanceTraveled");
        res.json({ success: true, hunters, travelers });
    } catch (e) {
        res.json({ success: false });
    }
});

app.get("/api/my-achievements/:pseudo", async (req, res) => {
    try {
        const user = await User.findOne({ pseudo: req.params.pseudo }).select(
            "achievements unlockedSkins",
        );
        if (!user) return res.json({ success: false });

        const list = ACHIEVEMENTS.map((ach) => ({
            id: ach.id,
            name: ach.name,
            desc: ach.desc,
            unlocked: user.achievements.includes(ach.id),
            rewardSkin: ach.rewardSkin,
        }));

        res.json({
            success: true,
            achievements: list,
            unlockedSkins: user.unlockedSkins,
            skinMap: ALL_SKIN_NAMES,
        });
    } catch (e) {
        res.json({ success: false });
    }
});

// --- ROUTES ADMIN ---

// 1. Dashboard
app.get("/api/admin/dashboard", verifyAdmin, async (req, res) => {
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
            maintenance: maintenanceMode,
        });
    } catch (e) {
        res.status(500).json({ success: false });
    }
});

// 2. Liste Users
app.get("/api/admin/users", verifyAdmin, async (req, res) => {
    try {
        const users = await User.find().select("-password");
        res.json({ success: true, users });
    } catch (e) {
        res.status(500).json({ success: false });
    }
});

// 3. Modifier User (Stats, Skins, Ban, Mdp)
app.post("/api/admin/update-user", verifyAdmin, async (req, res) => {
    const { userId, updates } = req.body;
    try {
        const target = await User.findById(userId);
        if (!target) return res.json({ success: false });
        if (target.isAdmin && updates.isBanned)
            return res.json({
                success: false,
                message: "Impossible de bannir un admin.",
            });

        if (updates.newPassword && updates.newPassword.trim() !== "") {
            updates.password = await bcrypt.hash(updates.newPassword, 10);
            delete updates.newPassword;
        } else {
            delete updates.newPassword;
        }

        await User.findByIdAndUpdate(userId, { $set: updates });
        await addLog(
            "UPDATE",
            req.user.pseudo,
            target.pseudo,
            `Modifs: ${Object.keys(updates).join(",")}`,
        );

        if (updates.isBanned) {
            const sockets = await io.fetchSockets();
            for (const s of sockets) {
                if (s.user && s.user.pseudo === target.pseudo) {
                    s.emit("forceLobby", "banned");
                    s.disconnect(true);
                }
            }
        }
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false });
    }
});

// 4. Supprimer User
app.delete("/api/admin/user/:id", verifyAdmin, async (req, res) => {
    try {
        const target = await User.findById(req.params.id);
        if (target && target.isAdmin)
            return res.json({ success: false, message: "Admin protégé." });
        await User.findByIdAndDelete(req.params.id);
        await addLog(
            "DELETE",
            req.user.pseudo,
            target ? target.pseudo : "?",
            "Compte supprimé",
        );
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false });
    }
});

// 5. Actions Serveur
app.post("/api/admin/action", verifyAdmin, async (req, res) => {
    const { type, payload } = req.body;
    try {
        if (type === "MAINTENANCE") {
            maintenanceMode = !maintenanceMode;
            io.emit("serverMessage", {
                text: maintenanceMode
                    ? "🔒 Serveur en MAINTENANCE"
                    : "🟢 Serveur OUVERT",
                color: "orange",
            });
            if (maintenanceMode) {
                const sockets = await io.fetchSockets();
                for (const s of sockets) {
                    let isAdmin = false;
                    if (s.user) {
                        const u = await User.findById(s.user.id);
                        if (u && u.isAdmin) isAdmin = true;
                    }
                    if (!isAdmin) {
                        s.emit("forceLobby", "maintenance");
                        s.disconnect(true);
                    }
                }
            }
            await addLog(
                "MAINTENANCE",
                req.user.pseudo,
                "SERVEUR",
                `État: ${maintenanceMode}`,
            );
        } else if (type === "BROADCAST") {
            const safeMessage = sanitizeBasicText(payload?.message || "", 200);
            if (!safeMessage)
                return res.json({ success: false, message: "Message vide." });
            io.emit("serverMessage", {
                text: `📢 ADMIN : ${safeMessage}`,
                color: "red",
            });
            await addLog("BROADCAST", req.user.pseudo, "ALL", safeMessage);
        } else if (type === "WHISPER") {
            const safeMessage = sanitizeBasicText(payload?.message || "", 200);
            const targetPseudo = sanitizeBasicText(
                payload?.targetPseudo || "",
                30,
            );
            if (!safeMessage || !targetPseudo)
                return res.json({
                    success: false,
                    message: "Données invalides.",
                });
            const sockets = await io.fetchSockets();
            let found = false;
            for (const s of sockets) {
                if (s.user && s.user.pseudo === targetPseudo) {
                    s.emit("serverMessage", {
                        text: `💬 MP Admin : ${safeMessage}`,
                        color: "purple",
                    });
                    found = true;
                }
            }
            if (!found)
                return res.json({
                    success: false,
                    message: "Joueur introuvable.",
                });
            await addLog("WHISPER", req.user.pseudo, targetPseudo, safeMessage);
        } else if (type === "KICK") {
            const targetPseudo = sanitizeBasicText(
                payload?.targetPseudo || "",
                30,
            );
            if (!targetPseudo)
                return res.json({ success: false, message: "Cible invalide." });
            const sockets = await io.fetchSockets();
            for (const s of sockets) {
                if (
                    (s.user && s.user.pseudo === targetPseudo) ||
                    (!s.user &&
                        targetPseudo.startsWith("Cube") &&
                        players[s.id])
                ) {
                    s.emit("forceLobby", "kick");
                    s.disconnect(true);
                }
            }
            await addLog("KICK", req.user.pseudo, targetPseudo, "Expulsé");
        } else if (type === "BAN_IP") {
            const targetPseudo = sanitizeBasicText(
                payload?.targetPseudo || "",
                30,
            );
            if (!targetPseudo)
                return res.json({ success: false, message: "Cible invalide." });
            const sockets = await io.fetchSockets();
            let targetIp = null;
            for (const s of sockets) {
                if (s.user && s.user.pseudo === targetPseudo) {
                    targetIp = s.handshake.address;
                    if (s.handshake.headers["x-forwarded-for"])
                        targetIp =
                            s.handshake.headers["x-forwarded-for"].split(
                                ",",
                            )[0];
                    s.emit("forceLobby", "banned");
                    s.disconnect(true);
                    break;
                }
            }
            if (targetIp) {
                await BannedIP.create({
                    ip: targetIp,
                    reason: "Banni par admin",
                });
                await addLog(
                    "BAN_IP",
                    req.user.pseudo,
                    targetPseudo,
                    `IP: ${targetIp}`,
                );
            } else
                return res.json({ success: false, message: "IP introuvable." });
        }
        res.json({ success: true });
    } catch (e) {
        console.error(e);
        res.status(500).json({ success: false });
    }
});

// --- GESTION IP BANNIES (NOUVEAU) ---
app.get("/api/admin/banned-ips", verifyAdmin, async (req, res) => {
    try {
        const list = await BannedIP.find().sort({ date: -1 });
        res.json({ success: true, list });
    } catch (e) {
        res.status(500).json({ success: false });
    }
});

app.post("/api/admin/unban-ip", verifyAdmin, async (req, res) => {
    try {
        const { id } = req.body;
        await BannedIP.findByIdAndDelete(id);
        await addLog("UNBAN_IP", req.user.pseudo, "IP", "IP débannie");
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false });
    }
});

// BOUTIQUE : Liste des skins
app.get("/api/shop", (req, res) => {
    res.json({ success: true, skins: SHOP_SKINS });
});

// BOUTIQUE : Acheter un skin
app.post("/api/shop/buy", authenticateToken, async (req, res) => {
    const { skinId } = req.body;

    // Chercher dans skins normaux OU communautaires
    let skin = SHOP_SKINS.find((s) => s.id === skinId);
    let isCommunity = false;

    if (!skin && skinId.startsWith("community_")) {
        const mongoId = skinId.replace("community_", "");
        const sub = await SkinSubmission.findById(mongoId).select(
            "name authorPseudo _id",
        );
        if (sub) {
            skin = {
                id: skinId,
                name: sub.name,
                price: 150,
                value: "skin-custom-" + sub._id.toString().slice(-8),
            };
            isCommunity = true;
        }
    }

    if (!skin)
        return res.json({ success: false, message: "Skin introuvable." });

    try {
        const user = await User.findById(req.user.id);
        if (!user)
            return res.json({
                success: false,
                message: "Utilisateur introuvable.",
            });
        if (user.unlockedSkins.includes(skin.value))
            return res.json({ success: false, message: "Skin déjà possédé !" });
        if ((user.coins || 0) < skin.price)
            return res.json({
                success: false,
                message: `Pas assez de coins ! (${skin.price - (user.coins || 0)} manquants)`,
            });

        user.coins -= skin.price;
        user.unlockedSkins.push(skin.value);
        if (!ALL_SKIN_NAMES[skin.value]) ALL_SKIN_NAMES[skin.value] = skin.name;
        await user.save();

        res.json({
            success: true,
            newCoins: user.coins,
            skinValue: skin.value,
        });
    } catch (e) {
        res.status(500).json({ success: false, message: "Erreur serveur." });
    }
});

// COINS : Solde actuel
app.get("/api/coins", authenticateToken, async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select("coins");
        res.json({ success: true, coins: user ? user.coins || 0 : 0 });
    } catch (e) {
        res.status(500).json({ success: false });
    }
});

// === ÉDITEUR DE SKIN ===

// Soumettre un skin
app.post("/api/skin-editor/submit", authenticateToken, async (req, res) => {
    const name = sanitizeBasicText(req.body?.name, 30);
    const description = sanitizeBasicText(req.body?.description || "", 220);
    const cssCode =
        typeof req.body?.cssCode === "string" ? req.body.cssCode : "";
    const previewData = req.body?.previewData;

    if (!name || !cssCode || !previewData)
        return res.json({ success: false, message: "Champs manquants." });
    if (name.length > 30)
        return res.json({ success: false, message: "Nom trop long." });
    if (cssCode.length > 5000)
        return res.json({
            success: false,
            message: "CSS trop long (max 5000 caractères).",
        });
    if (!isValidPreviewDataUrl(previewData))
        return res.json({
            success: false,
            message: "Preview invalide.",
        });
    if (!isValidCustomSkinCss(cssCode))
        return res.json({
            success: false,
            message: "CSS non autorisé (contenu interdit).",
        });

    try {
        // Max 3 soumissions en attente par joueur
        const pending = await SkinSubmission.countDocuments({
            authorPseudo: req.user.pseudo,
            status: "pending",
        });
        if (pending >= 3)
            return res.json({
                success: false,
                message: "Tu as déjà 3 skins en attente.",
            });

        await SkinSubmission.create({
            authorPseudo: req.user.pseudo,
            name,
            description,
            cssCode,
            previewData: previewData.slice(0, 200000), // limite base64
        });
        res.json({
            success: true,
            message: "Skin soumis ! Les admins vont le vérifier.",
        });
    } catch (e) {
        res.status(500).json({ success: false, message: "Erreur serveur." });
    }
});

// Mes soumissions
app.get(
    "/api/skin-editor/my-submissions",
    authenticateToken,
    async (req, res) => {
        try {
            const subs = await SkinSubmission.find({
                authorPseudo: req.user.pseudo,
            })
                .select("-previewData")
                .sort({ createdAt: -1 });
            res.json({ success: true, submissions: subs });
        } catch (e) {
            res.status(500).json({ success: false });
        }
    },
);

// ADMIN : Liste toutes les soumissions
app.get("/api/admin/skin-submissions", verifyAdmin, async (req, res) => {
    try {
        const subs = await SkinSubmission.find().sort({ createdAt: -1 });
        res.json({ success: true, submissions: subs });
    } catch (e) {
        res.status(500).json({ success: false });
    }
});

// ADMIN : Approuver un skin
app.post(
    "/api/admin/skin-submissions/approve",
    verifyAdmin,
    async (req, res) => {
        const { submissionId, achId, achName, achDesc } = req.body;
        try {
            const sub = await SkinSubmission.findById(submissionId);
            if (!sub)
                return res.json({
                    success: false,
                    message: "Soumission introuvable.",
                });

            const skinClassId = "skin-custom-" + sub._id.toString().slice(-8);
            sub.status = "approved";
            sub.linkedAchId = achId || null;
            sub.linkedAchName = achName || null;
            sub.linkedAchDesc = achDesc || null;
            await sub.save();

            // Donner le skin + coins à l'auteur
            const author = await User.findOne({ pseudo: sub.authorPseudo });
            if (author) {
                if (!author.unlockedSkins.includes(skinClassId))
                    author.unlockedSkins.push(skinClassId);
                author.coins = (author.coins || 0) + 100;
                await author.save();
                ALL_SKIN_NAMES[skinClassId] = sub.name;
            }

            // Notifier l'auteur s'il est connecté
            const authorSocket = [...io.sockets.sockets.values()].find(
                (s) => s.user && s.user.pseudo === sub.authorPseudo,
            );
            if (authorSocket) {
                authorSocket.emit("serverMessage", {
                    text: `🎨 Ton skin "${sub.name}" a été approuvé ! Tu reçois +100 🪙`,
                    color: "#00d4ff",
                });
                authorSocket.emit("skinApproved", {
                    skinClassId,
                    skinName: sub.name,
                    coinsGained: 100,
                });
                authorSocket.emit("coinsUpdate", author ? author.coins : 0);
            }

            await addLog(
                "APPROVE_SKIN",
                req.user.pseudo,
                sub.authorPseudo,
                `Skin: ${sub.name}`,
            );
            res.json({
                success: true,
                skinClassId,
                skinName: sub.name,
                authorPseudo: sub.authorPseudo,
            });
        } catch (e) {
            res.status(500).json({ success: false });
        }
    },
);

// ADMIN : Rejeter un skin
app.post(
    "/api/admin/skin-submissions/reject",
    verifyAdmin,
    async (req, res) => {
        const { submissionId } = req.body;
        const reason = sanitizeBasicText(req.body?.reason || "", 200);
        try {
            const sub = await SkinSubmission.findById(submissionId);
            if (!sub)
                return res.json({
                    success: false,
                    message: "Soumission introuvable.",
                });
            sub.status = "rejected";
            await sub.save();

            const authorSocket = [...io.sockets.sockets.values()].find(
                (s) => s.user && s.user.pseudo === sub.authorPseudo,
            );
            if (authorSocket) {
                authorSocket.emit("serverMessage", {
                    text: `❌ Ton skin "${sub.name}" a été refusé. ${reason ? "Raison : " + reason : ""}`,
                    color: "#ff4444",
                });
            }

            await addLog(
                "REJECT_SKIN",
                req.user.pseudo,
                sub.authorPseudo,
                `Skin: ${sub.name} | Raison: ${reason || "?"}`,
            );
            res.json({ success: true });
        } catch (e) {
            res.status(500).json({ success: false });
        }
    },
);

// Récupérer le CSS de tous les skins approuvés (injecté côté client)
app.get("/api/skin-editor/approved-css", async (req, res) => {
    try {
        const approved = await SkinSubmission.find({
            status: "approved",
        }).select("cssCode _id name authorPseudo description");
        let css = "";
        approved.forEach((s) => {
            const classId = "skin-custom-" + s._id.toString().slice(-8);
            if (!isValidCustomSkinCss(s.cssCode)) return;
            const wrapped = s.cssCode.replace(/\.skin-preview/g, "." + classId);
            const safeName = sanitizeCssComment(s.name);
            const safeAuthor = sanitizeCssComment(s.authorPseudo);
            css += `/* ${safeName} by ${safeAuthor} */\n${wrapped}\n\n`;
        });
        res.set("Content-Type", "text/css");
        res.send(css);
    } catch (e) {
        res.status(500).send("");
    }
});

// Liste des skins communautaires pour la boutique
app.get("/api/skin-editor/community-skins", async (req, res) => {
    try {
        const approved = await SkinSubmission.find({ status: "approved" })
            .select("_id name authorPseudo description createdAt")
            .sort({ createdAt: -1 });
        const skins = approved.map((s) => ({
            id: "community_" + s._id.toString(),
            skinId: s._id.toString(),
            name: s.name,
            author: s.authorPseudo,
            description: s.description || "",
            price: 150,
            tier: 6,
            value: "skin-custom-" + s._id.toString().slice(-8),
        }));
        res.json({ success: true, skins });
    } catch (e) {
        res.status(500).json({ success: false });
    }
});

const crypto = require("crypto");

// Ajouter email au compte
app.post("/api/set-email", authenticateToken, async (req, res) => {
    const email = sanitizeBasicText(req.body?.email || "", 100).toLowerCase();
    if (!email || !isValidEmail(email))
        return res.json({ success: false, message: "Email invalide." });
    try {
        const existingUser = await User.findOne({
            email,
            _id: { $ne: req.user.id },
        }).select("_id");

        if (existingUser)
            return res.json({
                success: false,
                message: "Cet email est déjà utilisé par un autre compte.",
            });

        await User.findByIdAndUpdate(req.user.id, { $set: { email } });
        res.json({ success: true });
    } catch (e) {
        if (e && e.code === 11000)
            return res.json({
                success: false,
                message: "Cet email est déjà utilisé par un autre compte.",
            });
        res.status(500).json({ success: false });
    }
});

app.post("/api/forgot-password", authLimiter, async (req, res) => {
    const pseudo = sanitizeBasicText(req.body?.pseudo || "", 30);
    if (!pseudo)
        return res.json({ success: false, message: "Pseudo manquant." });
    try {
        const user = await User.findOne({
            pseudo: new RegExp(`^${escapeRegExp(pseudo)}$`, "i"),
        });
        // Toujours répondre OK pour ne pas révéler si le compte existe
        if (!user || !user.email) return res.json({ success: true });

        // Supprimer anciens tokens
        await ResetToken.deleteMany({ userId: user._id });

        const token = crypto.randomBytes(32).toString("hex");
        await ResetToken.create({
            userId: user._id,
            token,
            expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1h
        });

        await sendResetEmail(user.email, user.pseudo, token);
        res.json({ success: true });
    } catch (e) {
        const { code, message, command, responseCode } = getSmtpErrorDetails(e);
        if (
            code === "ETIMEDOUT" ||
            code === "ESOCKET" ||
            code === "ECONNECTION" ||
            code === "EAUTH"
        ) {
            console.warn(
                `⚠️ SMTP reset-password error: ${code}${message ? ` - ${message}` : ""}${command ? ` (command=${command})` : ""}${responseCode ? ` (responseCode=${responseCode})` : ""}`,
            );

            if (code === "ETIMEDOUT") {
                console.warn(
                    "ℹ️ Vérifie Render: host/port SMTP accessibles, port 587/465 autorisé, et essaye SMTP_FAMILY=4.",
                );
            }
        } else if (code.startsWith("BREVO_HTTP_")) {
            console.warn(
                `⚠️ Brevo API reset-password error: ${code} - ${message}`,
            );
        } else if (e && e.message === "MAILER_DISABLED") {
            console.warn("⚠️ SMTP non configuré pour reset-password.");
        } else {
            console.error(e);
        }
        res.json({ success: true }); // Toujours OK côté client
    }
});

// Reset du mot de passe
app.post("/api/reset-password", authLimiter, async (req, res) => {
    const { token, newPassword } = req.body;
    if (!token || !newPassword)
        return res.json({ success: false, message: "Données manquantes." });
    if (
        typeof newPassword !== "string" ||
        newPassword.length < 8 ||
        newPassword.length > 72
    )
        return res.json({
            success: false,
            message: "Mot de passe invalide (8-72 caractères).",
        });
    try {
        const resetToken = await ResetToken.findOne({ token });
        if (!resetToken || resetToken.expiresAt < new Date())
            return res.json({
                success: false,
                message: "Lien invalide ou expiré.",
            });

        const hashed = await bcrypt.hash(newPassword, 10);
        await User.findByIdAndUpdate(resetToken.userId, {
            $set: { password: hashed },
        });
        await ResetToken.deleteOne({ _id: resetToken._id });

        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false });
    }
});

// Page de reset (sert le HTML)
app.get("/reset-password", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "reset-password.html"));
});

// --- SOCKET.IO ---
async function removePlayerFromGame(socketId) {
    const roomName = getRoomOfSocket(socketId);
    if (!roomName) return;
    const room = rooms[roomName];
    const p = room.players[socketId];
    if (!p) return;

    if (
        p.pendingDistance > 0 &&
        p.pseudo !== "Invité" &&
        !p.pseudo.startsWith("Cube")
    ) {
        try {
            const user = await User.findOne({ pseudo: p.pseudo });
            if (user) {
                user.distanceTraveled =
                    (user.distanceTraveled || 0) +
                    Math.round(p.pendingDistance);
                const xpGain =
                    Math.floor(p.pendingDistance / 100) *
                    XP_CONFIG.distancePer100;
                user.xp = (user.xp || 0) + xpGain;
                user.level = Math.floor(Math.sqrt(user.xp / 100)) + 1;
                await checkAchievements(user, null);
                await user.save();
            }
        } catch (e) {
            console.error(e);
        }
    }

    delete room.players[socketId];
    io.to(roomName).emit("playerDisconnected", socketId);

    if (socketId === room.wolfId) {
        const ids = Object.keys(room.players);
        if (ids.length > 0) {
            room.wolfId = ids[Math.floor(Math.random() * ids.length)];
            room.players[room.wolfId].isWolf = true;
            io.to(roomName).emit("updateWolf", room.wolfId);
            room.lastWolfMoveTime = Date.now();
        } else {
            room.wolfId = null;
            io.to(roomName).emit("updateWolf", null);
        }
    }
}

io.use(async (socket, next) => {
    let ip = socket.handshake.address;
    if (socket.handshake.headers["x-forwarded-for"])
        ip = socket.handshake.headers["x-forwarded-for"].split(",")[0];
    const banned = await BannedIP.findOne({ ip });
    if (banned) return next(new Error("IP Bannie"));

    const token = socket.handshake.auth.token;
    if (token) {
        jwt.verify(token, JWT_SECRET, (err, decoded) => {
            if (err) socket.user = null;
            else socket.user = decoded;
            next();
        });
    } else {
        socket.user = null;
        next();
    }
});

io.on("connection", async (socket) => {
    if (maintenanceMode) {
        let isAdmin = false;
        if (socket.user) {
            const u = await User.findById(socket.user.id);
            if (u && u.isAdmin) isAdmin = true;
        }
        if (!isAdmin) {
            socket.emit("forceLobby", "maintenance");
            socket.disconnect();
            return;
        }
    }

    socket.emit("currentPlayers", players);
    socket.emit("updateWolf", wolfId);
    if (currentBackground) socket.emit("updateBackground", currentBackground);

    socket.on("joinRoom", async (roomName) => {
        if (!ROOM_CONFIG.rooms.includes(roomName)) return;
        const room = rooms[roomName];
        if (Object.keys(room.players).length >= ROOM_CONFIG.maxPlayersPerRoom) {
            socket.emit("roomFull");
            return;
        }
        if (getRoomOfSocket(socket.id)) return;

        let finalPseudo = "Invité";
        let userColor =
            "#" +
            Math.floor(Math.random() * 16777215)
                .toString(16)
                .padStart(6, "0");
        if (socket.user && socket.user.pseudo) {
            finalPseudo = socket.user.pseudo;
            try {
                const user = await User.findOne({ pseudo: finalPseudo });
                if (user) {
                    if (user.isBanned) {
                        socket.emit("forceLobby", "banned");
                        socket.disconnect();
                        return;
                    }
                    await User.updateOne(
                        { pseudo: finalPseudo },
                        { $inc: { gamesJoined: 1 } },
                    );
                    if (user.currentSkin) userColor = user.currentSkin;
                }
            } catch (err) {}
        } else {
            finalPseudo = "Cube" + Math.floor(Math.random() * 1000);
        }

        socket.join(roomName);
        socket.currentRoom = roomName;

        room.players[socket.id] = {
            x: Math.floor(Math.random() * 900) + 50,
            y: Math.floor(Math.random() * 450) + 50,
            color: userColor,
            pseudo: finalPseudo,
            pendingDistance: 0,
            shield: false,
            speed: 1,
            invisible: false,
            isWolf: false,
        };

        if (!room.wolfId) {
            room.wolfId = socket.id;
            room.players[socket.id].isWolf = true;
            room.lastWolfMoveTime = Date.now();
            io.to(roomName).emit("updateWolf", room.wolfId);
        }

        socket.emit("gameJoined", {
            id: socket.id,
            info: room.players[socket.id],
            room: roomName,
        });
        socket.emit("currentPlayers", room.players);
        socket.emit("updateWolf", room.wolfId);
        socket.emit("powerupsInit", activePowerups[roomName]);
        socket.emit("portalsInit", roomPortals[roomName]);
        if (room.background) socket.emit("updateBackground", room.background);
        socket.emit("chatHistory", chatHistory[roomName].slice(-30));
        socket.emit("infectionMode", infectionMode[roomName]);

        socket.to(roomName).emit("newPlayer", {
            playerId: socket.id,
            playerInfo: room.players[socket.id],
        });

        // Envoyer obstacles actuels + timer
        socket.emit("obstaclesInit", roomObstacles[roomName]);

        // Démarrer la manche si c'est le premier joueur
        if (Object.keys(room.players).length === 1) {
            setTimeout(() => startRound(roomName), 1000);
        }

        await grantXP(finalPseudo, XP_CONFIG.perGame);

        await grantCoins(finalPseudo, COIN_REWARDS.perGame);
        // Envoyer coins actuels au joueur
        if (socket.user) {
            const userCoins = await User.findOne({
                pseudo: finalPseudo,
            }).select("coins");
            if (userCoins) socket.emit("coinsUpdate", userCoins.coins || 0);
        }
    });

    socket.on("leaveGame", async () => {
        await removePlayerFromGame(socket.id);
    });
    // Suppression de socket.on('toggleGodMode')

    socket.on("playerMovement", (movementData) => {
        const roomName = getRoomOfSocket(socket.id);
        if (!roomName) return;
        const room = rooms[roomName];
        const p = room.players[socket.id];
        if (!p) return;

        if (
            !movementData ||
            typeof movementData.x !== "number" ||
            typeof movementData.y !== "number" ||
            !Number.isFinite(movementData.x) ||
            !Number.isFinite(movementData.y)
        )
            return;

        const nextX = Math.max(0, Math.min(1200, movementData.x));
        const nextY = Math.max(0, Math.min(650, movementData.y));

        const dx = nextX - p.x,
            dy = nextY - p.y;
        p.pendingDistance += Math.sqrt(dx * dx + dy * dy);
        p.x = nextX;
        p.y = nextY;
        if (socket.id === room.wolfId) room.lastWolfMoveTime = Date.now();
        socket.to(roomName).emit("playerMoved", {
            playerId: socket.id,
            x: p.x,
            y: p.y,
            invisible: p.invisible,
        });

        // Vérif portails
        const currentPortals = roomPortals[roomName] || [];
        for (const portal of currentPortals) {
            if (
                Math.abs(p.x - portal.x) < 40 &&
                Math.abs(p.y - portal.y) < 40
            ) {
                const dest = currentPortals.find(
                    (pp) => pp.id === portal.pairId,
                );
                if (dest) {
                    p.x = dest.x + 50;
                    p.y = dest.y + 50;
                    socket.emit("teleport", { x: p.x, y: p.y });
                    io.to(roomName).emit("playerMoved", {
                        playerId: socket.id,
                        x: p.x,
                        y: p.y,
                    });
                }
            }
        }

        // Vérif power-ups
        const pus = activePowerups[roomName];
        for (let i = pus.length - 1; i >= 0; i--) {
            const pu = pus[i];
            if (Math.abs(p.x - pu.x) < 50 && Math.abs(p.y - pu.y) < 50) {
                pus.splice(i, 1);
                io.to(roomName).emit("collectPowerup", {
                    uid: pu.uid,
                    playerId: socket.id,
                    type: pu.type,
                    duration: pu.duration,
                });
                p[pu.type] = true;
                if (pu.type === "speed") p.speedBoost = true;
                setTimeout(() => {
                    if (room.players[socket.id]) {
                        room.players[socket.id][pu.type] = false;
                        room.players[socket.id].speedBoost = false;
                        socket.emit("powerupExpired", pu.type);
                    }
                }, pu.duration);
            }
        }
    });

    socket.on("tagPlayer", async (targetId) => {
        const roomName = getRoomOfSocket(socket.id);
        if (!roomName) return;
        const room = rooms[roomName];
        const wolf = room.players[socket.id];
        const target = room.players[targetId];
        if (!wolf || !target) return;
        if (target.shield) {
            socket.emit("serverMessage", {
                text: "🛡️ Bouclier !",
                color: "#00aaff",
            });
            return;
        }

        const isWolfMode = !infectionMode[roomName];
        const canTag = isWolfMode ? socket.id === room.wolfId : wolf.isWolf;
        if (!canTag) return;

        const now = Date.now();
        if (now - lastTagTime < TAG_COOLDOWN) return;
        const dx = Math.abs(wolf.x - target.x),
            dy = Math.abs(wolf.y - target.y);
        if (dx >= 90 || dy >= 90) return;

        lastTagTime = now;
        io.to(roomName).emit("playerTagged", {
            x: target.x + 25,
            y: target.y + 25,
            color: target.color,
        });

        if (wolf) wolf.roundTags = (wolf.roundTags || 0) + 1;

        if (isWolfMode) {
            room.wolfId = targetId;
            wolf.isWolf = false;
            target.isWolf = true;
            io.to(roomName).emit("updateWolf", room.wolfId);
            room.lastWolfMoveTime = Date.now();
        } else {
            // Mode infection
            target.isWolf = true;
            io.to(roomName).emit("infectedPlayer", targetId);
        }

        // Streak
        const wolfPseudo = wolf.pseudo;
        if (!tagStreaks[wolfPseudo]) tagStreaks[wolfPseudo] = 0;
        tagStreaks[wolfPseudo]++;
        const streak = tagStreaks[wolfPseudo];
        if (streak >= 3)
            io.to(roomName).emit("serverMessage", {
                text: `🔥 ${wolfPseudo} est en feu ! (x${streak})`,
                color: "#ff6600",
            });

        if (
            target.pseudo &&
            !target.pseudo.startsWith("Cube") &&
            target.pseudo !== "Invité"
        ) {
            tagStreaks[target.pseudo] = 0;
        }

        // Stats BDD
        const wolfP = wolf.pseudo;
        const targetP = target.pseudo;
        if (wolfP !== "Invité" && !wolfP.startsWith("Cube")) {
            const uWolf = await User.findOne({ pseudo: wolfP });
            if (uWolf) {
                uWolf.tagsInflicted++;
                await checkAchievements(uWolf, socket.id);
                await uWolf.save();
            }
            await grantXP(wolfP, XP_CONFIG.tagInflicted);
            await grantCoins(wolfP, COIN_REWARDS.tagInflicted);
        }
        if (targetP !== "Invité" && !targetP.startsWith("Cube")) {
            const uTarget = await User.findOne({ pseudo: targetP });
            if (uTarget) {
                uTarget.timesTagged++;
                await checkAchievements(uTarget, targetId);
                await uTarget.save();
            }
            await grantXP(targetP, XP_CONFIG.tagReceived);
        }
    });

    socket.on("changeBackground", async (imageData) => {
        const now = Date.now();
        if (uploadCooldowns[socket.id] && now < uploadCooldowns[socket.id]) {
            socket.emit(
                "uploadError",
                `Attends encore ${Math.ceil((uploadCooldowns[socket.id] - now) / 1000)}s.`,
            );
            return;
        }
        if (!API_USER || !API_SECRET) {
            socket.emit("uploadError", "Analyse d'image désactivée.");
            return;
        }

        if (!isSafeBackgroundDataUrl(imageData)) {
            socket.emit("uploadError", "Image invalide ou trop lourde.");
            return;
        }

        try {
            const base64Data = imageData.replace(
                /^data:image\/\w+;base64,/,
                "",
            );
            let imageBuffer = Buffer.from(base64Data, "base64");
            if (imageBuffer.length > 1_500_000) {
                socket.emit("uploadError", "Image trop lourde (max ~1.5MB).");
                return;
            }
            const isGif = imageBuffer.toString("ascii", 0, 3) === "GIF";
            if (isGif) {
                const metadata = await sharp(imageBuffer).metadata();
                imageBuffer = await sharp(imageBuffer, {
                    page: Math.floor(Math.random() * (metadata.pages || 1)),
                })
                    .png()
                    .toBuffer();
            }
            const form = new FormData();
            form.append("media", imageBuffer, "image.jpg");
            form.append("models", "nudity");
            form.append("api_user", API_USER);
            form.append("api_secret", API_SECRET);
            const response = await axios.post(API_URL, form, {
                headers: form.getHeaders(),
                timeout: 10_000,
                maxBodyLength: 2 * 1024 * 1024,
                maxContentLength: 2 * 1024 * 1024,
            });
            if (response.data.status === "success") {
                if (
                    response.data.nudity.raw > 0.5 ||
                    response.data.nudity.partial > 0.6
                ) {
                    uploadCooldowns[socket.id] = now + COOLDOWN_PENALTY;
                    const rn2 = getRoomOfSocket(socket.id);
                    if (rn2) {
                        rooms[rn2].background = BLOCKED_IMG;
                        io.to(rn2).emit("updateBackground", BLOCKED_IMG);
                    }
                    socket.emit(
                        "uploadError",
                        "Image interdite ! Bloqué 1 min.",
                    );
                } else {
                    uploadCooldowns[socket.id] = now + COOLDOWN_NORMAL;
                    const rn = getRoomOfSocket(socket.id);
                    if (rn) {
                        rooms[rn].background = imageData;
                        io.to(rn).emit("updateBackground", imageData);
                    }
                    if (socket.user && socket.user.pseudo) {
                        const u = await User.findOne({
                            pseudo: socket.user.pseudo,
                        });
                        if (u) {
                            u.backgroundsChanged++;
                            await checkAchievements(u, socket.id);
                            await u.save();
                        }
                    }
                }
            }
        } catch (error) {
            socket.emit("uploadError", "Erreur analyse image.");
        }
    });

    socket.on("saveSkin", async (data) => {
        const color = typeof data?.color === "string" ? data.color.trim() : "";
        if (
            socket.user &&
            socket.user.pseudo &&
            color &&
            isSafeCurrentSkinValue(color)
        )
            await User.updateOne(
                { pseudo: socket.user.pseudo },
                { $set: { currentSkin: color } },
            );
    });
    socket.on("redeemCode", async (data) => {
        const codeRaw = typeof data?.code === "string" ? data.code : "";
        if (!socket.user || !socket.user.pseudo) {
            socket.emit("codeError", "Connecte-toi d'abord !");
            return;
        }
        const pseudo = socket.user.pseudo;
        const cleanCode = codeRaw.trim().toUpperCase();
        if (!/^[A-Z0-9_-]{3,40}$/.test(cleanCode)) {
            socket.emit("codeError", "Code invalide.");
            return;
        }
        if (SECRET_CODES[cleanCode]) {
            const reward = SECRET_CODES[cleanCode];
            const user = await User.findOne({ pseudo });
            if (user) {
                if (!user.redeemedCodes) user.redeemedCodes = [];
                if (user.redeemedCodes.includes(cleanCode))
                    socket.emit("codeError", "Code déjà utilisé !");
                else {
                    user.redeemedCodes.push(cleanCode);
                    if (!user.unlockedSkins.includes(reward.skin)) {
                        user.unlockedSkins.push(reward.skin);
                        await user.save();
                        socket.emit(
                            "codeSuccess",
                            `Skin débloqué : ${reward.name}`,
                        );
                        socket.emit("updateSkins", user.unlockedSkins);
                    } else {
                        socket.emit("codeError", "Tu as déjà ce skin !");
                        await user.save();
                    }
                }
            }
        } else socket.emit("codeError", "Code invalide.");
    });

    // CHAT
    socket.on("chatMessage", (msg) => {
        const roomName = getRoomOfSocket(socket.id);
        if (!roomName) return;
        const p = rooms[roomName].players[socket.id];
        if (!p) return;

        const now = Date.now();
        if (chatCooldowns[socket.id] && now - chatCooldowns[socket.id] < 500)
            return;
        chatCooldowns[socket.id] = now;

        const clean = sanitizeBasicText(msg, 100);
        if (!clean) return;
        const safePseudo = sanitizeBasicText(p.pseudo, 20) || "Joueur";
        const entry = { pseudo: safePseudo, msg: clean, ts: Date.now() };
        chatHistory[roomName].push(entry);
        if (chatHistory[roomName].length > 100) chatHistory[roomName].shift();
        io.to(roomName).emit("chatMessage", entry);
    });

    // TOGGLE INFECTION MODE (admin)
    socket.on("toggleInfection", async () => {
        if (!socket.user) return;
        const user = await User.findById(socket.user.id);
        if (!user || !user.isAdmin) return;
        const roomName = getRoomOfSocket(socket.id);
        if (!roomName) return;
        infectionMode[roomName] = !infectionMode[roomName];
        io.to(roomName).emit("infectionMode", infectionMode[roomName]);
        io.to(roomName).emit("serverMessage", {
            text: infectionMode[roomName]
                ? "🧟 MODE INFECTION ACTIVÉ !"
                : "🐺 Mode normal rétabli",
            color: infectionMode[roomName] ? "#aa0000" : "#00aa00",
        });
    });

    socket.on("disconnect", async () => {
        await removePlayerFromGame(socket.id);
        delete uploadCooldowns[socket.id];
        delete chatCooldowns[socket.id];
    });
});

setInterval(() => {
    for (const roomName in rooms) {
        const room = rooms[roomName];
        const ids = Object.keys(room.players);
        if (
            room.wolfId &&
            ids.length > 1 &&
            Date.now() - room.lastWolfMoveTime > 15000
        ) {
            const ws = [...io.sockets.sockets.values()].find(
                (s) => s.id === room.wolfId,
            );
            if (ws) ws.emit("forceLobby", "afk");
            removePlayerFromGame(room.wolfId);
        }
        // Spawn power-up toutes les ~10s si conditions OK
        if (Math.random() < 0.1) spawnPowerup(roomName);
    }
}, 1000);

// Stats graphiques (1min) - Optimisé
const saveGraphStats = async () => {
    try {
        const count = Object.keys(players).length;
        const last = await ConnStat.findOne().sort({ timestamp: -1 });

        // Protection anti-spam (moins de 55s)
        if (last && Date.now() - last.timestamp < 55000) return;

        // Si le nombre de joueurs est identique au dernier enregistrement, on ignore
        if (last && last.count === count) return;

        await ConnStat.create({ count });
    } catch (e) {
        console.error("Erreur stats:", e);
    }
};
saveGraphStats();
setInterval(saveGraphStats, 60 * 1000);

// Nettoyage automatique des stats > 24h (Toutes les heures)
setInterval(
    async () => {
        try {
            const limitDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
            await ConnStat.deleteMany({ timestamp: { $lt: limitDate } });
        } catch (e) {
            console.error("Erreur nettoyage stats:", e);
        }
    },
    60 * 60 * 1000,
);

// Sauvegarde distances
setInterval(
    async () => {
        for (const id in players) {
            const p = players[id];
            if (
                p.pendingDistance > 0 &&
                p.pseudo !== "Invité" &&
                !p.pseudo.startsWith("Cube")
            ) {
                try {
                    const user = await User.findOne({ pseudo: p.pseudo });
                    if (user) {
                        user.distanceTraveled += Math.round(p.pendingDistance);
                        await checkAchievements(user, id);
                        await user.save();
                    }
                    p.pendingDistance = 0;
                } catch (err) {}
            }
        }
    },
    60 * 60 * 1000,
);

const PORT = process.env.PORT || 2220;
http.listen(PORT, "0.0.0.0", () =>
    console.log(`Serveur lancé sur le port ${PORT}`),
);
