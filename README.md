# TextScène Pro — Mobile (Android)

Version mobile (Capacitor) de TextScène Pro. Compile en un vrai fichier
`.apk` installable sur Android.

## Ce qui a changé par rapport à la version PC (Electron)

- **Stockage** : bibliothèque, réglages et Rhapsodie sont sauvegardés dans
  `localStorage` du téléphone (au lieu de fichiers via Node `fs`).
- **Mode Live** : sur PC il ouvrait une 2ᵉ fenêtre sur un second écran ; sur
  mobile il n'y a qu'un seul écran, donc le bouton "Live" affiche la
  projection **en plein écran par-dessus la console**. Double-tapez l'écran
  en mode Live pour revenir à la console. (Pour projeter sur une TV : passez
  en mode Live puis utilisez la recopie d'écran/Chromecast de votre
  téléphone.)
- **Import PDF Rhapsodie** : utilise `pdf.js` (navigateur) au lieu de
  `pdf-parse` (Node) — même algorithme d'extraction en ordre de lecture.
- **Choix d'image de fond / sauvegarde-restauration** : passent par le
  sélecteur de fichiers standard Android au lieu des dialogues Electron.

Toute la logique métier (`control.html`, `rhapsodyParser.js`) est identique
à la version PC — seul le "pont" (`js/api-shim.js`) a été réécrit pour
fonctionner dans un navigateur/WebView plutôt que via Electron.

## Obtenir le .apk automatiquement (recommandé, sans rien installer)

Ce dépôt contient déjà `.github/workflows/build-android.yml`. Une fois le
code envoyé sur GitHub, chaque `push` sur `main` compile automatiquement un
`.apk` dans le cloud.

1. Crée un dépôt GitHub et envoie ce dossier dedans (voir
   `GUIDE_GITHUB_ACTIONS.md` du projet PC pour la marche à suivre détaillée
   — la procédure GitHub Desktop est identique).
2. Va dans l'onglet **Actions** du dépôt → attends que "Build TextScène Pro
   (.apk)" se termine (icône verte ✔).
3. Ouvre le run terminé → section **Artifacts** → télécharge
   `TextScene-Pro-APK` (ou récupère l'APK depuis la **Release**
   "TextScène Pro (Android) — dernière version" sur la page principale du
   dépôt).
4. Transfère le `.apk` sur ton téléphone (câble USB, Drive, email...), ouvre
   le fichier, autorise "installer depuis une source inconnue" si Android le
   demande, installe.

## Builder localement (si tu as Android Studio installé)

```bash
npm install
npx cap sync android
npx cap open android   # ouvre le projet dans Android Studio
```
Puis dans Android Studio : **Build → Build Bundle(s) / APK(s) → Build APK(s)**.

Ou en ligne de commande (nécessite le SDK Android installé) :
```bash
npm install
npx cap sync android
cd android
./gradlew assembleDebug
# L'APK se trouve dans android/app/build/outputs/apk/debug/
```

## Icône de l'app

L'icône par défaut de Capacitor est utilisée pour l'instant. Pour utiliser
`icon.png` du projet comme icône de l'app, le plus simple est d'utiliser
l'outil intégré d'Android Studio : clic droit sur `android/app/src/main/res`
→ **New → Image Asset** → sélectionner `www/icon.png`.
