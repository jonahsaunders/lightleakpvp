'use strict';
// The one thing the page can ask the desktop app for: open its server to the local network.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  hostLan: () => ipcRenderer.invoke('host-lan'),
});
