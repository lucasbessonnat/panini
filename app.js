/* ============================================================
   STICKER TRACKER 2026 - Application principale
   ============================================================ */

// ---------- État global ----------
let stickers = [];               // données brutes du JSON
let collectionState = {};        // { stickerID: { status, count } }
let currentView = 'album';       // vue active
let currentPage = 1;            // pour la vue album
const STORAGE_KEY = 'panini2026_collection';

// ---------- Références DOM ----------
const mainEl = document.getElementById('main-content');
const navItems = document.querySelectorAll('#desktop-nav ul li, #mobile-nav button');
const btnExport = document.getElementById('btn-export');
const btnImport = document.getElementById('btn-import');
const fileInput = document.getElementById('file-input');

// ---------- Initialisation ----------
document.addEventListener('DOMContentLoaded', async () => {
    await loadStickers();
    loadState();
    setupNavigation();
    setupExportImport();
    renderView(currentView);
});

// ---------- 1. Chargement des données ----------
async function loadStickers() {
    try {
        const res = await fetch('database.json');
        if (!res.ok) throw new Error('Impossible de charger database.json');
        stickers = await res.json();
        // Si le JSON n'est pas un tableau, on tente de l'extraire
        if (!Array.isArray(stickers)) {
            if (stickers && typeof stickers === 'object') {
                // Parfois le fichier peut être un objet avec une propriété contenant le tableau
                const possible = Object.values(stickers).find(v => Array.isArray(v));
                if (possible) stickers = possible;
                else throw new Error('Format de données inattendu');
            } else {
                throw new Error('Le fichier ne contient pas un tableau');
            }
        }
    } catch (err) {
        console.error('Erreur chargement database.json:', err);
        mainEl.innerHTML = `<div class="empty-state">❌ Impossible de charger database.json. Vérifiez que le fichier est présent et valide.</div>`;
        stickers = [];
    }
}

// ---------- 2. Gestion de l'état de collection ----------
function getDefaultState() {
    const state = {};
    stickers.forEach(s => {
        state[s.ID] = { status: 'missing', count: 0 };
    });
    return state;
}

function loadState() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
        try {
            const parsed = JSON.parse(saved);
            // Vérifier que tous les stickers sont présents
            let valid = true;
            for (const s of stickers) {
                if (!parsed[s.ID]) { valid = false; break; }
            }
            if (valid) {
                collectionState = parsed;
                return;
            }
        } catch (_) { /* ignore */ }
    }
    // Sinon initialiser
    collectionState = getDefaultState();
    saveState();
}

function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(collectionState));
}

function setStatus(id, status, count = 0) {
    if (!collectionState[id]) return;
    collectionState[id].status = status;
    if (status === 'duplicate') {
        collectionState[id].count = Math.max(1, count);
    } else {
        collectionState[id].count = 0;
    }
    saveState();
    renderView(currentView); // rafraîchir la vue
}

function getStatus(id) {
    return collectionState[id] || { status: 'missing', count: 0 };
}

// ---------- 3. Navigation ----------
function setupNavigation() {
    navItems.forEach(item => {
        item.addEventListener('click', () => {
            const view = item.dataset.view;
            if (view) {
                currentView = view;
                // Mise à jour des classes actives
                navItems.forEach(n => n.classList.remove('active'));
                item.classList.add('active');
                // synchronisation entre desktop et mobile
                const sameView = document.querySelectorAll(`[data-view="${view}"]`);
                sameView.forEach(el => el.classList.add('active'));
                renderView(view);
            }
        });
    });
}

// ---------- 4. Rendu des vues ----------
function renderView(view) {
    switch (view) {
        case 'album': renderAlbum(); break;
        case 'country': renderCountry(); break;
        case 'missing': renderMissing(); break;
        case 'duplicates': renderDuplicates(); break;
        case 'stats': renderStats(); break;
        case 'trade': renderTrade(); break;
        default: mainEl.innerHTML = '<div class="empty-state">Vue inconnue</div>';
    }
}

// ---------- 4a. Vue Album par page ----------
function renderAlbum() {
    const pages = [...new Set(stickers.map(s => s.Page))].sort((a,b) => a-b);
    if (!pages.includes(currentPage)) currentPage = pages[0] || 1;

    const pageStickers = stickers.filter(s => s.Page === currentPage);
    const html = `
        <h2 class="section-title">Album · Page ${currentPage}</h2>
        <div class="album-pagination">
            <button id="prev-page">◀</button>
            <span>${currentPage} / ${pages.length}</span>
            <button id="next-page">▶</button>
        </div>
        <div class="sticker-grid">
            ${pageStickers.map(s => stickerCardHTML(s)).join('')}
        </div>
    `;
    mainEl.innerHTML = html;

    // Pagination
    document.getElementById('prev-page').addEventListener('click', () => {
        const idx = pages.indexOf(currentPage);
        if (idx > 0) { currentPage = pages[idx-1]; renderView('album'); }
    });
    document.getElementById('next-page').addEventListener('click', () => {
        const idx = pages.indexOf(currentPage);
        if (idx < pages.length-1) { currentPage = pages[idx+1]; renderView('album'); }
    });

    // Attacher les événements sur les cartes
    attachStickerEvents();
}

// ---------- 4b. Vue Par pays ----------
function renderCountry() {
    const codes = [...new Set(stickers.map(s => s.Code))].sort();
    // Créer un sélecteur de pays
    let selectHTML = `<select id="country-select" class="filters-bar"><option value="">-- Choisir un pays --</option>`;
    codes.forEach(code => {
        selectHTML += `<option value="${code}">${code}</option>`;
    });
    selectHTML += `</select>`;

    mainEl.innerHTML = `
        <h2 class="section-title">Par pays</h2>
        <div class="filters-bar">${selectHTML}</div>
        <div id="country-grid" class="sticker-grid"></div>
    `;

    const select = document.getElementById('country-select');
    const grid = document.getElementById('country-grid');

    select.addEventListener('change', () => {
        const code = select.value;
        if (!code) { grid.innerHTML = ''; return; }
        const filtered = stickers.filter(s => s.Code === code);
        grid.innerHTML = filtered.map(s => stickerCardHTML(s)).join('');
        attachStickerEvents();
    });
}

// ---------- 4c. Vue Manquantes ----------
function renderMissing() {
    renderFilterableList('missing', 'Mes manquantes', 'help_outline');
}

// ---------- 4d. Vue Doublons ----------
function renderDuplicates() {
    renderFilterableList('duplicate', 'Mes doublons', 'content_copy');
}

// Fonction générique pour les listes filtrées
function renderFilterableList(status, title, icon) {
    const filtered = stickers.filter(s => collectionState[s.ID]?.status === status);

    // Construction des filtres
    const sections = [...new Set(stickers.map(s => s.Section))].sort();
    const types = [...new Set(stickers.map(s => s.Type))].sort();
    const groups = [...new Set(stickers.map(s => s.Groupe || ''))].sort();

    let filtersHTML = `
        <div class="filters-bar">
            <select id="filter-section"><option value="">Toutes sections</option>
                ${sections.map(sec => `<option value="${sec}">${sec}</option>`).join('')}
            </select>
            <select id="filter-type"><option value="">Tous types</option>
                ${types.map(t => `<option value="${t}">${t}</option>`).join('')}
            </select>
            <select id="filter-group"><option value="">Tous groupes</option>
                ${groups.map(g => `<option value="${g}">${g || 'Aucun'}</option>`).join('')}
            </select>
            <button id="export-list-btn" class="hard-shadow-sm" style="padding:0.3rem 1rem;background:var(--color-primary);color:white;border:2px solid var(--color-inverse-surface);border-radius:var(--radius-full);">📋 Copier la liste</button>
        </div>
        <div id="filtered-grid" class="sticker-grid"></div>
    `;

    mainEl.innerHTML = `
        <h2 class="section-title"><span class="material-symbols-outlined" style="font-size:2rem;vertical-align:middle;">${icon}</span> ${title}</h2>
        ${filtersHTML}
    `;

    // Appliquer les filtres
    const grid = document.getElementById('filtered-grid');
    const filterSection = document.getElementById('filter-section');
    const filterType = document.getElementById('filter-type');
    const filterGroup = document.getElementById('filter-group');
    const exportBtn = document.getElementById('export-list-btn');

    function applyFilters() {
        const sec = filterSection.value;
        const typ = filterType.value;
        const grp = filterGroup.value;
        let list = stickers.filter(s => collectionState[s.ID]?.status === status);
        if (sec) list = list.filter(s => s.Section === sec);
        if (typ) list = list.filter(s => s.Type === typ);
        if (grp) list = list.filter(s => (s.Groupe || '') === grp);
        grid.innerHTML = list.map(s => stickerCardHTML(s)).join('');
        attachStickerEvents();
    }

    filterSection.addEventListener('change', applyFilters);
    filterType.addEventListener('change', applyFilters);
    filterGroup.addEventListener('change', applyFilters);

    // Export texte
    exportBtn.addEventListener('click', () => {
        const sec = filterSection.value;
        const typ = filterType.value;
        const grp = filterGroup.value;
        let list = stickers.filter(s => collectionState[s.ID]?.status === status);
        if (sec) list = list.filter(s => s.Section === sec);
        if (typ) list = list.filter(s => s.Type === typ);
        if (grp) list = list.filter(s => (s.Groupe || '') === grp);
        // Grouper par Code
        const groups = {};
        list.forEach(s => {
            const key = s.Code;
            if (!groups[key]) groups[key] = [];
            groups[key].push(s['N°']);
        });
        let text = '';
        for (const [code, nums] of Object.entries(groups)) {
            nums.sort((a,b) => a-b);
            text += `${code} ${nums.join(',')}\n`;
        }
        // Copier dans le presse-papier
        navigator.clipboard.writeText(text).then(() => {
            alert('Liste copiée dans le presse-papier !');
        }).catch(() => {
            // Fallback : afficher dans une textarea
            const ta = document.createElement('textarea');
            ta.value = text;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
            alert('Liste copiée !');
        });
    });

    applyFilters();
}

// ---------- 4e. Vue Stats ----------
function renderStats() {
    const total = stickers.length;
    const owned = stickers.filter(s => collectionState[s.ID]?.status === 'owned').length;
    const missing = stickers.filter(s => collectionState[s.ID]?.status === 'missing').length;
    const dup = stickers.filter(s => collectionState[s.ID]?.status === 'duplicate').length;
    const progress = total ? Math.round((owned / total) * 100) : 0;

    // Stats par pays
    const codes = [...new Set(stickers.map(s => s.Code))].sort();
    let countryStats = '';
    codes.forEach(code => {
        const totalCountry = stickers.filter(s => s.Code === code).length;
        const ownedCountry = stickers.filter(s => s.Code === code && collectionState[s.ID]?.status === 'owned').length;
        const pct = totalCountry ? Math.round((ownedCountry / totalCountry) * 100) : 0;
        countryStats += `
            <div style="display:flex;align-items:center;gap:var(--spacing-sm);margin-bottom:0.25rem;">
                <span style="font-weight:700;width:4rem;">${code}</span>
                <div class="progress-bar" style="flex:1;height:1rem;">
                    <div class="fill" style="width:${pct}%;"></div>
                </div>
                <span style="font-weight:700;">${pct}%</span>
            </div>
        `;
    });

    mainEl.innerHTML = `
        <h2 class="section-title">📊 Statistiques</h2>
        <div class="stats-grid">
            <div class="stat-card"><div class="number">${owned}</div><div class="label">Possédées</div></div>
            <div class="stat-card"><div class="number">${missing}</div><div class="label">Manquantes</div></div>
            <div class="stat-card"><div class="number">${dup}</div><div class="label">Doublons</div></div>
            <div class="stat-card"><div class="number">${progress}%</div><div class="label">Complétion</div></div>
        </div>
        <div class="progress-bar" style="height:2rem;margin-bottom:var(--spacing-lg);">
            <div class="fill" style="width:${progress}%;"></div>
        </div>
        <h3 class="section-title" style="font-size:1.2rem;">Progression par pays</h3>
        ${countryStats}
    `;
}

// ---------- 4f. Vue Échanges ----------
function renderTrade() {
    mainEl.innerHTML = `
        <h2 class="section-title">🤝 Module d'échanges</h2>
        <div class="trade-section">
            <div>
                <label style="font-weight:700;">Mes manquantes (coller ici)</label>
                <textarea id="trade-missing" placeholder="Ex: ARG 1, BRA 5, FRA 10..."></textarea>
            </div>
            <div>
                <label style="font-weight:700;">Mes doublons (coller ici)</label>
                <textarea id="trade-duplicates" placeholder="Ex: ENG 2, GER 12, ESP 4..."></textarea>
            </div>
            <button id="trade-compare" class="hard-shadow-sm" style="grid-column:1/-1;padding:0.6rem;background:var(--color-primary);color:white;border:2px solid var(--color-inverse-surface);border-radius:var(--radius-full);font-weight:700;font-size:1rem;">Comparer les listes</button>
            <div id="trade-result" class="result"></div>
        </div>
    `;

    document.getElementById('trade-compare').addEventListener('click', () => {
        const missingText = document.getElementById('trade-missing').value;
        const dupText = document.getElementById('trade-duplicates').value;
        // Parser les listes : on extrait les ID de stickers
        const parseList = (text) => {
            const ids = [];
            const tokens = text.split(/[,;\s]+/).filter(t => t.trim().length > 0);
            for (const token of tokens) {
                // Chercher un ID connu (ex: ARG1, BRA5, etc.)
                const match = token.trim().toUpperCase();
                const found = stickers.find(s => s.ID === match);
                if (found) ids.push(found.ID);
            }
            return ids;
        };

        const missingIds = parseList(missingText);
        const dupIds = parseList(dupText);

        // Comparer avec notre collection
        const myMissing = stickers.filter(s => collectionState[s.ID]?.status === 'missing').map(s => s.ID);
        const myDuplicates = stickers.filter(s => collectionState[s.ID]?.status === 'duplicate').map(s => s.ID);

        // Ce que je peux donner : doublons qui sont dans les manquantes de l'autre
        const give = myDuplicates.filter(id => missingIds.includes(id));
        // Ce que je peux recevoir : mes manquantes qui sont dans les doublons de l'autre
        const receive = myMissing.filter(id => dupIds.includes(id));

        let resultHTML = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--spacing-md);margin-top:var(--spacing-md);">';
        resultHTML += `<div style="border:2px solid var(--color-inverse-surface);padding:var(--spacing-sm);border-radius:var(--radius-default);background:var(--color-surface-container-low);">
            <h4 style="font-weight:700;">✅ Je peux donner</h4>
            ${give.length ? give.map(id => `<span class="sticker-tag">${id}</span>`).join(' ') : '<em>Aucun</em>'}
        </div>`;
        resultHTML += `<div style="border:2px solid var(--color-inverse-surface);padding:var(--spacing-sm);border-radius:var(--radius-default);background:var(--color-surface-container-low);">
            <h4 style="font-weight:700;">📥 Je peux recevoir</h4>
            ${receive.length ? receive.map(id => `<span class="sticker-tag">${id}</span>`).join(' ') : '<em>Aucun</em>'}
        </div>`;
        resultHTML += '</div>';

        document.getElementById('trade-result').innerHTML = resultHTML;
    });
}

// ---------- 5. Génération du HTML d'une carte vignette ----------
function stickerCardHTML(sticker) {
    const state = getStatus(sticker.ID);
    const statusClass = state.status === 'owned' ? 'status-owned' :
                        state.status === 'duplicate' ? 'status-duplicate' : 'status-missing';
    const dupBadge = state.status === 'duplicate' && state.count > 1 ?
        `<div class="dup-badge">+${state.count}</div>` : '';

    // Image ou placeholder
    const imgSrc = sticker.Drapeau && sticker.Drapeau.startsWith('http') ? sticker.Drapeau : '';
    const imgContent = imgSrc ?
        `<img src="${imgSrc}" alt="${sticker.Nom}" loading="lazy" />` :
        `<div class="empty">${sticker.ID}</div>`;

    return `
        <div class="sticker-card ${statusClass}" data-id="${sticker.ID}">
            ${dupBadge}
            <div class="header">
                <span>${sticker.ID}</span>
                <span class="badge">${sticker.Groupe || '—'}</span>
            </div>
            <div class="image">
                ${imgContent}
            </div>
            <div class="footer">
                <div class="name">${sticker.Nom}</div>
                <div class="type">${sticker.Type} · ${sticker.Section}</div>
            </div>
            <div class="status-indicator"></div>
        </div>
    `;
}

// ---------- 6. Attacher les événements sur les cartes (changement de statut) ----------
function attachStickerEvents() {
    document.querySelectorAll('.sticker-card').forEach(card => {
        card.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = card.dataset.id;
            if (!id) return;
            const state = getStatus(id);
            // Cycle : missing -> owned -> duplicate -> missing
            let newStatus, newCount = 0;
            if (state.status === 'missing') {
                newStatus = 'owned';
            } else if (state.status === 'owned') {
                newStatus = 'duplicate';
                newCount = 1;
            } else if (state.status === 'duplicate') {
                // Augmenter le compteur ou passer à missing ? On propose un cycle +1
                newCount = state.count + 1;
                newStatus = 'duplicate';
                // Si on dépasse 9, on remet à missing
                if (newCount > 9) {
                    newStatus = 'missing';
                    newCount = 0;
                }
            }
            setStatus(id, newStatus, newCount);
        });

        // Clic droit : revenir à missing
        card.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            const id = card.dataset.id;
            if (id) setStatus(id, 'missing', 0);
        });
    });
}

// ---------- 7. Export / Import JSON ----------
function setupExportImport() {
    btnExport.addEventListener('click', exportCollection);
    btnImport.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length) {
            importCollection(e.target.files[0]);
        }
        e.target.value = ''; // reset
    });
}

function exportCollection() {
    const json = JSON.stringify(collectionState, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ma-collection-panini-${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function importCollection(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const imported = JSON.parse(e.target.result);
            // Vérifier que c'est un objet avec les bonnes clés
            if (typeof imported !== 'object' || imported === null) {
                throw new Error('Fichier invalide');
            }
            // On vérifie que tous les stickers actuels sont présents
            let valid = true;
            for (const s of stickers) {
                if (!imported[s.ID]) { valid = false; break; }
            }
            if (!valid) {
                // On tente de fusionner : on garde les stickers existants, on ajoute les nouveaux en missing
                for (const s of stickers) {
                    if (!imported[s.ID]) {
                        imported[s.ID] = { status: 'missing', count: 0 };
                    }
                }
            }
            collectionState = imported;
            saveState();
            renderView(currentView);
            alert('Collection importée avec succès !');
        } catch (err) {
            alert('Erreur lors de l\'import : fichier JSON invalide.');
            console.error(err);
        }
    };
    reader.readAsText(file);
}

// ---------- 8. Sauvegarde automatique (déjà incluse dans setStatus) ----------
// On sauvegarde à chaque modification, c'est fait.