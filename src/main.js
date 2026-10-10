
const videoInput = document.getElementById("videoFile");
const video = document.getElementById("video");
const const $ = (id) => document.getElementById(id);

const youtubeUrl = $("youtubeUrl");
const previewYoutube = $("previewYoutube");
const youtubeArea = $("youtubeArea");
const youtubeFrame = $("youtubeFrame");

const videoFile = $("videoFile");
const localArea = $("localArea");
const sourceVideo = $("sourceVideo");

const startTime = $("startTime");
const clipDuration = $("clipDuration");
const outputSize = $("outputSize");
const fitMode = $("fitMode");

const makeClip = $("makeClip");
const stopClip = $("stopClip");
const progress = $("progress");
const status = $("status");
const downloadArea = $("downloadArea");
const canvas = $("renderCanvas");
const ctx = canvas.getContext("2d");

let localVideoUrl = null;
let recorder = null;
let animationId = null;
let exportRunning = false;
let stopRequested = false;
let recordingChunks = [];
let exportStartedAt = 0;
let exportDuration = 0;
let audioStream = null;
let canvasStream = null;
let exportFinished = false;

function setStatus(message) {
  status.textContent = message;
}

function getYouTubeId(rawUrl) {
  try {
    const url = new URL(rawUrl.trim());
    const host = url.hostname.replace(/^www\./, "").toLowerCase();

    if (host === "youtu.be") {
      return url.pathname.split("/").filter(Boolean)[0] || null;
    }

    if (
      host === "youtube.com" ||
      host === "m.youtube.com" ||
      host === "music.youtube.com" ||
      host === "youtube-nocookie.com"
    ) {
      if (url.pathname === "/watch") {
        return url.searchParams.get("v");
      }

      const parts = url.pathname.split("/").filter(Boolean);

      if (
        ["shorts", "embed", "live"].includes(parts[0]) &&
        parts[1]
      ) {
        return parts[1];
      }
    }

    return null;
  } catch {
    return null;
  }
}

function validYouTubeId(id) {
  return typeof id === "string" && /^[a-zA-Z0-9_-]{11}$/.test(id);
}

previewYoutube.addEventListener("click", () => {
  const id = getYouTubeId(youtubeUrl.value);

  if (!id || !validYouTubeId(id)) {
    setStatus("Please enter a valid YouTube video URL.");
    return;
  }

  youtubeFrame.src =
    "https://www.youtube-nocookie.com/embed/" +
    encodeURIComponent(id);

  youtubeArea.classList.remove("hidden");
  setStatus(
    "YouTube preview loaded. Select an authorized local video file to create a clip."
  );
});

youtubeUrl.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    previewYoutube.click();
  }
});

videoFile.addEventListener("change", () => {
  const file = videoFile.files && videoFile.files[0];

  if (!file) {
    return;
  }

  if (!file.type.startsWith("video/")) {
    setStatus("Please select a supported video file.");
    videoFile.value = "";
    return;
  }

  if (exportRunning) {
    setStatus("Wait for the current export to finish first.");
    return;
  }

  if (localVideoUrl) {
    URL.revokeObjectURL(localVideoUrl);
  }

  localVideoUrl = URL.createObjectURL(file);
  sourceVideo.src = localVideoUrl;
  sourceVideo.load();

  localArea.classList.remove("hidden");
  downloadArea.replaceChildren();
  progress.value = 0;

  setStatus("Video selected: " + file.name + ". Loading video details...");
});

sourceVideo.addEventListener("loadedmetadata", () => {
  if (Number.isFinite(sourceVideo.duration)) {
    setStatus(
      "Video ready. Duration: " +
      sourceVideo.duration.toFixed(1) +
      " seconds."
    );
  }
});

sourceVideo.addEventListener("error", () => {
  setStatus(
    "This video could not be opened by your browser. Try MP4 with H.264 video."
  );
});

function seekTo(seconds) {
  return new Promise((resolve, reject) => {
    if (Math.abs(sourceVideo.currentTime - seconds) < 0.05) {
      resolve();
      return;
    }

    const onSeeked = () => {
      cleanup();
      resolve();
    };

    const onError = () => {
      cleanup();
      reject(new Error("Could not seek to the requested start time."));
    };

    const cleanup = () => {
      sourceVideo.removeEventListener("seeked", onSeeked);
      sourceVideo.removeEventListener("error", onError);
    };

    sourceVideo.addEventListener("seeked", onSeeked, { once: true });
    sourceVideo.addEventListener("error", onError, { once: true });

    sourceVideo.currentTime = seconds;
  });
}

function drawFrame() {
  if (!exportRunning) {
    return;
  }

  const videoWidth = sourceVideo.videoWidth;
  const videoHeight = sourceVideo.videoHeight;

  if (videoWidth > 0 && videoHeight > 0) {
    const canvasWidth = canvas.width;
    const canvasHeight = canvas.height;

    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    if (fitMode.value === "crop") {
      const scale = Math.max(
        canvasWidth / videoWidth,
        canvasHeight / videoHeight
      );

      const drawWidth = videoWidth * scale;
      const drawHeight = videoHeight * scale;
      const x = (canvasWidth - drawWidth) / 2;
      const y = (canvasHeight - drawHeight) / 2;

      ctx.drawImage(
        sourceVideo,
        x,
        y,
        drawWidth,
        drawHeight
      );
    } else {
      const scale = Math.min(
        canvasWidth / videoWidth,
        canvasHeight / videoHeight
      );

      const drawWidth = videoWidth * scale;
      const drawHeight = videoHeight * scale;
      const x = (canvasWidth - drawWidth) / 2;
      const y = (canvasHeight - drawHeight) / 2;

      ctx.drawImage(
        sourceVideo,
        x,
        y,
        drawWidth,
        drawHeight
      );
    }
  }

  const elapsed = Math.max(
    0,
    sourceVideo.currentTime - exportStartedAt
  );

  progress.value = Math.min(
    100,
    (elapsed / exportDuration) * 100
  );

  animationId = requestAnimationFrame(drawFrame);
}

function getSupportedMimeType() {
  if (!window.MediaRecorder) {
    return "";
  }

  const types = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm"
  ];

  return types.find((type) =>
    MediaRecorder.isTypeSupported(type)
  ) || "";
}

function releaseStreams() {
  if (canvasStream) {
    canvasStream.getTracks().forEach((track) => track.stop());
    canvasStream = null;
  }

  if (audioStream) {
    audioStream.getTracks().forEach((track) => track.stop());
    audioStream = null;
  }
}

function finishExport() {
  exportRunning = false;
  stopClip.disabled = true;
  makeClip.disabled = false;

  if (animationId !== null) {
    cancelAnimationFrame(animationId);
    animationId = null;
  }

  sourceVideo.pause();
  releaseStreams();
}

makeClip.addEventListener("click", async () => {
  if (exportRunning) {
    return;
  }

  if (!videoFile.files || !videoFile.files[0] || !sourceVideo.src) {
    setStatus("Choose a video file to begin.");
    return;
  }

  if (!sourceVideo.videoWidth || !Number.isFinite(sourceVideo.duration)) {
    setStatus("Wait until the selected video has finished loading.");
    return;
  }

  if (!window.MediaRecorder || !canvas.captureStream) {
    setStatus(
      "Your browser does not support video export. Try a recent desktop Chrome or Edge browser."
    );
    return;
  }

  const start = Number(startTime.value);
  const requestedDuration = Number(clipDuration.value);
  const quality = Number(outputSize.value);

  if (!Number.isFinite(start) || start < 0) {
    setStatus("Enter a valid start time of zero seconds or more.");
    return;
  }

  if (start >= sourceVideo.duration) {
    setStatus("The start time must be before the end of the video.");
    return;
  }

  if (!Number.isFinite(requestedDuration) || requestedDuration <= 0) {
    setStatus("Choose a valid clip duration.");
    return;
  }

  exportDuration = Math.min(
    requestedDuration,
    sourceVideo.duration - start
  );

  if (exportDuration <= 0) {
    setStatus("There is no video remaining at this start time.");
    return;
  }

  canvas.width = quality;
  canvas.height = Math.round(quality * 16 / 9);

  downloadArea.replaceChildren();
  progress.value = 0;
  recordingChunks = [];
  stopRequested = false;
  exportFinished = false;

  makeClip.disabled = true;
  stopClip.disabled = false;
  exportRunning = true;

  setStatus("Preparing your vertical clip...");

  try {
    await seekTo(start);

    sourceVideo.muted = false;

    const captureVideo =
      sourceVideo.captureStream ||
      sourceVideo.mozCaptureStream;

    if (typeof captureVideo === "function") {
      audioStream = captureVideo.call(sourceVideo);
    }

    canvasStream = canvas.captureStream(30);

    const tracks = [...canvasStream.getVideoTracks()];

    if (audioStream) {
      audioStream.getAudioTracks().forEach((track) => {
        tracks.push(track);
      });
    }

    const combinedStream = new MediaStream(tracks);
    const mimeType = getSupportedMimeType();

    if (!mimeType) {
      throw new Error(
        "This browser cannot record WebM video. Try a recent desktop Chrome or Edge browser."
      );
    }

    recorder = new MediaRecorder(combinedStream, {
      mimeType
    });

    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        recordingChunks.push(event.data);
      }
    };

    recorder.onerror = () => {
      setStatus("An error occurred while recording the clip.");
      if (recorder && recorder.state !== "inactive") {
        recorder.stop();
      }
    };

    recorder.onstop = () => {
      finishExport();

      if (recordingChunks.length === 0) {
        setStatus("No video data was recorded. Please try again.");
        return;
      }

      const blob = new Blob(recordingChunks, {
        type: mimeType
      });

      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");

      link.href = url;
      link.download = "clipmaker-vertical-clip.webm";
      link.textContent = "⬇ Download your vertical clip";
      link.style.display = "inline-block";
      link.style.marginTop = "16px";
      link.style.fontWeight = "bold";

      downloadArea.replaceChildren(link);

      setStatus(
        stopRequested
          ? "Export stopped. Download the recorded portion below."
          : "Clip created! Use the download link below."
      );

      progress.value = stopRequested
        ? progress.value
        : 100;

      exportFinished = true;
    };

    exportStartedAt = start;
    drawFrame();

    recorder.start(250);

    await sourceVideo.play();

    setStatus(
      "Creating clip... Keep this page open until recording finishes."
    );

    const endTime = start + exportDuration;

    const checkPlayback = () => {
      if (!exportRunning || !recorder) {
        return;
      }

      if (
        sourceVideo.currentTime >= endTime ||
        sourceVideo.ended
      ) {
        sourceVideo.pause();

        if (recorder.state !== "inactive") {
          recorder.stop();
        }
      } else {
        requestAnimationFrame(checkPlayback);
      }
    };

    checkPlayback();
  } catch (error) {
    console.error(error);

    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    } else {
      finishExport();
    }

    setStatus(
      "Export failed: " +
      (error && error.message
        ? error.message
        : "Unknown error. Try a different video or browser.")
    );
  }
});

stopClip.addEventListener("click", () => {
  if (!exportRunning) {
    return;
  }

  stopRequested = true;
  setStatus("Stopping export...");

  if (recorder && recorder.state !== "inactive") {
    recorder.stop();
  } else {
    finishExport(const $ = (id) => document.getElementById(id);

const youtubeUrl = $("youtubeUrl");
const previewYoutube = $("previewYoutube");
const youtubeArea = $("youtubeArea");
const youtubeFrame = $("youtubeFrame");

const videoFile = $("videoFile");
const localArea = $("localArea");
const sourceVideo = $("sourceVideo");

const startTime = $("startTime");
const clipDuration = $("clipDuration");
const outputSize = $("outputSize");
const fitMode = $("fitMode");

const makeClip = $("makeClip");
const stopClip = $("stopClip");
const progress = $("progress");
const status = $("status");
const downloadArea = $("downloadArea");
const canvas = $("renderCanvas");
const ctx = canvas.getContext("2d");

let localVideoUrl = null;
let recorder = null;
let animationId = null;
let exportRunning = false;
let stopRequested = false;
let recordingChunks = [];
let exportStartedAt = 0;
let exportDuration = 0;
let audioStream = null;
let canvasStream = null;
let exportFinished = false;

function setStatus(message) {
  status.textContent = message;
}

function getYouTubeId(rawUrl) {
  try {
    const url = new URL(rawUrl.trim());
    const host = url.hostname.replace(/^www\./, "").toLowerCase();

    if (host === "youtu.be") {
      return url.pathname.split("/").filter(Boolean)[0] || null;
    }

    if (
      host === "youtube.com" ||
      host === "m.youtube.com" ||
      host === "music.youtube.com" ||
      host === "youtube-nocookie.com"
    ) {
      if (url.pathname === "/watch") {
        return url.searchParams.get("v");
      }

      const parts = url.pathname.split("/").filter(Boolean);

      if (
        ["shorts", "embed", "live"].includes(parts[0]) &&
        parts[1]
      ) {
        return parts[1];
      }
    }

    return null;
  } catch {
    return null;
  }
}

function validYouTubeId(id) {
  return typeof id === "string" && /^[a-zA-Z0-9_-]{11}$/.test(id);
}

previewYoutube.addEventListener("click", () => {
  const id = getYouTubeId(youtubeUrl.value);

  if (!id || !validYouTubeId(id)) {
    setStatus("Please enter a valid YouTube video URL.");
    return;
  }

  youtubeFrame.src =
    "https://www.youtube-nocookie.com/embed/" +
    encodeURIComponent(id);

  youtubeArea.classList.remove("hidden");
  setStatus(
    "YouTube preview loaded. Select an authorized local video file to create a clip."
  );
});

youtubeUrl.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    previewYoutube.click();
  }
});

videoFile.addEventListener("change", () => {
  const file = videoFile.files && videoFile.files[0];

  if (!file) {
    return;
  }

  if (!file.type.startsWith("video/")) {
    setStatus("Please select a supported video file.");
    videoFile.value = "";
    return;
  }

  if (exportRunning) {
    setStatus("Wait for the current export to finish first.");
    return;
  }

  if (localVideoUrl) {
    URL.revokeObjectURL(localVideoUrl);
  }

  localVideoUrl = URL.createObjectURL(file);
  sourceVideo.src = localVideoUrl;
  sourceVideo.load();

  localArea.classList.remove("hidden");
  downloadArea.replaceChildren();
  progress.value = 0;

  setStatus("Video selected: " + file.name + ". Loading video details...");
});

sourceVideo.addEventListener("loadedmetadata", () => {
  if (Number.isFinite(sourceVideo.duration)) {
    setStatus(
      "Video ready. Duration: " +
      sourceVideo.duration.toFixed(1) +
      " seconds."
    );
  }
});

sourceVideo.addEventListener("error", () => {
  setStatus(
    "This video could not be opened by your browser. Try MP4 with H.264 video."
  );
});

function seekTo(seconds) {
  return new Promise((resolve, reject) => {
    if (Math.abs(sourceVideo.currentTime - seconds) < 0.05) {
      resolve();
      return;
    }

    const onSeeked = () => {
      cleanup();
      resolve();
    };

    const onError = () => {
      cleanup();
      reject(new Error("Could not seek to the requested start time."));
    };

    const cleanup = () => {
      sourceVideo.removeEventListener("seeked", onSeeked);
      sourceVideo.removeEventListener("error", onError);
    };

    sourceVideo.addEventListener("seeked", onSeeked, { once: true });
    sourceVideo.addEventListener("error", onError, { once: true });

    sourceVideo.currentTime = seconds;
  });
}

function drawFrame() {
  if (!exportRunning) {
    return;
  }

  const videoWidth = sourceVideo.videoWidth;
  const videoHeight = sourceVideo.videoHeight;

  if (videoWidth > 0 && videoHeight > 0) {
    const canvasWidth = canvas.width;
    const canvasHeight = canvas.height;

    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    if (fitMode.value === "crop") {
      const scale = Math.max(
        canvasWidth / videoWidth,
        canvasHeight / videoHeight
      );

      const drawWidth = videoWidth * scale;
      const drawHeight = videoHeight * scale;
      const x = (canvasWidth - drawWidth) / 2;
      const y = (canvasHeight - drawHeight) / 2;

      ctx.drawImage(
        sourceVideo,
        x,
        y,
        drawWidth,
        drawHeight
      );
    } else {
      const scale = Math.min(
        canvasWidth / videoWidth,
        canvasHeight / videoHeight
      );

      const drawWidth = videoWidth * scale;
      const drawHeight = videoHeight * scale;
      const x = (canvasWidth - drawWidth) / 2;
      const y = (canvasHeight - drawHeight) / 2;

      ctx.drawImage(
        sourceVideo,
        x,
        y,
        drawWidth,
        drawHeight
      );
    }
  }

  const elapsed = Math.max(
    0,
    sourceVideo.currentTime - exportStartedAt
  );

  progress.value = Math.min(
    100,
    (elapsed / exportDuration) * 100
  );

  animationId = requestAnimationFrame(drawFrame);
}

function getSupportedMimeType() {
  if (!window.MediaRecorder) {
    return "";
  }

  const types = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm"
  ];

  return types.find((type) =>
    MediaRecorder.isTypeSupported(type)
  ) || "";
}

function releaseStreams() {
  if (canvasStream) {
    canvasStream.getTracks().forEach((track) => track.stop());
    canvasStream = null;
  }

  if (audioStream) {
    audioStream.getTracks().forEach((track) => track.stop());
    audioStream = null;
  }
}

function finishExport() {
  exportRunning = false;
  stopClip.disabled = true;
  makeClip.disabled = false;

  if (animationId !== null) {
    cancelAnimationFrame(animationId);
    animationId = null;
  }

  sourceVideo.pause();
  releaseStreams();
}

makeClip.addEventListener("click", async () => {
  if (exportRunning) {
    return;
  }

  if (!videoFile.files || !videoFile.files[0] || !sourceVideo.src) {
    setStatus("Choose a video file to begin.");
    return;
  }

  if (!sourceVideo.videoWidth || !Number.isFinite(sourceVideo.duration)) {
    setStatus("Wait until the selected video has finished loading.");
    return;
  }

  if (!window.MediaRecorder || !canvas.captureStream) {
    setStatus(
      "Your browser does not support video export. Try a recent desktop Chrome or Edge browser."
    );
    return;
  }

  const start = Number(startTime.value);
  const requestedDuration = Number(clipDuration.value);
  const quality = Number(outputSize.value);

  if (!Number.isFinite(start) || start < 0) {
    setStatus("Enter a valid start time of zero seconds or more.");
    return;
  }

  if (start >= sourceVideo.duration) {
    setStatus("The start time must be before the end of the video.");
    return;
  }

  if (!Number.isFinite(requestedDuration) || requestedDuration <= 0) {
    setStatus("Choose a valid clip duration.");
    return;
  }

  exportDuration = Math.min(
    requestedDuration,
    sourceVideo.duration - start
  );

  if (exportDuration <= 0) {
    setStatus("There is no video remaining at this start time.");
    return;
  }

  canvas.width = quality;
  canvas.height = Math.round(quality * 16 / 9);

  downloadArea.replaceChildren();
  progress.value = 0;
  recordingChunks = [];
  stopRequested = false;
  exportFinished = false;

  makeClip.disabled = true;
  stopClip.disabled = false;
  exportRunning = true;

  setStatus("Preparing your vertical clip...");

  try {
    await seekTo(start);

    sourceVideo.muted = false;

    const captureVideo =
      sourceVideo.captureStream ||
      sourceVideo.mozCaptureStream;

    if (typeof captureVideo === "function") {
      audioStream = captureVideo.call(sourceVideo);
    }

    canvasStream = canvas.captureStream(30);

    const tracks = [...canvasStream.getVideoTracks()];

    if (audioStream) {
      audioStream.getAudioTracks().forEach((track) => {
        tracks.push(track);
      });
    }

    const combinedStream = new MediaStream(tracks);
    const mimeType = getSupportedMimeType();

    if (!mimeType) {
      throw new Error(
        "This browser cannot record WebM video. Try a recent desktop Chrome or Edge browser."
      );
    }

    recorder = new MediaRecorder(combinedStream, {
      mimeType
    });

    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        recordingChunks.push(event.data);
      }
    };

    recorder.onerror = () => {
      setStatus("An error occurred while recording the clip.");
      if (recorder && recorder.state !== "inactive") {
        recorder.stop();
      }
    };

    recorder.onstop = () => {
      finishExport();

      if (recordingChunks.length === 0) {
        setStatus("No video data was recorded. Please try again.");
        return;
      }

      const blob = new Blob(recordingChunks, {
        type: mimeType
      });

      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");

      link.href = url;
      link.download = "clipmaker-vertical-clip.webm";
      link.textContent = "⬇ Download your vertical clip";
      link.style.display = "inline-block";
      link.style.marginTop = "16px";
      link.style.fontWeight = "bold";

      downloadArea.replaceChildren(link);

      setStatus(
        stopRequested
          ? "Export stopped. Download the recorded portion below."
          : "Clip created! Use the download link below."
      );

      progress.value = stopRequested
        ? progress.value
        : 100;

      exportFinished = true;
    };

    exportStartedAt = start;
    drawFrame();

    recorder.start(250);

    await sourceVideo.play();

    setStatus(
      "Creating clip... Keep this page open until recording finishes."
    );

    const endTime = start + exportDuration;

    const checkPlayback = () => {
      if (!exportRunning || !recorder) {
        return;
      }

      if (
        sourceVideo.currentTime >= endTime ||
        sourceVideo.ended
      ) {
        sourceVideo.pause();

        if (recorder.state !== "inactive") {
          recorder.stop();
        }
      } else {
        requestAnimationFrame(checkPlayback);
      }
    };

    checkPlayback();
  } catch (error) {
    console.error(error);

    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    } else {
      finishExport();
    }

    setStatus(
      "Export failed: " +
      (error && error.message
        ? error.message
        : "Unknown error. Try a different video or browser.")
    );
  }
});

stopClip.addEventListener("click", () => {
  if (!exportRunning) {
    return;
  }

  stopRequested = true;
  setStatus("Stopping export...");

  if (recorder && recorder.state !== "inactive") {
    recorder.stop();
  } else {
    finishExport();
  }
});

window.addEventListener("beforeunload", () => {
  if (localVideoUrl) {
    URL.revokeObjectURL(localVideoUrl);
  }
});use();

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
