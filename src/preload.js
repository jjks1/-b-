/**
 * 预加载脚本：只把必要的接口暴露给界面，界面本身拿不到 Node 能力。
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  state: () => ipcRenderer.invoke('state'),
  setPref: (key, value) => ipcRenderer.invoke('setPref', key, value),
  login: (force) => ipcRenderer.invoke('login', Boolean(force)),
  checkNow: () => ipcRenderer.invoke('checkNow'),
  netTest: () => ipcRenderer.invoke('netTest'),
  showDisclaimer: () => ipcRenderer.invoke('showDisclaimer'),
  acceptDisclaimer: () => ipcRenderer.invoke('acceptDisclaimer'),
  rejectDisclaimer: () => ipcRenderer.invoke('rejectDisclaimer'),
  openBili: () => ipcRenderer.invoke('openBili'),
  closePanel: () => ipcRenderer.invoke('closePanel'),
  retryFromPanel: () => ipcRenderer.invoke('retryFromPanel'),
  openDataDir: () => ipcRenderer.invoke('openDataDir'),

  onProgress: (cb) => ipcRenderer.on('progress', (_e, text) => cb(text)),
  onResult: (cb) => ipcRenderer.on('result', (_e, data) => cb(data)),
  onRefresh: (cb) => ipcRenderer.on('refresh', () => cb())
});
