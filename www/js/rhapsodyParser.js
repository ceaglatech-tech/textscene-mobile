// rhapsodyParser.js
// Transforme le texte brut extrait du PDF mensuel "Rhapsodie des Réalités"
// (édition française ou anglaise "Rhapsody of Realities") en une liste
// structurée d'entrées quotidiennes, avec détection automatique de la langue.
//
// Robuste face aux artefacts d'extraction PDF courants :
//  - lettrine (première lettre du corps) extraite hors-ordre ou sur sa propre ligne
//  - jour/numéro du mois parfois scindés sur deux lignes
//  - publicités, pieds de page, numéros de page insérés au milieu du texte

const LANGS = {
  fr: {
    code: 'fr',
    label: 'Français',
    weekdays: ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'],
    months: ['janvier', 'février', 'mars', 'avril', 'mai', 'juin',
      'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'],
    prayerRe: /^(PRIÈRE|CONFESSION)$/,
    studyRe: /^ÉTUDE APPROFONDIE:?$/i,
    read1Re: /^LECTURE DE LA BIBLE EN 1 AN$/i,
    read2Re: /^LECTURE DE LA BIBLE EN 2 ANS$/i,
    defaultPrayerLabel: 'PRIÈRE',
    noise: [
      /^\d{1,3}$/, /^french$/i, /^french drc$/i, /^keep getting rhapsody/i, /^or call \(us\)/i,
      /^abonnez-vous/i, /^pour continuer à obtenir/i, /^disponible sur/i,
      /^sur rhapsodyofrealities/i, /^www\.rhapsodyofrealities/i,
      /^visitez: www\.rhapsodyofrealities/i, /^ou appelez/i,
      /^\.\.\.DÉVOTIONNEL QUOTIDIEN$/i, /^Rhapsodie des Réalités$/i,
      /^postez vos commentaires/i, /^email\s*:/i,
    ],
    labels: { verse: 'Verset', prayer: 'Prière', study: 'Étude approfondie', reading1: 'Lecture 1 an', reading2: 'Lecture 2 ans' }
  },
  en: {
    code: 'en',
    label: 'English',
    weekdays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
    months: ['january', 'february', 'march', 'april', 'may', 'june',
      'july', 'august', 'september', 'october', 'november', 'december'],
    prayerRe: /^(PRAYER|CONFESSION)$/,
    studyRe: /^FURTHER STUDY:?$/i,
    read1Re: /^1[\s-]?YEAR BIBLE READING PLAN$/i,
    read2Re: /^2[\s-]?YEAR BIBLE READING PLAN$/i,
    defaultPrayerLabel: 'PRAYER',
    noise: [
      /^\d{1,3}$/, /^english$/i, /^keep getting rhapsody/i, /^or call \(us\)/i,
      /^subscribe/i, /^available on/i, /^on rhapsodyofrealities/i,
      /^www\.rhapsodyofrealities/i, /^visit: www\.rhapsodyofrealities/i,
      /^or call/i, /^\.\.\.DAILY DEVOTIONAL$/i, /^Rhapsody of Realities$/i,
      /^post your comments/i, /^share your comments/i, /^email\s*:/i,
    ],
    labels: { verse: 'Verse', prayer: 'Prayer', study: 'Further Study', reading1: '1-Year Reading', reading2: '2-Year Reading' }
  }
};

function isNoiseLine(l, lang) {
  if (!l) return true;
  if (lang.noise.some(re => re.test(l))) return true;
  // Sur certaines pages, le folio (numéro de page) se retrouve collé au
  // début de l'encart publicitaire/pied de page (même hauteur Y à
  // l'extraction) — ex: "18Keep getting Rhapsody of Realities…". Le motif
  // de bruit ne matche alors plus car la ligne ne commence plus par le mot
  // attendu. On retente donc le test après avoir ôté ce préfixe numérique.
  const stripped = l.replace(/^\d{1,3}(?=\D)/, '');
  if (stripped !== l && lang.noise.some(re => re.test(stripped))) return true;
  return false;
}

/**
 * Recolle des lignes extraites du PDF en un seul texte. À la différence
 * d'un simple join(' '), un tiret simple en fin de ligne ("Jésus-",
 * "Saint-", "raisonnez-"…) est presque toujours un mot composé coupé par la
 * mise en page — on recolle alors SANS espace ("Jésus-Christ",
 * "Saint-Esprit"). Un tiret cadratin/demi-cadratin (– —) n'est lui jamais
 * concerné : il reste toujours suivi d'un espace.
 */
function joinLines(lines) {
  let out = '';
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (i === 0) { out = l; continue; }
    out += /-$/.test(out) ? l : ' ' + l;
  }
  return fixKnownKerningGlitches(out.replace(/\s+/g, ' ').trim());
}

/**
 * Corrige de rares glitches de crénage propres à certains PDF Rhapsodie, où
 * un mot se retrouve coupé en deux par un espace parasite au milieu même
 * d'une ligne (ex: "mais soy  ez transformés" au lieu de "mais soyez
 * transformés" — présent tel quel dans le texte du PDF source). Liste
 * volontairement restreinte à des cas confirmés, pour ne jamais fusionner
 * par erreur deux mots réellement distincts.
 */
const KNOWN_KERNING_GLITCHES = [
  [/\bsoy\s+ez\b/g, 'soyez'],
];
function fixKnownKerningGlitches(text) {
  let out = text;
  for (const [re, replacement] of KNOWN_KERNING_GLITCHES) out = out.replace(re, replacement);
  return out;
}

/** Ajoute un point final si le texte n'en a pas déjà un (ou une ponctuation
 * de fin de phrase / guillemet fermant), pour éviter qu'une diapositive ne
 * s'arrête en plein milieu visuel sans ponctuation — cas rencontré dans le
 * PDF source lui-même pour certains derniers paragraphes avant PRIÈRE. */
function ensureTerminalPunctuation(text) {
  if (!text) return text;
  const t = text.trim();
  if (!t) return t;
  return /[.!?…»"”']$/.test(t) ? t : t + '.';
}

/**
 * Découpe un texte en phrases (approximatif mais suffisant pour la projection).
 * Le guillemet/parenthèse fermant(e) éventuel(le) qui suit la ponctuation de
 * fin de phrase fait partie de la phrase précédente : on le conserve au lieu
 * de le laisser disparaître dans le séparateur.
 */
function splitSentences(text) {
  if (!text) return [];
  const parts = text.split(/(?<=[.!?…]|[.!?…][»"”')])\s+(?=[A-ZÀ-Þ«"„])/);
  return parts.map(s => s.trim()).filter(Boolean);
}

/**
 * Regroupe des phrases par lots de N pour former des diapositives.
 */
function groupIntoPhases(sentences, perPhase) {
  perPhase = Math.max(1, perPhase || 2);
  const out = [];
  for (let i = 0; i < sentences.length; i += perPhase) {
    out.push(sentences.slice(i, i + perPhase).join(' '));
  }
  return out;
}

/**
 * Construit les "phases" de projection pour une entrée du jour.
 * Ordre : titre -> verset -> corps (regroupé par N phrases) -> prière/confession.
 */
function buildPhasesForDay(day, sentencesPerPhase, opts) {
  opts = opts || {};
  const phases = [];
  if (opts.includeTitle !== false && day.title) phases.push(day.title);
  if (day.verse) phases.push(day.verse + (day.verseRef ? '\n(' + day.verseRef + ')' : ''));
  const bodySentences = splitSentences(day.body);
  groupIntoPhases(bodySentences, sentencesPerPhase).forEach(p => phases.push(p));
  if (opts.includePrayer !== false && day.prayer) phases.push((day.prayerLabel || 'Prière') + '\n\n' + day.prayer);
  return phases;
}

/**
 * Repère les marqueurs "jour" (ex: "samedi 1er", "dimanche", "vendredi 7").
 *
 * Le numéro du jour est notoirement fragile à l'extraction PDF : selon
 * l'outil utilisé, il peut être absent, déplacé sur une autre ligne, ou
 * fusionné avec le numéro de page. Le NOM du jour, en revanche, reste
 * toujours fiable car il est extrait comme un mot normal. On ne matche donc
 * que des lignes courtes "weekday" ou "weekday + numéro", sans jamais aller
 * chercher un numéro isolé sur une ligne suivante (trop ambigu — ça pourrait
 * être un numéro de page). Le numéro fiable est reconstruit ensuite à partir
 * du cycle des 7 jours de la semaine (voir assignSequentialDayNumbers).
 */
function findMarkers(allLines, lang) {
  // Le suffixe ordinal (er/st/nd/rd/th) est capturé indépendamment du chiffre :
  // certains extracteurs PDF perdent le chiffre "1" de "1er" mais laissent
  // le "er" orphelin ("samedi er") — on doit quand même reconnaître la ligne.
  const MARKER_RE = new RegExp('^(' + lang.weekdays.join('|') + ')(?:\\s+(\\d{1,2}))?\\s*(?:st|nd|rd|th|er)?\\s*$', 'i');
  const markers = [];
  for (let i = 0; i < allLines.length; i++) {
    const l = allLines[i];
    if (!l) continue;
    const m = l.match(MARKER_RE);
    if (m) {
      markers.push({ start: i, end: i, weekday: m[1].toLowerCase(), extractedNum: m[2] ? parseInt(m[2], 10) : null });
    }
  }
  return markers;
}

/**
 * Reconstruit un numéro de jour fiable (1, 2, 3…) pour chaque marqueur, en
 * suivant le cycle des jours de la semaine plutôt qu'en faisant confiance au
 * chiffre extrait du PDF (qui peut manquer). Si un saut de plusieurs jours
 * est détecté dans le cycle (ex: jeudi -> samedi), on considère qu'un ou
 * plusieurs marqueurs n'ont pas été détectés par l'extraction PDF et on
 * avance la numérotation en conséquence, plutôt que de désaligner tous les
 * jours suivants.
 */
function assignSequentialDayNumbers(markers, lang) {
  const order = lang.weekdays; // ['lundi', ..., 'dimanche']
  markers.forEach((m, idx) => {
    const wdIndex = order.indexOf(m.weekday);
    if (idx === 0) {
      m.num = 1;
    } else {
      const prevWdIndex = order.indexOf(markers[idx - 1].weekday);
      let step = (wdIndex - prevWdIndex + 7) % 7;
      if (step === 0) step = 7; // même jour de la semaine => une semaine complète plus tard
      m.num = markers[idx - 1].num + step;
    }
  });
  return markers;
}

/**
 * Corrige le glitch de lettrine (première lettre décorative du corps de
 * texte) qui apparaît fréquemment avec l'extraction PDF basée sur la
 * position : au lieu d'être accolée au début de la première ligne, la
 * lettrine se retrouve collée au début du PREMIER MOT de la DEUXIÈME ligne
 * (ex: ligne1="ans le chapitre…", ligne2="Draconte la belle…" au lieu de
 * ligne1="Dans le chapitre…", ligne2="raconte la belle…"). Comme une phrase
 * ne commence jamais par une minuscule, on détecte ce cas et on déplace le
 * caractère fautif. Variante fréquente : la première ligne commence par une
 * apostrophe orpheline ("’une des vérités…" au lieu de "L’une des
 * vérités…"), la lettrine "L" s'étant retrouvée collée au mot de la
 * DEUXIÈME ligne ("Lnouvelle naissance…") plutôt qu'isolée — même
 * mécanisme, il suffit d'accepter l'apostrophe comme premier caractère
 * valide en plus d'une minuscule.
 */
function fixDropCapGlitch(lines) {
  if (!lines.length) return lines;
  const out = lines.slice();
  if (/^['’a-zà-ÿ]/.test(out[0]) && out.length > 1 && /^[A-ZÀ-Ÿ]/.test(out[1])) {
    const letter = out[1][0];
    out[0] = letter + out[0];
    out[1] = out[1].slice(1);
    return out;
  }
  // Repli : lettrine isolée sur sa propre ligne (ancien style d'extraction)
  if (/^[A-ZÀ-Ÿ]$/.test(out[0]) && out.length > 1) {
    const letter = out[0];
    out.splice(0, 1);
    out[0] = letter + out[0];
  }
  return out;
}

/**
 * Découpe le bloc d'un jour en champs structurés.
 *
 * Ordre RÉEL observé une fois le texte reconstruit en ordre spatial
 * (position x/y, cf. main.js) :
 *   TITRE (lignes en MAJUSCULES)
 *   VERSET … (Référence).
 *   CORPS … jusqu'à l'étiquette PRIÈRE/CONFESSION
 *   PRIÈRE/CONFESSION (étiquette) → contenu … jusqu'à ÉTUDE APPROFONDIE:
 *   ÉTUDE APPROFONDIE: (étiquette) → contenu … jusqu'à LECTURE EN 1 AN
 *   LECTURE DE LA BIBLE EN 1 AN (étiquette) → contenu … jusqu'à LECTURE EN 2 ANS
 *   LECTURE DE LA BIBLE EN 2 ANS (étiquette) → contenu … fin du bloc
 * Chaque étiquette est immédiatement suivie de son propre contenu (et non
 * regroupée avec les autres étiquettes comme le supposait l'ancienne
 * version du parseur, qui était calée sur l'ordre du flux PDF brut plutôt
 * que sur l'ordre visuel réel).
 */
function extractDays(allLines, markers, lang) {
  const days = [];
  for (let d = 0; d < markers.length; d++) {
    const blockStart = markers[d].end + 1;
    const blockEnd = (d + 1 < markers.length) ? markers[d + 1].start : allLines.length;
    const lines = allLines.slice(blockStart, blockEnd).filter(l => !isNoiseLine(l, lang));

    let idx = 0;

    // TITRE : lignes en majuscules consécutives
    const titleParts = [];
    while (idx < lines.length && lines[idx] && lines[idx] === lines[idx].toUpperCase() && /[A-ZÀ-Ÿ]/.test(lines[idx])) {
      titleParts.push(lines[idx]);
      idx++;
    }
    const title = joinLines(titleParts);

    // VERSET : jusqu'à une ligne se terminant par "(Référence)."
    const verseParts = [];
    let verseRef = '';
    while (idx < lines.length) {
      const l = lines[idx];
      verseParts.push(l);
      idx++;
      const mRef = l.match(/\(([^()]*\d[^()]*)\)\.?\s*$/);
      if (mRef) { verseRef = mRef[1].trim(); break; }
    }
    let verse = joinLines(verseParts);
    // La référence est déjà capturée séparément dans verseRef (et sera
    // rajoutée par buildPhasesForDay/rhBuildPhases) ; on l'ôte donc du texte
    // du verset pour éviter qu'elle n'apparaisse deux fois à l'affichage
    // (et pour retirer le collage sans espace du type "vous(Actes 1:8).").
    if (verseRef) {
      const escapedRef = verseRef.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const refTailRe = new RegExp('\\(\\s*' + escapedRef + '\\s*\\)\\.?\\s*$');
      const withoutRef = verse.replace(refTailRe, '').trim();
      if (withoutRef) {
        verse = /[.!?…]$/.test(withoutRef) ? withoutRef : withoutRef + '.';
      }
    }

    // CORPS : jusqu'à l'étiquette "PRIÈRE"/"PRAYER"/"CONFESSION"
    let bodyLines = [];
    let prayerLabel = '';
    while (idx < lines.length) {
      const l = lines[idx];
      if (lang.prayerRe.test(l)) { prayerLabel = l; idx++; break; }
      bodyLines.push(l);
      idx++;
    }
    bodyLines = fixDropCapGlitch(bodyLines);
    const body = ensureTerminalPunctuation(joinLines(bodyLines));

    // PRIÈRE / CONFESSION : contenu jusqu'à "ÉTUDE APPROFONDIE:" / "FURTHER STUDY:"
    const prayerLines = [];
    while (idx < lines.length) {
      const l = lines[idx];
      if (lang.studyRe.test(l)) { idx++; break; }
      prayerLines.push(l);
      idx++;
    }
    const prayer = ensureTerminalPunctuation(joinLines(prayerLines));

    // ÉTUDE APPROFONDIE : contenu jusqu'à l'étiquette lecture 1 an
    const studyLines = [];
    while (idx < lines.length) {
      const l = lines[idx];
      if (lang.read1Re.test(l)) { idx++; break; }
      studyLines.push(l);
      idx++;
    }
    const study = joinLines(studyLines);

    // LECTURE EN 1 AN : contenu jusqu'à l'étiquette lecture 2 ans
    const r1Lines = [];
    while (idx < lines.length) {
      const l = lines[idx];
      if (lang.read2Re.test(l)) { idx++; break; }
      r1Lines.push(l);
      idx++;
    }
    const reading1 = joinLines(r1Lines);

    // LECTURE EN 2 ANS : reste du bloc. Pour le dernier jour du mois, il n'y a
    // pas de marqueur de jour suivant pour borner proprement ce champ : on
    // s'arrête donc dès qu'on rencontre une ligne de type "grand titre"
    // (ex: "PRIÈRE DU SALUT", "A PROPOS DE L'AUTEUR") une fois qu'on a déjà
    // capturé du contenu, pour éviter d'avaler les pages de fin d'ouvrage.
    const r2Lines = [];
    while (idx < lines.length) {
      const l = lines[idx];
      const looksLikeSectionTitle = l === l.toUpperCase() && /[A-ZÀ-Ÿ]/.test(l) && l.length > 3;
      if (r2Lines.length > 0 && looksLikeSectionTitle) break;
      r2Lines.push(l);
      idx++;
    }
    const reading2 = joinLines(r2Lines);

    days.push({
      day: markers[d].num, // reconstruit via le cycle des jours (voir assignSequentialDayNumbers)
      weekday: markers[d].weekday,
      date: null, // rempli plus tard une fois year/month connus
      title, verse, verseRef, body,
      prayerLabel: prayerLabel || lang.defaultPrayerLabel,
      prayer, study, reading1, reading2
    });
  }
  return days;
}

function detectYearMonth(allLines, lang) {
  const headText = allLines.slice(0, 80).join(' ');
  const mMonth = headText.match(new RegExp('(' + lang.months.join('|') + ')\\s+(\\d{4})', 'i'));
  if (!mMonth) return { year: null, monthIndex: null };
  const monthIndex = lang.months.findIndex(m => m.toLowerCase() === mMonth[1].toLowerCase());
  const year = parseInt(mMonth[2], 10);
  return { year, monthIndex };
}

/**
 * Analyse le texte brut complet (issu de pdf-parse). Détecte automatiquement
 * la langue (français/anglais) en essayant les deux jeux de marqueurs et en
 * gardant celui qui détecte le plus de jours. Retourne :
 * { lang, year, month, monthLabel, days: [...] }
 */
function parseRhapsodyText(rawText, forcedLang) {
  const raw = String(rawText || '').replace(/\f/g, '\n');
  const allLines = raw.split('\n').map(l => l.trim());

  const candidates = forcedLang && LANGS[forcedLang] ? [LANGS[forcedLang]] : [LANGS.fr, LANGS.en];

  let best = null;
  for (const lang of candidates) {
    const markers = findMarkers(allLines, lang);
    if (!best || markers.length > best.markers.length) {
      best = { lang, markers };
    }
  }

  if (!best || best.markers.length === 0) {
    throw new Error("Aucun jour n'a été détecté dans ce PDF. Vérifiez qu'il s'agit bien de l'édition mensuelle de la Rhapsodie des Réalités (français ou anglais).");
  }

  const { lang, markers } = best;
  assignSequentialDayNumbers(markers, lang);
  const { year, monthIndex } = detectYearMonth(allLines, lang);
  if (!year || monthIndex === null) {
    throw new Error("Le mois/l'année n'ont pas pu être détectés dans ce PDF (ex: « Août 2026 Edition » attendu en première page).");
  }

  const days = extractDays(allLines, markers, lang);
  days.forEach(d => {
    const mm = String(monthIndex + 1).padStart(2, '0');
    const dd = String(d.day).padStart(2, '0');
    d.date = year + '-' + mm + '-' + dd;
  });

  return {
    lang: lang.code,
    year,
    month: monthIndex + 1,
    monthLabel: lang.months[monthIndex][0].toUpperCase() + lang.months[monthIndex].slice(1),
    days
  };
}

/** Texte brut concaténé d'un jour, pour l'indexation de recherche. */
function dayToSearchText(day) {
  return [day.title, day.verse, day.body, day.prayer, day.study].filter(Boolean).join(' ').toLowerCase();
}

// Adapté pour le navigateur (Capacitor) : plus de module.exports Node,
// on attache directement les fonctions utiles à window.
window.parseRhapsodyText = parseRhapsodyText;
window.rhapsodyParserUtils = {
  LANGS, buildPhasesForDay, splitSentences, groupIntoPhases, dayToSearchText
};
