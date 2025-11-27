const { createFFmpeg, fetchFile } = FFmpeg;

const ffmpeg = createFFmpeg({
    log: true
});

ffmpeg.load();

async function runFFmpeg() {
    await ffmpeg.FS("writeFile", "input.mp4", await fetchFile("input.mp4"));
    await ffmpeg.run("-i", "input.mp4", "output.webm");
    const data = ffmpeg.FS("readFile", "output.webm");
    console.log("Done", data);
}

const argList = document.getElementById("arg-list");
const addArg = document.getElementById("add-arg");
const runBtn = document.getElementById("run");

function addArgument() {
	const row = document.createElement("div");
    row.className = "arg-row";

    const keyInput = document.createElement("input");
    keyInput.placeholder = "Argument name";

    const valueInput = document.createElement("input");
    valueInput.placeholder = "Value";

    const removeBtn = document.createElement("button");
    removeBtn.textContent = "X";

    removeBtn.onclick = () => row.remove();

    row.appendChild(keyInput);
    row.appendChild(valueInput);
    row.appendChild(removeBtn);

    argList.appendChild(row);
}

async function run() {
    // Ensure FFmpeg is loaded
    if (!ffmpeg.isLoaded()) {
        await ffmpeg.load();
    }

    // Clear previous output
    console.clear();

    // Read all argument rows
    const rows = document.querySelectorAll(".arg-row");
    const args = [];

    rows.forEach(row => {
        const key = row.children[0].value.trim();
        const value = row.children[1].value.trim();

        if (key && value) {
            args.push(key, value);
        } else if (key) {
            args.push(key);
        }
    });

    // Write input file
    await ffmpeg.FS("writeFile", "input.mp4", await fetchFile("input.mp4"));

    // Build full command: ffmpeg <dynamic args> input output
    const finalArgs = [...args, "-i", "input.mp4", "output.webm"];

    console.log("Running FFmpeg with args:", finalArgs);

    // Execute
    await ffmpeg.run(...finalArgs);

    // Retrieve output
    const data = ffmpeg.FS("readFile", "output.webm");

    console.log("Conversion complete:", data);
}

addArg.addEventListener("click", addArgument);
runBtn.addEventListener("click", run);
