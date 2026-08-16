// ══════════════════════════════════════════════════════════════
// api-shim.js — Remplace le pont Electron (main.js + preload.js)
// par une implémentation 100% navigateur, compatible Capacitor/Android.
//
// - Bibliothèque / réglages / sauvegardes → localStorage
// - Images de fond → converties en dataURL et stockées en localStorage
// - Mode Live → BroadcastChannel (au lieu d'une 2e fenêtre système)
// - Import PDF Rhapsodie → pdf.js (au lieu de pdf-parse/Node)
// ══════════════════════════════════════════════════════════════

(function () {
  const LS = {
    LIBRARY: 'ts_library',
    SETTINGS: 'ts_settings',
    RHAPSODY_PREFIX: 'ts_rhapsody_',
  };

  function uid() {
    return Math.random().toString(16).slice(2) + Date.now().toString(16);
  }

  function readJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }
  function writeJSON(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
    return value;
  }

  // ─── Bibliothèque ───
  function readLibrary() {
    return readJSON(LS.LIBRARY, { folders: [], documents: [], playlists: [] });
  }
  function writeLibrary(lib) {
    return writeJSON(LS.LIBRARY, lib);
  }

  // ─── Réglages ───
  const DEFAULT_SETTINGS = {
    appearance: {
      bgType: 'solid',
      bgColor: '#ffffff',
      gradFrom: '#1a1a2e',
      gradTo: '#16213e',
      gradAngle: 135,
      bgImage: null,
      textColor: '#111111',
      outlineColor: '#e8ff47',
      outlineWidth: 0,
      fontFamily: "'Syne', sans-serif",
      fontSize: 100,
      fontWeight: 700,
      transition: 'fade',
      transitionMs: 400,
    },
    liveDisplayId: null,
    sentencesPerPhase: 2,
  };
  function readSettings() {
    const s = readJSON(LS.SETTINGS, null);
    if (!s) return JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    return { ...DEFAULT_SETTINGS, ...s, appearance: { ...DEFAULT_SETTINGS.appearance, ...(s.appearance || {}) } };
  }
  function writeSettings(settings) {
    writeJSON(LS.SETTINGS, settings);
    return readSettings();
  }

  // ─── Canal de diffusion vers la vue Live (même app, vue plein écran) ───
  const liveChannel = ('BroadcastChannel' in window) ? new BroadcastChannel('textscene-live') : null;
  let liveIsOpen = false;
  let onLiveClosedCb = null;

  // ─── Sélecteur d'image (remplace le dialogue natif Electron) ───
  function pickImageFile() {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/png,image/jpeg,image/webp,image/gif';
      input.onchange = () => {
        const file = input.files && input.files[0];
        if (!file) { resolve({ canceled: true }); return; }
        const reader = new FileReader();
        reader.onload = () => resolve({ canceled: false, url: reader.result });
        reader.onerror = () => resolve({ canceled: true });
        reader.readAsDataURL(file);
      };
      input.click();
    });
  }

  function pickPdfFile() {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'application/pdf';
      input.onchange = () => {
        const file = input.files && input.files[0];
        resolve(file || null);
      };
      input.click();
    });
  }

  function todayMonthKey() {
    const now = new Date();
    return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
  }
  function todayISO() {
    const now = new Date();
    return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
  }
  function rhKey(monthKey) { return LS.RHAPSODY_PREFIX + monthKey; }

  // ─── Extraction du texte d'un PDF en ordre de lecture réel, via pdf.js ───
  async function extractPdfTextInReadingOrder(file) {
    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    let fullText = '';
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      const items = content.items
        .filter((it) => it && typeof it.str === 'string')
        .map((it) => ({ str: it.str, x: it.transform[4], y: it.transform[5] }));

      const TOL = 2.2;
      const lines = [];
      for (const it of items) {
        let line = lines.find((l) => Math.abs(l.y - it.y) <= TOL);
        if (!line) { line = { y: it.y, items: [] }; lines.push(line); }
        line.items.push(it);
      }
      lines.sort((a, b) => b.y - a.y);
      const pageText = lines
        .map((l) => { l.items.sort((a, b) => a.x - b.x); return l.items.map((i) => i.str).join(''); })
        .join('\n');
      fullText += pageText + '\n';
    }
    return fullText;
  }

  window.api = {
    library: {
      getAll: async () => readLibrary(),
      createFolder: async (name) => {
        const lib = readLibrary();
        const folder = { id: uid(), name: name || 'Nouveau dossier', createdAt: Date.now() };
        lib.folders.push(folder);
        writeLibrary(lib);
        return folder;
      },
      renameFolder: async (id, name) => {
        const lib = readLibrary();
        const f = lib.folders.find((x) => x.id === id);
        if (f) f.name = name;
        writeLibrary(lib);
        return lib;
      },
      deleteFolder: async (id) => {
        const lib = readLibrary();
        lib.folders = lib.folders.filter((x) => x.id !== id);
        lib.documents.forEach((d) => { if (d.folderId === id) d.folderId = null; });
        writeLibrary(lib);
        return lib;
      },
      createDoc: async (doc) => {
        const lib = readLibrary();
        const d = { id: uid(), name: doc.name || 'Sans titre', content: doc.content || '', folderId: doc.folderId || null, createdAt: Date.now(), updatedAt: Date.now() };
        lib.documents.push(d);
        writeLibrary(lib);
        return d;
      },
      updateDoc: async (id, patch) => {
        const lib = readLibrary();
        const d = lib.documents.find((x) => x.id === id);
        if (d) Object.assign(d, patch, { updatedAt: Date.now() });
        writeLibrary(lib);
        return d;
      },
      deleteDoc: async (id) => {
        const lib = readLibrary();
        lib.documents = lib.documents.filter((x) => x.id !== id);
        lib.playlists.forEach((p) => { p.items = p.items.filter((i) => i !== id); });
        writeLibrary(lib);
        return lib;
      },
      createPlaylist: async (name) => {
        const lib = readLibrary();
        const pl = { id: uid(), name: name || 'Nouvelle playlist', items: [], createdAt: Date.now() };
        lib.playlists.push(pl);
        writeLibrary(lib);
        return pl;
      },
      updatePlaylist: async (id, patch) => {
        const lib = readLibrary();
        const p = lib.playlists.find((x) => x.id === id);
        if (p) Object.assign(p, patch);
        writeLibrary(lib);
        return p;
      },
      deletePlaylist: async (id) => {
        const lib = readLibrary();
        lib.playlists = lib.playlists.filter((x) => x.id !== id);
        writeLibrary(lib);
        return lib;
      },
    },

    settings: {
      get: async () => readSettings(),
      set: async (s) => writeSettings(s),
    },

    media: {
      pickImage: async () => pickImageFile(),
    },

    live: {
      // Sur mobile il n'y a qu'un seul écran : "ouvrir le live" affiche la
      // vue de projection en plein écran par-dessus la console.
      open: async () => {
        liveIsOpen = true;
        document.dispatchEvent(new CustomEvent('ts:live-open'));
        return true;
      },
      close: async () => {
        liveIsOpen = false;
        document.dispatchEvent(new CustomEvent('ts:live-close'));
        if (onLiveClosedCb) onLiveClosedCb();
        return true;
      },
      isOpen: async () => liveIsOpen,
      listDisplays: async () => ([{ id: 'device', label: 'Cet appareil (plein écran)', isPrimary: true }]),
      render: async (payload) => {
        if (liveChannel) liveChannel.postMessage({ type: 'render', payload });
        return true;
      },
      blank: async (isBlank) => {
        if (liveChannel) liveChannel.postMessage({ type: 'blank', isBlank });
        return true;
      },
      onClosed: (cb) => { onLiveClosedCb = cb; },
    },

    rhapsody: {
      importPdf: async (forcedLang) => {
        const file = await pickPdfFile();
        if (!file) return { canceled: true };
        const text = await extractPdfTextInReadingOrder(file);
        const parsed = window.parseRhapsodyText(text, forcedLang || null);
        const monthKey = parsed.year + '-' + String(parsed.month).padStart(2, '0');
        writeJSON(rhKey(monthKey), parsed);
        return { canceled: false, monthKey, data: parsed };
      },
      getMonth: async (monthKey) => {
        const data = readJSON(rhKey(monthKey), null);
        return data ? { found: true, data } : { found: false, data: null };
      },
      listMonths: async () => {
        const out = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.startsWith(LS.RHAPSODY_PREFIX)) {
            const monthKey = k.slice(LS.RHAPSODY_PREFIX.length);
            if (/^\d{4}-\d{2}$/.test(monthKey)) out.push(monthKey);
          }
        }
        return out.sort();
      },
      getToday: async () => {
        const monthKey = todayMonthKey();
        const iso = todayISO();
        const data = readJSON(rhKey(monthKey), null);
        if (!data) return { monthKey, date: iso, monthAvailable: false, day: null, lang: null };
        const day = data.days.find((d) => d.date === iso);
        return { monthKey, date: iso, monthAvailable: true, day: day || null, lang: data.lang };
      },
      search: async (query) => {
        const q = String(query || '').trim().toLowerCase();
        if (!q) return [];
        const results = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (!k || !k.startsWith(LS.RHAPSODY_PREFIX)) continue;
          const monthKey = k.slice(LS.RHAPSODY_PREFIX.length);
          if (!/^\d{4}-\d{2}$/.test(monthKey)) continue;
          const data = readJSON(k, null);
          if (!data || !data.days) continue;
          for (const day of data.days) {
            const hay = [day.title, day.verse, day.body, day.prayer, day.study].filter(Boolean).join(' ').toLowerCase();
            if (hay.includes(q)) {
              results.push({ monthKey, date: day.date, title: day.title, verse: day.verse, lang: data.lang });
            }
          }
        }
        return results.slice(0, 60);
      },
      getSettings: async () => readSettings(),
      setSettings: async (s) => writeSettings(s),
    },

    backup: {
      export: async () => {
        const backup = { library: readLibrary(), settings: readSettings(), exportedAt: Date.now() };
        const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `textscene-sauvegarde-${todayISO()}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
        return { canceled: false, path: a.download };
      },
      import: async () => {
        return new Promise((resolve) => {
          const input = document.createElement('input');
          input.type = 'file';
          input.accept = 'application/json';
          input.onchange = () => {
            const file = input.files && input.files[0];
            if (!file) { resolve({ canceled: true }); return; }
            const reader = new FileReader();
            reader.onload = () => {
              try {
                const raw = JSON.parse(reader.result);
                if (raw.library) writeLibrary(raw.library);
                if (raw.settings) writeSettings(raw.settings);
                resolve({ canceled: false, library: readLibrary(), settings: readSettings() });
              } catch (e) {
                resolve({ canceled: true });
              }
            };
            reader.readAsText(file);
          };
          input.click();
        });
      },
    },
  };
})();
