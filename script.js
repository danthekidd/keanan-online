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
    let audioFormat = null;
    let dataOffset = null;
    let dataSize = null;

    while (offset + 8 <= dataView.byteLength) {
        const chunkId = readString(offset, 4);
        const chunkSize = readUint32(offset + 4);
        const chunkDataOffset = offset + 8;

        if (chunkId === "fmt ") {
            audioFormat = readUint16(chunkDataOffset + 0);
            numChannels = readUint16(chunkDataOffset + 2);
            sampleRate = readUint32(chunkDataOffset + 4);
            bitsPerSample = readUint16(chunkDataOffset + 14);
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

    if (numChannels == null || sampleRate == null || bitsPerSample == null || audioFormat == null) {
        throw new Error("Invalid or missing fmt chunk in WAV.");
    }
    
    console.log(audioFormat);

    if (audioFormat !== 1 && audioFormat !== 3 && audioFormat !== 6 && audioFormat !== 7) {
        throw new Error("Unsupported WAV format. Supported: PCM (1), IEEE float (3), A-law (6), μ-law (7).");
    }

    let samples;

    if (audioFormat === 1) {
        const bytesPerSample = bitsPerSample / 8;
        const totalSamples = dataSize / bytesPerSample;

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
            throw new Error("Unsupported PCM bits per sample. Only 16-bit and 24-bit.");
        }
    } else if (audioFormat === 3) {
        if (bitsPerSample !== 32) {
            throw new Error("Only 32-bit float WAV is supported for IEEE float.");
        }
        const floatSamples = new Float32Array(arrayBuffer, dataOffset, dataSize / 4);
        samples = new Int16Array(floatSamples.length);
        for (let i = 0; i < floatSamples.length; i++) {
            let v = floatSamples[i];
            if (v > 1) v = 1;
            if (v < -1) v = -1;
            samples[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
        }
    } else if (audioFormat === 6 || audioFormat === 7) {
        const totalSamples = dataSize;
        samples = new Int16Array(totalSamples);
        for (let i = 0; i < totalSamples; i++) {
            const byte = dataView.getUint8(dataOffset + i);
            if (audioFormat === 7) {
                samples[i] = decodeMuLaw(byte);
            } else {
                samples[i] = decodeALaw(byte);
            }
        }
    } else {
        throw new Error("Unsupported audio format.");
    }

    return {
        samples,
        sampleRate,
        channels: numChannels,
        bitsPerSample
    };
}

function decodeMuLaw(muByte) {
    const MULAW_EXP_LUT16 = [0, 132, 396, 924, 1980, 4092, 8316, 16764];
    let mu = ~muByte & 0xff;
    const sign = mu & 0x80;
    const exponent = (mu >> 4) & 0x07;
    const mantissa = mu & 0x0f;
    let sample = MULAW_EXP_LUT16[exponent] + (mantissa << (exponent + 3));
    if (sign) sample = -sample;
    return sample;
}

function decodeALaw(aByte) {
    let a = aByte ^ 0x55;
    let sign = a & 0x80;
    let exponent = (a >> 4) & 0x07;
    let mantissa = a & 0x0f;
    let sample;
    if (exponent > 0) {
        sample = ((mantissa << 4) + 0x100) << (exponent - 1);
    } else {
        sample = (mantissa << 4) + 8;
    }
    if (!sign) {
        sample = -sample;
    }
    return sample;
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