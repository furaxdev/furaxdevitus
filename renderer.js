'use strict';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

const FREE_MODELS = [
  'openrouter/auto',
  'google/gemini-2.0-flash-exp:free',
  'meta-llama/llama-3.1-8b-instruct:free'
];

const AI_SYSTEM_PROMPT_TXT = `Tu es un assistant de révision académique. Tu reçois des notes brutes prises pendant un cours.

MISSION : Reformule et structure ces notes en texte clair et lisible, sans Markdown.

RÈGLES :
- Ne perds AUCUNE information
- Corrige l'orthographe et la grammaire
- Structure avec des titres en MAJUSCULES et des séparations claires
- N'ajoute rien qui n'est pas dans les notes
- Réponds en texte brut uniquement, pas de Markdown, pas de symboles spéciaux`;

const AI_SYSTEM_PROMPT_MD = `Tu es un assistant de révision académique expert. Tu reçois du contenu à organiser.

MISSION : Transformer ce contenu en document Markdown soigné, structuré et prêt à réviser.

RÈGLES ABSOLUES :
- Ne perds AUCUNE information — reformule, n'invente jamais
- Corrige l'orthographe et la grammaire
- N'ajoute aucun contenu absent des notes

FORMAT DE SORTIE (respecte exactement cet ordre) :

# [Titre du cours ou sujet principal]

> **Résumé** : [2-3 phrases qui capturent l'essentiel]

## [Titre de section 1]
[Contenu clair, en paragraphes ou listes à puces]

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
- Titres de sections descriptifs, jamais génériques

Réponds UNIQUEMENT en Markdown pur. Pas de préambule, pas de commentaire.`;

// ─── State ───────────────────────────────────────────────────────────────────

let allNotes       = [];
let activeNoteFile = null;
let activeTab      = 'txt';   // 'txt' | 'md'
let mdSubTab       = 'edit';  // 'edit' | 'preview'
let rawBeforeAI    = { txt: null, md: null };

// ─── DOM refs ────────────────────────────────────────────────────────────────

const $ = (id) => document.getElementById(id);

const subjectInput    = $('subject-input');
const dateInput       = $('date-input');
const txtArea         = $('txt-input');
const mdArea          = $('md-input');
const mdPreview       = $('md-preview');
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

const tabTxt      = $('tab-txt');
const tabMd       = $('tab-md');
const paneTxt     = $('pane-txt');
const paneMd      = $('pane-md');
const subTabEdit  = $('subtab-edit');
const subTabPrev  = $('subtab-preview');

// ─── Init ────────────────────────────────────────────────────────────────────

async function init() {
  dateInput.value = new Date().toISOString().split('T')[0];
  apiKeyInput.value = await window.electronAPI.getApiKey();
  await refreshNotesList();

  // Main tab switching
  tabTxt.addEventListener('click', () => switchTab('txt'));
  tabMd.addEventListener('click',  () => switchTab('md'));

  // Markdown sub-tabs
  subTabEdit.addEventListener('click', () => switchMdSubTab('edit'));
  subTabPrev.addEventListener('click', () => switchMdSubTab('preview'));

  // Update preview live when editing Markdown
  mdArea.addEventListener('input', () => renderPreview());

  // Hide undo when user edits manually
  txtArea.addEventListener('input', () => { if (rawBeforeAI.txt !== null) clearUndo('txt'); });
  mdArea.addEventListener('input',  () => { if (rawBeforeAI.md  !== null) clearUndo('md'); });

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
    if (e.key === 'Escape') closeSettings();
  });

  switchTab('txt');
}

// ─── Tab switching ────────────────────────────────────────────────────────────

function switchTab(tab) {
  activeTab = tab;
  tabTxt.classList.toggle('active', tab === 'txt');
  tabMd.classList.toggle('active',  tab === 'md');
  paneTxt.style.display = tab === 'txt' ? 'flex' : 'none';
  paneMd.style.display  = tab === 'md'  ? 'flex' : 'none';
  updateUndoVisibility();
}

function switchMdSubTab(sub) {
  mdSubTab = sub;
  subTabEdit.classList.toggle('active', sub === 'edit');
  subTabPrev.classList.toggle('active', sub === 'preview');
  mdArea.style.display    = sub === 'edit'    ? 'block' : 'none';
  mdPreview.style.display = sub === 'preview' ? 'block' : 'none';
  if (sub === 'preview') renderPreview();
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
    const date = new Date(note.mtime).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
    return `
      <div class="note-item ${activeNoteFile === note.path ? 'active' : ''}" data-path="${escHtml(note.path)}">
        <div class="note-title">${escHtml(label)}</div>
        <div class="note-date">${date}</div>
        <button class="note-delete" data-path="${escHtml(note.path)}" title="Supprimer">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/>
            <path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
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
    btn.addEventListener('click', (e) => { e.stopPropagation(); deleteNote(btn.dataset.path); });
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
  rawBeforeAI = { txt: null, md: null };
  // Open .md files in the Markdown tab
  mdArea.value = content;
  renderPreview();
  txtArea.value = '';
  const name = filePath.split('/').pop().replace('.md', '').replace(/_/g, ' ');
  subjectInput.value = name;
  switchTab('md');
  switchMdSubTab('preview');
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
  rawBeforeAI = { txt: null, md: null };
  txtArea.value = '';
  mdArea.value  = '';
  mdPreview.innerHTML = '';
  subjectInput.value = '';
  dateInput.value = new Date().toISOString().split('T')[0];
  setStatus('', '');
  updateUndoVisibility();
  renderNotesList(allNotes);
  switchTab('txt');
  txtArea.focus();
}

// ─── AI ──────────────────────────────────────────────────────────────────────

async function handleAI() {
  const area    = activeTab === 'txt' ? txtArea : mdArea;
  const content = area.value.trim();
  if (!content) { showToast('Écrivez d\'abord quelque chose !', 'info'); return; }

  const apiKey = await window.electronAPI.getApiKey();
  if (!apiKey) {
    showToast('Configurez votre clé API OpenRouter (icône ⚙️).', 'error');
    openSettings(); return;
  }

  const subject = subjectInput.value.trim();
  const date    = dateInput.value;
  const context = (subject || date)
    ? `Matière : ${subject || '(non précisée)'}  |  Date : ${date || '(non précisée)'}\n\n---\n\n`
    : '';

  const prompt     = activeTab === 'txt' ? AI_SYSTEM_PROMPT_TXT : AI_SYSTEM_PROMPT_MD;
  const userMsg    = context + content;

  aiBtn.disabled = true;
  setStatus('loading', '⚡ Organisation en cours…');

  let lastError;
  for (const model of FREE_MODELS) {
    try {
      const result = await callOpenRouter(apiKey, model, prompt, userMsg);
      rawBeforeAI[activeTab] = content;
      area.value = result;
      if (activeTab === 'md') renderPreview();
      updateUndoVisibility();
      const label = model === 'openrouter/auto' ? 'auto' : model.split('/')[1]?.split(':')[0] || model;
      setStatus('success', `✓ Organisé · ${label}`);
      showToast('Notes organisées !', 'success');
      aiBtn.disabled = false;
      return;
    } catch (err) {
      lastError = err;
    }
  }

  aiBtn.disabled = false;
  setStatus('error', '✗ Erreur API');
  showToast(`Erreur : ${lastError?.message || 'Échec'}`, 'error');
}

async function callOpenRouter(apiKey, model, systemPrompt, userMessage) {
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
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userMessage }
      ],
      max_tokens: 2048,
      temperature: 0.25
    })
  });
  if (!resp.ok) {
    const t = await resp.text().catch(() => resp.statusText);
    throw new Error(`HTTP ${resp.status}: ${t}`);
  }
  const data = await resp.json();
  const c = data?.choices?.[0]?.message?.content;
  if (!c) throw new Error('Réponse vide');
  return c;
}

// ─── Undo ────────────────────────────────────────────────────────────────────

function handleUndo() {
  const prev = rawBeforeAI[activeTab];
  if (prev === null) return;
  const area = activeTab === 'txt' ? txtArea : mdArea;
  area.value = prev;
  if (activeTab === 'md') renderPreview();
  clearUndo(activeTab);
  setStatus('', '');
  showToast('Contenu restauré.', 'info');
}

function clearUndo(tab) {
  rawBeforeAI[tab] = null;
  updateUndoVisibility();
}

function updateUndoVisibility() {
  undoBtn.style.display = rawBeforeAI[activeTab] !== null ? 'inline-flex' : 'none';
}

// ─── Save ────────────────────────────────────────────────────────────────────

async function handleSave() {
  // Always save the Markdown tab content as .md
  const content = mdArea.value.trim() || txtArea.value.trim();
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

// ─── Markdown preview ─────────────────────────────────────────────────────────

function renderPreview() {
  const md = mdArea.value;
  if (!md.trim()) { mdPreview.innerHTML = '<p style="color:var(--text-muted);font-style:italic">Aucun contenu à prévisualiser.</p>'; return; }

  let html = md
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/```([\s\S]*?)```/g, (_, code) => `<pre><code>${code}</code></pre>`)
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm,  '<h2>$1</h2>')
    .replace(/^# (.+)$/gm,   '<h1>$1</h1>')
    .replace(/^\*\*\*(.+?)\*\*\*$/gm, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g,    '<em>$1</em>')
    .replace(/`(.+?)`/g,      '<code>$1</code>')
    .replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>')
    .replace(/^[-*] (.+)$/gm, '<li>$1</li>')
    .replace(/^\d+\. (.+)$/gm,'<li>$1</li>')
    .replace(/^---$/gm,       '<hr>')
    .replace(/(<li>[\s\S]*?<\/li>)\n(?=<li>)/g, '$1')
    .replace(/(<li>[\s\S]*?(?:<\/li>))+/g, m => `<ul>${m}</ul>`)
    .split('\n\n').map(block => {
      if (/^<(h[1-6]|ul|ol|blockquote|pre|hr)/.test(block.trim())) return block;
      return `<p>${block.replace(/\n/g, '<br>')}</p>`;
    }).join('\n');

  mdPreview.innerHTML = html;
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

// ─── Status / Toast ──────────────────────────────────────────────────────────

function setStatus(type, text) {
  statusBadge.className = 'status-badge';
  if (!type) return;
  statusBadge.classList.add(type);
  statusBadge.innerHTML = type === 'loading'
    ? `<span class="spinner">⚡</span> ${escHtml(text)}`
    : escHtml(text);
}

let toastTimer;
function showToast(message, type = 'info') {
  clearTimeout(toastTimer);
  const icons = { success: '✓', error: '✗', info: 'ℹ' };
  const border = type === 'success' ? 'rgba(34,197,94,.4)' : type === 'error' ? 'rgba(239,68,68,.4)' : 'rgba(124,58,237,.4)';
  toast.style.cssText = `position:fixed;bottom:24px;right:24px;background:var(--bg-card);border:1px solid ${border};border-radius:var(--radius);padding:12px 16px;font-size:13px;display:flex;align-items:center;gap:8px;z-index:200;box-shadow:0 8px 24px rgba(0,0,0,.4);max-width:360px;color:var(--text-primary);`;
  toast.innerHTML = `<span>${icons[type] || 'ℹ'}</span> ${escHtml(message)}`;
  toastTimer = setTimeout(() => { toast.style.display = 'none'; }, 3500);
}

function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

init();
