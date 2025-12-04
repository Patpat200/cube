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
        skin: 'skin-tophat', // Le nom de la classe CSS qu'on vient de créer
        name: 'Le Chic'
    }
};

module.exports = { ACHIEVEMENTS, SECRET_CODES };