# 🕵️ UNDERCOVER — Jeu Web Multijoueur

Jeu de déduction sociale inspiré d'Undercover, pensé pour les smartphones.  
**3 à 10 joueurs** • Temps réel via Firebase • Hébergement gratuit Vercel/Netlify

---

## 🚀 Installation rapide

### 1. Cloner et installer

```bash
git clone <ton-repo>
cd undercover-game
npm install
```

### 2. Configurer Firebase

**a) Crée un projet Firebase**
- Va sur [console.firebase.google.com](https://console.firebase.google.com/)
- Clique "Ajouter un projet"

**b) Active les services nécessaires**
- **Authentication** → Connexion → Activer la méthode "**Anonyme**"
- **Realtime Database** → Créer une base de données → Choisir une région (europe-west1 recommandé) → Commencer en mode test

**c) Récupère la config**
- Paramètres du projet → Tes applications → Ajouter une application Web
- Copie les valeurs `firebaseConfig`

**d) Crée ton `.env.local`**

```bash
cp .env.example .env.local
```

Remplis `.env.local` avec tes valeurs :

```env
VITE_FIREBASE_API_KEY=AIzaSy...
VITE_FIREBASE_AUTH_DOMAIN=ton-projet.firebaseapp.com
VITE_FIREBASE_DATABASE_URL=https://ton-projet-default-rtdb.europe-west1.firebasedatabase.app
VITE_FIREBASE_PROJECT_ID=ton-projet
VITE_FIREBASE_STORAGE_BUCKET=ton-projet.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=123456789
VITE_FIREBASE_APP_ID=1:123456789:web:abc123
```

### 3. Règles de sécurité Firebase (Realtime Database)

Dans la console Firebase → Realtime Database → **Rules**, colle :

```json
{
  "rules": {
    "rooms": {
      "$roomCode": {
        ".read": true,
        ".write": "auth != null",
        "players": {
          "$uid": {
            ".write": "auth != null && (auth.uid == $uid || data.parent().parent().child('creatorId').val() == auth.uid)"
          }
        }
      }
    }
  }
}
```

### 4. Lancer en développement

```bash
npm run dev
```

→ Ouvre [http://localhost:3000](http://localhost:3000)

---

## 📦 Déploiement

### Vercel (recommandé)

```bash
npm install -g vercel
vercel
```

Ajoute tes variables d'environnement dans le dashboard Vercel (Settings → Environment Variables).

### Netlify

```bash
npm run build
# Déploie le dossier `dist/`
```

---

## 🎮 Règles du jeu

### Rôles

| Rôle | Nombre | Description |
|------|--------|-------------|
| 👤 Civil | Majorité | Connaît le mot principal |
| 🕵️ Undercover | 1 | A un mot proche — doit se fondre |
| 🗺️ Touriste (Mr White) | 1 (5+ joueurs) | N'a aucun mot — doit bluffer |
| ⚖️ La Balance | 1 (6+ joueurs) | Connaît le mot ET l'Undercover. Perd si l'Undercover le démasque |
| 🎭 Agent Double | 1 (7+ joueurs) | A le mot Undercover, but = se faire éliminer à sa place |

### Déroulement

1. **Révélation** — Chaque joueur appuie pour voir son mot (en privé)
2. **Indices** — Chacun donne un indice sans révéler son mot
3. **Vote** — On vote pour éliminer le suspect principal
4. **Résultats** — Le rôle de l'éliminé est révélé
5. Répéter jusqu'à la condition de victoire

### Conditions de victoire

- **Civils** : Éliminent l'Undercover avant d'être en minorité
- **Undercover** : Survit jusqu'à égalité numérique avec les civils
- **Touriste** : Survit jusqu'aux 3 derniers joueurs
- **Agent Double** : L'Undercover est éliminé alors que l'Agent Double est encore en vie

### Twists (20% de chance / tour)

- 🚫 Pas d'adjectifs
- 🎙️ Interrogatoire (question fermée)
- 🤫 Chuchotement
- 🔇 Mot unique seulement
- 🔄 Ordre inversé
- Et bien d'autres...

---

## 📁 Structure du projet

```
undercover-game/
├── index.html
├── src/
│   ├── main.js              # Point d'entrée + routeur
│   ├── firebase.js          # Config Firebase + auth anonyme
│   ├── utils.js             # Fonctions utilitaires
│   ├── css/
│   │   └── styles.css       # Tailwind + styles custom
│   ├── data/
│   │   └── words.js         # 80+ paires de mots français
│   ├── game/
│   │   ├── roles.js         # Assignation des rôles + victoire
│   │   ├── twists.js        # Système de twists aléatoires
│   │   └── roomManager.js   # CRUD Firebase (rooms, votes...)
│   └── screens/
│       ├── HomeScreen.js    # Accueil (créer / rejoindre)
│       ├── LobbyScreen.js   # Salle d'attente temps réel
│       └── GameScreen.js    # Jeu (reveal → play → vote → résultats)
├── .env.example
├── vite.config.js
├── tailwind.config.js
└── package.json
```

---

## 🔧 Stack technique

- **Frontend** : Vanilla JavaScript (ES Modules)
- **Style** : Tailwind CSS + CSS custom animations
- **Backend** : Firebase Realtime Database + Authentication anonyme
- **Build** : Vite
- **Hébergement** : Vercel / Netlify (gratuit)
