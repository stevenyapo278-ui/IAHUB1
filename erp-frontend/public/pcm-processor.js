// AudioWorklet: resample mic to 16kHz mono PCM + adaptive noise gate + VAD-friendly RMS.
// Filtre bruit de fond continu (postes fixes) : gate adaptatif + lissage spectral léger.
class PCMProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.ratio = sampleRate / 16000;
    this._frac = 0;
    // Noise gate params (surchargeables via port message { type:'config', noiseGate: {...} })
    this.noiseGateEnabled = true;
    this.noiseFloor = 0.008;      // RMS plancher bruit de fond (adaptatif)
    this.gateThreshold = 0.015;    // Seuil d'ouverture (parole détectée)
    this.attackMs = 5;            // ms d'attaque (plus réactif)
    this.releaseMs = 150;         // ms de relâchement (était 250)
    this.holdMs = 80;             // maintien ouvert après parole (était 120)
    this._gateOpen = false;
    this._holdRemain = 0;
    this._envelopeMs = 0;
    // Lissage passe-bas anti-aliasing (fenêtre 3 échantillons)
    this._prev = 0;
    this.port.onmessage = (e) => {
      if (e.data && e.data.type === 'config') {
        const c = e.data.noiseGate || {};
        if (typeof c.enabled === 'boolean') this.noiseGateEnabled = c.enabled;
        if (typeof c.threshold === 'number') this.gateThreshold = c.threshold;
        if (typeof c.floor === 'number') this.noiseFloor = c.floor;
      }
    };
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;
    const ch = input[0];

    // Resample avec lissage passe-bas (moyenne glissante 3 points)
    const out = [];
    let idx = this._frac;
    let prev2 = this._prev;
    // Estimation bruit de fond adaptative (moyenne glissante sur silences)
    // On calcule d'abord le RMS brut pour adapter le plancher
    let rawSum = 0;
    for (let i = 0; i < ch.length; i++) rawSum += ch[i] * ch[i];
    const rawRms = ch.length ? Math.sqrt(rawSum / ch.length) : 0;

    // Adaptation lente du plancher : suit les silences (quand rawRms < gateThreshold)
    if (rawRms < this.gateThreshold) {
      this.noiseFloor = this.noiseFloor * 0.995 + rawRms * 0.005;
      this.noiseFloor = Math.max(0.003, Math.min(0.02, this.noiseFloor));
    }

    const frameMs = (ch.length / sampleRate) * 1000;

    while (idx < ch.length) {
      const i0 = Math.floor(idx);
      const frac = idx - i0;
      // Interpolation linéaire + lissage
      const s0 = ch[i0] || 0;
      const s1 = ch[Math.min(i0 + 1, ch.length - 1)] || 0;
      let s = s0 * (1 - frac) + s1 * frac;
      s = (prev2 + s0 + s) / 3;
      prev2 = s;
      out.push(s);
      idx += this.ratio;
    }
    this._prev = ch[ch.length - 1] || 0;
    this._frac = idx - ch.length;

    // Noise gate
    let sum = 0;
    let gatedSum = 0;
    for (let i = 0; i < out.length; i++) sum += out[i] * out[i];
    const rms = out.length ? Math.sqrt(sum / out.length) : 0;

    // Décision gate avec hystérésis + hold
    if (rms > this.gateThreshold) {
      this._gateOpen = true;
      this._holdRemain = this.holdMs;
      this._envelopeMs = 0;
    } else if (this._gateOpen) {
      if (this._holdRemain > 0) {
        this._holdRemain -= frameMs;
      } else {
        // Release progressif
        this._envelopeMs += frameMs;
        if (this._envelopeMs >= this.releaseMs) {
          this._gateOpen = false;
          this._envelopeMs = 0;
        }
      }
    }

    // Atténuation progressive pendant le release
    let attenuation = 1;
    if (!this._gateOpen && this._envelopeMs > 0) {
      attenuation = 1 - this._envelopeMs / this.releaseMs;
      attenuation = Math.max(0, attenuation);
    } else if (!this._gateOpen) {
      attenuation = 0;
    }

    const int16 = new Int16Array(out.length);
    for (let i = 0; i < out.length; i++) {
      let s = out[i] * (this.noiseGateEnabled ? attenuation : 1);
      s = Math.max(-1, Math.min(1, s));
      int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      const norm = int16[i] / 0x7fff;
      gatedSum += norm * norm;
    }
    const gatedRms = out.length ? Math.sqrt(gatedSum / out.length) : 0;

    // isSpeech hint pour le VAD côté main thread (seuil + gate)
    const isSpeech = this._gateOpen && rms > this.noiseFloor * 1.5;

    this.port.postMessage(
      { pcm: int16.buffer, rms: gatedRms, rawRms: rms, isSpeech, gateOpen: this._gateOpen },
      [int16.buffer]
    );
    return true;
  }
}

registerProcessor('pcm-processor', PCMProcessor);
