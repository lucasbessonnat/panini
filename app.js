/**
 * ═══════════════════════════════════════════════════════════════
 * PANINI WC 2026 — APPLICATION JAVASCRIPT COMPLÈTE
 * Logique métier, gestion d'état, rendu des vues, import/export
 * ═══════════════════════════════════════════════════════════════
 *
 * Architecture :
 *  - État global : `stickers` (données brutes) + `collectionState` (état utilisateur)
 *  - Navigation par vues (album, pays, manquantes, doublons, stats, échanges)
 *  - Chaque vue est rendue à la demande (lazy rendering)
 *  - Persistance locale via localStorage (cache) + import/export fichier JSON
 */

'use strict';

/* ═══════════════════════════════════════════════════════════════
   1. CONFIGURATION GLOBALE
   ═══════════════════════════════════════════════════════════════ */

/** URL du fichier database.json — remplace par l'URL GitHub Pages en prod */
const DATABASE_URL = 'database.json';

/** Clé de stockage localStorage pour la collection */
const LS_KEY = 'panini_wc2026_collection';

/* ═══════════════════════════════════════════════════════════════
   2. ÉTAT GLOBAL DE L'APPLICATION
   ═══════════════════════════════════════════════════════════════ */

/** Données brutes chargées depuis database.json */
let stickers = [];

/**
 * État utilisateur de la collection.
 * Structure : { [stickerID]: { status: 'owned'|'missing'|'duplicate', count: number } }
 */
let collectionState = {};

/** Vue actuellement affichée */
let currentView = 'album';

/** Page d'album actuellement affichée (index dans la liste des pages triées) */
let currentAlbumPageIndex = 0;

/** Liste triée des numéros de pages uniques */
let albumPages = [];

/** ID de la vignette actuellement ouverte dans la modale */
let modalStickerID = null;

/* ═══════════════════════════════════════════════════════════════
   3. INITIALISATION AU CHARGEMENT
   ═══════════════════════════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', async () => {
  // Affichage du spinner pendant le chargement
  showLoadingSpinner();

  try {
    // Chargement des données
    await loadDatabase();

    // Chargement de la collection depuis localStorage (cache auto)
    loadCollectionFromLocalStorage();

    // Construction de l'interface
    initNavigation();
    initAlbumPageSelect();
    initPaysSelect();
    initFilters();
    initExportImport();
    initModal();
    initGlobalSearch();   // M3 — Recherche globale
    initBooster();        // M3 — FAB Booster

    // Rendu initial de la vue album
    renderCurrentView();
    updateGlobalProgress();

  } catch (err) {
    console.error('Erreur au démarrage :', err);
    showToast('❌ Impossible de charger la base de données.', 4000);
    hideLoadingSpinner();
  }
});

/* ═══════════════════════════════════════════════════════════════
   4. CHARGEMENT DES DONNÉES
   ═══════════════════════════════════════════════════════════════ */

/**
 * Charge le fichier database.json et initialise la liste des pages.
 */
async function loadDatabase() {
  const response = await fetch(DATABASE_URL);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  stickers = await response.json();

  // Extraction des pages uniques, triées numériquement
  const pagesSet = new Set(stickers.map(s => s['Page']));
  albumPages = Array.from(pagesSet).sort((a, b) => a - b);

  // Initialisation de collectionState : toutes les vignettes en "missing" par défaut
  stickers.forEach(s => {
    if (!collectionState[s.ID]) {
      collectionState[s.ID] = { status: 'missing', count: 0 };
    }
  });

  hideLoadingSpinner();
}

/* ═══════════════════════════════════════════════════════════════
   5. GESTION DE L'ÉTAT DE LA COLLECTION
   ═══════════════════════════════════════════════════════════════ */

/**
 * Retourne le statut d'une vignette ('missing' par défaut).
 * @param {string} id - ID de la vignette
 */
function getStatus(id) {
  return collectionState[id]?.status || 'missing';
}

/**
 * Retourne le nombre de doublons d'une vignette.
 * @param {string} id - ID de la vignette
 */
function getDupCount(id) {
  return collectionState[id]?.count || 2;
}

/**
 * Met à jour le statut d'une vignette et sauvegarde dans localStorage.
 * @param {string} id - ID de la vignette
 * @param {string} status - 'missing' | 'owned' | 'duplicate'
 * @param {number} [count] - Nombre de doublons (si status === 'duplicate')
 */
function setStatus(id, status, count) {
  if (!collectionState[id]) {
    collectionState[id] = { status: 'missing', count: 0 };
  }
  collectionState[id].status = status;
  if (status === 'duplicate') {
    collectionState[id].count = Math.max(2, count ?? collectionState[id].count ?? 2);
  } else {
    collectionState[id].count = 0;
  }
  saveCollectionToLocalStorage();
  updateGlobalProgress();
}

/* ═══════════════════════════════════════════════════════════════
   6. PERSISTANCE : LOCALSTORAGE (cache automatique)
   ═══════════════════════════════════════════════════════════════ */

/** Sauvegarde l'état courant dans localStorage. */
function saveCollectionToLocalStorage() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(collectionState));
  } catch (e) {
    console.warn('Impossible de sauvegarder dans localStorage :', e);
  }
}

/** Charge l'état depuis localStorage s'il existe. */
function loadCollectionFromLocalStorage() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return;

    const parsed = JSON.parse(raw);
    // Vérification minimale : doit être un objet
    if (typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Format invalide');
    }

    // Fusion avec l'état par défaut (les nouvelles vignettes restent "missing")
    Object.keys(parsed).forEach(id => {
      if (collectionState[id] !== undefined) {
        collectionState[id] = parsed[id];
      }
    });
  } catch (e) {
    console.warn('Données localStorage corrompues, réinitialisation :', e);
  }
}

/* ═══════════════════════════════════════════════════════════════
   7. PERSISTANCE : EXPORT / IMPORT FICHIER JSON
   ═══════════════════════════════════════════════════════════════ */

/**
 * Exporte la collection en tant que fichier JSON téléchargeable.
 * Sérialise collectionState via JSON.stringify, crée un Blob et déclenche le téléchargement.
 */
function exportCollectionAsJSON() {
  try {
    const json = JSON.stringify(collectionState, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    // Création d'un lien virtuel pour déclencher le téléchargement
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ma-collection-wc2026.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    // Nettoyage de la mémoire
    URL.revokeObjectURL(url);

    showToast('✅ Collection exportée avec succès !');
  } catch (e) {
    console.error('Erreur lors de l\'export :', e);
    showToast('❌ Erreur lors de l\'export.');
  }
}

/**
 * Importe une collection depuis un fichier JSON sélectionné par l'utilisateur.
 * Utilise FileReader, vérifie la structure, puis écrase collectionState.
 * @param {File} file - Fichier .json sélectionné
 */
function importCollectionFromJSON(file) {
  if (!file) return;

  const reader = new FileReader();

  reader.onload = (event) => {
    try {
      const parsed = JSON.parse(event.target.result);

      // Vérification minimale de structure
      if (typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Le fichier ne contient pas un objet JSON valide.');
      }

      // Vérification que les clés correspondent à des IDs de stickers connus
      const knownIDs = new Set(stickers.map(s => s.ID));
      const importedKeys = Object.keys(parsed);
      const validKeys = importedKeys.filter(k => knownIDs.has(k));

      if (validKeys.length === 0) {
        throw new Error('Aucun sticker reconnu dans ce fichier.');
      }

      // Réinitialisation vers "missing" pour tous
      stickers.forEach(s => {
        collectionState[s.ID] = { status: 'missing', count: 0 };
      });

      // Application des données importées (uniquement les IDs connus)
      validKeys.forEach(id => {
        const entry = parsed[id];
        if (entry && typeof entry.status === 'string') {
          collectionState[id] = {
            status: ['owned', 'missing', 'duplicate'].includes(entry.status) ? entry.status : 'missing',
            count: typeof entry.count === 'number' ? entry.count : 0,
          };
        }
      });

      // Sauvegarde dans localStorage
      saveCollectionToLocalStorage();

      // Re-rendu complet
      renderCurrentView();
      updateGlobalProgress();

      showToast(`✅ Collection importée ! (${validKeys.length} vignettes chargées)`);
    } catch (e) {
      console.error('Erreur lors de l\'import :', e);
      showToast(`❌ Erreur d'import : ${e.message}`);
    }
  };

  reader.onerror = () => {
    showToast('❌ Impossible de lire le fichier.');
  };

  reader.readAsText(file);
}

/* ═══════════════════════════════════════════════════════════════
   8. NAVIGATION ENTRE LES VUES
   ═══════════════════════════════════════════════════════════════ */

/**
 * Initialise les boutons de navigation (desktop + mobile).
 */
function initNavigation() {
  // Tous les boutons nav (desktop et mobile)
  const navBtns = document.querySelectorAll('[data-view]');

  navBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.view;
      switchView(view);
    });
  });
}

/**
 * Bascule vers une vue donnée.
 * @param {string} viewName - Identifiant de la vue
 */
function switchView(viewName) {
  currentView = viewName;

  // Mise à jour des boutons actifs
  document.querySelectorAll('[data-view]').forEach(btn => {
    const isActive = btn.dataset.view === viewName;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  });

  // Affichage / masquage des sections
  document.querySelectorAll('.view').forEach(view => {
    view.classList.toggle('hidden', view.id !== `view-${viewName}`);
  });

  // Rendu de la vue
  renderCurrentView();
}

/**
 * Déclenche le rendu de la vue courante.
 */
function renderCurrentView() {
  switch (currentView) {
    case 'album':      renderAlbumView();      break;
    case 'pays':       renderPaysView();        break;
    case 'manquantes': renderManquantesView();  break;
    case 'doublons':   renderDoublonsView();    break;
    case 'stats':      renderStatsView();       break;
    case 'echanges':   /* résultats persistés, pas de re-render automatique */ break;
    default: break;
  }
}

/* ═══════════════════════════════════════════════════════════════
   9. VUE ALBUM
   ═══════════════════════════════════════════════════════════════ */

/**
 * Initialise le sélecteur de page d'album.
 */
function initAlbumPageSelect() {
  const select = document.getElementById('albumPageSelect');
  select.innerHTML = '';

  albumPages.forEach((page, idx) => {
    // On construit le label à partir des stickers de cette page
    const pageStickers = stickers.filter(s => s['Page'] === page);
    const section = pageStickers[0]?.Section || `Page ${page}`;
    const opt = document.createElement('option');
    opt.value = idx;
    opt.textContent = `p.${page} — ${section}`;
    select.appendChild(opt);
  });

  select.addEventListener('change', () => {
    currentAlbumPageIndex = parseInt(select.value, 10);
    renderAlbumView();
  });

  // Boutons précédent / suivant
  document.getElementById('btnPagePrev').addEventListener('click', () => {
    if (currentAlbumPageIndex > 0) {
      currentAlbumPageIndex--;
      renderAlbumView();
    }
  });

  document.getElementById('btnPageNext').addEventListener('click', () => {
    if (currentAlbumPageIndex < albumPages.length - 1) {
      currentAlbumPageIndex++;
      renderAlbumView();
    }
  });

  // Mise à jour du total
  document.getElementById('albumPageTotal').textContent = albumPages.length;
}

/**
 * Rend la vue album pour la page courante.
 */
function renderAlbumView() {
  const pageNum = albumPages[currentAlbumPageIndex];
  const pageStickers = stickers.filter(s => s['Page'] === pageNum);

  // Filtrage recherche si actif
  const filtered = applySearchFilter(pageStickers);

  // Mise à jour de l'indicateur de page
  document.getElementById('albumPageCurrent').textContent = pageNum;
  document.getElementById('albumPageSelect').value = currentAlbumPageIndex;

  // Boutons prev/next
  document.getElementById('btnPagePrev').disabled = currentAlbumPageIndex === 0;
  document.getElementById('btnPageNext').disabled = currentAlbumPageIndex === albumPages.length - 1;

  // En-tête de section
  renderAlbumSectionHeader(pageStickers);

  // M2 — Grille via DocumentFragment (évite les reflows multiples)
  const grid = document.getElementById('stickerGrid');
  const frag = document.createDocumentFragment();

  filtered.forEach(sticker => {
    frag.appendChild(buildStickerCard(sticker));
  });

  if (filtered.length === 0 && searchQuery) {
    const empty = document.createElement('div');
    empty.className = 'no-search-results';
    empty.textContent = `Aucune vignette ne correspond à "${searchQuery}"`;
    frag.appendChild(empty);
  }

  grid.innerHTML = '';
  grid.appendChild(frag);
}

/**
 * Construit le bandeau de section en haut de la page d'album.
 * @param {Array} pageStickers - Vignettes de la page courante
 */
function renderAlbumSectionHeader(pageStickers) {
  const container = document.getElementById('albumSectionHeader');

  if (!pageStickers.length) {
    container.innerHTML = '';
    return;
  }

  // Récupération des sections uniques sur cette page
  const sections = [...new Set(pageStickers.map(s => s['Section']))];
  const firstSection = sections[0];
  const flagURL = pageStickers[0]?.Drapeau || '';
  const groupe = pageStickers[0]?.Groupe || '';

  container.innerHTML = `
    <div class="section-banner">
      ${flagURL ? `<img src="${escHtml(flagURL)}" alt="${escHtml(firstSection)}" />` : ''}
      <span>${escHtml(firstSection)}</span>
      ${groupe ? `<span style="font-size:12px;opacity:0.7;letter-spacing:0.1em;">Groupe ${escHtml(groupe)}</span>` : ''}
    </div>
  `;
}

/**
 * Construit et retourne un élément DOM représentant une vignette.
 * @param {Object} sticker - Données d'une vignette
 * @returns {HTMLElement}
 */
function buildStickerCard(sticker) {
  const status = getStatus(sticker.ID);
  const dupCount = getDupCount(sticker.ID);

  const article = document.createElement('article');
  article.className = `sticker-card ${status}`;
  article.setAttribute('role', 'listitem');
  article.setAttribute('aria-label', `${sticker.ID} — ${sticker.Nom} (${statusLabel(status)})`);
  article.dataset.id = sticker.ID;
  article.dataset.type = sticker.Type; // M1 — pour le sélecteur CSS holographique

  // Badge doublon
  const dupBadge = status === 'duplicate'
    ? `<div class="dup-badge" aria-label="${dupCount} doublons">x${dupCount}</div>`
    : '';

  // Couleur de header selon le type
  const typeColor = sticker.Type === 'Spécial' ? 'var(--purple-psycho)' : '';
  const typeStyle = typeColor ? `style="background:${typeColor};color:#fff;"` : '';

  article.innerHTML = `
    ${dupBadge}
    <div class="sticker-header" ${typeStyle}>
      <span class="sticker-id">${escHtml(sticker.ID)}</span>
      <span class="sticker-type-badge">${escHtml(sticker.Type === 'Spécial' ? 'SPEC' : 'STD')}</span>
    </div>
    <div class="sticker-flag-wrap">
      <img
        class="sticker-flag"
        src="${escHtml(sticker.Drapeau || '')}"
        alt="${escHtml(sticker.Section)}"
        loading="lazy"
        onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2260%22 height=%2240%22><rect width=%2260%22 height=%2240%22 fill=%22%23E3E2FF%22/></svg>'"
      />
    </div>
    <div class="sticker-footer">
      <div class="sticker-name">${escHtml(sticker.Nom)}</div>
      <div class="sticker-section-label">${escHtml(sticker.Section)}</div>
    </div>
  `;

  // Clic → ouverture de la modale
  article.addEventListener('click', () => openModal(sticker.ID));

  return article;
}

/* ═══════════════════════════════════════════════════════════════
   10. VUE PAR PAYS
   ═══════════════════════════════════════════════════════════════ */

/**
 * Initialise le sélecteur de pays.
 */
function initPaysSelect() {
  const select = document.getElementById('paysSelect');

  // Construction de la liste des pays uniques (triés par nom de section)
  const paysMap = {};
  stickers.forEach(s => {
    if (!paysMap[s.Code]) {
      paysMap[s.Code] = s.Section;
    }
  });

  const paysSorted = Object.entries(paysMap).sort((a, b) => a[1].localeCompare(b[1]));

  paysSorted.forEach(([code, section]) => {
    const opt = document.createElement('option');
    opt.value = code;
    opt.textContent = `${section} (${code})`;
    select.appendChild(opt);
  });

  select.addEventListener('change', () => renderPaysView());
}

/**
 * Rend la vue "Par pays".
 */
function renderPaysView() {
  const code = document.getElementById('paysSelect').value;
  const paysStickers = stickers.filter(s => s.Code === code);

  if (!paysStickers.length) return;

  const filtered = applySearchFilter(paysStickers);

  // Statistiques du pays
  const total = paysStickers.length;
  const owned = paysStickers.filter(s => getStatus(s.ID) === 'owned' || getStatus(s.ID) === 'duplicate').length;
  const pct = Math.round((owned / total) * 100);
  const flagURL = paysStickers[0]?.Drapeau || '';
  const sectionName = paysStickers[0]?.Section || code;

  // Résumé pays
  document.getElementById('paysSummary').innerHTML = `
    <img class="pays-flag" src="${escHtml(flagURL)}" alt="${escHtml(sectionName)}" 
         onerror="this.style.display='none'" />
    <div class="pays-info">
      <div class="pays-info-name">${escHtml(sectionName)}</div>
      <div class="pays-info-stats">
        <strong>${owned}</strong> / ${total} possédées — <strong>${pct}%</strong>
      </div>
    </div>
    <div class="pays-progress-bar">
      <div class="pays-progress-fill" style="width:${pct}%"></div>
    </div>
  `;

  // M2 — Grille via DocumentFragment
  const grid = document.getElementById('paysGrid');
  const frag = document.createDocumentFragment();

  filtered.forEach(s => frag.appendChild(buildStickerCard(s)));

  if (filtered.length === 0 && searchQuery) {
    const empty = document.createElement('div');
    empty.className = 'no-search-results';
    empty.textContent = `Aucune vignette ne correspond à "${searchQuery}"`;
    frag.appendChild(empty);
  }

  grid.innerHTML = '';
  grid.appendChild(frag);
}

/* ═══════════════════════════════════════════════════════════════
   11. VUE MANQUANTES
   ═══════════════════════════════════════════════════════════════ */

/**
 * Initialise les filtres communs aux vues manquantes et doublons.
 */
function initFilters() {
  // Filtres manquantes
  document.getElementById('manqSectionFilter').addEventListener('change', renderManquantesView);

  // Filtres doublons
  document.getElementById('dblSectionFilter').addEventListener('change', renderDoublonsView);

  // Peuplement des filtres
  populateFilterSelects();
}

/**
 * Peuple les <select> de filtres avec les codes et sections uniques.
 */
function populateFilterSelects() {
  const sections = [...new Set(stickers.map(s => s.Section))].sort();

  const manqSec  = document.getElementById('manqSectionFilter');
  const dblSec   = document.getElementById('dblSectionFilter');

  sections.forEach(sec => {
    [manqSec, dblSec].forEach(sel => {
      const opt = document.createElement('option');
      opt.value = sec;
      opt.textContent = sec;
      sel.appendChild(opt);
    });
  });
}

/**
 * Rend la vue "Mes manquantes".
 */
function renderManquantesView() {
  const filterSection = document.getElementById('manqSectionFilter').value;

  let missing = stickers.filter(s => getStatus(s.ID) === 'missing');

  if (filterSection) missing = missing.filter(s => s.Section === filterSection);

  // Compteur
  document.getElementById('manqCount').innerHTML =
    `<span>${missing.length}</span> vignette${missing.length > 1 ? 's' : ''} manquante${missing.length > 1 ? 's' : ''}`;

  // Rendu de la liste
  renderStickerList(document.getElementById('manqList'), missing);

  // Masquer la zone d'export si on change les filtres
  document.getElementById('manqExportZone').classList.add('hidden');
}

/**
 * Rend la vue "Mes doublons".
 */
function renderDoublonsView() {
  const filterSection = document.getElementById('dblSectionFilter').value;

  let duplicates = stickers.filter(s => getStatus(s.ID) === 'duplicate');

  if (filterSection) duplicates = duplicates.filter(s => s.Section === filterSection);

  // Compteur
  document.getElementById('dblCount').innerHTML =
    `<span>${duplicates.length}</span> vignette${duplicates.length > 1 ? 's' : ''} en doublon`;

  // Rendu de la liste
  renderStickerList(document.getElementById('dblList'), duplicates, true);

  // Masquer la zone d'export
  document.getElementById('dblExportZone').classList.add('hidden');
}

/**
 * Rend une liste de vignettes groupées par pays.
 * @param {HTMLElement} container - Conteneur de la liste
 * @param {Array} stickersList - Vignettes à afficher
 * @param {boolean} showDupCount - Afficher le compteur de doublons
 */
function renderStickerList(container, stickersList, showDupCount = false) {
  // M2 — DocumentFragment pour éviter les reflows
  const frag = document.createDocumentFragment();

  if (!stickersList.length) {
    const empty = document.createElement('div');
    empty.style.cssText = 'padding:var(--sp-lg);text-align:center;color:var(--outline);';
    empty.innerHTML = `
      <span class="material-symbols-outlined" style="font-size:48px;opacity:0.3;display:block;margin-bottom:12px;">check_circle</span>
      <p style="font-weight:700;font-size:14px;">Aucune vignette dans cette catégorie.</p>
    `;
    frag.appendChild(empty);
    container.innerHTML = '';
    container.appendChild(frag);
    return;
  }

  // Groupement par Code (pays)
  const grouped = {};
  stickersList.forEach(s => {
    if (!grouped[s.Code]) grouped[s.Code] = [];
    grouped[s.Code].push(s);
  });

  Object.entries(grouped).forEach(([code, items]) => {
    // En-tête du groupe pays
    const sectionName = items[0]?.Section || code;
    const flagURL     = items[0]?.Drapeau || '';

    const header = document.createElement('div');
    header.className = 'list-group-header';
    header.innerHTML = `
      ${flagURL ? `<img src="${escHtml(flagURL)}" alt="" />` : ''}
      <span>${escHtml(sectionName)}</span>
      <span style="margin-left:auto;font-size:11px;color:var(--outline);">${items.length} vignette${items.length > 1 ? 's' : ''}</span>
    `;
    frag.appendChild(header);

    // Items de ce groupe
    items.forEach(s => {
      const item = document.createElement('div');
      item.className = 'list-item';
      item.setAttribute('role', 'listitem');
      item.dataset.id = s.ID;

      const dupBadge = showDupCount
        ? `<div class="list-item-dup-count">x${getDupCount(s.ID)}</div>`
        : '';

      item.innerHTML = `
        <img class="list-item-flag" src="${escHtml(s.Drapeau || '')}" alt="" loading="lazy"
             onerror="this.style.display='none'" />
        <span class="list-item-id">${escHtml(s.ID)}</span>
        <span class="list-item-name">${escHtml(s.Nom)}</span>
        <span class="list-item-section">${escHtml(s.Type)}</span>
        ${dupBadge}
      `;

      item.addEventListener('click', () => openModal(s.ID));
      frag.appendChild(item);
    });
  });

  container.innerHTML = '';
  container.appendChild(frag);
}

/* ═══════════════════════════════════════════════════════════════
   12. EXPORT TEXTE (wantlist / tradelist)
   ═══════════════════════════════════════════════════════════════ */

/**
 * Génère le texte d'export au format "CODE N°1,N°2,N°3".
 * @param {Array} stickersList - Vignettes à exporter
 * @returns {string} - Texte formaté
 */
function generateExportText(stickersList) {
  // Groupement par code pays
  const grouped = {};
  stickersList.forEach(s => {
    if (!grouped[s.Code]) grouped[s.Code] = [];
    grouped[s.Code].push(s['N°']);
  });

  return Object.entries(grouped)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([code, nums]) => `${code} ${nums.sort((a, b) => a - b).join(',')}`)
    .join('\n');
}

/**
 * Initialise les boutons d'export texte et de copie.
 */
function initExportImport() {
  // --- Export / Import global (JSON) ---
  document.getElementById('btnExport').addEventListener('click', exportCollectionAsJSON);

  document.getElementById('inputImport').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) importCollectionFromJSON(file);
    e.target.value = ''; // Reset pour permettre un nouvel import du même fichier
  });

  // --- Export texte Manquantes ---
  document.getElementById('btnExportManq').addEventListener('click', () => {
    const filterSection = document.getElementById('manqSectionFilter').value;

    let missing = stickers.filter(s => getStatus(s.ID) === 'missing');
    if (filterSection) missing = missing.filter(s => s.Section === filterSection);

    const text = generateExportText(missing);
    document.getElementById('manqTextarea').value = text || '(Aucune vignette manquante)';
    document.getElementById('manqExportZone').classList.remove('hidden');
    document.getElementById('manqExportZone').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });

  document.getElementById('btnCopyManq').addEventListener('click', () => {
    copyTextarea('manqTextarea');
  });

  document.getElementById('btnCloseManqExport').addEventListener('click', () => {
    document.getElementById('manqExportZone').classList.add('hidden');
  });

  // --- Export texte Doublons ---
  document.getElementById('btnExportDbl').addEventListener('click', () => {
    const filterSection = document.getElementById('dblSectionFilter').value;

    let duplicates = stickers.filter(s => getStatus(s.ID) === 'duplicate');
    if (filterSection) duplicates = duplicates.filter(s => s.Section === filterSection);

    const text = generateExportText(duplicates);
    document.getElementById('dblTextarea').value = text || '(Aucun doublon)';
    document.getElementById('dblExportZone').classList.remove('hidden');
    document.getElementById('dblExportZone').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });

  document.getElementById('btnCopyDbl').addEventListener('click', () => {
    copyTextarea('dblTextarea');
  });

  document.getElementById('btnCloseDblExport').addEventListener('click', () => {
    document.getElementById('dblExportZone').classList.add('hidden');
  });

  // --- Module Échanges Matchmaker ---
  initMatchmaker();
}

/* ═══════════════════════════════════════════════════════════════
   M3 — BARRE DE RECHERCHE GLOBALE
   ═══════════════════════════════════════════════════════════════ */

/** Terme de recherche courant (vide = pas de filtre) */
let searchQuery = '';

/**
 * Initialise la barre de recherche dans le header.
 */
function initGlobalSearch() {
  const input = document.getElementById('globalSearchInput');
  const clearBtn = document.getElementById('globalSearchClear');

  input.addEventListener('input', () => {
    searchQuery = input.value.trim().toLowerCase();
    clearBtn.classList.toggle('visible', searchQuery.length > 0);
    renderCurrentView();
  });

  clearBtn.addEventListener('click', () => {
    input.value = '';
    searchQuery = '';
    clearBtn.classList.remove('visible');
    input.focus();
    renderCurrentView();
  });
}

/**
 * Filtre une liste de stickers selon la recherche courante.
 * Correspond à l'ID (ex: "FRA10") ou au nom du joueur (ex: "Mbappé").
 * @param {Array} list - Liste brute de stickers
 * @returns {Array} - Liste filtrée
 */
function applySearchFilter(list) {
  if (!searchQuery) return list;
  return list.filter(s =>
    s.ID.toLowerCase().includes(searchQuery) ||
    (s.Nom && s.Nom.toLowerCase().includes(searchQuery))
  );
}

/* ═══════════════════════════════════════════════════════════════
   M3 — MODE "OUVERTURE DE BOOSTER" (FAB + Modale)
   ═══════════════════════════════════════════════════════════════ */

/**
 * Initialise le FAB et la modale de booster.
 */
function initBooster() {
  const fab    = document.getElementById('fabBooster');
  const modal  = document.getElementById('boosterModal');
  const input  = document.getElementById('boosterInput');
  const preview = document.getElementById('boosterPreview');

  // Ouverture
  fab.addEventListener('click', () => {
    modal.classList.remove('hidden');
    input.value = '';
    preview.innerHTML = '';
    input.focus();
  });

  // Fermeture
  document.getElementById('btnBoosterClose').addEventListener('click', closeBoosterModal);
  document.getElementById('btnBoosterCancel').addEventListener('click', closeBoosterModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeBoosterModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.classList.contains('hidden')) closeBoosterModal();
  });

  // Prévisualisation en temps réel
  input.addEventListener('input', () => {
    const knownIDs = new Set(stickers.map(s => s.ID));
    const tokens   = input.value.trim().toUpperCase().split(/\s+/).filter(Boolean);

    if (!tokens.length) { preview.innerHTML = ''; return; }

    preview.innerHTML = tokens.map(t => {
      const exists = knownIDs.has(t);
      return `<span class="tag-${exists ? 'ok' : 'err'}">${escHtml(t)}</span>`;
    }).join('');
  });

  // Validation
  document.getElementById('btnBoosterValider').addEventListener('click', () => {
    const knownIDs = new Set(stickers.map(s => s.ID));
    const tokens   = input.value.trim().toUpperCase().split(/\s+/).filter(Boolean);
    const valid    = tokens.filter(t => knownIDs.has(t));

    if (!valid.length) {
      showToast('⚠️ Aucun ID reconnu dans la saisie.');
      return;
    }

    let added = 0;
    valid.forEach(id => {
      const current = getStatus(id);
      if (current === 'missing') {
        setStatus(id, 'owned');
        added++;
      } else if (current === 'owned') {
        setStatus(id, 'duplicate', 2);
        added++;
      } else if (current === 'duplicate') {
        const count = (collectionState[id]?.count || 2) + 1;
        setStatus(id, 'duplicate', count);
        added++;
      }
    });

    closeBoosterModal();
    renderCurrentView();
    showToast(`✅ ${added} vignette${added > 1 ? 's' : ''} ajoutée${added > 1 ? 's' : ''} !`);
  });
}

function closeBoosterModal() {
  document.getElementById('boosterModal').classList.add('hidden');
}

/* ═══════════════════════════════════════════════════════════════
   M4 — MATCHMAKER (module échanges refondu)
   ═══════════════════════════════════════════════════════════════ */

/**
 * Initialise le module Matchmaker (onglets + analyse + export).
 */
function initMatchmaker() {
  // Onglets
  document.querySelectorAll('.matchmaker-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.matchmaker-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.matchmaker-tab-pane').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(`matchmaker-pane-${tab.dataset.tab}`).classList.add('active');
    });
  });

  // Analyser depuis texte brut
  document.getElementById('btnAnalyseTexte').addEventListener('click', () => {
    const raw = document.getElementById('colleagueInputTexte').value.trim();
    if (!raw) { showToast('⚠️ La liste est vide.'); return; }
    const friendStickers = parseTextList(raw);
    if (!friendStickers.size) {
      showToast('⚠️ Format non reconnu. Exemple : MEX 1,2,3');
      return;
    }
    renderMatchmakerResults(friendStickers);
  });

  // Analyser depuis JSON
  document.getElementById('btnAnalyseJSON').addEventListener('click', () => {
    const raw = document.getElementById('colleagueInputJSON').value.trim();
    if (!raw) { showToast('⚠️ Aucun JSON fourni.'); return; }
    const friendStickers = parseFriendJSON(raw);
    if (!friendStickers) return; // erreur déjà toastée
    renderMatchmakerResults(friendStickers);
  });
}

/**
 * Parse le JSON de collection d'un ami et retourne deux Sets :
 * ses doublons (disponibles à l'échange) et ses manquantes.
 * @param {string} raw - JSON brut
 * @returns {{ doublons: Set<string>, manquantes: Set<string> } | null}
 */
function parseFriendJSON(raw) {
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();

    const knownIDs = new Set(stickers.map(s => s.ID));
    const doublons  = new Set();
    const manquantes = new Set();

    Object.entries(parsed).forEach(([id, entry]) => {
      if (!knownIDs.has(id)) return;
      if (entry.status === 'duplicate') doublons.add(id);
      if (entry.status === 'missing')   manquantes.add(id);
    });

    // Les owned de l'ami : il ne les cherche plus et ne les a pas en surplus
    // Toutes les non-listées ou manquantes → il les cherche
    // Complète ses manquantes en ajoutant ce qui n'est ni owned ni duplicate
    stickers.forEach(s => {
      const entry = parsed[s.ID];
      if (!entry || entry.status === 'missing') manquantes.add(s.ID);
    });

    return { doublons, manquantes };
  } catch {
    showToast('❌ JSON invalide ou format non reconnu.');
    return null;
  }
}

/**
 * Génère et affiche les résultats du Matchmaker.
 * Accepte soit un Set<ID> (mode texte brut = doublons de l'ami)
 * soit { doublons, manquantes } (mode JSON).
 *
 * @param {Set<string> | { doublons: Set<string>, manquantes: Set<string> }} friendData
 */
function renderMatchmakerResults(friendData) {
  const mesManquantes = new Set(
    stickers.filter(s => getStatus(s.ID) === 'missing').map(s => s.ID)
  );
  const mesDoublons = new Set(
    stickers.filter(s => getStatus(s.ID) === 'duplicate').map(s => s.ID)
  );

  let friendDoublons, friendManquantes;

  if (friendData instanceof Set) {
    // Mode texte brut : la liste fournie = doublons de l'ami
    friendDoublons  = friendData;
    // Ses manquantes = tout ce qu'il n'a pas listé
    const allIDs = new Set(stickers.map(s => s.ID));
    friendManquantes = new Set([...allIDs].filter(id => !friendDoublons.has(id)));
  } else {
    friendDoublons   = friendData.doublons;
    friendManquantes = friendData.manquantes;
  }

  // Ce que JE DONNE à mon ami : mes doublons que lui cherche (qu'il n'a pas)
  const jeDonne = [...mesDoublons].filter(id => friendManquantes.has(id));

  // Ce que MON AMI ME DONNE : ses doublons que je cherche
  const jeRecois = [...friendDoublons].filter(id => mesManquantes.has(id));

  const resultsDiv = document.getElementById('matchmakerResults');

  // Bannière résumé
  const balanced = Math.min(jeDonne.length, jeRecois.length);
  let html = `
    <div class="match-summary-banner">
      <span class="material-symbols-outlined">swap_horiz</span>
      <span>Échange équilibré : </span>
      <span class="score">${balanced}</span>
      <span class="arrow material-symbols-outlined">arrow_forward</span>
      <span>${jeDonne.length} à donner · ${jeRecois.length} à recevoir</span>
    </div>
    <div class="matchmaker-results">
  `;

  // Bloc "Ce que je donne"
  html += `
    <div class="match-block give">
      <div class="match-block-header">
        🔄 Je donne à mon ami (${jeDonne.length})
      </div>
      <div class="match-block-body">
        ${jeDonne.length === 0
          ? `<p class="match-empty">Aucun doublon utilisable.</p>`
          : `<div class="match-tags">${jeDonne.map(id => {
              const s = stickers.find(x => x.ID === id);
              return `<span class="match-tag" title="${escHtml(s?.Nom || '')}" data-id="${escHtml(id)}">${escHtml(id)}</span>`;
            }).join('')}</div>`
        }
      </div>
    </div>
  `;

  // Bloc "Ce que je reçois"
  html += `
    <div class="match-block receive">
      <div class="match-block-header">
        ✅ Je reçois de mon ami (${jeRecois.length})
      </div>
      <div class="match-block-body">
        ${jeRecois.length === 0
          ? `<p class="match-empty">Ton ami n'a rien qui t'intéresse.</p>`
          : `<div class="match-tags">${jeRecois.map(id => {
              const s = stickers.find(x => x.ID === id);
              return `<span class="match-tag" title="${escHtml(s?.Nom || '')}" data-id="${escHtml(id)}">${escHtml(id)}</span>`;
            }).join('')}</div>`
        }
      </div>
    </div>
  `;

  html += `</div>`;

  // Zone d'export texte
  const exportText = generateMatchExportText(jeDonne, jeRecois);
  html += `
    <div class="matchmaker-export-zone" style="margin-top:var(--sp-sm);">
      <div class="matchmaker-export-header">
        <span class="material-symbols-outlined">content_paste</span>
        <span>Récapitulatif à envoyer</span>
        <button class="btn btn-icon" id="btnCopyMatchExport" title="Copier">
          <span class="material-symbols-outlined">content_copy</span>
        </button>
      </div>
      <textarea class="export-textarea" id="matchExportTextarea" readonly style="min-height:120px;">${escHtml(exportText)}</textarea>
    </div>
  `;

  resultsDiv.innerHTML = html;

  // Clic sur les tags → ouvre la modale de la vignette
  resultsDiv.querySelectorAll('.match-tag[data-id]').forEach(tag => {
    tag.addEventListener('click', () => openModal(tag.dataset.id));
  });

  // Bouton copie export
  document.getElementById('btnCopyMatchExport')?.addEventListener('click', () => {
    copyTextarea('matchExportTextarea');
  });
}

/**
 * Génère le texte d'export formaté pour l'échange (envoi par messagerie).
 * @param {string[]} jeDonne - IDs que je donne
 * @param {string[]} jeRecois - IDs que je reçois
 * @returns {string}
 */
function generateMatchExportText(jeDonne, jeRecois) {
  const balanced = Math.min(jeDonne.length, jeRecois.length);
  const lines = [
    '=== PANINI WC 2026 — RÉCAPITULATIF D\'ÉCHANGE ===',
    '',
    `Échange équilibré possible : ${balanced} vignette(s)`,
    '',
    `▶ CE QUE JE TE DONNE (${jeDonne.length}) :`,
    generateExportText(stickers.filter(s => jeDonne.includes(s.ID))) || '(aucun)',
    '',
    `◀ CE QUE TU ME DONNES (${jeRecois.length}) :`,
    generateExportText(stickers.filter(s => jeRecois.includes(s.ID))) || '(aucun)',
  ];
  return lines.join('\n');
}

/**
 * Copie le contenu d'un textarea dans le presse-papier.
 * @param {string} textareaId - ID du textarea
 */
function copyTextarea(textareaId) {
  const textarea = document.getElementById(textareaId);
  navigator.clipboard.writeText(textarea.value)
    .then(() => showToast('📋 Liste copiée dans le presse-papier !'))
    .catch(() => {
      // Fallback pour les environnements sans clipboard API
      textarea.select();
      document.execCommand('copy');
      showToast('📋 Liste copiée !');
    });
}

/* ═══════════════════════════════════════════════════════════════
   13. VUE STATISTIQUES
   ═══════════════════════════════════════════════════════════════ */

/**
 * Rend la vue Statistiques.
 */
function renderStatsView() {
  const total     = stickers.length;
  const owned     = stickers.filter(s => getStatus(s.ID) === 'owned').length;
  const duplicates = stickers.filter(s => getStatus(s.ID) === 'duplicate').length;
  const missing   = stickers.filter(s => getStatus(s.ID) === 'missing').length;
  // Les doublons comptent comme "possédées" pour le % de complétion
  const ownedTotal = owned + duplicates;
  const pct = Math.round((ownedTotal / total) * 100);

  // Cartes globales
  document.getElementById('statsGlobal').innerHTML = `
    <div class="stat-card completion">
      <div class="stat-card-value">${pct}%</div>
      <div class="stat-card-label">Complétion globale</div>
    </div>
    <div class="stat-card owned">
      <div class="stat-card-value">${ownedTotal}</div>
      <div class="stat-card-label">Possédées</div>
    </div>
    <div class="stat-card missing">
      <div class="stat-card-value">${missing}</div>
      <div class="stat-card-label">Manquantes</div>
    </div>
    <div class="stat-card duplicate">
      <div class="stat-card-value">${duplicates}</div>
      <div class="stat-card-label">Doublons</div>
    </div>
  `;

  // Barres par pays
  renderStatsBars();
}

/**
 * Rend les barres de complétion par pays/section.
 */
function renderStatsBars() {
  const container = document.getElementById('statsBars');
  container.innerHTML = '';

  // Groupement par Code pays
  const grouped = {};
  stickers.forEach(s => {
    if (!grouped[s.Code]) grouped[s.Code] = { section: s.Section, flag: s.Drapeau, stickers: [] };
    grouped[s.Code].stickers.push(s);
  });

  // Tri par taux de complétion décroissant
  const sortedEntries = Object.entries(grouped).sort((a, b) => {
    const getPct = (items) => {
      const total = items.length;
      const ok = items.filter(s => getStatus(s.ID) !== 'missing').length;
      return ok / total;
    };
    return getPct(b[1].stickers) - getPct(a[1].stickers);
  });

  sortedEntries.forEach(([code, data]) => {
    const total  = data.stickers.length;
    const ok     = data.stickers.filter(s => getStatus(s.ID) !== 'missing').length;
    const pct    = Math.round((ok / total) * 100);
    const fillClass = pct === 100 ? 'full' : pct < 20 ? 'low' : '';

    const row = document.createElement('div');
    row.className = 'stat-bar-row';
    row.innerHTML = `
      <div class="stat-bar-label">
        ${data.flag ? `<img src="${escHtml(data.flag)}" alt="" loading="lazy" />` : ''}
        <span title="${escHtml(data.section)}">${escHtml(data.section)}</span>
      </div>
      <div class="stat-bar-track">
        <div class="stat-bar-fill ${fillClass}" style="width:${pct}%"></div>
      </div>
      <div class="stat-bar-pct">${pct}%</div>
    `;
    container.appendChild(row);
  });
}

/* ═══════════════════════════════════════════════════════════════
   14. PARSING DE LISTES TEXTE
   ═══════════════════════════════════════════════════════════════ */
function parseTextList(text) {
  const ids = new Set();
  const knownIDs = new Set(stickers.map(s => s.ID));

  // Chaque ligne : "CODE n1,n2,n3" ou "CODE n1, n2, n3"
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  lines.forEach(line => {
    // Tente de matcher "CODE NUMS"
    const match = line.match(/^([A-Z0-9]+)\s+([\d,\s]+)$/i);
    if (!match) return;

    const code = match[1].toUpperCase();
    const nums = match[2].split(',').map(n => parseInt(n.trim(), 10)).filter(n => !isNaN(n));

    nums.forEach(n => {
      const id = `${code}${n}`;
      if (knownIDs.has(id)) ids.add(id);
    });
  });

  return ids;
}

/* ═══════════════════════════════════════════════════════════════
   15. MODALE VIGNETTE
   ═══════════════════════════════════════════════════════════════ */

/**
 * Initialise la modale et ses contrôles.
 */
function initModal() {
  // Fermeture
  document.getElementById('btnModalClose').addEventListener('click', closeModal);
  document.getElementById('stickerModal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modalStickerID) closeModal();
  });

  // Boutons de statut
  document.querySelectorAll('.btn-status').forEach(btn => {
    btn.addEventListener('click', () => {
      const status = btn.dataset.status;
      if (!modalStickerID) return;

      setStatus(modalStickerID, status);
      updateModalStatusButtons(status);
      refreshStickerInView(modalStickerID);

      if (status === 'duplicate') {
        document.getElementById('modalDupControls').classList.remove('hidden');
        const count = getDupCount(modalStickerID);
        document.getElementById('dupCountDisplay').textContent = count;
        updateModalDupMinusState(count);
      } else {
        document.getElementById('modalDupControls').classList.add('hidden');
      }
    });
  });

  // Contrôles de compteur doublons
  document.getElementById('btnDupPlus').addEventListener('click', () => {
    if (!modalStickerID) return;
    const newCount = (collectionState[modalStickerID]?.count || 2) + 1;
    setStatus(modalStickerID, 'duplicate', newCount);
    document.getElementById('dupCountDisplay').textContent = newCount;
    updateModalDupMinusState(newCount);
    refreshStickerInView(modalStickerID);
  });

  document.getElementById('btnDupMinus').addEventListener('click', () => {
    if (!modalStickerID) return;
    const current = collectionState[modalStickerID]?.count || 2;
    if (current <= 2) return; // minimum 2 pour un doublon
    const newCount = current - 1;
    setStatus(modalStickerID, 'duplicate', newCount);
    document.getElementById('dupCountDisplay').textContent = newCount;
    updateModalDupMinusState(newCount);
    refreshStickerInView(modalStickerID);
  });
}

/**
 * Active/désactive le bouton "Moins" selon la limite de 2 doublons minimum.
 * @param {number} count - Valeur courante du compteur
 */
function updateModalDupMinusState(count) {
  const btn = document.getElementById('btnDupMinus');
  btn.disabled = count <= 2;
}

/**
 * Ouvre la modale pour une vignette donnée.
 * @param {string} id - ID de la vignette
 */
function openModal(id) {
  const sticker = stickers.find(s => s.ID === id);
  if (!sticker) return;

  modalStickerID = id;
  const status = getStatus(id);

  // Remplissage des informations
  document.getElementById('modalId').textContent = sticker.ID;
  document.getElementById('modalTitle').textContent = sticker.Nom;
  document.getElementById('modalFlag').src = sticker.Drapeau || '';
  document.getElementById('modalFlag').alt = sticker.Section;

  document.getElementById('modalMeta').innerHTML = `
    <span>${escHtml(sticker.Section)}</span>
    <span>${escHtml(sticker.Type)}</span>
    ${sticker.Groupe ? `<span>Groupe ${escHtml(sticker.Groupe)}</span>` : ''}
    <span>Page ${sticker['Page']}</span>
  `;

  // Couleur de l'en-tête selon le statut
  const headerColors = {
    owned:     { bg: 'var(--green-deep)',      fg: 'var(--yellow-lime)' },
    missing:   { bg: 'var(--surface-mid)',     fg: 'var(--outline)' },
    duplicate: { bg: 'var(--orange-vibrant)',  fg: '#fff' },
  };
  const colors = headerColors[status] || headerColors.missing;
  const header = document.getElementById('modalHeader');
  header.style.background = colors.bg;
  header.style.color = colors.fg;

  // Boutons de statut
  updateModalStatusButtons(status);

  // Compteur doublons
  const dupControls = document.getElementById('modalDupControls');
  if (status === 'duplicate') {
    dupControls.classList.remove('hidden');
    const dupCount = getDupCount(id);
    document.getElementById('dupCountDisplay').textContent = dupCount;
    updateModalDupMinusState(dupCount);
  } else {
    dupControls.classList.add('hidden');
  }

  // Affichage de la modale
  document.getElementById('stickerModal').classList.remove('hidden');
  document.getElementById('btnModalClose').focus();
}

/**
 * Ferme la modale.
 */
function closeModal() {
  document.getElementById('stickerModal').classList.add('hidden');
  modalStickerID = null;
}

/**
 * Met à jour l'état visuel des boutons de statut dans la modale.
 * @param {string} activeStatus - Statut actuellement actif
 */
function updateModalStatusButtons(activeStatus) {
  document.querySelectorAll('.btn-status').forEach(btn => {
    btn.classList.toggle('active-status', btn.dataset.status === activeStatus);
  });
}

/**
 * Met à jour une vignette dans la vue courante sans re-rendre toute la grille.
 * @param {string} id - ID de la vignette à rafraîchir
 */
function refreshStickerInView(id) {
  // On re-rend uniquement si la vue courante affiche cette vignette
  // Pour les vues album et pays, on cherche la card existante et on la remplace
  const existingCards = document.querySelectorAll(`.sticker-card[data-id="${id}"]`);
  if (existingCards.length > 0) {
    const sticker = stickers.find(s => s.ID === id);
    if (!sticker) return;
    const newCard = buildStickerCard(sticker);
    existingCards.forEach(card => card.parentNode.replaceChild(newCard.cloneNode(true), card));
    // Ré-attacher les événements sur le clone
    document.querySelectorAll(`.sticker-card[data-id="${id}"]`).forEach(card => {
      card.addEventListener('click', () => openModal(id));
    });
  }

  // Mise à jour des vues liste si elles sont actives
  if (currentView === 'manquantes') renderManquantesView();
  if (currentView === 'doublons')   renderDoublonsView();
  if (currentView === 'stats')      renderStatsView();
}

/* ═══════════════════════════════════════════════════════════════
   16. BARRE DE PROGRESSION GLOBALE
   ═══════════════════════════════════════════════════════════════ */

/**
 * Met à jour la barre de progression globale dans l'en-tête.
 */
function updateGlobalProgress() {
  const total = stickers.length;
  const owned = stickers.filter(s => getStatus(s.ID) !== 'missing').length;
  const pct   = total > 0 ? Math.round((owned / total) * 100) : 0;

  document.getElementById('progressOwned').textContent = owned;
  document.getElementById('progressTotal').textContent = total;
  document.getElementById('progressPct').textContent = `${pct}%`;
  document.getElementById('progressFill').style.width = `${pct}%`;

  // M1 — Badge compact mobile
  const badge = document.getElementById('progressPctMobile');
  if (badge) badge.textContent = `${pct}%`;
}

/* ═══════════════════════════════════════════════════════════════
   17. UTILITAIRES
   ═══════════════════════════════════════════════════════════════ */

/**
 * Échappe les caractères HTML pour prévenir les injections XSS.
 * @param {string} str - Chaîne à échapper
 * @returns {string}
 */
function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g,  '&#39;');
}

/**
 * Retourne un libellé lisible pour un statut.
 * @param {string} status
 * @returns {string}
 */
function statusLabel(status) {
  const labels = { owned: 'Possédée', missing: 'Manquante', duplicate: 'Doublon' };
  return labels[status] || status;
}

/* ─── Toast (M1 : anti-spam agrégé) ─── */

let toastTimer = null;
let toastSpamKey = null;      // clé de catégorie du toast courant
let toastSpamCount = 0;       // nb d'actions groupées

/**
 * Affiche un message toast temporaire.
 * Si spamKey est fourni et correspond au toast actif, on agrège
 * en incrémentant un compteur plutôt qu'empiler de nouveaux toasts.
 *
 * @param {string} message   - Message principal
 * @param {number} [duration=2500] - Durée en ms
 * @param {string|null} [spamKey=null] - Clé pour détecter les spams (ex: 'owned')
 * @param {string|null} [spamTemplate=null] - Template avec %n% pour le compteur
 */
function showToast(message, duration = 2500, spamKey = null, spamTemplate = null) {
  const toast = document.getElementById('toast');

  if (spamKey && spamKey === toastSpamKey && toast.classList.contains('show')) {
    // Toast existant de la même catégorie → on agrège
    toastSpamCount++;
    toast.textContent = spamTemplate
      ? spamTemplate.replace('%n%', toastSpamCount)
      : message;
    // On reset le timer
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.classList.remove('show');
      toastSpamKey = null;
      toastSpamCount = 0;
    }, duration);
    return;
  }

  // Nouveau toast
  toastSpamKey   = spamKey;
  toastSpamCount = 1;
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove('show');
    toastSpamKey = null;
    toastSpamCount = 0;
  }, duration);
}

/* ─── Spinner de chargement ─── */

function showLoadingSpinner() {
  const main = document.getElementById('stickerGrid');
  if (main) {
    main.innerHTML = `
      <div class="loading-spinner" style="grid-column:1/-1">
        <div class="spinner-ring"></div>
        <p style="font-weight:700;font-size:14px;color:var(--outline);">Chargement de la base…</p>
      </div>
    `;
  }
}

function hideLoadingSpinner() {
  // Le spinner disparaîtra au prochain renderAlbumView()
}
