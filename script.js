const getElementById = document.getElementById.bind(document);
const getElementsByTagName = document.getElementsByTagName.bind(document);
const createElement = document.createElement.bind(document);

const BITRATE_OPTIONS = [
    { text: "320kbps", value: 320 },
    { text: "192kbps", value: 192 },
    { text: "128kbps", value: 128 }
];

const SAMPLE_RATE_OPTIONS = [
    { text: "48kHz", value: 48000 },
    { text: "44.1kHz", value: 44100 }
];

function createSelectElement(options) {
    const selectElem = createElement("select");
    for (let option of options) {
        const optionElem = createElement("option");
        optionElem.value = option.value;
        optionElem.textContent = option.text;
        selectElem.appendChild(optionElem);
    }
    return selectElem;
}

function decodeWav(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    const view = new DataView(arrayBuffer);

    let offset = 0;

    function readString(len) {
        let s = "";
        for (let i = 0; i < len; i++) {
            s += String.fromCharCode(bytes[offset + i]);
        }
        offset += len;
        return s;
    }

    function readUint32() {
        const value = view.getUint32(offset, true);
        offset += 4;
        return value;
    }

    function readUint16() {
        const value = view.getUint16(offset, true);
        offset += 2;
        return value;
    }

    const chunkID = readString(4);
    const chunkSize = readUint32();
    const format = readString(4);

    if (chunkID !== "RIFF" || format !== "WAVE") {
        throw new Error("Not a valid WAV file.");
    }

    let fmt = null;
    let data = null;

    while (offset < bytes.length) {
        const subchunkID = readString(4);
        const subchunkSize = readUint32();

        if (subchunkID === "fmt ") {
            const audioFormat = readUint16();
            const numChannels = readUint16();
            const sampleRate = readUint32();
            const byteRate = readUint32();
            const blockAlign = readUint16();
            const bitsPerSample = readUint16();

            offset += subchunkSize - 16;

            fmt = {
                audioFormat,
                numChannels,
                sampleRate,
                byteRate,
                blockAlign,
                bitsPerSample
            };
        } else if (subchunkID === "data") {
            const start = offset;
            const end = offset + subchunkSize;
            data = bytes.subarray(start, end);
            offset = end;
        } else {
            offset += subchunkSize;
        }

        if (subchunkSize % 2 === 1) {
            offset += 1;
        }
    }

    if (!fmt || !data) {
        throw new Error("WAV file missing fmt or data chunk.");
    }

    if (fmt.audioFormat !== 1) {
        throw new Error("Only PCM (audioFormat 1) is supported.");
    }

    const bytesPerSample = fmt.bitsPerSample / 8;
    if (!Number.isInteger(bytesPerSample)) {
        throw new Error("Unsupported bitsPerSample: " + fmt.bitsPerSample);
    }

    const frameSize = bytesPerSample * fmt.numChannels;
    const numFrames = Math.floor(data.length / frameSize);

    const channels = [];
    for (let ch = 0; ch < fmt.numChannels; ch++) {
        channels[ch] = new Float32Array(numFrames);
    }

    const samplesView = new DataView(data.buffer, data.byteOffset, data.byteLength);
    let byteOffset = 0;

    for (let i = 0; i < numFrames; i++) {
        for (let ch = 0; ch < fmt.numChannels; ch++) {
            let sample;

            switch (fmt.bitsPerSample) {
                case 8: {
                    const v = samplesView.getUint8(byteOffset);
                    sample = (v - 128) / 128;
                    byteOffset += 1;
                    break;
                }
                case 16: {
                    const v = samplesView.getInt16(byteOffset, true);
                    sample = v / 32768;
                    byteOffset += 2;
                    break;
                }
                case 24: {
                    const b0 = samplesView.getUint8(byteOffset);
                    const b1 = samplesView.getUint8(byteOffset + 1);
                    const b2 = samplesView.getUint8(byteOffset + 2);
                    let v = b0 | (b1 << 8) | (b2 << 16);
                    if (v & 0x800000) {
                        v |= 0xFF000000;
                    }
                    sample = v / 8388608;
                    byteOffset += 3;
                    break;
                }
                case 32: {
                    const v = samplesView.getInt32(byteOffset, true);
                    sample = v / 2147483648;
                    byteOffset += 4;
                    break;
                }
                default:
                    throw new Error("Unsupported bitsPerSample: " + fmt.bitsPerSample);
            }

            channels[ch][i] = sample;
        }
    }

    const pcm = {
        sampleRate: fmt.sampleRate,
        numChannels: fmt.numChannels,
        length: numFrames,
        channels
    };

    return { fmt, data, pcm };
}

function encodeMp3(wav, bitrateKbps) {
    const numChannels = wav.pcm.numChannels;
    const sampleRate = wav.pcm.sampleRate;
    const samplesPerChannel = wav.pcm.length;
    const samplesLeft = wav.pcm.channels[0];
    const samplesRight = numChannels > 1 ? wav.pcm.channels[1] : null;

    const mp3encoder = new lamejs.Mp3Encoder(numChannels, sampleRate, bitrateKbps);
    const mp3Data = [];
    const maxSamples = 1152;

    let i = 0;
    while (i < samplesPerChannel) {
        const leftChunk = samplesLeft.subarray(i, i + maxSamples);
        const leftBuffer = new Int16Array(leftChunk.length);
        for (let j = 0; j < leftChunk.length; j++) {
            let s = Math.max(-1, Math.min(1, leftChunk[j]));
            leftBuffer[j] = s < 0 ? s * 32768 : s * 32767;
        }

        let mp3buf;
        if (numChannels === 2 && samplesRight) {
            const rightChunk = samplesRight.subarray(i, i + maxSamples);
            const rightBuffer = new Int16Array(rightChunk.length);
            for (let j = 0; j < rightChunk.length; j++) {
                let s = Math.max(-1, Math.min(1, rightChunk[j]));
                rightBuffer[j] = s < 0 ? s * 32768 : s * 32767;
            }
            mp3buf = mp3encoder.encodeBuffer(leftBuffer, rightBuffer);
        } else {
            mp3buf = mp3encoder.encodeBuffer(leftBuffer);
        }

        if (mp3buf.length > 0) {
            mp3Data.push(mp3buf);
        }

        i += maxSamples;
    }

    const mp3buf = mp3encoder.flush();
    if (mp3buf.length > 0) {
        mp3Data.push(mp3buf);
    }

    return new Blob(mp3Data, { type: "audio/mpeg" });
}

function stringToUtf16WithBomBytes(str) {
    const codeUnits = new Uint16Array(str.length + 1);
    codeUnits[0] = 0xfeff;
    for (let i = 0; i < str.length; i++) {
        codeUnits[i + 1] = str.charCodeAt(i);
    }
    const bytes = new Uint8Array(codeUnits.length * 2);
    const view = new DataView(bytes.buffer);
    for (let i = 0; i < codeUnits.length; i++) {
        view.setUint16(i * 2, codeUnits[i], true);
    }
    return bytes;
}

function createTextFrame(frameId, text) {
    const textBytes = stringToUtf16WithBomBytes(text);
    const size = textBytes.length + 1;
    const frame = new Uint8Array(10 + size);
    frame[0] = frameId.charCodeAt(0);
    frame[1] = frameId.charCodeAt(1);
    frame[2] = frameId.charCodeAt(2);
    frame[3] = frameId.charCodeAt(3);
    frame[4] = (size >>> 24) & 0xff;
    frame[5] = (size >>> 16) & 0xff;
    frame[6] = (size >>> 8) & 0xff;
    frame[7] = size & 0xff;
    frame[8] = 0;
    frame[9] = 0;
    frame[10] = 1;
    frame.set(textBytes, 11);
    return frame;
}

function encodeSynchsafe(size) {
    const out = new Uint8Array(4);
    out[0] = (size >>> 21) & 0x7f;
    out[1] = (size >>> 14) & 0x7f;
    out[2] = (size >>> 7) & 0x7f;
    out[3] = size & 0x7f;
    return out;
}

function createId3v23Tag(title, artist) {
    const frames = [];
    if (title && title.length > 0) {
        frames.push(createTextFrame("TIT2", title));
    }
    if (artist && artist.length > 0) {
        frames.push(createTextFrame("TPE1", artist));
    }
    let framesSize = 0;
    for (let f of frames) {
        framesSize += f.length;
    }
    const header = new Uint8Array(10);
    header[0] = 0x49;
    header[1] = 0x44;
    header[2] = 0x33;
    header[3] = 3;
    header[4] = 0;
    header[5] = 0;
    const sizeBytes = encodeSynchsafe(framesSize);
    header[6] = sizeBytes[0];
    header[7] = sizeBytes[1];
    header[8] = sizeBytes[2];
    header[9] = sizeBytes[3];
    const tag = new Uint8Array(10 + framesSize);
    tag.set(header, 0);
    let offset = 10;
    for (let f of frames) {
        tag.set(f, offset);
        offset += f.length;
    }
    return tag;
}

document.addEventListener("DOMContentLoaded", async function () {
    const jsErrorElem = getElementById("javascript-error");
    if (jsErrorElem) {
        jsErrorElem.remove();
    }

    const fileInputLabel = createElement("label");
    fileInputLabel.id = "file_input_label";
    fileInputLabel.htmlFor = "file_input";
    fileInputLabel.textContent = "Choose File";

    const fileInput = createElement("input");
    fileInput.type = "file";
    fileInput.id = "file_input";

    const bitrateSelectLabel = createElement("label");
    bitrateSelectLabel.htmlFor = "bitrate_select";
    bitrateSelectLabel.textContent = "Bitrate";

    const bitrateSelect = createSelectElement(BITRATE_OPTIONS);
    bitrateSelect.id = "bitrate_select";
    
    const titleInputLabel = createElement("label");
    titleInputLabel.htmlFor = "title_input";
    titleInputLabel.textContent = "Title";
    
    const titleInput = createElement("input");
    titleInput.type = "text";
    titleInput.id = "title_input";
    titleInput.placeholder = "Wasted (feat. Lil Uzi Vert)";
    
    const artistInputLabel = createElement("label");
    artistInputLabel.htmlFor = "artist_input";
    artistInputLabel.textContent = "Artist(s)";
    
    const artistInput = createElement("input");
    artistInput.type = "text";
    artistInput.id = "artist_input";
    artistInput.placeholder = "Juice WRLD, Lil Uzi Vert";

    const convertButton = createElement("button");
    convertButton.id = "convert_button";
    convertButton.textContent = "Convert to MP3";

    convertButton.addEventListener("click", async () => {
        const file = fileInput.files[0];
        if (!file) {
            return;
        }
        const arrayBuffer = await file.arrayBuffer();
        const wav = decodeWav(arrayBuffer);
        const mp3Blob = encodeMp3(wav, Number(bitrateSelect.value));
        const baseName = file.name.replace(/\.[^/.]+$/, "");
        const mp3Filename = baseName + ".mp3";
        const title = titleInput.value && titleInput.value.length > 0 ? titleInput.value : baseName;
        const artist = artistInput.value || "";
        const id3Tag = createId3v23Tag(title, artist);
        const taggedMp3Blob = new Blob([id3Tag, mp3Blob], { type: "audio/mpeg" });
        const url = URL.createObjectURL(taggedMp3Blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = mp3Filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    });
    
    const inputRows = [
        [fileInputLabel, fileInput],
        [bitrateSelectLabel, bitrateSelect],
        [titleInputLabel, titleInput],
        [artistInputLabel, artistInput],
        [convertButton]
    ];
    
    const divs = [];
    
    for (let inputRow of inputRows) {
        const div = createElement("div");
        div.className = "input-row";
        div.append(...inputRow);
        divs.push(div);
    }

    const mainElem = getElementsByTagName("main")[0];
    mainElem.append(...divs);
});

if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
        navigator.serviceWorker.register("/service-worker.js");
    });
}