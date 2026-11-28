// Shared by the classic offline worker and the sample enrollment dialog.
// All input is mono PCM at 16 kHz, as required by the diarization model.
const acousticFingerprint = (() => {
  const size = 512,
    frame = 400,
    bins = size / 2,
    bands = 24
  const window = Array.from(
    { length: frame },
    (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (frame - 1)),
  )
  const melTop = Math.log1p(8000 / 700)
  const edges = Array.from(
    { length: bands + 2 },
    (_, i) => (700 * Math.expm1((i * melTop) / (bands + 1)) * size) / 16000,
  )
  const cosines = Array.from({ length: 12 }, (_, c) =>
    Array.from(
      { length: bands },
      (_, m) => Math.cos((Math.PI * (c + 1) * (m + 0.5)) / bands) / bands,
    ),
  )
  const reversed = Array.from({ length: size }, (_, i) =>
    parseInt(i.toString(2).padStart(9, '0').split('').reverse().join(''), 2),
  )
  const cos = Array.from({ length: bins }, (_, i) => Math.cos((-2 * Math.PI * i) / size))
  const sin = Array.from({ length: bins }, (_, i) => Math.sin((-2 * Math.PI * i) / size))
  const mean = (xs) => xs.reduce((sum, x) => sum + x, 0) / xs.length
  const sd = (xs, avg) => Math.sqrt(mean(xs.map((x) => (x - avg) ** 2)))
  const quantile = (sorted, q) => sorted[Math.round((sorted.length - 1) * q)]
  function spectrum(samples, off) {
    const re = new Float64Array(size),
      im = new Float64Array(size)
    for (let i = 0; i < frame; i++) re[reversed[i]] = samples[off + i] * window[i]
    for (let length = 2; length <= size; length *= 2) {
      for (let j = 0; j < length / 2; j++) {
        const k = (j * size) / length
        for (let a = j; a < size; a += length) {
          const b = a + length / 2
          const x = re[b] * cos[k] - im[b] * sin[k],
            y = re[b] * sin[k] + im[b] * cos[k]
          re[b] = re[a] - x
          im[b] = im[a] - y
          re[a] += x
          im[a] += y
        }
      }
    }
    return re.slice(0, bins).map((x, i) => x * x + im[i] * im[i])
  }
  function fundamental(samples, off) {
    // Normalized autocorrelation of a low-pass, 8 kHz frame. Use the earliest
    // strong local maximum to avoid reporting a multiple of the pitch period.
    const x = new Float64Array(frame / 2)
    for (let i = 0; i < x.length; i++) x[i] = (samples[off + 2 * i] + samples[off + 2 * i + 1]) / 2
    const dc = mean(x)
    for (let i = 0; i < x.length; i++) x[i] -= dc
    const corr = new Float64Array(117)
    let best = 0
    for (let lag = 18; lag < corr.length; lag++) {
      let dot = 0,
        a = 0,
        b = 0
      for (let i = lag; i < x.length; i++) {
        dot += x[i] * x[i - lag]
        a += x[i] ** 2
        b += x[i - lag] ** 2
      }
      corr[lag] = dot / Math.sqrt(a * b + 1e-18)
      best = Math.max(best, corr[lag])
    }
    for (let lag = 19; lag < corr.length - 1; lag++)
      if (
        corr[lag] >= Math.max(0.65, best * 0.94) &&
        corr[lag] >= corr[lag - 1] &&
        corr[lag] > corr[lag + 1]
      )
        return 8000 / lag
  }
  return function acousticFingerprint(samples) {
    if (samples.length < frame) return
    const count = Math.min(80, 1 + Math.floor((samples.length - frame) / 160))
    const frames = []
    for (let i = 0; i < count; i++) {
      const off = Math.floor((i * (samples.length - frame)) / Math.max(1, count - 1))
      let power = 0,
        peak = 0
      for (let j = off; j < off + frame; j++) {
        power += samples[j] ** 2
        peak = Math.max(peak, Math.abs(samples[j]))
      }
      frames.push({ off, db: 10 * Math.log10(power / frame + 1e-12), peak })
    }
    const levels = frames.map((f) => f.db).sort((a, b) => a - b)
    const active = frames.filter((f) => f.db >= Math.max(-65, quantile(levels, 0.9) - 30))
    if (active.length < 3) return
    const cep = cosines.map(() => []),
      spectral = [[], [], []],
      pitch = []
    for (const { off } of active) {
      const p = spectrum(samples, off),
        total = p.reduce((a, b) => a + b, 0)
      let centroid = 0,
        variance = 0,
        sum = 0,
        roll = 0
      for (let i = 0; i < bins; i++) centroid += (i * p[i]) / total
      for (let i = 0; i < bins; i++) {
        variance += ((i - centroid) ** 2 * p[i]) / total
        if (sum < total * 0.85) roll = i
        sum += p[i]
      }
      ;[centroid, Math.sqrt(variance), roll].forEach((v, k) =>
        spectral[k].push(Math.log1p((v * 16000) / size)),
      )
      const mel = Array.from({ length: bands }, (_, m) => {
        let sum = 0
        for (let i = Math.ceil(edges[m]); i < edges[m + 2] && i < bins; i++) {
          const w = Math.min(
            (i - edges[m]) / (edges[m + 1] - edges[m]),
            (edges[m + 2] - i) / (edges[m + 2] - edges[m + 1]),
          )
          sum += p[i] * w
        }
        return Math.log(sum / total + 1e-10)
      })
      cosines.forEach((row, k) => cep[k].push(row.reduce((sum, w, m) => sum + w * mel[m], 0)))
      const hz = fundamental(samples, off)
      if (hz) pitch.push(Math.log2(hz))
    }
    pitch.sort((a, b) => a - b)
    const loud = active.map((f) => f.db),
      avg = mean(loud)
    return {
      cepstrum: cep.map(mean),
      spread: cep.map((c) => sd(c, mean(c))),
      spectrum: spectral.map(mean),
      pitch: pitch.length < 3 ? [] : [0.25, 0.5, 0.75].map((q) => quantile(pitch, q)),
      energy: [
        avg,
        sd(loud, avg),
        20 * Math.log10(Math.max(...active.map((f) => f.peak))) - quantile(levels, 0.1),
        1 - active.length / count,
      ],
      voiced: pitch.length / count,
    }
  }
})()
if (typeof module !== 'undefined') module.exports = { acousticFingerprint }
