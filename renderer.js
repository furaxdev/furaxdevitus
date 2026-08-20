'use strict';

// ─── Constants ───────────────────────────────────────────────────────────────

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

// Free models with fallback order
const FREE_MODELS = [
  'openrouter/auto',
  'google/gemini-2.0-flash-exp:free',
  'meta-llama/llama-3.1-8b-instruct:free'
];

const AI_SYSTEM_PROMPT = `Tu es un assistant spécialisé dans l'organisation de notes de cours.

Ta tâche : prendre des notes brutes tapées rapidement pendant un cours et les transformer en document structuré et lisible.

Instructions strictes de formatage (Markdown) :
1. Commence par un **résumé** en 2-3 phrases maximum (section "## Résumé")
2. Organise les notes en sections avec des titres clairs (## et ###)
3. Mets en **gras** tous les termes, concepts, formules et mots-clés importants
4. Reformule pour la clarté mais préserve le sens exact
5. Utilise des listes à puces quand c'est pertinent
6. Si tu vois des formules, conserve-les telles quelles
7. Ajoute une section "## Points clés à retenir" à la fin avec les 3-5 concepts essentiels

Réponds UNIQUEMENT en Markdown. Commence directement par le titre principal (#).`;

// ─── State ────────────────────────────────────────────────────────────────────

let allNotes = [];
let activeNoteFile = null;
let organisedMarkdown = '';

// ─── DOM refs ────────────────────────────────────────────────────────────────

const $ = (id) => document.getElementById(id);

const subjectInput   = $('subject-input');
const dateInput      = $('date-input');
const notesInput     = $('notes-input');
const aiBtn          = $('ai-btn');
const saveBtn        = $('save-btn');
const newBtn         = $('new-btn');
const togglePaneBtn  = $('toggle-pane-btn');
const notesList      = $('notes-list');
const searchInput    = $('search-input');
const statusBadge    = $('status-badge');
const resultPane     = $('result-pane');
const resultContent  = $('result-content');
const editorArea     = $('editor-area');
const settingsOverlay = $('settings-overlay');
const apiKeyInput    = $('api-key-input');
const toast          = $('toast');

// ─── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  // Set today's date
  dateInput.value = new Date().toISOString().split('T')[0];

  // Load API key into settings panel (but not showing it yet)
  const key = await window.electronAPI.getApiKey();
  apiKeyInput.value = key;

  // Load saved notes
  await refreshNotesList();

  // Wire up events
  aiBtn.addEventListener('click', handleAI);
  saveBtn.addEventListener('click', handleSave);
  newBtn.addEventListener('click', handleNew);
  togglePaneBtn.addEventListener('click', togglePane);
  searchInput.addEventListener('input', filterNotes);
  $('settings-btn').addEventListener('click', openSettings);
  $('settings-cancel').addEventListener('click', closeSettings);
  $('settings-save').addEventListener('click', saveSettings);
  $('open-folder-btn').addEventListener('click', () => window.electronAPI.showNotesFolder());

  // Close overlay on backdrop click
  settingsOverlay.addEventListener('click', (e) => {
    if (e.target === settingsOverlay) closeSettings();
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); handleSave(); }
    if ((e.metaKey || e.ctrlKey) && e.key === 'n') { e.preventDefault(); handleNew(); }
    if ((e.metaKey || e.ctrlKey) && e.key === ',') { e.preventDefault(); openSettings(); }
    if (e.key === 'Escape') closeSettings();
  });
}

// ─── Notes list ───────────────────────────────────────────────────────────────

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
    const isActive = activeNoteFile && activeNoteFile === note.path;
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

  // Click handlers
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
  const filtered = allNotes.filter(n => n.name.toLowerCase().includes(q));
  renderNotesList(filtered);
}

async function openNote(filePath) {
  const content = await window.electronAPI.readNote(filePath);
  if (content === null) { showToast('Impossible de lire la note.', 'error'); return; }

  activeNoteFile = filePath;
  notesInput.value = '';
  organisedMarkdown = content;
  renderMarkdown(content);
  resultPane.classList.add('visible');
  editorArea.classList.remove('single-pane');
  togglePaneBtn.style.display = 'inline-flex';

  // Try to parse subject / date from filename
  const name = filePath.split('/').pop().replace('.md', '').replace(/_/g, ' ');
  subjectInput.value = name;

  renderNotesList(allNotes); // refresh active state
  showToast(`Note ouverte : ${name}`, 'info');
}

async function deleteNote(filePath) {
  const name = filePath.split('/').pop().replace('.md', '').replace(/_/g, ' ');
  if (!confirm(`Supprimer « ${name} » ?`)) return;
  const ok = await window.electronAPI.deleteNote(filePath);
  if (ok) {
    if (activeNoteFile === filePath) {
      handleNew();
    }
    await refreshNotesList();
    showToast('Note supprimée.', 'success');
  } else {
    showToast('Erreur lors de la suppression.', 'error');
  }
}

// ─── New note ─────────────────────────────────────────────────────────────────

function handleNew() {
  activeNoteFile = null;
  notesInput.value = '';
  organisedMarkdown = '';
  resultContent.innerHTML = '';
  resultPane.classList.remove('visible');
  editorArea.classList.add('single-pane');
  togglePaneBtn.style.display = 'none';
  subjectInput.value = '';
  dateInput.value = new Date().toISOString().split('T')[0];
  setStatus('', '');
  renderNotesList(allNotes);
  notesInput.focus();
}

// ─── AI organisation ──────────────────────────────────────────────────────────

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
  const date = dateInput.value;
  const contextLine = subject || date
    ? `Matière : ${subject || '(non précisée)'}  |  Date : ${date || '(non précisée)'}`
    : '';

  const userMessage = contextLine
    ? `${contextLine}\n\n---\n\n${raw}`
    : raw;

  aiBtn.disabled = true;
  setStatus('loading', '⚡ Traitement IA…');

  let lastError;
  for (const model of FREE_MODELS) {
    try {
      const result = await callOpenRouter(apiKey, model, userMessage);
      organisedMarkdown = result;
      renderMarkdown(result);
      resultPane.classList.add('visible');
      editorArea.classList.remove('single-pane');
      togglePaneBtn.style.display = 'inline-flex';
      setStatus('success', `✓ Organisé (${model.split('/')[1].split(':')[0]})`);
      showToast('Notes organisées avec succès !', 'success');
      aiBtn.disabled = false;
      return;
    } catch (err) {
      lastError = err;
      console.warn(`Model ${model} failed:`, err.message);
    }
  }

  // All models failed
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
        { role: 'user', content: userMessage }
      ],
      max_tokens: 2048,
      temperature: 0.3
    })
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => resp.statusText);
    throw new Error(`HTTP ${resp.status}: ${errText}`);
  }

  const data = await resp.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('Réponse vide de l\'API');
  return content;
}

// ─── Save note ────────────────────────────────────────────────────────────────

async function handleSave() {
  const subject = subjectInput.value.trim();
  const date = dateInput.value || new Date().toISOString().split('T')[0];
  const contentToSave = organisedMarkdown || notesInput.value.trim();

  if (!contentToSave) { showToast('Rien à sauvegarder !', 'info'); return; }

  const filenameBase = subject
    ? `${date}_${subject}`
    : `${date}_note`;

  const { success, name } = await window.electronAPI.saveNote({
    filename: filenameBase,
    content: contentToSave
  });

  if (success) {
    await refreshNotesList();
    showToast(`Sauvegardé : ${name}`, 'success');
  } else {
    showToast('Erreur lors de la sauvegarde.', 'error');
  }
}

// ─── Toggle pane ──────────────────────────────────────────────────────────────

function togglePane() {
  if (editorArea.classList.contains('single-pane')) {
    editorArea.classList.remove('single-pane');
  } else {
    editorArea.classList.add('single-pane');
  }
}

// ─── Markdown renderer ────────────────────────────────────────────────────────

function renderMarkdown(md) {
  // Simple but functional Markdown → HTML renderer
  let html = md
    // Escape HTML first
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    // Code blocks (must be before inline code)
    .replace(/```[\s\S]*?```/g, (m) => {
      const inner = m.replace(/^```\w*\n?/, '').replace(/```$/, '');
      return `<pre><code>${inner}</code></pre>`;
    })
    // Headers
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    // Bold
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // Italic
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/_(.+?)_/g, '<em>$1</em>')
    // Inline code
    .replace(/`(.+?)`/g, '<code>$1</code>')
    // Blockquote
    .replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>')
    // Unordered list items
    .replace(/^[-*] (.+)$/gm, '<li>$1</li>')
    // Ordered list items
    .replace(/^\d+\. (.+)$/gm, '<li>$1</li>')
    // Horizontal rule
    .replace(/^---$/gm, '<hr style="border-color:var(--border);margin:16px 0">')
    // Paragraphs: double newline → paragraph break
    .replace(/\n\n/g, '</p><p>')
    // Single newlines
    .replace(/\n/g, '<br>');

  // Wrap loose li in ul
  html = html.replace(/(<li>.*?<\/li>)+/gs, (m) => `<ul>${m}</ul>`);

  // Wrap in paragraph if not starting with a block element
  if (!/^<(h[1-6]|ul|ol|blockquote|pre|hr)/.test(html)) {
    html = `<p>${html}</p>`;
  }

  resultContent.innerHTML = html;
}

// ─── Settings ─────────────────────────────────────────────────────────────────

function openSettings() {
  window.electronAPI.getApiKey().then(key => {
    apiKeyInput.value = key;
    settingsOverlay.classList.add('visible');
    setTimeout(() => apiKeyInput.focus(), 50);
  });
}

function closeSettings() {
  settingsOverlay.classList.remove('visible');
}

async function saveSettings() {
  const key = apiKeyInput.value.trim();
  await window.electronAPI.saveApiKey(key);
  closeSettings();
  showToast('Clé API enregistrée.', 'success');
}

// ─── Status badge ─────────────────────────────────────────────────────────────

function setStatus(type, text) {
  statusBadge.className = 'status-badge';
  if (!type) return;
  statusBadge.classList.add(type);

  if (type === 'loading') {
    statusBadge.innerHTML = `<span class="spinner">⚡</span> ${escHtml(text)}`;
  } else {
    statusBadge.textContent = text;
  }
}

// ─── Toast ────────────────────────────────────────────────────────────────────

let toastTimer;
function showToast(message, type = 'info') {
  clearTimeout(toastTimer);
  const icons = {
    success: '✓',
    error: '✗',
    info: 'ℹ'
  };
  toast.className = `status-badge visible ${type}`;
  toast.style.cssText = `
    position: fixed; bottom: 24px; right: 24px;
    background: var(--bg-card); border: 1px solid;
    border-radius: var(--radius); padding: 12px 16px;
    font-size: 13px; display: flex; align-items: center;
    gap: 8px; z-index: 200; box-shadow: 0 8px 24px rgba(0,0,0,.4);
    max-width: 360px; color: var(--text-primary);
    border-color: ${type === 'success' ? 'rgba(34,197,94,.4)' : type === 'error' ? 'rgba(239,68,68,.4)' : 'rgba(124,58,237,.4)'};
  `;
  toast.innerHTML = `<span>${icons[type] || 'ℹ'}</span> ${escHtml(message)}`;
  toast.style.display = 'flex';

  toastTimer = setTimeout(() => { toast.style.display = 'none'; }, 3500);
}

// ─── Utility ──────────────────────────────────────────────────────────────────

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── Boot ─────────────────────────────────────────────────────────────────────

init();
