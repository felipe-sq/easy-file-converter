const ffmpeg = require("fluent-ffmpeg");
const path = require("path");
const fs = require("fs");
const os = require("os");

function canExecute(binaryPath) {
  try {
    fs.accessSync(binaryPath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function isInsideAsar(binaryPath) {
  return binaryPath.includes(`${path.sep}app.asar${path.sep}`);
}

function resolveBinaryPath(binaryName) {
  const resourcesPath = process.resourcesPath || "";
  const candidates = [
    path.join(__dirname, "bin", binaryName),
    path.join(resourcesPath, "app.asar.unpacked", "bin", binaryName),
    path.join(resourcesPath, "bin", binaryName),
  ];

  for (const candidate of candidates) {
    if (candidate && !isInsideAsar(candidate) && canExecute(candidate)) {
      return candidate;
    }
  }

  return null;
}

const resolvedFfmpegPath = resolveBinaryPath("ffmpeg");
if (resolvedFfmpegPath) {
  ffmpeg.setFfmpegPath(resolvedFfmpegPath);
  console.log(`[converter] Using ffmpeg binary: ${resolvedFfmpegPath}`);
}

const resolvedFfprobePath = resolveBinaryPath("ffprobe");
if (resolvedFfprobePath) {
  ffmpeg.setFfprobePath(resolvedFfprobePath);
  console.log(`[converter] Using ffprobe binary: ${resolvedFfprobePath}`);
}

const SCALE_FILTER =
  "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2";

function getMediaInfo(inputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(inputPath, (err, metadata) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(metadata || {});
    });
  });
}

function canCopyToMp4(mediaInfo, useHighQuality) {
  if (!useHighQuality) {
    // Compressed mode must re-encode to HEVC; do not fast-remux in that path.
    return false;
  }

  const streams = mediaInfo.streams || [];
  const formatName = (mediaInfo.format && mediaInfo.format.format_name) || "";
  const videoStream = streams.find((s) => s.codec_type === "video");
  const audioStream = streams.find((s) => s.codec_type === "audio");

  if (!videoStream || !audioStream) {
    return false;
  }

  const videoCodec = String(videoStream.codec_name || "").toLowerCase();
  const audioCodec = String(audioStream.codec_name || "").toLowerCase();
  const targetVideoCodec = "h264"; // Always H.264 now for thumbnail compatibility

  // Keep this conservative to avoid container/codec edge cases.
  return (
    formatName.includes("mp4") &&
    videoCodec === targetVideoCodec &&
    audioCodec === "aac"
  );
}

function toConcatLine(filePath) {
  // Escape single quotes for ffmpeg concat format.
  const escapedPath = String(filePath).replace(/'/g, "'\\''");
  return `file '${escapedPath}'`;
}

function writeConcatFile(concatFilePath, inputFilePaths) {
  fs.writeFileSync(concatFilePath, inputFilePaths.map(toConcatLine).join("\n"));
}

function shouldScale(inputPath) {
  return new Promise((resolve) => {
    ffmpeg.ffprobe(inputPath, (err, metadata) => {
      if (err) {
        console.error("ffprobe error:", err);
        resolve(false);
        return;
      }

      const videoStream = (metadata.streams || []).find(
        (s) => s.codec_type === "video",
      );
      if (!videoStream) {
        resolve(false);
        return;
      }

      const width = Number(videoStream.width || 0);
      const height = Number(videoStream.height || 0);
      resolve(width > 1280 || height > 720);
    });
  });
}

function getEncoderOutputOptions(useHighQuality, useHardwareAcceleration) {
  if (!useHighQuality) {
    // Compressed mode should use HEVC on CPU to preserve file-size reduction.
    return [
      ["-c:v", "libx265"],
      ["-preset", "faster"],
      ["-crf", "26"],
      ["-pix_fmt", "yuv420p"],
      ["-tag:v", "hvc1"],
    ];
  }

  if (useHardwareAcceleration) {
    // Hardware-accelerated high-quality mode uses VideoToolbox bitrate control.
    return [
      ["-c:v", "h264_videotoolbox"],
      ["-b:v", "5000k"],
      ["-maxrate", "6000k"],
      ["-bufsize", "12000k"],
      ["-pix_fmt", "yuv420p"],
    ];
  }

  return [
    ["-c:v", "libx264"],
    ["-preset", "faster"],
    ["-crf", "22"],
    ["-pix_fmt", "yuv420p"],
  ];
}

function applyOutputOptions(command, optionPairs) {
  let updated = command;
  optionPairs.forEach(([key, value]) => {
    updated = updated.outputOptions(key, value);
  });
  return updated;
}

function buildConversionCommand(
  inputFilePath,
  outputFilePath,
  useHighQuality,
  useHardwareAcceleration,
  inputAudioCodec,
) {
  const encoderOptions = getEncoderOutputOptions(
    useHighQuality,
    useHardwareAcceleration,
  );

  // Log encoder profile to help diagnose file size and hardware acceleration behavior.
  const codecDescription = useHighQuality
    ? useHardwareAcceleration
      ? "High-quality hardware H.264 encode (h264_videotoolbox)"
      : "High-quality CPU H.264 encode (libx264)"
    : "Compressed mode HEVC CPU encode (libx265)";
  console.log(`[converter] Starting conversion: ${codecDescription}`);

  let command = ffmpeg(inputFilePath);
  command = applyOutputOptions(command, encoderOptions);

  const audioCodecOption = inputAudioCodec === "aac" ? "copy" : "aac";

  return command
    .outputOptions("-c:a", audioCodecOption)
    .outputOptions("-threads", "0")
    .outputOptions("-movflags", "+faststart")
    .outputOptions("-strict", "experimental")
    .output(outputFilePath);
}

function buildCopyCommand(inputFilePath, outputFilePath) {
  return ffmpeg(inputFilePath)
    .outputOptions("-c:v", "copy")
    .outputOptions("-c:a", "copy")
    .outputOptions("-movflags", "+faststart")
    .output(outputFilePath);
}

function convertMovToMp4(
  inputFilePath,
  outputFilePath,
  callback,
  options = {},
) {
  let progress = 0;
  const useHighQuality = options.useHighQuality !== false;
  const useScaling = options.useScaling !== false;
  const useFastRemux = options.useFastRemux !== false;
  const useHardwareAcceleration =
    options.useHardwareAcceleration !== false && process.platform === "darwin";
  let hardwareFallbackTried = false;

  const controller = {
    command: null,
    pendingKillSignal: null,
    kill(signal = "SIGKILL") {
      if (this.command && typeof this.command.kill === "function") {
        this.command.kill(signal);
      } else {
        this.pendingKillSignal = signal;
      }
    },
  };

  const startCommand = (
    scaleNeeded,
    useCopyMode,
    forceCpu = false,
    inputAudioCodec = null,
  ) => {
    const hardwareForThisRun = useHardwareAcceleration && !forceCpu;
    const command = useCopyMode
      ? buildCopyCommand(inputFilePath, outputFilePath)
      : buildConversionCommand(
          inputFilePath,
          outputFilePath,
          useHighQuality,
          hardwareForThisRun,
          inputAudioCodec,
        );

    if (scaleNeeded && !useCopyMode) {
      command.outputOptions("-vf", SCALE_FILTER);
    }

    command
      .on("progress", (info) => {
        progress = Math.round(info.percent);
        callback(null, progress);
      })
      .on("end", () => {
        if (useCopyMode) {
          console.log("Remux complete (stream copy)");
        } else {
          console.log("Conversion complete");
        }
        callback(null, 100);
      })
      .on("error", (err) => {
        if (useHardwareAcceleration && !useCopyMode && !hardwareFallbackTried) {
          hardwareFallbackTried = true;
          console.warn(
            "Hardware encode failed, retrying conversion with CPU encoder:",
            err,
          );
          startCommand(scaleNeeded, false, true, inputAudioCodec);
          return;
        }
        console.error("Error during conversion:", err);
        callback(err, progress);
      });

    controller.command = command;
    command.run();

    if (controller.pendingKillSignal) {
      command.kill(controller.pendingKillSignal);
      controller.pendingKillSignal = null;
    }
  };

  Promise.all([
    useScaling ? shouldScale(inputFilePath) : Promise.resolve(false),
    useFastRemux
      ? getMediaInfo(inputFilePath).catch((err) => {
          console.error("Error probing media info for copy mode:", err);
          return null;
        })
      : Promise.resolve(null),
  ])
    .then(([scaleNeeded, mediaInfo]) => {
      const copyEligible =
        useFastRemux &&
        !scaleNeeded &&
        mediaInfo &&
        canCopyToMp4(mediaInfo, useHighQuality);

      const streams = (mediaInfo && mediaInfo.streams) || [];
      const audioStream = streams.find((s) => s.codec_type === "audio");
      const inputAudioCodec = audioStream
        ? String(audioStream.codec_name || "").toLowerCase()
        : null;

      startCommand(scaleNeeded, Boolean(copyEligible), false, inputAudioCodec);
    })
    .catch((err) => {
      console.error(
        "Error preparing conversion, proceeding with fallback:",
        err,
      );
      startCommand(false, false);
    });

  return controller;
}

function combineMovToMp4(
  inputFilePaths,
  outputFilePath,
  callback,
  options = {},
) {
  const tempDir = path.join(
    os.tmpdir(),
    "mov-to-mpeg4",
    `combine-${Date.now()}-${process.pid}`,
  );

  if (!Array.isArray(inputFilePaths) || inputFilePaths.length === 0) {
    const errMsg = "[combineMovToMp4] No input files provided.";
    console.error(errMsg);
    callback(new Error(errMsg), 0);
    return;
  }

  if (fs.existsSync(tempDir)) {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
      console.log("[combineMovToMp4] Cleaned temp directory.");
    } catch (err) {
      console.error("[combineMovToMp4] Failed to clean temp directory:", err);
      callback(err, 0);
      return;
    }
  }

  try {
    fs.mkdirSync(tempDir, { recursive: true });
  } catch (err) {
    console.error("[combineMovToMp4] Failed to create temp directory:", err);
    callback(err, 0);
    return;
  }

  const totalFiles = inputFilePaths.length;
  let filesConverted = 0;

  const useScaling = options.useScaling !== false;
  const useHighQuality = options.useHighQuality !== false;
  const useFastRemux = options.useFastRemux !== false;
  const useHardwareAcceleration =
    options.useHardwareAcceleration !== false && process.platform === "darwin";
  let combineHardwareFallbackTried = false;

  const resetTempDir = () => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    fs.mkdirSync(tempDir, { recursive: true });
  };

  const finalizeError = (err) => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (cleanupErr) {
      console.error(
        "[combineMovToMp4] Error cleaning up temp directory:",
        cleanupErr,
      );
    }
    callback(err, 0);
  };

  const runCopyConcat = () => {
    const concatFile = path.join(tempDir, "concat.txt");
    try {
      writeConcatFile(concatFile, inputFilePaths);
      console.log(
        `[combineMovToMp4] Wrote concat file for stream copy: ${concatFile}`,
      );
    } catch (err) {
      console.error(
        "[combineMovToMp4] Error writing concat.txt for stream copy:",
        err,
      );
      finalizeError(err);
      return;
    }

    ffmpeg()
      .input(concatFile)
      .inputOptions("-f", "concat", "-safe", "0")
      .outputOptions("-c", "copy")
      .outputOptions("-movflags", "+faststart")
      .output(outputFilePath)
      .on("progress", (info) => {
        const combineProgress = Math.round(info.percent);
        if (!isNaN(combineProgress)) {
          const clamped = combineProgress >= 100 ? 99 : combineProgress;
          callback(null, clamped);
        }
      })
      .on("stderr", (line) => {
        console.log(`[combineMovToMp4][ffmpeg][stderr][copy-combine]: ${line}`);
      })
      .on("end", () => {
        console.log("[combineMovToMp4] Combo complete (stream copy)");
        try {
          fs.rmSync(tempDir, { recursive: true, force: true });
        } catch (err) {
          console.error(
            "[combineMovToMp4] Error cleaning up temp directory:",
            err,
          );
        }
        callback(null, 100);
      })
      .on("error", (err) => {
        console.error(
          "[combineMovToMp4] Stream-copy combine failed, falling back to re-encode:",
          err,
        );
        startCombine(false);
      })
      .run();
  };

  const startCombine = (applyScaling, forceCpu = false) => {
    const hardwareForThisRun = useHardwareAcceleration && !forceCpu;
    const tempFiles = inputFilePaths.map((inputFilePath, index) => {
      const tempFilePath = path.join(tempDir, `file${index}.ts`);
      return new Promise((resolve, reject) => {
        console.log(
          `[combineMovToMp4] Starting ffmpeg for input: ${inputFilePath} -> ${tempFilePath}`,
        );

        let command = ffmpeg(inputFilePath)
          .outputOptions("-c:a", "aac")
          .outputOptions("-threads", "0")
          .outputOptions("-f", "mpegts");

        command = applyOutputOptions(
          command,
          getEncoderOutputOptions(useHighQuality, hardwareForThisRun),
        );

        if (applyScaling) {
          command = command.outputOptions("-vf", SCALE_FILTER);
        }

        command
          .output(tempFilePath)
          .on("progress", (info) => {
            const fileProgress = Math.round(info.percent);
            let overallProgress = Math.round(
              ((filesConverted + fileProgress / 100) / (totalFiles + 1)) * 100,
            );
            if (overallProgress >= 100) overallProgress = 99;
            callback(null, overallProgress);
          })
          .on("stderr", (line) => {
            console.log(
              `[combineMovToMp4][ffmpeg][stderr][${inputFilePath}]: ${line}`,
            );
          })
          .on("end", () => {
            filesConverted += 1;
            let overallProgress = Math.round(
              (filesConverted / (totalFiles + 1)) * 100,
            );
            if (overallProgress >= 100) overallProgress = 99;
            callback(null, overallProgress);
            resolve(tempFilePath);
          })
          .on("error", (err) => {
            console.error(
              `[combineMovToMp4] Error converting file ${inputFilePath}:`,
              err,
            );
            reject(err);
          })
          .run();
      });
    });

    Promise.all(tempFiles)
      .then((tsFiles) => {
        const concatFile = path.join(tempDir, "concat.txt");
        try {
          writeConcatFile(concatFile, tsFiles);
          console.log(`[combineMovToMp4] Wrote concat file: ${concatFile}`);
        } catch (err) {
          console.error("[combineMovToMp4] Error writing concat.txt:", err);
          finalizeError(err);
          return;
        }

        console.log(
          `[combineMovToMp4] Starting ffmpeg for final combine: ${outputFilePath}`,
        );

        let combineCommand = ffmpeg()
          .input(concatFile)
          .inputOptions("-f", "concat", "-safe", "0")
          .outputOptions("-c:a", "aac")
          .outputOptions("-threads", "0")
          .outputOptions("-movflags", "+faststart")
          .outputOptions("-strict", "experimental");

        combineCommand = applyOutputOptions(
          combineCommand,
          getEncoderOutputOptions(useHighQuality, hardwareForThisRun),
        );

        if (applyScaling) {
          combineCommand = combineCommand.outputOptions("-vf", SCALE_FILTER);
        }

        combineCommand
          .output(outputFilePath)
          .on("progress", (info) => {
            const combineProgress = Math.round(info.percent);
            let overallProgress = Math.round(
              ((filesConverted + combineProgress / 100) / (totalFiles + 1)) *
                100,
            );
            if (!isNaN(overallProgress)) {
              if (overallProgress >= 100) overallProgress = 99;
              callback(null, overallProgress);
            }
          })
          .on("stderr", (line) => {
            console.log(`[combineMovToMp4][ffmpeg][stderr][combine]: ${line}`);
          })
          .on("end", () => {
            console.log("[combineMovToMp4] Combo complete");
            try {
              fs.rmSync(tempDir, { recursive: true, force: true });
            } catch (err) {
              console.error(
                "[combineMovToMp4] Error cleaning up temp directory:",
                err,
              );
            }
            callback(null, 100);
          })
          .on("error", (err) => {
            if (hardwareForThisRun && !combineHardwareFallbackTried) {
              combineHardwareFallbackTried = true;
              console.warn(
                "[combineMovToMp4] Hardware final combine failed, retrying with CPU encoder:",
                err,
              );
              try {
                resetTempDir();
              } catch (resetErr) {
                finalizeError(resetErr);
                return;
              }
              filesConverted = 0;
              startCombine(applyScaling, true);
              return;
            }
            console.error("[combineMovToMp4] Error during combination:", err);
            finalizeError(err);
          })
          .run();
      })
      .catch((err) => {
        if (hardwareForThisRun && !combineHardwareFallbackTried) {
          combineHardwareFallbackTried = true;
          console.warn(
            "[combineMovToMp4] Hardware temp conversion failed, retrying with CPU encoder:",
            err,
          );
          try {
            resetTempDir();
          } catch (resetErr) {
            finalizeError(resetErr);
            return;
          }
          filesConverted = 0;
          startCombine(applyScaling, true);
          return;
        }
        console.error(
          "[combineMovToMp4] Error during conversion of files to .ts:",
          err,
        );
        finalizeError(err);
      });
  };

  Promise.all([
    useScaling
      ? Promise.all(inputFilePaths.map((p) => shouldScale(p))).catch((err) => {
          console.error(
            "[combineMovToMp4] Error deciding scaling, proceeding without scaling:",
            err,
          );
          return inputFilePaths.map(() => false);
        })
      : Promise.resolve(inputFilePaths.map(() => false)),
    useFastRemux
      ? Promise.all(
          inputFilePaths.map((p) =>
            getMediaInfo(p)
              .then((mediaInfo) => canCopyToMp4(mediaInfo, useHighQuality))
              .catch((err) => {
                console.error(
                  "[combineMovToMp4] Error probing media info:",
                  err,
                );
                return false;
              }),
          ),
        )
      : Promise.resolve(inputFilePaths.map(() => false)),
  ])
    .then(([scaleFlags, copyFlags]) => {
      const applyScaling = scaleFlags.some(Boolean);
      const canUseCopyConcat =
        useFastRemux &&
        !applyScaling &&
        copyFlags.length > 0 &&
        copyFlags.every(Boolean);

      if (canUseCopyConcat) {
        runCopyConcat();
        return;
      }

      startCombine(applyScaling);
    })
    .catch((err) => {
      console.error(
        "[combineMovToMp4] Error preparing combine, using fallback:",
        err,
      );
      startCombine(false);
    });
}

module.exports = {
  convertMovToMp4,
  combineMovToMp4,
};
