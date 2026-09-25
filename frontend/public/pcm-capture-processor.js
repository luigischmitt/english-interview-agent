class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.outputRate = 16_000;
    this.outputPhase = 0;
    this.filteredSample = 0;
    this.lowPassAlpha = 1 - Math.exp((-2 * Math.PI * 7_000) / sampleRate);
    this.frameSamples = 1_600;
    this.frame = new Float32Array(this.frameSamples);
    this.frameOffset = 0;
    this.flushing = false;
    this.port.onmessage = (event) => {
      if (event.data?.type !== "flush") return;
      this.flushing = true;
      this.postFrame();
      this.port.postMessage({ type: "flushed" });
    };
  }

  postFrame() {
    if (this.frameOffset === 0) return;
    const samples = this.frame.slice(0, this.frameOffset);
    this.port.postMessage({ type: "frame", samples: samples.buffer }, [samples.buffer]);
    this.frame = new Float32Array(this.frameSamples);
    this.frameOffset = 0;
  }

  process(inputs) {
    if (this.flushing) return true;
    const channels = inputs[0];
    if (!channels?.length) return true;
    const frameCount = channels[0].length;
    for (let index = 0; index < frameCount; index += 1) {
      let monoSample = 0;
      for (const channel of channels) monoSample += channel[index] ?? 0;
      monoSample /= channels.length;
      this.filteredSample += this.lowPassAlpha * (monoSample - this.filteredSample);
      this.outputPhase += this.outputRate;
      if (this.outputPhase < sampleRate) continue;
      this.outputPhase -= sampleRate;
      this.frame[this.frameOffset] = this.filteredSample;
      this.frameOffset += 1;
      if (this.frameOffset === this.frameSamples) this.postFrame();
    }
    return true;
  }
}

registerProcessor("pcm-capture-processor", PcmCaptureProcessor);
