/**
 * Splits an audio file into multiple chunks of a specified duration.
 * Uses Web Audio API to decode and then re-encode chunks.
 * Note: For simplicity, we'll slice the Blob if it's a known format, 
 * but for true precision, we decode it.
 */

export async function sliceAudio(file: File, segmentDurationSeconds: number): Promise<Blob[]> {
  const audioContext = new AudioContext();
  const arrayBuffer = await file.arrayBuffer();
  
  try {
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    const totalDuration = audioBuffer.duration;
    const numSegments = Math.ceil(totalDuration / segmentDurationSeconds);
    const chunks: Blob[] = [];

    for (let i = 0; i < numSegments; i++) {
        const start = i * segmentDurationSeconds;
        const end = Math.min((i + 1) * segmentDurationSeconds, totalDuration);
        const duration = end - start;
        
        // Create a new buffer for the segment
        const segmentBuffer = audioContext.createBuffer(
          audioBuffer.numberOfChannels,
          Math.floor(duration * audioBuffer.sampleRate),
          audioBuffer.sampleRate
        );

        for (let channel = 0; channel < audioBuffer.numberOfChannels; channel++) {
          const channelData = audioBuffer.getChannelData(channel);
          const segmentData = segmentBuffer.getChannelData(channel);
          const startOffset = Math.floor(start * audioBuffer.sampleRate);
          for (let s = 0; s < segmentData.length; s++) {
            segmentData[s] = channelData[startOffset + s];
          }
        }

        // Ideally we'd encode to MP3/WAV here. 
        // For simplicity, we'll convert to a WAV Blob.
        const wavBlob = await bufferToWav(segmentBuffer);
        chunks.push(wavBlob);
    }
    
    return chunks;
  } catch (e) {
    console.warn("Failed to decode audio for precise splitting, falling back to simple slicing", e);
    // If decoding fails (unsupported format by browser), we'll just return the whole file as one chunk
    // because bitwise slicing is risky for most formats.
    return [file];
  } finally {
    audioContext.close();
  }
}

function bufferToWav(buffer: AudioBuffer): Promise<Blob> {
  const numOfChan = buffer.numberOfChannels;
  const length = buffer.length * numOfChan * 2 + 44;
  const buffer_arr = new ArrayBuffer(length);
  const view = new DataView(buffer_arr);
  const channels = [];
  let i, sample, offset = 0, pos = 0;

  // write WAVE header
  setUint32(0x46464952);                         // "RIFF"
  setUint32(length - 8);                         // file length - 8
  setUint32(0x45564157);                         // "WAVE"
  setUint32(0x20746d66);                         // "fmt " chunk
  setUint32(16);                                 // length = 16
  setUint16(1);                                  // PCM (uncompressed)
  setUint16(numOfChan);
  setUint32(buffer.sampleRate);
  setUint32(buffer.sampleRate * 2 * numOfChan);  // avg. bytes/sec
  setUint16(numOfChan * 2);                      // block-align
  setUint16(16);                                 // 16-bit (hardcoded)
  setUint32(0x61746164);                         // "data" - chunk
  setUint32(length - pos - 4);                   // chunk length

  // write interleaved data
  for (i = 0; i < buffer.numberOfChannels; i++)
    channels.push(buffer.getChannelData(i));

  while (pos < length) {
    for (i = 0; i < numOfChan; i++) {             // interleave channels
      sample = Math.max(-1, Math.min(1, channels[i][offset])); // clamp
      sample = (sample < 0 ? sample * 0x8000 : sample * 0x7FFF) | 0; // scale to 16nd-bit signed int
      view.setInt16(pos, sample, true);          // write 16-bit sample
      pos += 2;
    }
    offset++;                                     // next sample
  }

  return Promise.resolve(new Blob([buffer_arr], { type: "audio/wav" }));

  function setUint16(data: number) {
    view.setUint16(pos, data, true);
    pos += 2;
  }

  function setUint32(data: number) {
    view.setUint32(pos, data, true);
    pos += 4;
  }
}
