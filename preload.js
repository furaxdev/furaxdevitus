const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getApiKey: () => ipcRenderer.invoke('get-api-key'),
  saveApiKey: (key) => ipcRenderer.invoke('save-api-key', key),
  listNotes: () => ipcRenderer.invoke('list-notes'),
  readNote: (filePath) => ipcRenderer.invoke('read-note', filePath),
  saveNote: (data) => ipcRenderer.invoke('save-note', data),
  deleteNote: (filePath) => ipcRenderer.invoke('delete-note', filePath),
  showNotesFolder: () => ipcRenderer.invoke('show-notes-folder'),
  getNotesDir: () => ipcRenderer.invoke('get-notes-dir')
});
