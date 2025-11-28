const fileInput = document.getElementById("file");
const convertBtn = document.getElementById("convert");

let selectedFile = null;

fileInput.addEventListener("change", (event) => {
    selectedFile = event.target.files[0] || null;
});

function parseWav(arrayBuffer) {
    const dataView = new DataView(arrayBuffer);

    function readUint16(offset) {
        return dataView.getUint16(offset, true);
    }

    function readUint32(offset) {
        return dataView.getUint32(offset, true);
    }

    function readString(offset, length) {
        let str = "";
        for (let i = 0; i < length; i++) {
            str += String.fromCharCode(dataView.getUint8(offset + i));
        }
        return str;
    }

    if (readString(0, 4) !== "RIFF") {
        throw new Error("Not a RIFF file.");
    }

    if (readString(8, 4) !== "WAVE") {
        throw new Error("Not a WAVE file.");
    }

    let offset = 12;

    let numChannels = null;
    let sampleRate = null;
    let bitsPerSample = null;
    let dataOffset = null;
    let dataSize = null;

    while (offset + 8 <= dataView.byteLength) {
        const chunkId = readString(offset, 4);
        const chunkSize = readUint32(offset + 4);
        const chunkDataOffset = offset + 8;

        if (chunkId === "fmt ") {
            const audioFormat = readUint16(chunkDataOffset + 0);
            numChannels = readUint16(chunkDataOffset + 2);
            sampleRate = readUint32(chunkDataOffset + 4);
            bitsPerSample = readUint16(chunkDataOffset + 14);

            if (audioFormat !== 1) {
                throw new Error("Only PCM WAV is supported.");
            }

            if (bitsPerSample !== 16) {
                throw new Error("Only 16-bit WAV is supported in this demo.");
            }
        } else if (chunkId === "data") {
            dataOffset = chunkDataOffset;
            dataSize = chunkSize;
            break;
        }

        offset += 8 + chunkSize;
    }

    if (dataOffset == null || dataSize == null) {
        throw new Error("No data chunk found in WAV.");
    }

    if (numChannels == null || sampleRate == null || bitsPerSample == null) {
        throw new Error("Invalid or missing fmt chunk in WAV.");
    }

    const samples = new Int16Array(arrayBuffer, dataOffset, dataSize / 2);

    return {
        samples,
        sampleRate,
        channels: numChannels,
        bitsPerSample
    };
}

async function convert() {
    if (selectedFile === null) return;

    try {
        const arrayBuffer = await selectedFile.arrayBuffer();
        const wavData = parseWav(arrayBuffer);
        console.log("Parsed WAV data:", wavData);
    } catch (err) {
        console.error("Conversion error:", err);
        alert(err.message || String(err));
    }
}

convertBtn.addEventListener("click", convert);