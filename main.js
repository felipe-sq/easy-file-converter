const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const converter = require("./converter");
const os = require("os");
const fs = require("fs");
const SETTINGS_PATH = path.join(
  os.homedir(),
  ".easy-file-converter-settings.json",
);
// Previous name, from when the app was called mov2mp4. Read once at startup so
// existing users keep their saved folders and preferences.
const LEGACY_SETTINGS_PATH = path.join(os.homedir(), ".mov2mp4_settings.json");
let mainWindow;

// Copy the legacy settings file to the current path if the user has one and has
// not yet been migrated. The old file is deliberately left in place: it costs
// nothing and makes downgrading harmless.
function migrateLegacySettings() {
  try {
    if (fs.existsSync(SETTINGS_PATH)) return;
    if (!fs.existsSync(LEGACY_SETTINGS_PATH)) return;
    // Parse before writing so a corrupt legacy file fails here rather than
    // producing an unreadable settings file under the new name.
    const data = JSON.parse(fs.readFileSync(LEGACY_SETTINGS_PATH, "utf8"));
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(data));
  } catch {
    // A failed migration is not fatal — the app falls back to defaults.
  }
}

migrateLegacySettings();

// Helper to generate a unique output file name by appending (1), (2), etc. if needed
function getUniqueOutputFilePath(basePath, ext) {
  let outputPath = basePath + ext;
  let counter = 1;
  while (fs.existsSync(outputPath)) {
    outputPath = `${basePath}(${counter})${ext}`;
    counter++;
  }
  return outputPath;
}

// Queue for combine jobs (select multiple batches, process sequentially)
const combineQueue = [];
let isProcessingCombineQueue = false;
// Throttle progress updates to reduce UI load
let lastProgressTime = 0;
const PROGRESS_THROTTLE_MS = 500; // Update every 500ms max
let currentSingleConversionProcess = null;
let isSingleConversionCanceled = false;

function sendThrottledProgress(data) {
  const now = Date.now();
  if (now - lastProgressTime >= PROGRESS_THROTTLE_MS) {
    mainWindow.webContents.send("conversion-progress", data);
    lastProgressTime = now;
  }
}

function sendCombineQueueUpdate() {
  if (!mainWindow) return;
  mainWindow.webContents.send("combine-queue-update", {
    queued: combineQueue.length,
    processing: isProcessingCombineQueue,
  });
}

function processNextCombineJob() {
  if (isProcessingCombineQueue) return;
  if (combineQueue.length === 0) {
    isProcessingCombineQueue = false;
    sendCombineQueueUpdate();
    return;
  }

  isProcessingCombineQueue = true;
  const job = combineQueue.shift();
  sendCombineQueueUpdate();

  const outputName = path.basename(job.outputFilePath);
  mainWindow.webContents.send("combine-job-started", {
    outputName,
    queueRemaining: combineQueue.length,
  });

  converter.combineMovToMp4(
    job.filePaths,
    job.outputFilePath,
    (err, progress) => {
      if (err) {
        mainWindow.webContents.send("conversion-failed", err.message);
        isProcessingCombineQueue = false;
        processNextCombineJob();
        return;
      }

      sendThrottledProgress({
        currentFileProgress: progress,
        currentFile: outputName,
        queueRemaining: combineQueue.length,
      });

      if (progress === 100) {
        mainWindow.webContents.send("combine-successful", {
          outputFilePath: job.outputFilePath,
          queueRemaining: combineQueue.length,
        });
        isProcessingCombineQueue = false;
        processNextCombineJob();
      }
    },
    job.options,
  );
}

function cancelCombineQueue() {
  combineQueue.length = 0;
  sendCombineQueueUpdate();
  if (mainWindow) {
    mainWindow.webContents.send("combine-queue-canceled");
  }
}

function getSavedDir(type) {
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      const data = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf8"));
      if (data[type] && fs.existsSync(data[type])) return data[type];
    }
  } catch {}
  // Default: Desktop/Converted Files for output, Desktop for others
  if (type === "outputDir") {
    const desktop = path.join(os.homedir(), "Desktop", "Converted Files");
    if (!fs.existsSync(desktop)) fs.mkdirSync(desktop, { recursive: true });
    return desktop;
  }
  return path.join(os.homedir(), "Desktop");
}

function saveDir(type, dir) {
  let data = {};
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      data = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf8"));
    }
  } catch {}
  data[type] = dir;
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(data));
}

function getSavedQualityMode() {
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      const data = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf8"));
      if (data.useHighQuality !== undefined) return data.useHighQuality;
    }
  } catch {}
  return false; // Default to compressed mode
}

function saveQualityMode(useHighQuality) {
  let data = {};
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      data = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf8"));
    }
  } catch {}
  data.useHighQuality = useHighQuality;
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(data));
}

function getSavedHardwareAccelMode() {
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      const data = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf8"));
      if (data.useHardwareAcceleration !== undefined)
        return data.useHardwareAcceleration;
    }
  } catch {}
  return false; // Default to disabled so the user can opt in manually
}

function saveHardwareAccelMode(enabled) {
  let data = {};
  try {
    if (fs.existsSync(SETTINGS_PATH)) {
      data = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf8"));
    }
  } catch {}
  data.useHardwareAcceleration = enabled;
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(data));
}

function getSavedOutputDir() {
  return getSavedDir("outputDir");
}

function saveOutputDir(dir) {
  saveDir("outputDir", dir);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 850, // Increased height for better spacing
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "index.html"));

  if (process.env.NODE_ENV === "development") {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on("closed", function () {
    mainWindow = null;
  });
}

// Create the main application window when Electron has finished initializing
app.on("ready", createWindow);

// Quit when all windows are closed
app.on("window-all-closed", function () {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

ipcMain.on("quit-app", () => {
  if (mainWindow) {
    mainWindow.close();
  }
  // Optionally, to force quit the app:
  app.quit();
});

app.on("activate", function () {
  if (mainWindow === null) {
    createWindow();
  }
});

ipcMain.handle("select-output-dir", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory"],
    title: "Select Output Folder",
  });
  if (result.canceled || !result.filePaths[0]) return getSavedOutputDir();
  saveOutputDir(result.filePaths[0]);
  mainWindow.webContents.send("output-dir-changed", result.filePaths[0]);
  return result.filePaths[0];
});

ipcMain.handle("get-output-dir", async () => {
  return getSavedOutputDir();
});

ipcMain.handle("get-quality-mode", async () => {
  return getSavedQualityMode();
});

ipcMain.handle("set-quality-mode", async (event, useHighQuality) => {
  saveQualityMode(useHighQuality);
  return useHighQuality;
});

ipcMain.handle("get-hardware-accel-mode", async () => {
  return getSavedHardwareAccelMode();
});

ipcMain.handle("set-hardware-accel-mode", async (event, enabled) => {
  saveHardwareAccelMode(enabled);
  return enabled;
});

ipcMain.on("select-mov-files", async (event, options) => {
  const useHighQuality = options?.useHighQuality ?? false;
  // Default matches the persisted setting default (opt-in), not the converter's.
  const useHardwareAcceleration = options?.useHardwareAcceleration ?? false;
  const defaultPath = getSavedDir("individualFileSelectDir");
  const { filePaths } = await dialog.showOpenDialog({
    filters: [{ name: "Movies", extensions: ["mov", "mp4", "mpeg4"] }],
    properties: ["openFile", "multiSelections"],
    defaultPath: defaultPath,
  });

  if (filePaths && filePaths.length > 0) {
    // Save the directory of the first selected file for future use
    const selectedDir = path.dirname(filePaths[0]);
    saveDir("individualFileSelectDir", selectedDir);

    const outputDirectory = getSavedOutputDir();
    const conversionOptions = { useHighQuality, useHardwareAcceleration };
    let filesConverted = 0;
    let index = 0;
    let active = 0;
    const concurrency = 1; // sequential single-file conversion queue

    // track cancellation state
    isSingleConversionCanceled = false;
    currentSingleConversionProcess = null;

    // Send total number of files to renderer
    mainWindow.webContents.send("conversion-total-files", filePaths.length);

    function next() {
      if (isSingleConversionCanceled) {
        // Stop starting new conversions after cancellation
        currentSingleConversionProcess = null;
        return;
      }

      while (active < concurrency && index < filePaths.length) {
        if (isSingleConversionCanceled) {
          currentSingleConversionProcess = null;
          break;
        }

        const inputFilePath = filePaths[index++];
        const inputFileName = path.basename(
          inputFilePath,
          path.extname(inputFilePath),
        );
        const baseOutput = path.join(outputDirectory, inputFileName);
        const outputFilePath = getUniqueOutputFilePath(baseOutput, ".mp4");
        active++;
        let fileDone = false;

        // Send current file info
        mainWindow.webContents.send("conversion-file-started", {
          currentFile: inputFileName,
          fileNumber: index,
          totalFiles: filePaths.length,
        });

        currentSingleConversionProcess = converter.convertMovToMp4(
          inputFilePath,
          outputFilePath,
          (err, progress) => {
            if (isSingleConversionCanceled) {
              // user requested cancellation, stop here
              currentSingleConversionProcess = null;
              mainWindow.webContents.send("conversion-canceled");
              active = 0;
              index = filePaths.length;
              isSingleConversionCanceled = false;
              return;
            }

            if (err) {
              currentSingleConversionProcess = null;
              mainWindow.webContents.send("conversion-failed", err.message);
              active = Math.max(0, active - 1);
              next();
              return;
            }

            // Calculate overall progress
            const overallProgress = Math.round(
              ((filesConverted + progress / 100) / filePaths.length) * 100,
            );

            sendThrottledProgress({
              currentFileProgress: progress,
              overallProgress: overallProgress,
              currentFile: inputFileName,
              fileNumber: index,
            });

            if (progress === 100 && !fileDone) {
              fileDone = true;
              filesConverted++;
              mainWindow.webContents.send(
                "conversion-files-converted",
                filesConverted,
              );
              if (filesConverted === filePaths.length) {
                mainWindow.webContents.send("conversion-successful");
              }
              currentSingleConversionProcess = null;
              active--;
              next();
            }
          },
          conversionOptions,
        );
      }
    }
    next();
  }
});

ipcMain.on("combine-mov-files", async (event, options) => {
  const useHighQuality = options?.useHighQuality ?? false;
  // Default matches the persisted setting default (opt-in), not the converter's.
  const useHardwareAcceleration = options?.useHardwareAcceleration ?? false;
  const defaultPath = getSavedDir("combineFileSelectDir");
  const { filePaths } = await dialog.showOpenDialog({
    filters: [{ name: "Movies", extensions: ["mov", "mp4", "mpeg4"] }],
    properties: ["openFile", "multiSelections"],
    defaultPath: defaultPath,
  });

  if (!filePaths || filePaths.length === 0) return;

  // Save the directory of the first selected file for future use
  const selectedDir = path.dirname(filePaths[0]);
  saveDir("combineFileSelectDir", selectedDir);

  const conversionOptions = { useHighQuality, useHardwareAcceleration };

  // Sort files by creation time to find the earliest (likely original)
  filePaths.sort((a, b) => {
    const statA = fs.statSync(a);
    const statB = fs.statSync(b);
    return statA.birthtime.getTime() - statB.birthtime.getTime();
  });

  const outputDirectory = getSavedDir("combineSaveDir") || getSavedOutputDir();
  const earliestFile = filePaths[0];
  let baseName = path.basename(earliestFile, path.extname(earliestFile));
  // Optionally strip "copy" suffixes to get cleaner default name
  baseName = baseName.replace(/\s+copy\s*\d*$/i, "");

  // Show save dialog for user to choose output file name
  const saveResult = await dialog.showSaveDialog(mainWindow, {
    defaultPath: path.join(outputDirectory, baseName + ".mp4"),
    filters: [{ name: "MP4 Files", extensions: ["mp4"] }],
    title: "Save Combined Video As",
  });

  if (saveResult.canceled || !saveResult.filePath) return;

  // Save the directory of the chosen save path for future use
  const saveDirPath = path.dirname(saveResult.filePath);
  saveDir("combineSaveDir", saveDirPath);

  // Ensure the chosen path is unique
  const chosenBase = path.join(
    path.dirname(saveResult.filePath),
    path.basename(saveResult.filePath, ".mp4"),
  );
  const outputFilePath = getUniqueOutputFilePath(chosenBase, ".mp4");

  // Enqueue the job and start processing if needed
  combineQueue.push({ filePaths, outputFilePath, options: conversionOptions });
  if (mainWindow) {
    mainWindow.webContents.send("combine-queued", {
      outputFilePath,
      outputName: path.basename(outputFilePath),
      queueLength: combineQueue.length,
    });
  }

  sendCombineQueueUpdate();
});

ipcMain.on("cancel-combine-queue", () => {
  cancelCombineQueue();
});

ipcMain.on("cancel-single-conversion", () => {
  isSingleConversionCanceled = true;
  if (
    currentSingleConversionProcess &&
    typeof currentSingleConversionProcess.kill === "function"
  ) {
    currentSingleConversionProcess.kill("SIGKILL");
  }
});

ipcMain.on("start-combine-queue", () => {
  processNextCombineJob();
});
