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

addArg.addEventListener("click", addArgument);