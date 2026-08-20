# Klarity

Application de bureau Electron pour prendre des notes de cours et les organiser avec l'IA (OpenRouter).

## Fonctionnalités

- **Zone de notes** — grande zone de texte pour taper vite pendant le cours
- **Champs matière / date** — en haut de l'interface
- **Clé API OpenRouter** — stockée localement et chiffrée, jamais transmise ailleurs qu'à OpenRouter
- **"Organiser avec l'IA"** — appelle OpenRouter (modèles gratuits avec fallback) pour :
  - Créer un résumé en 2-3 phrases
  - Organiser en sections avec titres
  - Mettre les mots-clés en **gras**
  - Reformuler clairement
- **Sauvegarde en `.md`** — fichiers Markdown dans le dossier de données de l'app
- **Barre latérale** — liste des notes, cliquables pour les rouvrir
- **Design** — thème sombre, accents violet/bleu électrique, police lisible

## Build via CI/CD (pas en local)

Le `.app` est produit par GitHub Actions sur un runner `macos-latest` hébergé par GitHub — aucun build sur votre Mac.

### Déclencher un build

#### Option 1 — Tag git (produit une Release GitHub)

```bash
git tag v1.0.0
git push origin v1.0.0
```

Cela déclenche le workflow `build.yml`, qui :
1. Build l'app sur `macos-latest` (runner GitHub)
2. Produit un `.dmg` et un `.zip` macOS x64
3. Crée une Release GitHub avec les fichiers en téléchargement

#### Option 2 — Déclenchement manuel

1. Allez sur GitHub → onglet **Actions**
2. Sélectionnez le workflow **"Build macOS App"**
3. Cliquez **"Run workflow"** → entrez un numéro de version → **Run**

### Télécharger le .app

- **Depuis une Release** : GitHub → onglet **Releases** → téléchargez le `.dmg`
- **Depuis un run manuel** : GitHub → Actions → cliquez sur le run → section **Artifacts** → téléchargez le `.zip`

### Installation

1. Ouvrez le `.dmg` téléchargé
2. Glissez **Klarity.app** dans votre dossier `Applications`
3. Premier lancement sans certificat Apple Developer :
   - **Clic droit** sur l'app → **Ouvrir** → confirmez dans la boîte de dialogue
   - (Gatekeeper bloque les apps non signées au double-clic simple)

## Configuration

1. Lancez l'app
2. Cliquez l'icône ⚙️ en haut à droite
3. Entrez votre clé API OpenRouter (gratuite sur [openrouter.ai](https://openrouter.ai))
4. Cliquez **Enregistrer**

La clé est stockée localement et chiffrée — elle ne quitte jamais cet appareil sauf pour les requêtes vers `openrouter.ai`.

## Raccourcis clavier

| Action | macOS |
|--------|-------|
| Nouvelle note | `⌘N` |
| Sauvegarder | `⌘S` |
| Paramètres | `⌘,` |
| Fermer panneau | `Esc` |

## Structure du projet

```
cours-notes/
├── main.js              # Processus principal Electron (IPC, fichiers)
├── preload.js           # Bridge sécurisé renderer ↔ main
├── index.html           # Interface utilisateur
├── renderer.js          # Logique UI + appel OpenRouter
├── package.json         # Config npm + electron-builder
├── .github/
│   └── workflows/
│       └── build.yml    # CI/CD GitHub Actions
└── assets/
    └── icon.icns        # (optionnel) icône app macOS
```

## Notes sur les modèles IA (OpenRouter gratuits)

L'app essaie les modèles dans cet ordre, avec fallback automatique :
1. `google/gemini-2.0-flash-exp:free`
2. `meta-llama/llama-3.1-8b-instruct:free`
3. `mistralai/mistral-7b-instruct:free`

Les modèles `:free` peuvent avoir des limites de taux — si l'un échoue, le suivant est automatiquement essayé.
