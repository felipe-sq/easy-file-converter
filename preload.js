const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electron", {
  selectOutputDir: () => ipcRenderer.invoke("select-output-dir"),
  getOutputDir: () => ipcRenderer.invoke("get-output-dir"),
  onOutputDirChanged: (callback) =>
    ipcRenderer.on("output-dir-changed", callback),
  getQualityMode: () => ipcRenderer.invoke("get-quality-mode"),
  setQualityMode: (useHighQuality) =>
    ipcRenderer.invoke("set-quality-mode", useHighQuality),
  getHardwareAccelMode: () => ipcRenderer.invoke("get-hardware-accel-mode"),
  setHardwareAccelMode: (enabled) =>
    ipcRenderer.invoke("set-hardware-accel-mode", enabled),
  selectMovFiles: (options) => ipcRenderer.send("select-mov-files", options),
  combineMovFiles: (options) => ipcRenderer.send("combine-mov-files", options),
  onConversionFileStarted: (callback) =>
    ipcRenderer.on("conversion-file-started", callback),
  onConversionFailed: (callback) =>
    ipcRenderer.on("conversion-failed", callback),
  onConversionSuccessful: (callback) =>
    ipcRenderer.on("conversion-successful", callback),
  onConversionProgress: (callback) =>
    ipcRenderer.on("conversion-progress", callback),
  onConversionTotalFiles: (callback) =>
    ipcRenderer.on("conversion-total-files", callback),
  onConversionFilesConverted: (callback) =>
    ipcRenderer.on("conversion-files-converted", callback),
  onConversionCanceled: (callback) =>
    ipcRenderer.on("conversion-canceled", callback),
  onCombineQueued: (callback) => ipcRenderer.on("combine-queued", callback),
  onCombineQueueUpdate: (callback) =>
    ipcRenderer.on("combine-queue-update", callback),
  onCombineJobStarted: (callback) =>
    ipcRenderer.on("combine-job-started", callback),
  onCombineSuccessful: (callback) =>
    ipcRenderer.on("combine-successful", callback),
  onCombineQueueCanceled: (callback) =>
    ipcRenderer.on("combine-queue-canceled", callback),
  cancelCombineQueue: () => ipcRenderer.send("cancel-combine-queue"),
  cancelSingleConversion: () => ipcRenderer.send("cancel-single-conversion"),
  startCombineQueue: () => ipcRenderer.send("start-combine-queue"),
  quitApp: () => ipcRenderer.send("quit-app"),
});
