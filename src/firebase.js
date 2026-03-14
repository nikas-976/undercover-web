// =============================================
// CONFIGURATION FIREBASE
// =============================================
// 1. Crée un projet sur https://console.firebase.google.com/
// 2. Active "Realtime Database" (mode test pour commencer)
// 3. Active "Authentication" > méthode "Anonyme"
// 4. Copie .env.example en .env.local et remplis tes valeurs
// =============================================

import { initializeApp } from 'firebase/app'
import { getDatabase } from 'firebase/database'
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth'

const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL:       import.meta.env.VITE_FIREBASE_DATABASE_URL,
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID,
}

// Initialisation de l'app Firebase
const app = initializeApp(firebaseConfig)

// Exports des services
export const db   = getDatabase(app)
export const auth = getAuth(app)

// =============================================
// AUTHENTIFICATION ANONYME
// Chaque joueur reçoit un uid unique et persistant
// =============================================

/** Retourne une promesse qui résout avec l'uid du joueur connecté */
export function initAuth() {
  return new Promise((resolve, reject) => {
    onAuthStateChanged(auth, async (user) => {
      if (user) {
        resolve(user.uid)
      } else {
        try {
          const { user: newUser } = await signInAnonymously(auth)
          resolve(newUser.uid)
        } catch (error) {
          console.error('Erreur d\'authentification anonyme:', error)
          reject(error)
        }
      }
    })
  })
}

// =============================================
// RÈGLES DE SÉCURITÉ FIREBASE RECOMMANDÉES
// À coller dans Firebase Console > Realtime Database > Rules
// =============================================
/*
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
*/
