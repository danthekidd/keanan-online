const getElementById = document.getElementById.bind(document);
const createElement = document.createElement.bind(document);

const BITRATE_OPTIONS = [
    { text: "320kbps", value: 320 },
    { text: "192kbps", value: 192 },
    { text: "128kbps", value: 128 }
];

function createSelectElement(options) {
    const selectElem = createElement("select");
    for (const option of options) {
        const optionElem = createElement("option");
        optionElem.value = String(option.value);
        optionElem.textContent = option.text;
        selectElem.appendChild(optionElem);
    }
    return selectElem;
}

function isMp3File(file) {
    const name = file.name.toLowerCase();
    const type = (file.type || "").toLowerCase();
    if (name.endsWith(".mp3")) return true;
    if (type === "audio/mpeg" || type === "audio/mp3") return true;
    return false;
}

function isWavFile(file) {
    const name = file.name.toLowerCase();
    const type = (file.type || "").toLowerCase();
    if (name.endsWith(".wav")) return true;
    if (type === "audio/wav" || type === "audio/x-wav") return true;
    return false;
}

function decodeWav(arrayBuffer) {
    if (!(arrayBuffer instanceof ArrayBuffer)) {
        throw new TypeError("arrayBuffer must be an ArrayBuffer");
    }

    const bytes = new Uint8Array(arrayBuffer);
    const view = new DataView(arrayBuffer);
    let offset = 0;

    function ensureAvailable(len) {
        if (offset + len > bytes.length) {
            throw new Error("Unexpected end of WAV file");
        }
    }

    function readString(len) {
        ensureAvailable(len);
        let s = "";
        for (let i = 0; i < len; i++) {
            s += String.fromCharCode(bytes[offset + i]);
        }
        offset += len;
        return s;
    }

    function readUint32() {
        ensureAvailable(4);
        const value = view.getUint32(offset, true);
        offset += 4;
        return value;
    }

    function readUint16() {
        ensureAvailable(2);
        const value = view.getUint16(offset, true);
        offset += 2;
        return value;
    }

    const chunkID = readString(4);
    const chunkSize = readUint32();
    const format = readString(4);

    if (chunkID !== "RIFF" || format !== "WAVE") {
        throw new Error("Not a valid WAV file");
    }

    if (chunkSize + 8 > bytes.length) {
        throw new Error("Invalid WAV chunk size");
    }

    let fmt = null;
    let data = null;

    while (offset + 8 <= bytes.length) {
        const subchunkID = readString(4);
        const subchunkSize = readUint32();

        if (subchunkSize < 0 || offset + subchunkSize > bytes.length) {
            break;
        }

        if (subchunkID === "fmt ") {
            const audioFormat = readUint16();
            const numChannels = readUint16();
            const sampleRate = readUint32();
            const byteRate = readUint32();
            const blockAlign = readUint16();
            const bitsPerSample = readUint16();

            let remaining = subchunkSize - 16;
            let extensibleSubFormatTag = null;

            if (remaining > 0) {
                const cbSize = readUint16();
                remaining -= 2;

                if (audioFormat === 0xFFFE && remaining >= 22) {
                    const validBitsPerSample = readUint16();
                    const channelMask = readUint32();
                    const subFormatTag = readUint16();
                    readUint16();
                    readUint32();
                    readUint32();
                    readUint32();
                    extensibleSubFormatTag = subFormatTag;
                    remaining -= 22;
                }

                if (remaining > 0) {
                    ensureAvailable(remaining);
                    offset += remaining;
                }
            }

            let sampleEncoding;

            if (audioFormat === 1) {
                sampleEncoding = "pcm";
            } else if (audioFormat === 3) {
                sampleEncoding = "float";
            } else if (audioFormat === 0xFFFE) {
                if (extensibleSubFormatTag === 1) {
                    sampleEncoding = "pcm";
                } else if (extensibleSubFormatTag === 3) {
                    sampleEncoding = "float";
                } else {
                    throw new Error("Unsupported WAV extensible subformat: " + extensibleSubFormatTag);
                }
            } else {
                throw new Error("Unsupported WAV audioFormat: " + audioFormat);
            }

            fmt = {
                audioFormat,
                numChannels,
                sampleRate,
                byteRate,
                blockAlign,
                bitsPerSample,
                sampleEncoding
            };
        } else if (subchunkID === "data") {
            const start = offset;
            const end = offset + subchunkSize;
            data = bytes.subarray(start, end);
            offset = end;
        } else {
            offset += subchunkSize;
        }

        if (subchunkSize % 2 === 1 && offset < bytes.length) {
            offset += 1;
        }
    }

    if (!fmt || !data) {
        throw new Error("WAV file missing fmt or data chunk");
    }

    const bytesPerSample = fmt.bitsPerSample / 8;
    if (!Number.isInteger(bytesPerSample) || bytesPerSample <= 0) {
        throw new Error("Unsupported bitsPerSample: " + fmt.bitsPerSample);
    }

    const frameSize = bytesPerSample * fmt.numChannels;
    if (frameSize <= 0) {
        throw new Error("Invalid frame size");
    }

    const numFrames = Math.floor(data.length / frameSize);

    const channels = [];
    for (let ch = 0; ch < fmt.numChannels; ch++) {
        channels[ch] = new Float32Array(numFrames);
    }

    const samplesView = new DataView(data.buffer, data.byteOffset, data.byteLength);
    let byteOffset = 0;
    const isFloat = fmt.sampleEncoding === "float";

    for (let i = 0; i < numFrames; i++) {
        for (let ch = 0; ch < fmt.numChannels; ch++) {
            let sample;

            if (isFloat) {
                if (fmt.bitsPerSample === 32) {
                    sample = samplesView.getFloat32(byteOffset, true);
                    byteOffset += 4;
                } else if (fmt.bitsPerSample === 64) {
                    sample = samplesView.getFloat64(byteOffset, true);
                    byteOffset += 8;
                } else {
                    throw new Error("Unsupported float bitsPerSample: " + fmt.bitsPerSample);
                }
            } else {
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
                        throw new Error("Unsupported integer bitsPerSample: " + fmt.bitsPerSample);
                }
            }

            channels[ch][i] = sample;
        }
    }

    return {
        fmt,
        data,
        pcm: {
            sampleRate: fmt.sampleRate,
            numChannels: fmt.numChannels,
            length: numFrames,
            channels
        }
    };
}

function float32ToInt16Buffer(float32Array) {
    const out = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
        let s = float32Array[i];
        if (s > 1) s = 1;
        else if (s < -1) s = -1;
        out[i] = s < 0 ? s * 32768 : s * 32767;
    }
    return out;
}

function encodeMp3(wav, bitrateKbps) {
    if (!wav || !wav.pcm) {
        throw new Error("Invalid WAV PCM data");
    }
    if (typeof lamejs === "undefined" || !lamejs.Mp3Encoder) {
        throw new Error("lamejs.Mp3Encoder not available");
    }

    const numChannels = wav.pcm.numChannels;
    const sampleRate = wav.pcm.sampleRate;
    const samplesPerChannel = wav.pcm.length;
    const samplesLeft = wav.pcm.channels[0];
    const samplesRight = numChannels > 1 ? wav.pcm.channels[1] : null;

    if (!samplesLeft || samplesLeft.length !== samplesPerChannel) {
        throw new Error("Invalid left channel samples");
    }
    if (numChannels === 2 && (!samplesRight || samplesRight.length !== samplesPerChannel)) {
        throw new Error("Invalid right channel samples");
    }

    const mp3encoder = new lamejs.Mp3Encoder(numChannels, sampleRate, bitrateKbps);
    const mp3Data = [];
    const maxSamples = 1152;

    for (let i = 0; i < samplesPerChannel; i += maxSamples) {
        const leftChunk = samplesLeft.subarray(i, i + maxSamples);
        const leftBuffer = float32ToInt16Buffer(leftChunk);

        let mp3buf;
        if (numChannels === 2 && samplesRight) {
            const rightChunk = samplesRight.subarray(i, i + maxSamples);
            const rightBuffer = float32ToInt16Buffer(rightChunk);
            mp3buf = mp3encoder.encodeBuffer(leftBuffer, rightBuffer);
        } else {
            mp3buf = mp3encoder.encodeBuffer(leftBuffer);
        }

        if (mp3buf && mp3buf.length > 0) {
            mp3Data.push(mp3buf);
        }
    }

    const mp3buf = mp3encoder.flush();
    if (mp3buf && mp3buf.length > 0) {
        mp3Data.push(mp3buf);
    }

    return new Blob(mp3Data, { type: "audio/mpeg" });
}

function encodeSynchsafe32(n) {
    const out = new Uint8Array(4);
    out[0] = (n >> 21) & 0x7F;
    out[1] = (n >> 14) & 0x7F;
    out[2] = (n >> 7) & 0x7F;
    out[3] = n & 0x7F;
    return out;
}

function utf16WithBomBytes(str) {
    const buf = new Uint8Array((str.length + 1) * 2 + 2);
    buf[0] = 0xFE;
    buf[1] = 0xFF;
    let o = 2;
    for (let i = 0; i < str.length; i++) {
        const c = str.charCodeAt(i);
        buf[o++] = (c >> 8) & 0xFF;
        buf[o++] = c & 0xFF;
    }
    buf[o++] = 0x00;
    buf[o++] = 0x00;
    return buf;
}

function createTextFrame(id, textOrTexts) {
    const encoding = 1;
    const values = Array.isArray(textOrTexts) ? textOrTexts : [textOrTexts];
    const joined = values.join("\u0000");
    const payload = utf16WithBomBytes(joined);
    const size = payload.length + 1;
    const frame = new Uint8Array(10 + size);

    frame[0] = id.charCodeAt(0);
    frame[1] = id.charCodeAt(1);
    frame[2] = id.charCodeAt(2);
    frame[3] = id.charCodeAt(3);

    const ss = encodeSynchsafe32(size);
    frame[4] = ss[0];
    frame[5] = ss[1];
    frame[6] = ss[2];
    frame[7] = ss[3];

    frame[8] = 0;
    frame[9] = 0;
    frame[10] = encoding;
    frame.set(payload, 11);
    return frame;
}

function createApicFrame(mimeType, bytes) {
    const encoding = 0;
    const mime = new TextEncoder().encode(mimeType);
    const size =
        1 +
        mime.length + 1 +
        1 +
        1 +
        bytes.length;

    const frame = new Uint8Array(10 + size);
    frame[0] = 0x41;
    frame[1] = 0x50;
    frame[2] = 0x49;
    frame[3] = 0x43;

    const ss = encodeSynchsafe32(size);
    frame[4] = ss[0];
    frame[5] = ss[1];
    frame[6] = ss[2];
    frame[7] = ss[3];

    frame[8] = 0;
    frame[9] = 0;

    let o = 10;
    frame[o++] = encoding;
    frame.set(mime, o);
    o += mime.length;
    frame[o++] = 0x00;
    frame[o++] = 0x03;
    frame[o++] = 0x00;
    frame.set(bytes, o);
    return frame;
}

function splitMultiValues(str) {
    return str
        .split(";")
        .map(s => s.trim())
        .filter(Boolean);
}

function createId3v24Tag(meta) {
    const frames = [];

    if (meta.title) {
        frames.push(createTextFrame("TIT2", meta.title));
    }

    if (meta.artist) {
        const artists = splitMultiValues(meta.artist);
        if (artists.length > 0) {
            frames.push(createTextFrame("TPE1", artists));
        }
    }

    if (meta.album) {
        frames.push(createTextFrame("TALB", meta.album));
    }

    if (meta.albumArtist) {
        const albumArtists = splitMultiValues(meta.albumArtist);
        if (albumArtists.length > 0) {
            frames.push(createTextFrame("TPE2", albumArtists));
        }
    }

    if (meta.year) {
        frames.push(createTextFrame("TDRC", meta.year));
    }

    if (meta.coverArt) {
        frames.push(createApicFrame(meta.coverArt.mimeType, meta.coverArt.bytes));
    }

    let totalSize = 0;
    for (const f of frames) totalSize += f.length;

    const header = new Uint8Array(10);
    header[0] = 0x49;
    header[1] = 0x44;
    header[2] = 0x33;
    header[3] = 0x04;
    header[4] = 0x00;
    header[5] = 0x00;

    const ss = encodeSynchsafe32(totalSize);
    header[6] = ss[0];
    header[7] = ss[1];
    header[8] = ss[2];
    header[9] = ss[3];

    const out = new Uint8Array(10 + totalSize);
    out.set(header, 0);

    let off = 10;
    for (const f of frames) {
        out.set(f, off);
        off += f.length;
    }

    return out;
}

document.addEventListener("DOMContentLoaded", () => {
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
    fileInput.accept = ".wav,.mp3,audio/wav,audio/x-wav,audio/mpeg,audio/mp3";
    
    fileInput.addEventListener("change", () => {
        const file = fileInput.files && fileInput.files[0];
        fileInputLabel.textContent = file ? file.name : "Choose File";
    });

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
    artistInput.placeholder = "Juice WRLD; Lil Uzi Vert";

    const albumInputLabel = createElement("label");
    albumInputLabel.htmlFor = "album_input";
    albumInputLabel.textContent = "Album";

    const albumInput = createElement("input");
    albumInput.type = "text";
    albumInput.id = "album_input";
    albumInput.placeholder = "Goodbye & Good Riddance";

    const albumArtistInputLabel = createElement("label");
    albumArtistInputLabel.htmlFor = "album_artist_input";
    albumArtistInputLabel.textContent = "Album Artist(s)";

    const albumArtistInput = createElement("input");
    albumArtistInput.type = "text";
    albumArtistInput.id = "album_artist_input";
    albumArtistInput.placeholder = "Juice WRLD";

    const yearInputLabel = createElement("label");
    yearInputLabel.htmlFor = "year_input";
    yearInputLabel.textContent = "Year";

    const yearInput = createElement("input");
    yearInput.type = "text";
    yearInput.id = "year_input";
    yearInput.placeholder = "2018";

    const coverArtFieldLabel = createElement("label");
    coverArtFieldLabel.textContent = "Cover Art";

    const coverArtInput = createElement("input");
    coverArtInput.type = "file";
    coverArtInput.id = "cover_art_input";
    coverArtInput.accept = "image/*";
    coverArtInput.style.display = "none";

    const coverArtButtonLabel = createElement("label");
    coverArtButtonLabel.id = "cover_art_label";
    coverArtButtonLabel.textContent = "Choose File";
    coverArtButtonLabel.style.cursor = "pointer";

    coverArtButtonLabel.addEventListener("click", () => {
        coverArtInput.click();
    });

    coverArtInput.addEventListener("change", () => {
        const file = coverArtInput.files && coverArtInput.files[0];
        coverArtButtonLabel.textContent = file ? file.name : "Choose File";
    });

    const convertButton = createElement("button");
    convertButton.id = "convert_button";
    convertButton.textContent = "Convert to MP3";

    const inputRows = [
        [fileInputLabel, fileInput],
        [bitrateSelectLabel, bitrateSelect],
        [titleInputLabel, titleInput],
        [artistInputLabel, artistInput],
        [albumInputLabel, albumInput],
        [albumArtistInputLabel, albumArtistInput],
        [yearInputLabel, yearInput],
        [coverArtFieldLabel, coverArtButtonLabel, coverArtInput],
        [convertButton]
    ];

    const divs = [];

    for (const inputRow of inputRows) {
        const div = createElement("div");
        div.className = "input-row";
        div.append(...inputRow);
        divs.push(div);
    }

    const mainElem = document.querySelector("main") || document.body;
    mainElem.append(...divs);

    const setConvertButtonState = (disabled) => {
        convertButton.disabled = disabled;
        convertButton.style.opacity = disabled ? "0.6" : "1";
        convertButton.style.pointerEvents = disabled ? "none" : "auto";
    };

    const updateBitrateSelectState = () => {
        const file = fileInput.files && fileInput.files[0];
        const disabled = !!(file && isMp3File(file));
        bitrateSelect.disabled = disabled;
        bitrateSelect.style.opacity = disabled ? "0.6" : "1";
        bitrateSelectLabel.style.opacity = disabled ? "0.6" : "1";
    };

    fileInput.addEventListener("change", updateBitrateSelectState);

    convertButton.addEventListener("click", async () => {
        const file = fileInput.files && fileInput.files[0];
        if (!file) {
            return;
        }

        setConvertButtonState(true);

        try {
            const mp3 = isMp3File(file);
            const wav = isWavFile(file);

            if (!mp3 && !wav) {
                throw new Error("Selected file must be WAV or MP3");
            }

            const baseName = file.name.replace(/\.[^/.]+$/, "");
            const title = titleInput.value && titleInput.value.length > 0 ? titleInput.value : baseName;
            const artist = artistInput.value || "";
            const album = albumInput.value || "";
            const albumArtist = albumArtistInput.value || "";
            const year = yearInput.value || "";

            let coverArt = null;
            const coverArtFile = coverArtInput.files && coverArtInput.files[0];
            if (coverArtFile) {
                const coverBuffer = await coverArtFile.arrayBuffer();
                coverArt = {
                    mimeType: coverArtFile.type || "image/jpeg",
                    bytes: new Uint8Array(coverBuffer)
                };
            }

            const id3Tag = createId3v24Tag({
                title,
                artist,
                album,
                albumArtist,
                year,
                coverArt
            });

            let taggedMp3Blob;
            let mp3Filename;

            if (mp3) {
                const mp3ArrayBuffer = await file.arrayBuffer();
                const mp3Bytes = new Uint8Array(mp3ArrayBuffer);
                const combined = new Uint8Array(id3Tag.length + mp3Bytes.length);
                combined.set(id3Tag, 0);
                combined.set(mp3Bytes, id3Tag.length);
                taggedMp3Blob = new Blob([combined], { type: "audio/mpeg" });
                mp3Filename = file.name.toLowerCase().endsWith(".mp3") ? file.name : baseName + ".mp3";
            } else {
                const wavBuffer = await file.arrayBuffer();
                const wavDecoded = decodeWav(wavBuffer);
                const mp3Blob = encodeMp3(wavDecoded, Number(bitrateSelect.value));
                const mp3ArrayBuffer = await mp3Blob.arrayBuffer();
                const mp3Bytes = new Uint8Array(mp3ArrayBuffer);
                const combined = new Uint8Array(id3Tag.length + mp3Bytes.length);
                combined.set(id3Tag, 0);
                combined.set(mp3Bytes, id3Tag.length);
                taggedMp3Blob = new Blob([combined], { type: "audio/mpeg" });
                mp3Filename = baseName + ".mp3";
            }

            const url = URL.createObjectURL(taggedMp3Blob);
            const a = createElement("a");
            a.href = url;
            a.download = mp3Filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
        } catch (err) {
            console.error(err);
            alert(err && err.message ? err.message : "An error occurred during conversion");
        } finally {
            setConvertButtonState(false);
        }
    });
});

if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
        navigator.serviceWorker
            .register("/service-worker.js")
            .catch((err) => console.error("Service worker registration failed:", err));
    });
}