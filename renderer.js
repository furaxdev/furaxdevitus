'use strict';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

const FREE_MODELS = [
  'openrouter/auto',
  'google/gemini-2.0-flash-exp:free',
  'meta-llama/llama-3.1-8b-instruct:free'
];

const AI_SYSTEM_PROMPT = `Tu es un assistant de révision académique expert. Tu reçois des notes brutes prises rapidement pendant un cours — abréviations, phrases incomplètes, schémas en mots.

MISSION : transformer ces notes en un document Markdown soigné, structuré et prêt à réviser.

RÈGLES ABSOLUES :
- Ne perds AUCUNE information — reformule, n'invente jamais
- Corrige l'orthographe et la grammaire
- Développe les abréviations si le contexte est clair (ex : "déf" → "Définition")
- N'ajoute aucun contenu absent des notes

FORMAT DE SORTIE (respecte exactement cet ordre) :

# [Titre du cours ou sujet principal]

> **Résumé** : [2-3 phrases qui capturent l'essentiel]

## [Titre de section 1]
[Contenu clair, en paragraphes ou listes à puces selon ce qui est le plus lisible]

## [Titre de section 2]
...

---
### Points clés à retenir
- **[Concept 1]** : explication courte
- **[Concept 2]** : explication courte

STYLE :
- **Gras** sur tous les termes techniques, définitions, formules, concepts importants
- Listes à puces pour les énumérations
- Blocs de code (\`\`\`) pour les formules mathématiques ou le code
- Titres de sections descriptifs, jamais génériques ("Partie 1", "Introduction")

Réponds UNIQUEMENT en Markdown pur. Pas de préambule, pas de commentaire méta.`;

// ─── State ───────────────────────────────────────────────────────────────────

let allNotes      = [];
let activeNoteFile = null;
let rawBeforeAI   = null; // snapshot before AI rewrites the textarea

// ─── DOM refs ────────────────────────────────────────────────────────────────

const $ = (id) => document.getElementById(id);

const subjectInput    = $('subject-input');
const dateInput       = $('date-input');
const notesInput      = $('notes-input');
const aiBtn           = $('ai-btn');
const undoBtn         = $('undo-btn');
const saveBtn         = $('save-btn');
const newBtn          = $('new-btn');
const notesList       = $('notes-list');
const searchInput     = $('search-input');
const statusBadge     = $('status-badge');
const settingsOverlay = $('settings-overlay');
const apiKeyInput     = $('api-key-input');
const toast           = $('toast');

// ─── Init ────────────────────────────────────────────────────────────────────

async function init() {
  dateInput.value = new Date().toISOString().split('T')[0];

  const key = await window.electronAPI.getApiKey();
  apiKeyInput.value = key;

  await refreshNotesList();

  aiBtn.addEventListener('click', handleAI);
  undoBtn.addEventListener('click', handleUndo);
  saveBtn.addEventListener('click', handleSave);
  newBtn.addEventListener('click', handleNew);
  searchInput.addEventListener('input', filterNotes);
  $('settings-btn').addEventListener('click', openSettings);
  $('settings-cancel').addEventListener('click', closeSettings);
  $('settings-save').addEventListener('click', saveSettings);
  $('open-folder-btn').addEventListener('click', () => window.electronAPI.showNotesFolder());

  settingsOverlay.addEventListener('click', (e) => {
    if (e.target === settingsOverlay) closeSettings();
  });

  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); handleSave(); }
    if ((e.metaKey || e.ctrlKey) && e.key === 'n') { e.preventDefault(); handleNew(); }
    if ((e.metaKey || e.ctrlKey) && e.key === ',') { e.preventDefault(); openSettings(); }
    if ((e.metaKey || e.ctrlKey) && e.key === 'z' && rawBeforeAI !== null) {
      e.preventDefault(); handleUndo();
    }
    if (e.key === 'Escape') closeSettings();
  });

  // Hide undo button when user manually edits after AI
  notesInput.addEventListener('input', () => {
    if (rawBeforeAI !== null) hideUndo();
  });
}

// ─── Notes list ──────────────────────────────────────────────────────────────

async function refreshNotesList() {
  allNotes = await window.electronAPI.listNotes();
  renderNotesList(allNotes);
}

function renderNotesList(notes) {
  if (!notes.length) {
    notesList.innerHTML = `
      <div class="empty-state">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity=".4">
          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
        </svg>
        <span>Aucune note sauvegardée</span>
      </div>`;
    return;
  }

  notesList.innerHTML = notes.map(note => {
    const label = note.name.replace('.md', '').replace(/_/g, ' ');
    const date = new Date(note.mtime).toLocaleDateString('fr-FR', {
      day: '2-digit', month: 'short', year: 'numeric'
    });
    const isActive = activeNoteFile === note.path;
    return `
      <div class="note-item ${isActive ? 'active' : ''}" data-path="${escHtml(note.path)}">
        <div class="note-title">${escHtml(label)}</div>
        <div class="note-date">${date}</div>
        <button class="note-delete" data-path="${escHtml(note.path)}" title="Supprimer">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/>
            <path d="M10 11v6"/><path d="M14 11v6"/>
            <path d="M9 6V4h6v2"/>
          </svg>
        </button>
      </div>`;
  }).join('');

  notesList.querySelectorAll('.note-item').forEach(item => {
    item.addEventListener('click', (e) => {
      if (e.target.closest('.note-delete')) return;
      openNote(item.dataset.path);
    });
  });

  notesList.querySelectorAll('.note-delete').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteNote(btn.dataset.path);
    });
  });
}

function filterNotes() {
  const q = searchInput.value.toLowerCase();
  renderNotesList(allNotes.filter(n => n.name.toLowerCase().includes(q)));
}

async function openNote(filePath) {
  const content = await window.electronAPI.readNote(filePath);
  if (content === null) { showToast('Impossible de lire la note.', 'error'); return; }

  activeNoteFile = filePath;
  rawBeforeAI    = null;
  hideUndo();
  notesInput.value = content;

  const name = filePath.split('/').pop().replace('.md', '').replace(/_/g, ' ');
  subjectInput.value = name;

  setStatus('', '');
  renderNotesList(allNotes);
  showToast(`Note ouverte : ${name}`, 'info');
}

async function deleteNote(filePath) {
  const name = filePath.split('/').pop().replace('.md', '').replace(/_/g, ' ');
  if (!confirm(`Supprimer « ${name} » ?`)) return;
  const ok = await window.electronAPI.deleteNote(filePath);
  if (ok) {
    if (activeNoteFile === filePath) handleNew();
    await refreshNotesList();
    showToast('Note supprimée.', 'success');
  } else {
    showToast('Erreur lors de la suppression.', 'error');
  }
}

// ─── New note ────────────────────────────────────────────────────────────────

function handleNew() {
  activeNoteFile = null;
  rawBeforeAI    = null;
  hideUndo();
  notesInput.value  = '';
  subjectInput.value = '';
  dateInput.value   = new Date().toISOString().split('T')[0];
  setStatus('', '');
  renderNotesList(allNotes);
  notesInput.focus();
}

// ─── AI organisation ─────────────────────────────────────────────────────────

async function handleAI() {
  const raw = notesInput.value.trim();
  if (!raw) { showToast('Écrivez d\'abord vos notes !', 'info'); return; }

  const apiKey = await window.electronAPI.getApiKey();
  if (!apiKey) {
    showToast('Configurez votre clé API OpenRouter d\'abord (icône ⚙️).', 'error');
    openSettings();
    return;
  }

  const subject = subjectInput.value.trim();
  const date    = dateInput.value;
  const context = (subject || date)
    ? `Matière : ${subject || '(non précisée)'}  |  Date : ${date || '(non précisée)'}\n\n---\n\n`
    : '';

  aiBtn.disabled = true;
  setStatus('loading', '⚡ Organisation en cours…');

  let lastError;
  for (const model of FREE_MODELS) {
    try {
      const result = await callOpenRouter(apiKey, model, context + raw);

      // Save snapshot for undo, then replace textarea content directly
      rawBeforeAI = raw;
      notesInput.value = result;
      showUndo();

      const modelLabel = model === 'openrouter/auto' ? 'auto' : model.split('/')[1]?.split(':')[0] || model;
      setStatus('success', `✓ Organisé · ${modelLabel}`);
      showToast('Notes organisées !', 'success');
      aiBtn.disabled = false;
      return;
    } catch (err) {
      lastError = err;
      console.warn(`Model ${model} failed:`, err.message);
    }
  }

  aiBtn.disabled = false;
  setStatus('error', '✗ Erreur API');
  showToast(`Erreur : ${lastError?.message || 'Tous les modèles ont échoué'}`, 'error');
}

async function callOpenRouter(apiKey, model, userMessage) {
  const resp = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://klarity-app.local',
      'X-Title': 'Klarity'
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: AI_SYSTEM_PROMPT },
        { role: 'user',   content: userMessage }
      ],
      max_tokens: 2048,
      temperature: 0.25
    })
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => resp.statusText);
    throw new Error(`HTTP ${resp.status}: ${errText}`);
  }

  const data    = await resp.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('Réponse vide de l\'API');
  return content;
}

// ─── Undo AI ─────────────────────────────────────────────────────────────────

function handleUndo() {
  if (rawBeforeAI === null) return;
  notesInput.value = rawBeforeAI;
  rawBeforeAI = null;
  hideUndo();
  setStatus('', '');
  showToast('Brouillon restauré.', 'info');
}

function showUndo() { undoBtn.style.display = 'inline-flex'; }
function hideUndo() { undoBtn.style.display = 'none'; }

// ─── Save ────────────────────────────────────────────────────────────────────

async function handleSave() {
  const content = notesInput.value.trim();
  if (!content) { showToast('Rien à sauvegarder !', 'info'); return; }

  const subject = subjectInput.value.trim();
  const date    = dateInput.value || new Date().toISOString().split('T')[0];
  const base    = subject ? `${date}_${subject}` : `${date}_note`;

  const { success, name } = await window.electronAPI.saveNote({ filename: base, content });

  if (success) {
    await refreshNotesList();
    showToast(`Sauvegardé : ${name}`, 'success');
  } else {
    showToast('Erreur lors de la sauvegarde.', 'error');
  }
}

// ─── Settings ────────────────────────────────────────────────────────────────

function openSettings() {
  window.electronAPI.getApiKey().then(key => {
    apiKeyInput.value = key;
    settingsOverlay.classList.add('visible');
    setTimeout(() => apiKeyInput.focus(), 50);
  });
}

function closeSettings() { settingsOverlay.classList.remove('visible'); }

async function saveSettings() {
  await window.electronAPI.saveApiKey(apiKeyInput.value.trim());
  closeSettings();
  showToast('Clé API enregistrée.', 'success');
}

// ─── Status badge ────────────────────────────────────────────────────────────

function setStatus(type, text) {
  statusBadge.className = 'status-badge';
  if (!type) return;
  statusBadge.classList.add(type);
  statusBadge.innerHTML = type === 'loading'
    ? `<span class="spinner">⚡</span> ${escHtml(text)}`
    : escHtml(text);
}

// ─── Toast ───────────────────────────────────────────────────────────────────

let toastTimer;
function showToast(message, type = 'info') {
  clearTimeout(toastTimer);
  const icons = { success: '✓', error: '✗', info: 'ℹ' };
  const borderColor = type === 'success' ? 'rgba(34,197,94,.4)' : type === 'error' ? 'rgba(239,68,68,.4)' : 'rgba(124,58,237,.4)';
  toast.style.cssText = `
    position:fixed;bottom:24px;right:24px;
    background:var(--bg-card);border:1px solid ${borderColor};
    border-radius:var(--radius);padding:12px 16px;
    font-size:13px;display:flex;align-items:center;
    gap:8px;z-index:200;box-shadow:0 8px 24px rgba(0,0,0,.4);
    max-width:360px;color:var(--text-primary);
  `;
  toast.innerHTML = `<span>${icons[type] || 'ℹ'}</span> ${escHtml(message)}`;
  toastTimer = setTimeout(() => { toast.style.display = 'none'; }, 3500);
}

// ─── Utility ─────────────────────────────────────────────────────────────────

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

init();
