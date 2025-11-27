const { createFFmpeg, fetchFile } = FFmpeg;

const ffmpeg = createFFmpeg({
    log: true,
    corePath: "https://unpkg.com/@ffmpeg/core@0.11.0/dist/ffmpeg-core.js"
});

async function runFFmpeg() {
    await ffmpeg.load();
    // Example: convert input.mp4 → output.webm
    await ffmpeg.FS("writeFile", "input.mp4", await fetchFile("input.mp4"));
    await ffmpeg.run("-i", "input.mp4", "output.webm");
    const data = ffmpeg.FS("readFile", "output.webm");
    console.log("Done", data);
}
