
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";

const $ = (selector) => document.querySelector(selector);

const videoInput = $("#video");
const startButton = $("#start");
console.log("ShortsMaker main.js is running");
const statusBox = $("#status");
const outputLink = $("#output");

let ffmpeg = null;
let loadPromise = null;
let selectedFile = null;
let outputURL = null;
let isProcessing = false;

if (!videoInput || !startButton || !statusBox || !outputLink) {
  throw new Error(
    "ShortsMaker setup error: check the video, start, status and output IDs in index.html."
  );
}

// Create advanced controls without requiring changes to index.html.
const controls = document.createElement("section");
controls.id = "advanced-controls";
controls.style.cssText = `
  display:grid;
  grid-template-columns:repeat(2,minmax(0,1fr));
  gap:12px;
  margin-top:16px;
`;

controls.innerHTML = `
  <label style="display:block;font-size:13px">
    Clip duration
    <select id="clip-duration" style="
      display:block;width:100%;margin-top:7px;padding:12px;
      border-radius:10px;border:1px solid #46536d;
      background:#101829;color:#fff">
      <option value="30">30 seconds</option>
      <option value="45">45 seconds</option>
      <option value="60" selected>60 seconds</option>
    </select>
  </label>
  <label style="display:block;font-size:13px">
    Video framing
    <select id="framing" style="
      display:block;width:100%;margin-top:7px;padding:12px;
      border-radius:10px;border:1px solid #46536d;
      background:#101829;color:#fff">
      <option value="crop" selected>Fill screen</option>
      <option value="fit">Show entire video</option>
    </select>
  </label>
`;

startButton.parentNode.insertBefore(controls, startButton);

const progress = document.createElement("progress");
progress.max = 100;
progress.value = 0;
progress.style.cssText = `
  display:block;width:100%;height:12px;margin-top:14px;
`;
progress.setAttribute("aria-label", "Video processing progress");
statusBox.insertAdjacentElement("afterend", progress);

function showStatus(message) {
  statusBox.textContent = message;
}

function clearDownload() {
  outputLink.hidden = true;
  outputLink.removeAttribute("href");

  if (outputURL) {
    URL.revokeObjectURL(outputURL);
    outputURL = null;
  }
}

function setBusy(busy) {
  isProcessing = busy;
  startButton.disabled = busy;
  videoInput.disabled = busy;
  $("#clip-duration").disabled = busy;
  $("#framing").disabled = busy;
  startButton.textContent = busy
    ? "Processing…"
    : "▶ Create Short";
}

videoInput.addEventListener("change", () => {
  selectedFile = videoInput.files?.[0] || null;
  clearDownload();
  progress.value = 0;

  if (!selectedFile) {
    showStatus("No video selected. Choose a video to begin.");
    return;
  }

  if (!selectedFile.type.startsWith("video/")) {
    selectedFile = null;
    showStatus("Please choose a supported video file.");
    return;
  }

  showStatus(
    `Selected: ${selectedFile.name} · ${(
      selectedFile.size / (1024 * 1024)
    ).toFixed(1)} MB`
  );
});

async function loadEngine() {
  if (ffmpeg) return ffmpeg;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    showStatus("Loading video engine for the first time…");

    const engine = new FFmpeg();

    engine.on("log", ({ message }) => {
      // Keep diagnostic output in the browser console.
      console.debug("[ShortsMaker FFmpeg]", message);
    });

    engine.on("progress", ({ progress: amount }) => {
      if (Number.isFinite(amount)) {
        const percent = Math.max(
          0,
          Math.min(99, Math.round(amount * 100))
        );
        progress.value = percent;
        showStatus(`Processing video… ${percent}%`);
      }
    });

    const base = `${import.meta.env.BASE_URL}ffmpeg/`;

    await engine.load({
      coreURL: await toBlobURL(
        `${base}ffmpeg-core.js`,
        "text/javascript"
      ),
      wasmURL: await toBlobURL(
        `${base}ffmpeg-core.wasm`,
        "application/wasm"
      )
    });

    ffmpeg = engine;
    return engine;
  })();

  try {
    return await loadPromise;
  } catch (error) {
    loadPromise = null;
    throw error;
  }
}

startButton.addEventListener("click", async () => {
  if (isProcessing) return;

  if (!selectedFile) {
    showStatus("Please choose a video file first.");
    return;
  }

  clearDownload();
  progress.value = 0;
  setBusy(true);

  let engine;

  try {
    engine = await loadEngine();

    showStatus("Preparing your video…");

    // Use the original extension so FFmpeg can identify the input format.
    const extension =
      selectedFile.name.match(/\.([a-zA-Z0-9]{1,8})$/)?.[1] ||
      "mp4";

    const inputName = `input.${extension.toLowerCase()}`;
    const outputName = "shortsmaker-output.mp4";

    // Remove files left by an earlier attempt.
    for (const name of [inputName, outputName]) {
      try {
        await engine.deleteFile(name);
      } catch {
        // The file may not exist yet.
      }
    }

    await engine.writeFile(inputName, await fetchFile(selectedFile));

    const duration = $("#clip-duration").value;
    const framing = $("#framing").value;

    const videoFilter =
      framing === "fit"
        ? "scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2:black"
        : "scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280";

    showStatus("Creating your vertical MP4…");

    const exitCode = await engine.exec([
      "-i", inputName,
      "-t", duration,
      "-map", "0:v:0",
      "-map", "0:a:0?",
      "-vf", videoFilter,
      "-r", "30",
      "-c:v", "libx264",
      "-preset", "ultrafast",
      "-crf", "23",
      "-pix_fmt", "yuv420p",
      "-c:a", "aac",
      "-b:a", "128k",
      "-movflags", "+faststart",
      outputName
    ]);

    if (exitCode !== 0) {
      throw new Error(`FFmpeg exited with code ${exitCode}.`);
    }

    showStatus("Preparing download…");

    const data = await engine.readFile(outputName);

    outputURL = URL.createObjectURL(
      new Blob([data], { type: "video/mp4" })
    );

    outputLink.href = outputURL;
    outputLink.download = "shortsmaker.mp4";
    outputLink.textContent = "⬇ Download your Short";
    outputLink.hidden = false;

    progress.value = 100;
    showStatus("Finished! Your vertical video is ready.");

    // Clean up the virtual filesystem.
    for (const name of [inputName, outputName]) {
      try {
        await engine.deleteFile(name);
      } catch {
        // Ignore cleanup errors.
      }
    }
  } catch (error) {
    console.error("[ShortsMaker]", error);
    progress.value = 0;

    showStatus(
      `Could not create the video: ${error.message || String(error)}. ` +
      "Check your internet connection and try a smaller video."
    );
  } finally {
    setBusy(false);
  }
});

showStatus("Ready. Choose a video to begin.");
progress.value = 0;
