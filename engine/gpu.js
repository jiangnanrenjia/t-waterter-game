const align = (value, boundary) => Math.ceil(value / boundary) * boundary;

/** One WebGPU owner for the whole app: device, queue, frame encoder and cached pipelines. */
export class GPUCore {
  static instance;

  static async create(canvas) {
    if (!navigator.gpu) return null;
    try {
      const core = new GPUCore(canvas);
      const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
      if (!adapter) return null;
      core.adapter = adapter;
      core.device = await adapter.requestDevice();
      core.queue = core.device.queue;
      core.context = canvas.getContext("webgpu");
      if (!core.context) return null;
      core.format = navigator.gpu.getPreferredCanvasFormat();
      core.context.configure({ device: core.device, format: core.format, alphaMode: "opaque" });
      core.resize();
      GPUCore.instance = core;
      core.device.lost.then((info) => {
        console.warn("WebGPU device lost:", info.message || info.reason);
        window.dispatchEvent(new CustomEvent("gpu-device-lost"));
      });
      return core;
    } catch (error) {
      console.warn("WebGPU unavailable; using the 2D scene renderer.", error);
      return null;
    }
  }

  constructor(canvas) {
    this.canvas = canvas;
    this.pipelineCache = new Map();
    this.uniformStride = 256;
    this.drawCapacity = 128;
    this.drawBuffer = null;
    this.frameSerial = 0;
  }

  resize() {
    const mobile = window.matchMedia("(max-width:650px)").matches;
    const ratio = Math.min(window.devicePixelRatio || 1, mobile ? 1.2 : 1.75);
    const width = Math.max(1, Math.round(this.canvas.clientWidth * ratio));
    const height = Math.max(1, Math.round(this.canvas.clientHeight * ratio));
    if (width !== this.canvas.width || height !== this.canvas.height) {
      this.canvas.width = width;
      this.canvas.height = height;
      this.context.configure({ device: this.device, format: this.format, alphaMode: "opaque" });
    }
    return { width, height };
  }

  makeUniformBuffer(label, bytes = 256) {
    return this.device.createBuffer({
      label,
      size: align(bytes, 256),
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
  }

  ensureDrawBuffer(items = 1) {
    if (items <= this.drawCapacity && this.drawBuffer) return;
    this.drawCapacity = Math.max(128, 2 ** Math.ceil(Math.log2(items)));
    this.drawBuffer?.destroy();
    this.drawBuffer = this.device.createBuffer({
      label: "256-byte aligned draw records",
      size: this.drawCapacity * this.uniformStride,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    return this.drawBuffer;
  }

  /** Pack per-draw records into fixed 256-byte slots to satisfy uniform-offset alignment. */
  writeDrawRecords(records) {
    this.ensureDrawBuffer(records.length);
    const bytes = new ArrayBuffer(Math.max(1, records.length) * this.uniformStride);
    const floats = new Float32Array(bytes);
    records.forEach((record, index) => {
      floats.set(record, (index * this.uniformStride) / 4);
    });
    if (records.length) this.queue.writeBuffer(this.drawBuffer, 0, bytes);
    return this.drawBuffer;
  }

  async pipeline(key, descriptor, kind = "render") {
    if (this.pipelineCache.has(key)) return this.pipelineCache.get(key);
    const creation = kind === "compute"
      ? this.device.createComputePipelineAsync(descriptor)
      : this.device.createRenderPipelineAsync(descriptor);
    const promise = creation.catch((error) => {
      this.pipelineCache.delete(key);
      throw error;
    });
    this.pipelineCache.set(key, promise);
    return promise;
  }

  async prewarm(pipelineRequests) {
    // Compile off the first interactive frame. This prevents lazy shader work on cast/bite.
    await Promise.all(pipelineRequests.map(([key, descriptor, kind]) => this.pipeline(key, descriptor, kind)));
  }

  beginFrame() {
    this.resize();
    this.frameSerial += 1;
    return this.device.createCommandEncoder({ label: `T Waterter frame ${this.frameSerial}` });
  }

  submit(encoder) {
    this.queue.submit([encoder.finish()]);
  }

  texture(label, width, height, format, usage, sampleCount = 1) {
    return this.device.createTexture({
      label,
      size: { width, height, depthOrArrayLayers: 1 },
      format,
      usage,
      sampleCount,
    });
  }
}
