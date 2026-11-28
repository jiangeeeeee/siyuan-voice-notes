/* Runs the upstream sherpa-onnx WebAssembly builds entirely in a local worker. */
let recognizer, vad, diarizer, kind
let carry = new Float32Array(0)
let received = 0
const segments = []
var Module

function diarizationConfig(options = {}) {
  const numSpeakers = options.numSpeakers ?? 0
  const threshold = options.threshold ?? 0.5
  if (!Number.isInteger(numSpeakers) || numSpeakers < 0 || numSpeakers > 30 ||
      !Number.isFinite(threshold) || threshold < 0.1 || threshold > 0.9)
    throw Error('Invalid speaker analysis options')
  return {
    segmentation: { pyannote: { model: './segmentation.onnx' }, numThreads: 1, debug: 0, provider: 'cpu' },
    embedding: { model: './embedding.onnx', numThreads: 1, debug: 0, provider: 'cpu' },
    clustering: { numClusters: numSpeakers || -1, threshold },
    minDurationOn: 0.3, minDurationOff: 0.5,
  }
}

function drainSpeech() {
  while (!vad.isEmpty()) {
    const segment = vad.front()
    vad.pop()
    const stream = recognizer.createStream()
    try {
      stream.acceptWaveform(16000, segment.samples)
      recognizer.decode(stream)
      const result = recognizer.getResult(stream)
      const text = result.text.replace(/<\|[^|]*\|>/g, '').trim()
      if (text) {
        const item = {
          start: segment.start / 16000,
          end: (segment.start + segment.samples.length) / 16000,
          text,
        }
        segments.push(item)
        postMessage({ type: 'segment', segment: item })
      }
    } finally {
      stream.free()
    }
  }
}

function accept(samples) {
  const data = new Float32Array(carry.length + samples.length)
  data.set(carry)
  data.set(samples, carry.length)
  let offset = 0
  for (; offset + 512 <= data.length; offset += 512) {
    vad.acceptWaveform(data.subarray(offset, offset + 512))
    drainSpeech()
  }
  carry = data.slice(offset)
  received += samples.length
}

function flush() {
  if (carry.length) {
    const padded = new Float32Array(512)
    padded.set(carry)
    vad.acceptWaveform(padded)
    carry = new Float32Array(0)
  }
  vad.flush()
  drainSpeech()
  postMessage({ type: 'done', segments })
}

self.onmessage = ({ data }) => {
  try {
    if (data.type === 'init') {
      kind = data.kind
      const base = new URL(kind + '/', self.location.href).href
      Module = {
        locateFile: (file) => base + file,
        print: () => {},
        printErr: () => {},
        onAbort: (error) =>
          postMessage({ type: 'error', error: String(error) }),
        onRuntimeInitialized: () => {
          try {
            if (kind === 'asr') {
              recognizer = new OfflineRecognizer(
                {
                  modelConfig: {
                    tokens: './tokens.txt',
                    numThreads: 1,
                    debug: 0,
                    senseVoice: {
                      model: './sense-voice.onnx',
                      language: data.language || 'auto',
                      useInverseTextNormalization: 1,
                    },
                  },
                },
                Module,
              )
              vad = createVad(Module)
            } else {
              diarizer = createOfflineSpeakerDiarization(Module, diarizationConfig(data.options))
            }
            postMessage({ type: 'ready' })
          } catch (error) {
            postMessage({ type: 'error', error: String(error) })
          }
        },
      }
      if (kind === 'asr') {
        importScripts(
          base + 'sherpa-onnx-asr.js',
          base + 'sherpa-onnx-vad.js',
          base + 'sherpa-onnx-wasm-main-vad-asr.js',
        )
      } else {
        importScripts(
          new URL('acoustics.js', self.location.href).href,
          base + 'sherpa-onnx-speaker-diarization.js',
          base + 'sherpa-onnx-wasm-main-speaker-diarization.js',
        )
      }
    } else if (data.type === 'configure' && kind === 'diar') {
      // Reuse the loaded models; sherpa's setConfig updates clustering only.
      diarizer.setConfig(diarizationConfig(data.options))
      postMessage({ type: 'ready' })
    } else if (data.type === 'push') {
      accept(data.samples)
      postMessage({ type: 'accepted', received })
    } else if (data.type === 'finish') {
      flush()
    } else if (data.type === 'batch') {
      if (kind === 'diar') {
        const result = diarizer.process(data.samples)
        const turns = result.map(turn => ({ ...turn, acoustic: acousticFingerprint(
          data.samples.subarray(Math.max(0, Math.round(turn.start * 16000)), Math.max(0, Math.round(turn.end * 16000)))) }))
        postMessage({ type: 'done', turns })
      } else {
        // Bound VAD buffering and publish progress between speech segments.
        for (let i = 0; i < data.samples.length; i += 16000) {
          accept(data.samples.subarray(i, i + 16000))
          postMessage({
            type: 'progress',
            value: Math.min(1, (i + 16000) / data.samples.length),
          })
        }
        flush()
      }
    }
  } catch (error) {
    postMessage({ type: 'error', error: String(error) })
  }
}
