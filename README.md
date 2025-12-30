# **Cube — Jeu multijoueur (serveur Node/Socket.io)**

<a href="https://github.com/Patpat200/cube/stargazers"><img src="https://img.shields.io/github/stars/Patpat200/cube" alt="Stars Badge"/></a>
<a href="https://github.com/Patpat200/cube/network/members"><img src="https://img.shields.io/github/forks/Patpat200/cube" alt="Forks Badge"/></a>
<a href="https://github.com/Patpat200/cube/pulls"><img src="https://img.shields.io/github/issues-pr/Patpat200/cube" alt="Pull Requests Badge"/></a>
<a href="https://github.com/Patpat200/cube/issues"><img src="https://img.shields.io/github/issues/Patpat200/cube" alt="Issues Badge"/></a>
<a href="https://github.com/Patpat200/cube/graphs/contributors"><img alt="GitHub contributors" src="https://img.shields.io/github/contributors/Patpat200/cube?color=2b9348"></a>


- **Projet :** Un petit jeu multijoueur web «Cube» avec authentification, scores, skins et arrière-plans personnalisés.
- **Fichiers clés :** `server.js`, `gameConfig.js`, dossier `public/` (HTML/CSS/JS clients).

**Description**
- Ce dépôt contient le serveur Node.js d'un jeu en temps réel utilisant `socket.io` pour la logique multijoueur et une API REST minimale pour l'authentification et la gestion des statistiques.
- Le serveur gère les comptes (MongoDB), les achievements, les skins et l'upload d'images (analyse via SightEngine si configuré).

**Démo locale**
- Ouvre un navigateur sur `http://localhost:2220` (ou le port que vous aurez configuré).

**Prérequis**
- Node.js (>= 14 recommandé)
- MongoDB (URI accessible)
- Une clé JWT secrète pour sécuriser les tokens

**Variables d'environnement**
Créez un fichier `.env` à la racine avec au minimum :

```
JWT_SECRET=votre_secret_jwt_long_et_complexe
MONGO_URI=mongodb://utilisateur:mdp@host:port/dbname
# Optionnel pour analyse d'image (SightEngine)
SIGHTENGINE_USER=xxx
SIGHTENGINE_SECRET=yyy
# Port doublement optionnel
PORT=2220
```

**Installation**

1. Installer les dépendances :

```
npm install
```

2. Lancer le serveur :

```
node server.js
```

Le serveur écoute par défaut sur le port `2220` si `PORT` n'est pas défini.

**Structure principale**
- `server.js` : logique serveur (Express + Socket.io), API REST et gestion des utilisateurs.
- `gameConfig.js` : configuration des achievements, codes secrets, et mappings de skins.
- `public/` : client web statique (`index.html`, styles, assets).

**Fonctionnalités**
- Authentification (enregistrement / login) avec JWT.
- Parties en temps réel via `socket.io` (rejoindre, se déplacer, taguer).
- Sauvegarde des statistiques utilisateur (MongoDB).
- Système d'achievements et skins débloquables.
- Upload d'image pour arrière-plan avec analyse (optionnelle) pour filtrer contenu inapproprié.

**Personnalisation rapide**
- Modifier les récompenses et achievements : éditez `gameConfig.js`.
- Modifier l'interface : éditez `public/index.html` et `public/skins.css`.

**Sécurité & bonnes pratiques**
- Ne publiez jamais votre `JWT_SECRET` ou `MONGO_URI` en clair dans le dépôt.
- Utilisez des mots de passe forts et limitez l'accès à votre base de données.
- Le serveur utilise `helmet` et des rate-limiters pour améliorer la sécurité.

**Dépannage rapide**
- Erreur démarrage liée au JWT : assurez-vous que `JWT_SECRET` est défini.
- Problème de connexion Mongo : vérifiez `MONGO_URI` et la disponibilité de MongoDB.
- Si les uploads d'image échouent, vérifiez `SIGHTENGINE_USER` et `SIGHTENGINE_SECRET` ou désactivez l'analyse.

**Contribution**
- Suggestions, corrections ou nouvelles fonctionnalités : ouvrez une issue ou une PR.
- Avant une PR, ajoutez une description claire et, si possible, un petit test manuel décrivant la validation.

**Prochaines étapes recommandées**
- Ajouter un script `npm start` dans `package.json` (si absent).
- Ajouter des tests automatés pour les routes critiques.
- Documenter les endpoints API (`/api/register`, `/api/login`, `/api/me`, `/api/leaderboard`, etc.).

**Star History**

[![Star History Chart](https://api.star-history.com/svg?repos=Patpat200/cube&type=date&legend=top-left)](https://www.star-history.com/#Patpat200/cube&type=date&legend=top-left)
