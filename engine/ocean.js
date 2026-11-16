const N = 64;
const CELLS = N * N;
const TAU = Math.PI * 2;
const SCALES = [7.35, 31.7, 173.4, 733.2];
const GRAVITY = 9.81;

const evolveSource = /* wgsl */ `
struct Params { time: f32, scale: f32, windX: f32, windZ: f32 };
@group(0) @binding(0) var<storage, read> h0: array<vec2f>;
@group(0) @binding(1) var<storage, read_write> evolved: array<vec4f>;
@group(0) @binding(2) var<uniform> params: Params;
fn cmul(a: vec2f, b: vec2f) -> vec2f { return vec2f(a.x*b.x-a.y*b.y, a.x*b.y+a.y*b.x); }
@compute @workgroup_size(128)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let id = gid.x; if (id >= ${CELLS}u) { return; }
  let x = id % ${N}u; let z = id / ${N}u;
  let mx = (${N}u - x) % ${N}u; let mz = (${N}u - z) % ${N}u;
  var fx=f32(x); var fz=f32(z);
  if(x>${N / 2}u){fx=fx-${N}.0;} if(z>${N / 2}u){fz=fz-${N}.0;}
  let kx = fx * 6.2831853 / params.scale;
  let kz = fz * 6.2831853 / params.scale;
  let k = max(length(vec2f(kx,kz)), 0.0001);
  let omega = sqrt(${GRAVITY}.0 * k);
  let phase = omega * params.time;
  let hA = h0[id];
  let hB = h0[mz * ${N}u + mx];
  let forward = vec2f(cos(phase), sin(phase));
  let backward = vec2f(cos(phase), -sin(phase));
  let height = cmul(hA, forward) + cmul(vec2f(hB.x, -hB.y), backward);
  // Horizontal Gerstner displacement uses -i(k/|k|)H.
  let direction = kx / k;
  let horizontal = vec2f(height.y * direction, -height.x * direction) * 0.82;
  evolved[id] = vec4f(height, horizontal);
}`;

function fftSource(inputName, outputName, axis, inverse) {
  const readIndex = axis === "row" ? `id * ${N}u + reverseBits(i)` : `reverseBits(i) * ${N}u + id`;
  const writeIndex = axis === "row" ? `id * ${N}u + i` : `i * ${N}u + id`;
  return /* wgsl */ `
@group(0) @binding(0) var<storage, read> ${inputName}: array<vec4f>;
@group(0) @binding(1) var<storage, read_write> ${outputName}: array<vec4f>;
fn bitReverse6(value: u32) -> u32 { return reverseBits(value) >> 26u; }
fn cmul(a: vec2f, b: vec2f) -> vec2f { return vec2f(a.x*b.x-a.y*b.y, a.x*b.y+a.y*b.x); }
fn butterfly(a: vec4f, b: vec4f, tw: vec2f) -> vec4f {
  return vec4f(a.xy + cmul(b.xy, tw), a.zw + cmul(b.zw, tw));
}
@compute @workgroup_size(1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let id = gid.x; if (id >= ${N}u) { return; }
  var values: array<vec4f, ${N}>;
  for (var i=0u; i<${N}u; i=i+1u) { values[i] = ${inputName}[${readIndex.replaceAll("reverseBits", "bitReverse6")}]; }
  var width = 2u;
  loop {
    if (width > ${N}u) { break; }
    let half = width / 2u;
    for (var block=0u; block<${N}u; block=block+width) {
      for (var j=0u; j<half; j=j+1u) {
        let angle = ${inverse ? "1.0" : "-1.0"} * 6.2831853 * f32(j) / f32(width);
        let twiddle = vec2f(cos(angle), sin(angle));
        let a = values[block+j]; let b = values[block+j+half];
        let productH = cmul(b.xy, twiddle); let productX = cmul(b.zw, twiddle);
        values[block+j] = a + vec4f(productH, productX);
        values[block+j+half] = a - vec4f(productH, productX);
      }
    }
    width = width * 2u;
  }
  for (var i=0u; i<${N}u; i=i+1u) {
    ${outputName}[${writeIndex}] = values[i] / ${inverse ? `${N}.0` : "1.0"};
  }
}`;
}

const foamSource = /* wgsl */ `
@group(0) @binding(0) var<storage, read> spatial: array<vec4f>;
@group(0) @binding(1) var<storage, read_write> wave: array<vec4f>;
@compute @workgroup_size(128)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let id=gid.x; if(id>=${CELLS}u){return;}
  let x=id%${N}u; let z=id/${N}u;
  let xl=z*${N}u+(x+${N-1}u)%${N}u; let xr=z*${N}u+(x+1u)%${N}u;
  let zd=((z+${N-1}u)%${N}u)*${N}u+x; let zu=((z+1u)%${N}u)*${N}u+x;
  let center=spatial[id];
  let dx=(spatial[xr].z-spatial[xl].z)*0.5;
  let slope=(spatial[zu].x-spatial[zd].x)*0.5;
  let curvature=abs(spatial[zu].y+spatial[zd].y+spatial[xr].y+spatial[xl].y-4.0*center.y);
  let jacobian=1.0+dx;
  let foam=clamp(max((0.76-jacobian)*2.4, curvature*1.8-0.1),0.0,1.0);
  wave[id]=vec4f(center.z,center.x,center.y,foam);
}`;

function gaussianPair(seed) {
  let a = ((Math.sin(seed * 12.9898 + 78.233) * 43758.5453) % 1 + 1) % 1;
  let b = ((Math.sin(seed * 39.3467 + 11.135) * 96321.9123) % 1 + 1) % 1;
  a = Math.max(0.00001, a); b = Math.max(0.00001, b);
  const radius = Math.sqrt(-2 * Math.log(a));
  return [radius * Math.cos(TAU * b), radius * Math.sin(TAU * b)];
}

/** Four cascaded spectral ocean fields. FFT runs in compute shaders; all work shares one frame encoder. */
export class OceanFFT {
  constructor(core) {
    this.core = core;
    this.cascades = [];
    this.time = 0;
    this.wind = 4.4;
    this.pipelinePromise = this.create();
  }

  async create() {
    const { device } = this.core;
    const descriptors = [
      ["ocean-evolve", {
        label: "SST spectral time evolution",
        layout: "auto",
        compute: { module: device.createShaderModule({ label: "ocean spectrum evolution", code: evolveSource }), entryPoint: "main" },
      }, "compute"],
      ["ocean-row-ifft", {
        label: "Ocean row inverse FFT",
        layout: "auto",
        compute: { module: device.createShaderModule({ label: "row FFT", code: fftSource("source", "target", "row", true) }), entryPoint: "main" },
      }, "compute"],
      ["ocean-column-ifft", {
        label: "Ocean column inverse FFT",
        layout: "auto",
        compute: { module: device.createShaderModule({ label: "column FFT", code: fftSource("source", "target", "column", true) }), entryPoint: "main" },
      }, "compute"],
      ["ocean-jacobian-foam", {
        label: "Ocean Jacobian foam field",
        layout: "auto",
        compute: { module: device.createShaderModule({ label: "Jacobian foam", code: foamSource }), entryPoint: "main" },
      }, "compute"],
    ];
    const [evolve, row, column, foam] = await this.core.prewarm(descriptors).then(() =>
      Promise.all(descriptors.map(([key]) => this.core.pipelineCache.get(key))));

    SCALES.forEach((scale, cascadeIndex) => {
      const h0Data = new Float32Array(CELLS * 2);
      const fundamental = TAU / scale;
      for (let z = 0; z < N; z += 1) {
        for (let x = 0; x < N; x += 1) {
          const kx = (x > N / 2 ? x - N : x) * fundamental;
          const kz = (z > N / 2 ? z - N : z) * fundamental;
          const mode = Math.hypot(kx, kz) * scale / TAU;
          const amplitude = mode < 0.5 ? 0 : (N * 0.11) / Math.pow(1 + mode * 0.15, 1.35);
          const [a, b] = gaussianPair(cascadeIndex * CELLS + z * N + x + 1);
          const offset = (z * N + x) * 2;
          h0Data[offset] = a * amplitude * 0.7071;
          h0Data[offset + 1] = b * amplitude * 0.7071;
        }
      }
      const storage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST;
      const buffers = {
        spectrum: device.createBuffer({ label: `spectrum ${scale}m`, size: h0Data.byteLength, usage: storage }),
        evolved: device.createBuffer({ label: `evolved ${scale}m`, size: CELLS * 16, usage: GPUBufferUsage.STORAGE }),
        row: device.createBuffer({ label: `row spectrum ${scale}m`, size: CELLS * 16, usage: GPUBufferUsage.STORAGE }),
        spatial: device.createBuffer({ label: `spatial ${scale}m`, size: CELLS * 16, usage: GPUBufferUsage.STORAGE }),
        wave: device.createBuffer({ label: `wave displacement ${scale}m`, size: CELLS * 16, usage: GPUBufferUsage.STORAGE }),
        params: this.core.makeUniformBuffer(`ocean parameters ${scale}m`, 16),
      };
      this.core.queue.writeBuffer(buffers.spectrum, 0, h0Data);
      const bind = (pipeline, entries) => device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries });
      const group = {
        evolve: bind(evolve, [
          { binding: 0, resource: { buffer: buffers.spectrum } },
          { binding: 1, resource: { buffer: buffers.evolved } },
          { binding: 2, resource: { buffer: buffers.params } },
        ]),
        row: bind(row, [
          { binding: 0, resource: { buffer: buffers.evolved } },
          { binding: 1, resource: { buffer: buffers.row } },
        ]),
        column: bind(column, [
          { binding: 0, resource: { buffer: buffers.row } },
          { binding: 1, resource: { buffer: buffers.spatial } },
        ]),
        foam: bind(foam, [
          { binding: 0, resource: { buffer: buffers.spatial } },
          { binding: 1, resource: { buffer: buffers.wave } },
        ]),
      };
      this.cascades.push({ scale, buffers, group, pipelines: { evolve, row, column, foam } });
    });
    return this.cascades;
  }

  setWind(speed) { this.wind = speed; }

  async encode(encoder, deltaSeconds, worldTime) {
    await this.pipelinePromise;
    this.time = worldTime;
    const direction = 0.32 + Math.sin(worldTime * 0.03) * 0.12;
    for (const cascade of this.cascades) {
      const params = new Float32Array([worldTime, cascade.scale, Math.cos(direction) * this.wind, Math.sin(direction) * this.wind]);
      this.core.queue.writeBuffer(cascade.buffers.params, 0, params);
      for (const [name, count] of [["evolve", Math.ceil(CELLS / 128)], ["row", N], ["column", N], ["foam", Math.ceil(CELLS / 128)]]) {
        const pass = encoder.beginComputePass({ label: `${name} cascade ${cascade.scale.toFixed(1)}m` });
        pass.setPipeline(cascade.pipelines[name]);
        pass.setBindGroup(0, cascade.group[name]);
        pass.dispatchWorkgroups(count);
        pass.end();
      }
    }
  }

  get waveBuffers() { return this.cascades.map((cascade) => cascade.buffers.wave); }
  get cascadeScales() { return SCALES; }
}
