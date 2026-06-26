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
    case 'echanges':   /* rien à rendre d'emblée */ break;
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

  // Mise à jour de l'indicateur de page
  document.getElementById('albumPageCurrent').textContent = pageNum;
  document.getElementById('albumPageSelect').value = currentAlbumPageIndex;

  // Boutons prev/next
  document.getElementById('btnPagePrev').disabled = currentAlbumPageIndex === 0;
  document.getElementById('btnPageNext').disabled = currentAlbumPageIndex === albumPages.length - 1;

  // En-tête de section
  renderAlbumSectionHeader(pageStickers);

  // Grille de vignettes
  const grid = document.getElementById('stickerGrid');
  grid.innerHTML = '';

  pageStickers.forEach(sticker => {
    const card = buildStickerCard(sticker);
    grid.appendChild(card);
  });
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
    <div>
      <div class="pays-info-name">${escHtml(sectionName)}</div>
      <div class="pays-info-stats">
        <strong>${owned}</strong> / ${total} possédées — <strong>${pct}%</strong>
      </div>
    </div>
    <div class="pays-progress-bar" style="flex:1;height:12px;background:var(--blue-electric);border:2px solid rgba(255,255,255,0.2);border-radius:var(--radius-sm);overflow:hidden;">
      <div class="pays-progress-fill" style="width:${pct}%;height:100%;background:var(--green-bright);transition:width 0.3s;"></div>
    </div>
  `;

  // Grille des vignettes du pays
  const grid = document.getElementById('paysGrid');
  grid.innerHTML = '';
  paysStickers.forEach(s => grid.appendChild(buildStickerCard(s)));
}

/* ═══════════════════════════════════════════════════════════════
   11. VUE MANQUANTES
   ═══════════════════════════════════════════════════════════════ */

/**
 * Initialise les filtres communs aux vues manquantes et doublons.
 */
function initFilters() {
  // Filtres manquantes : on ne garde que le filtre section
  document.getElementById('manqSectionFilter').addEventListener('change', renderManquantesView);

  // Filtres doublons
  document.getElementById('dblSectionFilter').addEventListener('change', renderDoublonsView);

  // Peuplement des filtres
  populateFilterSelects();
}

/**
 * Peuple les <select> de filtres avec les sections uniques.
 */
function populateFilterSelects() {
  const sections = [...new Set(stickers.map(s => s.Section))].sort();

  const manqSec  = document.getElementById('manqSectionFilter');
  const dblSec   = document.getElementById('dblSectionFilter');

  // On vide et on ajoute l'option "Toutes les sections" déjà présente dans le HTML
  // mais on peut les vider pour éviter les doublons
  manqSec.innerHTML = '<option value="">Toutes les sections</option>';
  dblSec.innerHTML = '<option value="">Toutes les sections</option>';

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
  container.innerHTML = '';

  if (!stickersList.length) {
    container.innerHTML = `
      <div style="padding:var(--sp-lg);text-align:center;color:var(--outline);">
        <span class="material-symbols-outlined" style="font-size:48px;opacity:0.3;display:block;margin-bottom:12px;">check_circle</span>
        <p style="font-weight:700;font-size:14px;">Aucune vignette dans cette catégorie.</p>
      </div>
    `;
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
    container.appendChild(header);

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
      container.appendChild(item);
    });
  });
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

  // --- Module Échanges ---
  document.getElementById('btnAnalyse').addEventListener('click', analyseEchanges);
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
   14. MODULE ÉCHANGES
   ═══════════════════════════════════════════════════════════════ */

/**
 * Analyse la liste textuelle d'un collègue et affiche les échanges possibles.
 *
 * Format attendu :
 *   CODE N°1,N°2,N°3
 *   CODE N°4,N°5
 * Interprète chaque ligne comme les doublons du collègue (ou ses manquantes).
 */
function analyseEchanges() {
  const raw = document.getElementById('colleagueInput').value.trim();
  const resultsDiv = document.getElementById('echangeResults');

  if (!raw) {
    resultsDiv.innerHTML = `
      <div class="echange-empty">
        <span class="material-symbols-outlined">warning</span>
        <p>La liste est vide. Colle la liste de ton collègue.</p>
      </div>
    `;
    return;
  }

  // Parse la liste du collègue
  const colleagueStickers = parseTextList(raw);

  if (colleagueStickers.size === 0) {
    resultsDiv.innerHTML = `
      <div class="echange-empty">
        <span class="material-symbols-outlined">error</span>
        <p>Format non reconnu. Exemple attendu :<br><code>MEX 1,2,3</code></p>
      </div>
    `;
    return;
  }

  // Mes manquantes : vignettes que je n'ai pas
  const mesManquantes = new Set(
    stickers.filter(s => getStatus(s.ID) === 'missing').map(s => s.ID)
  );

  // Mes doublons : vignettes que j'ai en surplus
  const mesDoublons = new Set(
    stickers.filter(s => getStatus(s.ID) === 'duplicate').map(s => s.ID)
  );

  // Ce que le collègue a (et que je cherche) : intersection(colleagueStickers, mesManquantes)
  const ilsOntPourMoi = [...colleagueStickers].filter(id => mesManquantes.has(id));

  // Ce que j'ai en doublon (et dont le collègue a besoin) : intersection(mesDoublons, manquantes du collègue)
  // Note : on interprète la liste collée comme ses doublons OU ses manquantes.
  // On considère ici que TOUTES les vignettes qu'il a listées = ses doublons disponibles.
  // Ses manquantes sont les stickers non listés. Mes doublons dont il a besoin = mesDoublons - colleagueStickers.
  const jeDonnePourLui = [...mesDoublons].filter(id => !colleagueStickers.has(id));

  // Construction du rendu
  let html = '';

  // Bloc 1 : Ce que le collègue peut me donner
  html += `<div class="echange-block ils-ont">
    <div class="echange-block-title">
      ✅ Il/Elle peut me donner (${ilsOntPourMoi.length})
    </div>`;

  if (ilsOntPourMoi.length === 0) {
    html += `<p class="echange-empty" style="padding:var(--sp-sm);color:var(--outline);font-size:13px;">
      Aucune vignette en commun.
    </p>`;
  } else {
    html += `<div class="echange-sticker-tags">`;
    ilsOntPourMoi.forEach(id => {
      const s = stickers.find(x => x.ID === id);
      html += `<span class="echange-tag" title="${escHtml(s?.Nom || '')}">${escHtml(id)}</span>`;
    });
    html += `</div>`;
  }
  html += `</div>`;

  // Bloc 2 : Ce que je peux lui donner
  html += `<div class="echange-block je-donne">
    <div class="echange-block-title">
      🔄 Je peux lui/lui donner (${jeDonnePourLui.length})
    </div>`;

  if (jeDonnePourLui.length === 0) {
    html += `<p class="echange-empty" style="padding:var(--sp-sm);color:rgba(255,255,255,0.6);font-size:13px;">
      Aucun doublon à lui proposer.
    </p>`;
  } else {
    html += `<div class="echange-sticker-tags">`;
    jeDonnePourLui.forEach(id => {
      const s = stickers.find(x => x.ID === id);
      html += `<span class="echange-tag" title="${escHtml(s?.Nom || '')}">${escHtml(id)}</span>`;
    });
    html += `</div>`;
  }
  html += `</div>`;

  resultsDiv.innerHTML = html;
}

/**
 * Parse une liste texte au format "CODE N°1,N°2,N°3" et retourne un Set d'IDs.
 * @param {string} text - Texte brut à analyser
 * @returns {Set<string>} - Ensemble des IDs reconnus
 */
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
        document.getElementById('dupCountDisplay').textContent = getDupCount(modalStickerID);
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
    refreshStickerInView(modalStickerID);
  });

  document.getElementById('btnDupMinus').addEventListener('click', () => {
    if (!modalStickerID) return;
    const current = collectionState[modalStickerID]?.count || 2;
    if (current <= 2) return; // minimum 2 pour un doublon
    const newCount = current - 1;
    setStatus(modalStickerID, 'duplicate', newCount);
    document.getElementById('dupCountDisplay').textContent = newCount;
    refreshStickerInView(modalStickerID);
  });
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
    document.getElementById('dupCountDisplay').textContent = getDupCount(id);
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

/* ─── Toast ─── */

let toastTimer = null;

/**
 * Affiche un message toast temporaire.
 * @param {string} message - Message à afficher
 * @param {number} [duration=2500] - Durée en ms
 */
function showToast(message, duration = 2500) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), duration);
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