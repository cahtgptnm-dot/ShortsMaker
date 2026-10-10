
const videoInput = document.getElementById("videoFile");
const video = document.getElementById("video");
const status = document.getElementById("status");
const startInput = document.getElementById("startTime");
const durationInput = document.getElementById("duration");
const qualityInput = document.getElementById("quality");
const exportBtn = document.getElementById("exportBtn");
const stopBtn = document.getElementById("stopBtn");
const progress = document.getElementById("progress");
const exportStatus = document.getElementById("exportStatus");
const downloadArea = document.getElementById("downloadArea");

let currentURL = null;
let cancelExport = false;
let exporting = false;
let recorder = null;
let animationId = null;

function setStatus(message) {
  status.textContent = message;
}

function setExportStatus(message) {
  exportStatus.textContent = message;
}

function waitForEvent(element, eventName) {
  return new Promise((resolve, reject) => {
    const onEvent = () => {
      cleanup();
      resolve();
    };

    const onError = () => {
      cleanup();
      reject(new Error("The video could not be loaded or decoded."));
    };

    const cleanup = () => {
      element.removeEventListener(eventName, onEvent);
      element.removeEventListener("error", onError);
    };

    element.addEventListener(eventName, onEvent, { once: true });
    element.addEventListener("error", onError, { once: true });
  });
}

videoInput.addEventListener("change", async () => {
  const file = videoInput.files?.[0];

  if (!file) {
    setStatus("No video selected.");
    return;
  }

  if (!file.type.startsWith("video/")) {
    setStatus("Please select a valid video file.");
    return;
  }

  if (currentURL) {
    URL.revokeObjectURL(currentURL);
  }

  currentURL = URL.createObjectURL(file);
  video.pause();
  video.removeAttribute("src");
  video.load();

  setStatus(`Selected: ${file.name}. Loading preview...`);
  exportBtn.disabled = true;
  downloadArea.replaceChildren();
  progress.value = 0;

  try {
    const loaded = waitForEvent(video, "loadedmetadata");
    video.src = currentURL;
    video.load();
    await loaded;

    if (!Number.isFinite(video.duration) || video.duration <= 0) {
      throw new Error("The video duration could not be detected.");
    }

    startInput.max = Math.max(0, video.duration - 0.1);
    startInput.value = "0";

    setStatus(
      `Video ready: ${file.name} | Duration: ${video.duration.toFixed(1)} seconds`
    );
    exportBtn.disabled = false;
    setExportStatus("Your video is ready to edit.");
  } catch (error) {
    setStatus(`Error: ${error.message}`);
    exportBtn.disabled = true;
  }
});

function waitForSeek() {
  if (video.seeking) {
    return waitForEvent(video, "seeked");
  }

  return Promise.resolve();
}

function getRecorderType() {
  const types = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm"
  ];

  return types.find(type => MediaRecorder.isTypeSupported(type)) || "";
}

function drawVerticalFrame(ctx, canvas) {
  const sourceWidth = video.videoWidth;
  const sourceHeight = video.videoHeight;

  if (!sourceWidth || !sourceHeight) return;

  // Fill a 9:16 canvas without stretching the source video.
  const scale = Math.max(
    canvas.width / sourceWidth,
    canvas.height / sourceHeight
  );

  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  const x = (canvas.width - width) / 2;
  const y = (canvas.height - height) / 2;

  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(video, x, y, width, height);
}

function waitUntilPlaying() {
  if (!video.paused) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const onPlaying = () => {
      cleanup();
      resolve();
    };

    const onError = () => {
      cleanup();
      reject(new Error("The video could not start playing."));
    };

    const cleanup = () => {
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("error", onError);
    };

    video.addEventListener("playing", onPlaying, { once: true });
    video.addEventListener("error", onError, { once: true });
  });
}

function stopTracks(stream) {
  if (stream) {
    stream.getTracks().forEach(track => track.stop());
  }
}

async function createClip() {
  if (exporting) return;

  if (!video.src || !Number.isFinite(video.duration)) {
    setExportStatus("Choose a video first.");
    return;
  }

  if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) {
    setExportStatus(
      "Your browser does not support video export. Try the latest Chrome browser."
    );
    return;
  }

  const start = Number(startInput.value);
  const duration = Number(durationInput.value);
  const resolution = Number(qualityInput.value);

  if (
    !Number.isFinite(start) ||
    start < 0 ||
    !Number.isFinite(duration) ||
    ![30, 45, 60].includes(duration) ||
    start + duration > video.duration
  ) {
    setExportStatus(
      `Invalid selection. Choose a start time between 0 and ${Math.max(
        0,
        video.duration - duration
      ).toFixed(1)} seconds. The full clip must fit inside your video.`
    );
    return;
  }

  exporting = true;
  cancelExport = false;
  exportBtn.disabled = true;
  stopBtn.disabled = false;
  video.pause();
  downloadArea.replaceChildren();
  progress.value = 0;

  let canvasStream = null;
  let sourceStream = null;
  let outputStream = null;
  let context = null;
  let chunks = [];
  let finished = false;
  let originalTime = video.currentTime;

  try {
    if (!video.videoWidth || !video.videoHeight) {
      throw new Error("Wait for the video preview to finish loading.");
    }

    if (typeof video.captureStream !== "function" &&
        typeof video.mozCaptureStream !== "function") {
      throw new Error(
        "This browser cannot capture the video's audio. Try an updated desktop Chrome browser."
      );
    }

    setExportStatus("Preparing your vertical video...");

    const width = resolution;
    const height = Math.round(resolution * 16 / 9);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    context = canvas.getContext("2d");

    if (!context) {
      throw new Error("Could not initialize the video canvas.");
    }

    video.currentTime = start;
    await waitForSeek();

    canvasStream = canvas.captureStream(30);

    const capture = video.captureStream || video.mozCaptureStream;
    sourceStream = capture.call(video);

    outputStream = new MediaStream([
      ...canvasStream.getVideoTracks(),
      ...sourceStream.getAudioTracks()
    ]);

    if (!outputStream.getVideoTracks().length) {
      throw new Error("Could not create the output video stream.");
    }

    const mimeType = getRecorderType();
    recorder = new MediaRecorder(
      outputStream,
      mimeType ? { mimeType } : undefined
    );

    chunks = [];

    const recordingFinished = new Promise((resolve, reject) => {
      recorder.addEventListener("dataavailable", event => {
        if (event.data && event.data.size > 0) {
          chunks.push(event.data);
        }
      });

      recorder.addEventListener("stop", () => {
        finished = true;
        resolve();
      }, { once: true });

      recorder.addEventListener("error", event => {
        reject(event.error || new Error("Recording failed."));
      }, { once: true });
    });

    recorder.start(1000);

    drawVerticalFrame(context, canvas);

    const renderFrame = () => {
      if (cancelExport || !exporting) return;

      drawVerticalFrame(context, canvas);

      const elapsed = video.currentTime - start;
      progress.value = Math.min(
        100,
        Math.max(0, elapsed / duration * 100)
      );

      setExportStatus(
        `Creating clip: ${Math.min(duration, Math.max(0, elapsed)).toFixed(1)} / ${duration} seconds`
      );

      if (elapsed >= duration || video.ended) {
        if (recorder && recorder.state !== "inactive") {
          recorder.stop();
        }
        return;
      }

      animationId = requestAnimationFrame(renderFrame);
    };

    await video.play();
    await waitUntilPlaying();

    animationId = requestAnimationFrame(renderFrame);

    // A fallback ensures recording stops even if animation frames pause.
    await new Promise(resolve => {
      const check = () => {
        if (cancelExport || !exporting ||
            video.currentTime >= start + duration ||
            video.ended || recorder?.state === "inactive") {
          if (recorder && recorder.state !== "inactive") {
            recorder.stop();
          }
          resolve();
          return;
        }
        setTimeout(check, 200);
      };
      check();
    });

    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    }

    await recordingFinished;

    if (cancelExport) {
      setExportStatus("Export cancelled.");
      return;
    }

    if (!chunks.length) {
      throw new Error("No video data was produced. Try another video.");
    }

    const outputType = recorder.mimeType || "video/webm";
    const blob = new Blob(chunks, { type: outputType });
    const downloadURL = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = downloadURL;
    link.download = "my-vertical-clip.webm";
    link.textContent = "⬇ Download your vertical clip";
    link.style.fontWeight = "bold";

    downloadArea.replaceChildren(link);
    progress.value = 100;
    setExportStatus(
      `Clip created successfully! File size: ${(blob.size / (1024 * 1024)).toFixed(2)} MB.`
    );
  } catch (error) {
    if (recorder && recorder.state !== "inactive") {
      try { recorder.stop(); } catch {}
    }
    setExportStatus(`Export error: ${error.message}`);
  } finally {
    if (animationId !== null) {
      cancelAnimationFrame(animationId);
      animationId = null;
    }

    video.pause();

    try {
      if (Number.isFinite(originalTime)) {
        video.currentTime = Math.min(originalTime, video.duration);
      }
    } catch {}

    stopTracks(canvasStream);
    stopTracks(sourceStream);
    stopTracks(outputStream);

    recorder = null;
    exporting = false;
    exportBtn.disabled = !video.src;
    stopBtn.disabled = true;
  }
}

exportBtn.addEventListener("click", createClip);

stopBtn.addEventListener("click", () => {
  cancelExport = true;

  if (animationId !== null) {
    cancelAnimationFrame(animationId);
    animationId = null;
  }

  if (recorder && recorder.state !== "inactive") {
    recorder.stop();
  }

  video.pause();
  setExportStatus("Cancelling export...");
});
