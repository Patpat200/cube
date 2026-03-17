// --- CONFIGURATION DU JEU (Succès & Codes) ---

// 1. LISTE DES SUCCÈS
const ACHIEVEMENTS = [
    { 
        id: 'first_blood', 
        name: 'Premier Sang', 
        desc: 'Infliger 1 tag', 
        condition: (u) => u.tagsInflicted >= 1, 
        rewardSkin: '#ff0000', 
        skinName: 'Rouge Sang' 
    },
    { 
        id: 'hunter_pro', 
        name: 'Chasseur Pro', 
        desc: 'Infliger 10 tags', 
        condition: (u) => u.tagsInflicted >= 10, 
        rewardSkin: 'linear-gradient(45deg, #ff9a9e 0%, #fecfef 99%, #fecfef 100%)', 
        skinName: 'Aube' 
    },
    // NOUVEAU SUCCÈS
    {
        id: 'master_hunter',
        name: 'Maître Chasseur',
        desc: 'Infliger 50 tags',
        condition: (u) => u.tagsInflicted >= 50,
        rewardSkin: 'skin-neon', // CSS class
        skinName: 'Néon Futuriste'
    },
    { 
        id: 'traveler', 
        name: 'Voyageur', 
        desc: 'Parcourir 5 000px', 
        condition: (u) => u.distanceTraveled >= 5000, 
        rewardSkin: '#00ccff', 
        skinName: 'Azur' 
    },
    { 
        id: 'marathon', 
        name: 'Marathonien', 
        desc: 'Parcourir 20 000px', 
        condition: (u) => u.distanceTraveled >= 20000, 
        rewardSkin: 'linear-gradient(to right, #f12711, #f5af19)', 
        skinName: 'Feu' 
    },
    // NOUVEAU SUCCÈS
    {
        id: 'veteran',
        name: 'Vétéran',
        desc: 'Parcourir 1 000 000px',
        condition: (u) => u.distanceTraveled >= 1000000,
        rewardSkin: 'skin-plasma', // CSS class
        skinName: 'Plasma Fluide'
    },
    { 
        id: 'architect', 
        name: 'Architecte', 
        desc: 'Changer 5 fois de fond', 
        condition: (u) => u.backgroundsChanged >= 5, 
        rewardSkin: '#9b59b6', 
        skinName: 'Améthyste' 
    },
    { 
        id: 'survivor', 
        name: 'Sac de frappe', 
        desc: 'Être touché 10 fois', 
        condition: (u) => u.timesTagged >= 10, 
        rewardSkin: '#7f8c8d', 
        skinName: 'Fantôme' 
    },
    { 
        id: 'god_mode', 
        name: 'Dieu du jeu', 
        desc: 'Tout débloquer (Impossible)', 
        condition: (u) => false, 
        rewardSkin: 'skin-rainbow', 
        skinName: 'Lumière Divine' 
    },
    { 
        id: 'white_walker', 
        name: 'Marcheur Blanc', 
        desc: 'Parcourir 2 000 000px', 
        condition: (u) => u.distanceTraveled >= 2000000, 
        rewardSkin: 'skin-snow',  // <-- Le nom de la classe CSS
        skinName: 'Hiver Éternel' 
    },
    { 
        id: 'badapple', 
        name: 'Bad Apple!', 
        desc: 'Rejoindre 100 parties', 
        condition: (u) => u.gamesJoined >= 100, 
        rewardSkin: 'https://files.catbox.moe/8a4984.gif',  // <-- Le nom de la classe CSS
        skinName: 'Bad Apple!' 
    },
    { 
        id: 'cat', 
        name: 'Chat Kawaii', 
        desc: 'Rejoindre 1000 parties', 
        condition: (u) => u.gamesJoined >= 1000, 
        rewardSkin: 'skin-kawaii-cat',  // <-- Le nom de la classe CSS
        skinName: 'Chat Kawaii' 
    },
    {
        id: 'inverser',
        name: 'Le Monde à l\'Envers',
        desc: 'Infliger 100 tags',
        condition: (u) => u.tagsInflicted >= 100,
        rewardSkin: 'skin-negative',
        skinName: 'Négatif'
    },
    { 
        id: 'hiden',
        name: 'Cube Caché',
        desc: 'Être touché 100 fois',
        condition: (u) => u.timesTagged >= 100,
        rewardSkin: 'skin-hiden',
        skinName: 'Cube Caché'
    },
    { 
        id: 'triangle',
        name: 'Cube Triangle?',
        desc: 'Changer 10 fois de fond',
        condition: (u) => u.backgroundsChanged >= 10,
        rewardSkin: 'skin-triangle',
        skinName: 'Cube Triangle?'
    },
    { 
        id: 'eyes',
        name: 'Cube 👁️👄👁️',
        desc: 'Parcourir 4 000 000px', 
        condition: (u) => u.distanceTraveled >= 4000000, 
        rewardSkin: 'skin-eyes',
        skinName: '👁️👄👁️'
    }
];

// 2. CODES SECRETS
const SECRET_CODES = {
    "PATPAT": { 
        skin: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', 
        name: 'Skin Admin' 
    },
    "DEV2025": { 
        skin: '#00ff00', 
        name: 'Hacker Green' 
    },
    "GOLD": {
        skin: 'linear-gradient(to bottom, #f7971e, #ffd200)',
        name: 'Or Massif'
    },
    "RAINBOW": { 
        skin: 'skin-rainbow', 
        name: 'Arc-en-ciel' 
    },
    "MATRIX": { 
        skin: 'skin-glitch', 
        name: 'Matrix' 
    },
    "BOOM": {
        skin: 'skin-pulse',
        name: 'Pulsation'
    },
    "PLASMA": {
        skin: 'skin-plasma',
        name: 'Plasma Gratuit'
    },
    "GENTLEMAN": {
        skin: 'skin-tophat',
        name: 'Le Chic'
    },
    "PIXEL": {
        skin: 'https://art.pixilart.com/original/sr5z26073f1b17aws3.gif', 
        name: 'Pixel Art'
    }
};



// 3. CONFIGURATION DES POWER-UPS
const POWERUP_TYPES = [
    { id: 'shield',    label: '🛡️', color: '#00aaff', duration: 5000,  desc: 'Bouclier 5s' },
    { id: 'speed',     label: '⚡', color: '#ffdd00', duration: 6000,  desc: 'Vitesse x2 6s' },
    { id: 'invisible', label: '👻', color: '#aaffaa', duration: 4000,  desc: 'Invisible 4s' },
];

// 4. CONFIGURATION DES ROOMS
const ROOM_CONFIG = {
    maxPlayersPerRoom: 12,
    rooms: ['Arène 1', 'Arène 2', 'Arène 3']
};

// 5. CONFIGURATION XP
const XP_CONFIG = {
    tagInflicted:   50,
    tagReceived:    10,
    distancePer100: 1,
    perGame:        5,
};

// 6. OBSTACLES (zones rectangulaires infranchissables)
const OBSTACLES = [
    { x: 200, y: 150, w: 80, h: 20 },
    { x: 500, y: 300, w: 20, h: 120 },
    { x: 800, y: 200, w: 80, h: 20 },
    { x: 350, y: 450, w: 20, h: 100 },
    { x: 650, y: 100, w: 100, h: 20 },
    { x: 1000, y: 350, w: 20, h: 80 },
];

// 7. PORTAILS
const PORTALS = [
    { id: 'A', x: 50,   y: 50,  pairId: 'B' },
    { id: 'B', x: 1150, y: 600, pairId: 'A' },
];

// 8. BOUTIQUE DE SKINS (50+ skins)
const SHOP_SKINS = [
    // --- TIER 1 : 100 coins ---
    { id: 'shop_lava',      name: 'Lave',           price: 100,  tier: 1, value: 'linear-gradient(135deg, #ff4500, #ff8c00, #ff4500)', desc: 'Brûlant' },
    { id: 'shop_ocean',     name: 'Océan',           price: 100,  tier: 1, value: 'linear-gradient(135deg, #006994, #00bfff, #006994)', desc: 'Profondeurs marines' },
    { id: 'shop_forest',    name: 'Forêt',           price: 100,  tier: 1, value: 'linear-gradient(135deg, #228b22, #90ee90, #228b22)', desc: 'Nature sauvage' },
    { id: 'shop_sunset',    name: 'Coucher de soleil',price: 100, tier: 1, value: 'linear-gradient(135deg, #ff6b35, #f7c59f, #efefd0)', desc: 'Crépuscule' },
    { id: 'shop_midnight',  name: 'Minuit',          price: 100,  tier: 1, value: 'linear-gradient(135deg, #0a0a2e, #1a1a5e, #0a0a2e)', desc: 'Nuit profonde' },
    { id: 'shop_candy',     name: 'Bonbon',          price: 100,  tier: 1, value: 'linear-gradient(135deg, #ff69b4, #ffb6c1, #ff69b4)', desc: 'Sucré' },
    { id: 'shop_slate',     name: 'Ardoise',         price: 100,  tier: 1, value: '#708090', desc: 'Sobre et élégant' },
    { id: 'shop_crimson',   name: 'Cramoisi',        price: 100,  tier: 1, value: '#dc143c', desc: 'Rouge intense' },
    { id: 'shop_teal',      name: 'Sarcelle',        price: 100,  tier: 1, value: '#008080', desc: 'Bleu-vert unique' },
    { id: 'shop_coral',     name: 'Corail',          price: 100,  tier: 1, value: '#ff7f50', desc: 'Chaleureux' },

    // --- TIER 2 : 250 coins ---
    { id: 'shop_aurora',    name: 'Aurore Boréale',  price: 250,  tier: 2, value: 'skin-aurora',   desc: 'Lumières du nord' },
    { id: 'shop_galaxy',    name: 'Galaxie',         price: 250,  tier: 2, value: 'skin-galaxy',   desc: 'Univers infini' },
    { id: 'shop_fire',      name: 'Flammes',         price: 250,  tier: 2, value: 'skin-fire',     desc: 'En feu' },
    { id: 'shop_ice',       name: 'Glace',           price: 250,  tier: 2, value: 'skin-ice',      desc: 'Cristaux gelés' },
    { id: 'shop_toxic',     name: 'Toxique',         price: 250,  tier: 2, value: 'skin-toxic',    desc: 'Dangereux' },
    { id: 'shop_hologram',  name: 'Hologramme',      price: 250,  tier: 2, value: 'skin-hologram', desc: 'Projection 3D' },
    { id: 'shop_lavaflow',  name: 'Lave Fluide',     price: 250,  tier: 2, value: 'skin-lavaflow', desc: 'Magma en mouvement' },
    { id: 'shop_vaporwave', name: 'Vaporwave',       price: 250,  tier: 2, value: 'skin-vaporwave',desc: 'Esthétique rétro' },
    { id: 'shop_matrix2',   name: 'Matrix 2.0',      price: 250,  tier: 2, value: 'skin-matrix2',  desc: 'Code numérique' },
    { id: 'shop_bloodmoon', name: 'Lune de Sang',    price: 250,  tier: 2, value: 'skin-bloodmoon',desc: 'Eclipse lunaire' },
    { id: 'shop_shadow',    name: 'Ombre',           price: 250,  tier: 2, value: 'skin-shadow',   desc: 'Dissimulation' },
    { id: 'shop_lightning', name: 'Foudre',          price: 250,  tier: 2, value: 'skin-lightning',desc: 'Électrisant' },

    // --- TIER 3 : 500 coins ---
    { id: 'shop_blackhole', name: 'Trou Noir',       price: 500,  tier: 3, value: 'skin-blackhole',desc: 'Aspire tout' },
    { id: 'shop_prism',     name: 'Prisme',          price: 500,  tier: 3, value: 'skin-prism',    desc: 'Réfraction lumineuse' },
    { id: 'shop_cyberpunk', name: 'Cyberpunk',       price: 500,  tier: 3, value: 'skin-cyberpunk',desc: 'Futur dystopique' },
    { id: 'shop_void',      name: 'Le Néant',        price: 500,  tier: 3, value: 'skin-void',     desc: 'Rien... ou presque' },
    { id: 'shop_storm',     name: 'Tempête',         price: 500,  tier: 3, value: 'skin-storm',    desc: 'Électricité statique' },
    { id: 'shop_inferno',   name: 'Enfer',           price: 500,  tier: 3, value: 'skin-inferno',  desc: 'Chaleur extrême' },
    { id: 'shop_crystal',   name: 'Cristal',         price: 500,  tier: 3, value: 'skin-crystal',  desc: 'Transparent et pur' },
    { id: 'shop_acid',      name: 'Acide',           price: 500,  tier: 3, value: 'skin-acid',     desc: 'Corrosif' },
    { id: 'shop_mirage',    name: 'Mirage',          price: 500,  tier: 3, value: 'skin-mirage',   desc: 'Illusion optique' },
    { id: 'shop_obsidian',  name: 'Obsidienne',      price: 500,  tier: 3, value: 'skin-obsidian', desc: 'Pierre volcanique' },
    { id: 'shop_nuke',      name: 'Nucléaire',       price: 500,  tier: 3, value: 'skin-nuke',     desc: 'Radioactif' },
    { id: 'shop_warp',      name: 'Distorsion',      price: 500,  tier: 3, value: 'skin-warp',     desc: 'Déformation spatiale' },

    // --- TIER 4 : 1000 coins (RARES) ---
    { id: 'shop_supernova', name: 'Supernova',       price: 1000, tier: 4, value: 'skin-supernova',desc: 'Explosion stellaire' },
    { id: 'shop_angelic',   name: 'Angélique',       price: 1000, tier: 4, value: 'skin-angelic',  desc: 'Lumière divine' },
    { id: 'shop_demonic',   name: 'Démoniaque',      price: 1000, tier: 4, value: 'skin-demonic',  desc: 'Obscurité totale' },
    { id: 'shop_quantum',   name: 'Quantique',       price: 1000, tier: 4, value: 'skin-quantum',  desc: 'Superposition d\'états' },
    { id: 'shop_timewarp',  name: 'Voyage Temporel', price: 1000, tier: 4, value: 'skin-timewarp', desc: 'Distorsion du temps' },
    { id: 'shop_dreamcore', name: 'Dreamcore',       price: 1000, tier: 4, value: 'skin-dreamcore',desc: 'Entre rêve et réalité' },
    { id: 'shop_cosmos',    name: 'Cosmos',          price: 1000, tier: 4, value: 'skin-cosmos',   desc: 'L\'univers entier' },
    { id: 'shop_phantom',   name: 'Fantôme Royal',   price: 1000, tier: 4, value: 'skin-phantom',  desc: 'Spectre noble' },
    { id: 'shop_titan',     name: 'Titan',           price: 1000, tier: 4, value: 'skin-titan',    desc: 'Colossal' },
    { id: 'shop_ethereal',  name: 'Éthéré',          price: 1000, tier: 4, value: 'skin-ethereal', desc: 'Entre deux mondes' },

    // --- TIER 5 : 2500 coins (LÉGENDAIRES) ---
    { id: 'shop_celestial', name: 'Céleste',         price: 2500, tier: 5, value: 'skin-celestial',desc: '✨ Légendaire' },
    { id: 'shop_chaos',     name: 'Chaos Absolu',    price: 2500, tier: 5, value: 'skin-chaos',    desc: '✨ Légendaire' },
    { id: 'shop_genesis',   name: 'Genèse',          price: 2500, tier: 5, value: 'skin-genesis',  desc: '✨ Légendaire' },
    { id: 'shop_omega',     name: 'Oméga',           price: 2500, tier: 5, value: 'skin-omega',    desc: '✨ Légendaire' },
    { id: 'shop_abyssal',   name: 'Abyssal',         price: 2500, tier: 5, value: 'skin-abyssal',  desc: '✨ Légendaire' },
    { id: 'shop_nebula',    name: 'Nébuleuse',       price: 2500, tier: 5, value: 'skin-nebula',   desc: '✨ Légendaire' },
    { id: 'shop_aurora2',   name: 'Grande Aurore',   price: 2500, tier: 5, value: 'skin-aurora2',  desc: '✨ Légendaire' },
    { id: 'shop_singularity',name:'Singularité',     price: 2500, tier: 5, value: 'skin-singularity',desc:'✨ Légendaire' },
];

// Coins gagnés par action
const COIN_REWARDS = {
    tagInflicted:   10,
    perGame:         2,
    distancePer500:  1,
    roundWin:       25,
};

module.exports = { ACHIEVEMENTS, SECRET_CODES, POWERUP_TYPES, ROOM_CONFIG, XP_CONFIG, OBSTACLES, PORTALS, SHOP_SKINS, COIN_REWARDS };