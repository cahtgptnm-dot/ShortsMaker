
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";

const fileInput = document.querySelector("#video");
const startButton = document.querySelector("#start");
const status = document.querySelector("#status");
const output = document.querySelector("#output");

let selectedFile;

fileInput.addEventListener("change", () => {
  selectedFile = fileInput.files[0];
  if (selectedFile) {
    status.textContent = `Selected: ${selectedFile.name}`;
  }
});

startButton.addEventListener("click", async () => {
  if (!selectedFile) {
    status.textContent = "Choose a video first.";
    return;
  }

  startButton.disabled = true;

  try {
    status.textContent = "Loading video engine…";

    const ffmpeg = new FFmpeg();
    const base = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd";

    ffmpeg.on("log", ({ message }) => {
      status.textContent = message;
    });

    await ffmpeg.load({
      coreURL: await toBlobURL(`${base}/ffmpeg-core.js`, "text/javascript"),
      wasmURL: await toBlobURL(`${base}/ffmpeg-core.wasm`, "application/wasm"),
    });

    status.textContent = "Preparing video…";
    await ffmpeg.writeFile("input.mp4", await fetchFile(selectedFile));

    await ffmpeg.exec([
      "-i", "input.mp4",
      "-t", "60",
      "-vf", "scale=ih*9/16:ih,crop=iw:ih,scale=720:1280",
      "-c:v", "libx264",
      "-preset", "ultrafast",
      "-c:a", "aac",
      "-movflags", "+faststart",
      "output.mp4"
    ]);

    const data = await ffmpeg.readFile("output.mp4");
    const url = URL.createObjectURL(
      new Blob([data], { type: "video/mp4" })
    );

    output.href = url;
    output.download = "shortsmaker.mp4";
    output.hidden = false;
    output.textContent = "Download your vertical video";

    status.textContent = "Finished!";
  } catch (error) {
    status.textContent = `Error: ${error.message}`;
  } finally {
    startButton.disabled = false;
  }
});

