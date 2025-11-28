const fileInput = document.getElementById("file");
const bitrateInput = document.getElementById("bitrate");
const convertBtn = document.getElementById("convert");

let selectedFile = null;

fileInput.addEventListener("change", (event) => {
    selectedFile = event.target.files[0] || null;
});

function triggerDownload(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

function encodeMp3(samples, sampleRate, numChannels) {
    const bitrate = bitrateInput.value;
    const encoder = new lamejs.Mp3Encoder(numChannels, sampleRate, bitrate);
    const blockSize = 1152;
    const mp3Data = [];
    
    if (numChannels === 1) {
        for (let i = 0; i < samples.length; i += blockSize) {
            const chunk = samples.subarray(i, i + blockSize);
            const mp3buf = encoder.encodeBuffer(chunk);
            if (mp3buf.length > 0) {
                mp3Data.push(mp3buf);
            }
        }
    } else if (numChannels === 2) {
        const frameCount = samples.length / 2;
        const left = new Int16Array(frameCount);
        const right = new Int16Array(frameCount);

        for (let i = 0, j = 0; i < samples.length; i += 2, j++) {
            left[j] = samples[i];
            right[j] = samples[i + 1];
        }

        for (let i = 0; i < frameCount; i += blockSize) {
            const leftChunk = left.subarray(i, i + blockSize);
            const rightChunk = right.subarray(i, i + blockSize);
            const mp3buf = encoder.encodeBuffer(leftChunk, rightChunk);
            if (mp3buf.length > 0) {
                mp3Data.push(mp3buf);
            }
        }
    } else {
        throw new Error("Only mono or stereo WAV is supported.");
    }

    const flush = encoder.flush();
    if (flush.length > 0) {
        mp3Data.push(flush);
    }

    return new Blob(mp3Data, { type: "audio/mpeg" });
}

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
                throw new Error("Only linear PCM WAV is supported.");
            }

            if (bitsPerSample !== 16 && bitsPerSample !== 24) {
                throw new Error("Only 16-bit or 24-bit WAV is supported.");
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

    const bytesPerSample = bitsPerSample / 8;
    const totalSamples = dataSize / bytesPerSample;
    let samples;

    if (bitsPerSample === 16) {
        samples = new Int16Array(arrayBuffer, dataOffset, totalSamples);
    } else if (bitsPerSample === 24) {
        samples = new Int16Array(totalSamples);
        let sampleIndex = 0;
        for (let i = 0; i < dataSize; i += 3) {
            const b0 = dataView.getUint8(dataOffset + i);
            const b1 = dataView.getUint8(dataOffset + i + 1);
            const b2 = dataView.getUint8(dataOffset + i + 2);
            let value = b0 | (b1 << 8) | (b2 << 16);
            if (value & 0x800000) {
                value |= 0xff000000;
            }
            samples[sampleIndex++] = value >> 8;
        }
    } else {
        throw new Error("Unsupported bits per sample.");
    }

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
        const mp3Blob = encodeMp3(wavData.samples, wavData.sampleRate, wavData.channels);

        const baseName = selectedFile.name.replace(/\.[^.]+$/i, "");
        const fileName = baseName + ".mp3";
        
        triggerDownload(mp3Blob, fileName);
    } catch (err) {
        console.error("Conversion error:", err);
        alert(err.message || String(err));
    }
}

convertBtn.addEventListener("click", convert);