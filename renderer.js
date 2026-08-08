document.addEventListener("DOMContentLoaded", () => {
  // Track which operation is active
  let isCombineOperation = false;
  console.log("DOM is ready");

  const selectOutputDirButton = document.getElementById("selectOutputDir");
  const outputDirDisplay = document.getElementById("outputDirDisplay");

  const selectMovButton = document.getElementById("selectMovFile");
  const combineMovButton = document.getElementById("combineMovFiles");
  const clearButton = document.getElementById("clearButton");
  const startQueueButton = document.getElementById("startQueueButton");
  const cancelQueueButton = document.getElementById("cancelQueueButton");
  const cancelSingleButton = document.getElementById("cancelSingleButton");
  const statusDiv = document.getElementById("status");
  const progressBar = document.getElementById("progressBar");
  const totalFilesDiv = document.getElementById("totalFiles");
  const filesConvertedDiv = document.getElementById("filesConverted");
  const combineQueueStatusDiv = document.getElementById("combineQueueStatus");
  const conversionCompleteMessage = document.getElementById(
    "conversionCompleteMessage",
  );
  const quitButton = document.getElementById("quitButton");
  const combineSuccessMessage = document.getElementById(
    "combineSuccessMessage",
  );
  const highQualityCheckbox = document.getElementById("highQualityMode");
  const qualityInfoText = document.getElementById("qualityInfo");
  const hardwareAccelCheckbox = document.getElementById("hardwareAccelMode");
  const hwAccelLabel = document.getElementById("hwAccelLabel");

  // Initially hide conversion info elements
  totalFilesDiv.style.display = "none";
  filesConvertedDiv.style.display = "none";
  if (combineQueueStatusDiv) combineQueueStatusDiv.style.display = "none";

  // Track quality preference
  window.electron.getQualityMode().then((isHighQuality) => {
    highQualityCheckbox.checked = isHighQuality;
    updateQualityInfo(isHighQuality);
    updateHardwareAccelAvailability(isHighQuality);
  });

  // Track hardware acceleration preference
  window.electron.getHardwareAccelMode().then((isEnabled) => {
    hardwareAccelCheckbox.checked = isEnabled;
  });

  highQualityCheckbox.addEventListener("change", (e) => {
    window.electron.setQualityMode(e.target.checked);
    updateQualityInfo(e.target.checked);
    updateHardwareAccelAvailability(e.target.checked);
  });

  hardwareAccelCheckbox.addEventListener("change", (e) => {
    window.electron.setHardwareAccelMode(e.target.checked);
  });

  function updateQualityInfo(isHighQuality) {
    if (isHighQuality) {
      qualityInfoText.textContent =
        "High Quality Mode: H.264 codec for better quality";
    } else {
      qualityInfoText.textContent =
        "Compressed Mode: H.265 codec for iPad storage optimization (~50% smaller)";
    }
  }

  function updateHardwareAccelAvailability(isHighQuality) {
    if (!isHighQuality) {
      hwAccelLabel.classList.add("hw-accel-disabled");
      hardwareAccelCheckbox.checked = false;
      hardwareAccelCheckbox.disabled = true;
      return;
    }
    hwAccelLabel.classList.remove("hw-accel-disabled");
    hardwareAccelCheckbox.disabled = false;
  }

  quitButton.addEventListener("click", () => {
    window.electron.quitApp();
  });

  let totalFiles = 0;
  let totalQueuedJobs = 0;

  function updateOutputDirDisplay(dir) {
    outputDirDisplay.textContent = "Output folder: " + dir;
  }

  window.electron.getOutputDir().then(updateOutputDirDisplay);

  window.electron.onOutputDirChanged((event, dir) => {
    updateOutputDirDisplay(dir);
  });

  statusDiv.className = "status-text status-progress";
  selectOutputDirButton.addEventListener("click", () => {
    window.electron.selectOutputDir().then(updateOutputDirDisplay);
  });

  function clearAllSuccessMessagesAndProgress() {
    if (conversionCompleteMessage) {
      conversionCompleteMessage.style.display = "none";
      conversionCompleteMessage.textContent = "";
    }
    if (combineSuccessMessage) {
      combineSuccessMessage.style.display = "none";
      combineSuccessMessage.textContent = "";
    }
    totalFilesDiv.textContent = "";
    filesConvertedDiv.textContent = "";
    if (combineQueueStatusDiv) {
      combineQueueStatusDiv.textContent = "";
      combineQueueStatusDiv.style.display = "none";
    }
    if (cancelQueueButton) cancelQueueButton.disabled = true;
    // Always reset and show status/progress bar
    statusDiv.style.display = "block";
    progressBar.style.display = "block";
  }

  selectMovButton.addEventListener("click", () => {
    clearAllSuccessMessagesAndProgress();
    isCombineOperation = false;
    if (combineSuccessMessage) {
      combineSuccessMessage.style.display = "none";
      combineSuccessMessage.textContent = "";
    }
    console.log("Select button clicked");
    window.electron.selectMovFiles({
      useHighQuality: highQualityCheckbox.checked,
      useHardwareAcceleration: hardwareAccelCheckbox.checked,
    });
    statusDiv.textContent = "Status: Conversion started...";
    progressBar.style.display = "block";
    statusDiv.className = "status-text status-progress";
    progressBar.value = 0;
    if (cancelSingleButton) cancelSingleButton.disabled = false;
  });

  combineMovButton.addEventListener("click", () => {
    // Keep queue status visible; just reset other messages/progress
    if (conversionCompleteMessage) {
      conversionCompleteMessage.style.display = "none";
      conversionCompleteMessage.textContent = "";
    }
    if (combineSuccessMessage) {
      combineSuccessMessage.style.display = "none";
      combineSuccessMessage.textContent = "";
    }

    isCombineOperation = true;
    console.log("Combine button clicked");
    statusDiv.className = "status-text status-progress";
    statusDiv.textContent = "Status: Combining started...";
    progressBar.value = 0;
    window.electron.combineMovFiles({
      useHighQuality: highQualityCheckbox.checked,
      useHardwareAcceleration: hardwareAccelCheckbox.checked,
    });
  });

  clearButton.addEventListener("click", () => {
    console.log("Clear button clicked");
    statusDiv.textContent = "Status: Idle";
    progressBar.style.display = "none";
    progressBar.value = 0;
    conversionCompleteMessage.textContent = "";
    conversionCompleteMessage.style.display = "none";
    if (combineSuccessMessage) {
      combineSuccessMessage.style.display = "none";
      combineSuccessMessage.textContent = "";
    }
    statusDiv.className = "status-text status-idle";
    totalFilesDiv.textContent = "";
    totalFilesDiv.style.display = "none";
    filesConvertedDiv.textContent = "";
    filesConvertedDiv.style.display = "none";
    if (combineQueueStatusDiv) {
      combineQueueStatusDiv.textContent = "";
      combineQueueStatusDiv.style.display = "none";
    }
    clearButton.disabled = true;
    if (cancelSingleButton) cancelSingleButton.disabled = true;
    if (startQueueButton) startQueueButton.disabled = true;
    if (cancelQueueButton) cancelQueueButton.disabled = true;
    totalQueuedJobs = 0;
    isCombineOperation = false;
  });

  if (cancelQueueButton) {
    cancelQueueButton.addEventListener("click", () => {
      window.electron.cancelCombineQueue();
      if (combineQueueStatusDiv) {
        combineQueueStatusDiv.textContent = "Combine queue canceled.";
      }
      cancelQueueButton.disabled = true;
    });
  }

  if (cancelSingleButton) {
    cancelSingleButton.addEventListener("click", () => {
      window.electron.cancelSingleConversion();
      cancelSingleButton.disabled = true;
      statusDiv.textContent = "Status: Single conversion canceled.";
    });
  }

  if (startQueueButton) {
    startQueueButton.addEventListener("click", () => {
      window.electron.startCombineQueue();
      startQueueButton.disabled = true;
    });
  }

  window.electron.onConversionFailed((event, errorMessage) => {
    console.error("Conversion failed:", errorMessage);
    statusDiv.className = "status-text status-progress";
    statusDiv.textContent = `Status: Conversion failed - ${errorMessage}`;
    progressBar.style.display = "none";
    totalFilesDiv.style.display = "none";
    filesConvertedDiv.style.display = "none";
    clearButton.disabled = false;
  });

  window.electron.onConversionCanceled(() => {
    console.log("Conversion canceled");
    statusDiv.className = "status-text status-idle";
    statusDiv.textContent = "Status: Conversion canceled by user.";
    progressBar.style.display = "none";
    totalFilesDiv.style.display = "none";
    filesConvertedDiv.style.display = "none";
    clearButton.disabled = false;
  });

  window.electron.onConversionSuccessful(() => {
    // If this is a combine operation, show the styled combine success message
    if (
      combineSuccessMessage &&
      combineSuccessMessage.style.display === "block"
    ) {
      // Already handled by combine event, do nothing
      return;
    }
    // Otherwise, show individual conversion success
    statusDiv.style.display = "none";
    progressBar.style.display = "none";
    totalFilesDiv.style.display = "none";
    filesConvertedDiv.style.display = "none";
    conversionCompleteMessage.style.display = "block";
    conversionCompleteMessage.innerHTML =
      "Hooray! Your conversions are now complete!";
    clearButton.disabled = false;
  });

  window.electron.onConversionFileStarted((event, data) => {
    statusDiv.textContent = `Status: Converting file ${data.fileNumber} of ${data.totalFiles}: ${data.currentFile}`;
    progressBar.style.display = "block";
  });

  statusDiv.className = "status-text status-progress";
  window.electron.onConversionProgress((event, data) => {
    const progressValue =
      !isNaN(data.overallProgress) && data.overallProgress !== undefined
        ? data.overallProgress
        : !isNaN(data.currentFileProgress)
          ? data.currentFileProgress
          : 0;

    progressBar.value = progressValue;

    let statusText = "Status: Processing...";
    if (data.currentFile) {
      const percent = !isNaN(data.currentFileProgress)
        ? Math.round(data.currentFileProgress)
        : 0;
      statusText = `Status: Converting ${data.currentFile} (${percent}%)`;
    }

    if (data.queueRemaining != null) {
      statusText += ` — ${data.queueRemaining} job(s) queued`;
    }

    statusDiv.textContent = statusText;
    statusDiv.className = "status-text status-progress";
  });

  window.electron.onConversionTotalFiles((event, total) => {
    totalFiles = total;
    totalFilesDiv.textContent = `Total individual files selected for conversion: ${total}`;
    totalFilesDiv.style.display = "block";
    filesConvertedDiv.textContent = `Progress of converted files: 0`;
    filesConvertedDiv.style.display = "block";
    conversionCompleteMessage.style.display = "none";
    statusDiv.textContent = "Status: Starting conversion...";
    progressBar.value = 0;
    progressBar.style.display = "block";
  });

  window.electron.onConversionFilesConverted((event, converted) => {
    filesConvertedDiv.textContent = `Progress of converted files: ${converted}`;
    if (converted === totalFiles && !isCombineOperation) {
      // Only show individual success message, hide combine success
      if (combineSuccessMessage) {
        combineSuccessMessage.style.display = "none";
        combineSuccessMessage.textContent = "";
      }
      statusDiv.style.display = "none";
      progressBar.style.display = "none";
      conversionCompleteMessage.style.display = "block";
      conversionCompleteMessage.innerHTML =
        "Hooray! Your conversions are now complete!";
      progressBar.value = 100;
    }
  });

  window.electron.onCombineQueued((event, data) => {
    if (!combineQueueStatusDiv) return;
    if (cancelQueueButton) cancelQueueButton.disabled = false;
    if (startQueueButton) startQueueButton.disabled = false;
    totalQueuedJobs += 1;
    combineQueueStatusDiv.style.display = "block";
    combineQueueStatusDiv.textContent = `Queued: ${data.queueLength} job(s). Next output: ${data.outputName}`;
  });

  window.electron.onCombineQueueUpdate((event, data) => {
    if (!combineQueueStatusDiv) return;
    if (cancelQueueButton) cancelQueueButton.disabled = data.queued === 0;
    if (startQueueButton)
      startQueueButton.disabled = data.queued === 0 || data.processing;

    if (data.queued === 0 && !data.processing) {
      combineQueueStatusDiv.textContent = "";
      combineQueueStatusDiv.style.display = "none";
      return;
    }

    combineQueueStatusDiv.style.display = "block";
    const statusLabel = data.processing ? "Processing" : "Idle";
    combineQueueStatusDiv.textContent = `Combine queue: ${data.queued} job(s) pending — ${statusLabel}`;
  });

  window.electron.onCombineJobStarted((event, data) => {
    if (!combineQueueStatusDiv) return;
    if (cancelQueueButton) cancelQueueButton.disabled = false;
    combineQueueStatusDiv.style.display = "block";
    combineQueueStatusDiv.textContent = `Combine running: ${data.outputName} — ${data.queueRemaining} job(s) remaining`;
  });

  if (window.electron.onCombineQueueCanceled) {
    window.electron.onCombineQueueCanceled(() => {
      if (!combineQueueStatusDiv) return;
      combineQueueStatusDiv.textContent = "";
      combineQueueStatusDiv.style.display = "none";
      if (cancelQueueButton) cancelQueueButton.disabled = true;
    });
  }

  function showCombineSuccessMessage() {
    // Hide progress and status, show combine success message
    statusDiv.style.display = "none";
    progressBar.style.display = "none";
    conversionCompleteMessage.style.display = "none";
    totalFilesDiv.textContent = "";
    filesConvertedDiv.textContent = "";
    if (combineSuccessMessage) {
      combineSuccessMessage.style.display = "block";
      combineSuccessMessage.innerHTML = `✅ Success! ${totalQueuedJobs} combo job(s) were completed.`;
    }
  }

  // Listen for combine success event from main process
  window.electron.onCombineSuccessful((event, data) => {
    // If there are still jobs in the queue, show a smaller status update and keep processing
    isCombineOperation = true;

    if (data?.queueRemaining > 0) {
      if (combineSuccessMessage) {
        combineSuccessMessage.style.display = "block";
        combineSuccessMessage.innerHTML = `Batch complete. ${data.queueRemaining} job(s) remaining...`;
      }
      return;
    }

    // Queue is empty — show final success message
    statusDiv.style.display = "none";
    progressBar.style.display = "none";
    conversionCompleteMessage.style.display = "none";
    showCombineSuccessMessage();
    clearButton.disabled = false;
  });
});
