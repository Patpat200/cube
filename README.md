# Cube

**Présentation**
- **Nom**: `cube` — petit projet web Node.js utilisant `express` et `socket.io`.
- **But**: servir une application front (dans `public/`) via un serveur Node local.

**Prérequis**
- **Node.js**: version 16+ recommandée.
- **npm**: livré avec Node.js.

**Installation**
- Clonez le dépôt ou placez-vous dans le dossier du projet:


- Installez les dépendances:

```pwsh
npm install
```

**Lancer l'application**
- Démarrer le serveur (exécute `server.js`):

```pwsh
node server.js
# ou (si vous préférez un script npm):
# npm start  # (script `start` non défini par défaut dans `package.json`)
```

- Ouvrez votre navigateur à l'adresse: `http://localhost:2220` (ou le port exposé par `server.js`).

**Scripts utiles**
- **Installer**: `npm install`
- **Démarrer**: `node server.js`


**Structure du projet**
- **`server.js`** : serveur Node/Express qui sert le contenu et gère les sockets.
- **`public/`** : fichiers statiques (ex. `index.html`, CSS, client JS).
- **`package.json`** : dépendances et scripts du projet.

**Développement**
- Modifiez les fichiers dans `public/` pour changer l'interface.
- Si vous utilisez `socket.io`, redémarrez le serveur après modification du code serveur.
- Pour un redémarrage automatique (optionnel), installez `nodemon` globalement ou en dépendance de développement:

```pwsh
npm install --save-dev nodemon
npx nodemon server.js
```

**Dépannage**
- Si une dépendance manque: réexécutez `npm install`.
- Vérifiez le port dans `server.js` si la page ne s'affiche pas.

**Testé**
- Vous pouvez tester le jeux directement sur se [site](https://cube.patpat-web.uk/)

**RGB**
```js
let color = true;    

function changeColor(colorInput) {
    const newColor = colorInput;
    socket.emit('changeColor', newColor);
    document.getElementById('status').innerText = "Couleur changée !";
    setTimeout(() => { document.getElementById('status').innerText = ""; }, 2000);
    document.body.focus(); 
}

// Function to generate a random color
function getRandomColor() {
    const r = Math.floor(Math.random() * 256);
    const g = Math.floor(Math.random() * 256);
    const b = Math.floor(Math.random() * 256);
    return `rgb(${r}, ${g}, ${b})`;
}

// Change color every second if color is true
const changeColorInterval = setInterval(() => {
    if (color) {
        const newColor = getRandomColor();
        changeColor(newColor);
    } else {
        clearInterval(changeColorInterval);
    }
}, 100);

// To stop the color changing, set color to false
// color = false; 
```
