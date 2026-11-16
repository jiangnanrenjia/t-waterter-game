import { GPUCore } from "./gpu.js";
import { OceanFFT } from "./ocean.js";

const sceneWGSL = /* wgsl */ `
struct Params { time:f32, bobberX:f32, bobberY:f32, bobberVisible:f32, cast:f32, tension:f32, whale:f32, day:f32, night:f32, pad0:f32, pad1:f32, pad2:f32, pad3:f32, pad4:f32, pad5:f32, pad6:f32 };
struct VertexOut { @builtin(position) position:vec4f, @location(0) uv:vec2f };
struct SceneOut { @location(0) color:vec4f, @location(1) velocity:vec2f, @location(2) waterCode:f32 };
@group(0) @binding(0) var<uniform> p:Params;
struct DrawParams { offset:vec2f, zoom:f32, pad:f32 };
@group(0) @binding(1) var<uniform> draw:DrawParams;
fn hash(v:vec2f)->f32 { return fract(sin(dot(v,vec2f(127.1,311.7)))*43758.5453); }
fn noise(v:vec2f)->f32 {
 let i=floor(v); let f=fract(v); let u=f*f*(3.0-2.0*f);
 return mix(mix(hash(i),hash(i+vec2f(1.0,0.0)),u.x),mix(hash(i+vec2f(0.0,1.0)),hash(i+vec2f(1.0,1.0)),u.x),u.y);
}
fn fbm(v:vec2f)->f32 { var x=v; var value=0.0; var amp=0.55; for(var i=0;i<4;i=i+1){value+=noise(x)*amp;x=x*2.03+vec2f(8.2,3.7);amp*=0.5;} return value; }
fn sdSegment(p0:vec2f,a:vec2f,b:vec2f)->f32 { let pa=p0-a; let ba=b-a; let h=clamp(dot(pa,ba)/dot(ba,ba),0.0,1.0); return length(pa-ba*h); }
fn roundedBox(p0:vec2f, center:vec2f, size:vec2f, radius:f32)->f32 { let q=abs(p0-center)-size+vec2f(radius); return length(max(q,vec2f(0.0)))+min(max(q.x,q.y),0.0)-radius; }
@vertex fn vs(@builtin(vertex_index) index:u32)->VertexOut {
 var pts=array<vec2f,3>(vec2f(-1.0,-1.0),vec2f(3.0,-1.0),vec2f(-1.0,3.0));
 let raw=pts[index]; let pos=raw*(1.0+draw.zoom)+draw.offset; var out:VertexOut; out.position=vec4f(pos,0.0,1.0); out.uv=vec2f(pos.x*0.5+0.5,0.5-pos.y*0.5); return out;
}
@fragment fn fs(in:VertexOut)->SceneOut {
 let uv=in.uv; let t=p.time; let horizon=0.386; let water=uv.y>horizon;
 let sunHeight=sin((p.day-0.25)*6.2831853);
 let sunDir=vec2f(0.5+cos((p.day-0.5)*6.2831853)*0.39,0.35-max(0.0,sunHeight)*0.22);
 let dayLight=smoothstep(-0.12,0.22,sunHeight);
 let skyTop=mix(vec3f(0.036,0.20,0.28),vec3f(0.22,0.70,0.77),dayLight);
 let skyHorizon=mix(vec3f(0.72,0.39,0.33),vec3f(0.94,0.71,0.48),dayLight);
 var color=mix(skyTop,skyHorizon,smoothstep(0.04,horizon,uv.y));
 let sunDistance=length((uv-sunDir)*vec2f(1.0,1.52));
 let sunGlow=exp(-sunDistance*21.0)*0.22+exp(-sunDistance*5.0)*0.11;
 color+=vec3f(1.0,0.75,0.42)*sunGlow*dayLight;
 let moonDistance=length((uv-vec2f(1.0-sunDir.x,0.18))*vec2f(1.0,1.4));
 let moon=exp(-moonDistance*180.0)*p.night;
 color=mix(color,vec3f(0.82,0.91,0.85),moon);
 let cloudField=fbm(vec2f(uv.x*7.0+t*0.003,uv.y*15.0-t*0.001));
 let cloudBand=1.0-smoothstep(0.48,0.73,abs(uv.y-(0.17+cloudField*0.09)));
 let cloudShape=smoothstep(0.46,0.66,fbm(vec2f(uv.x*8.0+t*0.002,uv.y*9.0)));
 let cloud=cloudBand*cloudShape*0.43;
 color=mix(color,vec3f(0.91,0.91,0.82),cloud);

 // Layered island ridges and mangrove silhouettes.
 let ridgeA=0.369-0.082*exp(-pow((uv.x-0.20)/0.105,2.0))-0.049*exp(-pow((uv.x-0.39)/0.12,2.0));
 let ridgeB=0.384-0.062*exp(-pow((uv.x-0.205)/0.14,2.0))-0.032*exp(-pow((uv.x-0.43)/0.18,2.0));
 let islandA=1.0-smoothstep(ridgeA-0.002,ridgeA+0.002,uv.y);
 let islandB=1.0-smoothstep(ridgeB-0.003,ridgeB+0.002,uv.y);
 color=mix(color,vec3f(0.20,0.42,0.34),islandB);
 color=mix(color,vec3f(0.31,0.52,0.36),islandA);
 let shoreLine=1.0-smoothstep(0.002,0.006,abs(uv.y-ridgeA));
 color=mix(color,vec3f(0.86,0.75,0.54),shoreLine*0.68);
 for(var palm=0;palm<5;palm=palm+1){
   let px=0.115+f32(palm)*0.063; let baseY=0.36-0.055*exp(-pow((px-0.2)/0.1,2.0)); let height=0.032+f32((palm*7)%3)*0.006;
   let trunk=sdSegment(uv,vec2f(px,baseY),vec2f(px+0.008,baseY-height));
   let crown=vec2f(px+0.008,baseY-height);
   var leaf=0.0; for(var branch=0;branch<5;branch=branch+1){let a=f32(branch)*1.256-0.35; leaf=max(leaf,1.0-smoothstep(0.0018,0.0035,sdSegment(uv,crown,crown+vec2f(cos(a)*0.026,sin(a)*0.013))));}
   let trunkMask=1.0-smoothstep(0.0012,0.0024,trunk); color=mix(color,vec3f(0.10,0.28,0.24),max(trunkMask,leaf));
 }
 // Far-water plate; the spectral water is composited in the next pass.
 let waterBase=mix(vec3f(0.10,0.42,0.48),vec3f(0.026,0.24,0.34),smoothstep(horizon,1.0,uv.y));
 color=select(color,waterBase,water);

 // Dock, plank seams, and the fisher silhouette.
 let depth=clamp((uv.y-0.42)/0.58,0.0,1.0);
 let dockCenter=mix(0.31,0.52,depth);
 let dockHalf=mix(0.019,0.17,depth);
 let dock=uv.y>0.418 && abs(uv.x-dockCenter)<dockHalf;
 let plankLine=abs(fract((uv.y-0.418)*46.0)-0.5);
 color=mix(color,vec3f(0.48,0.28,0.16),dock);
 color=mix(color,vec3f(0.74,0.50,0.29),select(0.0,0.36,plankLine<0.08 && dock));
 let post=sdSegment(uv,vec2f(0.285,0.485),vec2f(0.285,0.435));
 color=mix(color,vec3f(0.33,0.23,0.16),select(0.0,0.8,post<0.003));
 let body=roundedBox(uv,vec2f(0.39,0.492),vec2f(0.008,0.024),0.006);
 let head=length((uv-vec2f(0.39,0.458))*vec2f(1.0,0.9))-0.009;
 let hat=roundedBox(uv,vec2f(0.39,0.447),vec2f(0.012,0.003),0.002);
 color=mix(color,vec3f(0.84,0.67,0.43),select(0.0,0.9,body<0.0 || head<0.0 || hat<0.0));
 let rod=sdSegment(uv,vec2f(0.397,0.47),vec2f(0.494,0.304));
 color=mix(color,vec3f(0.24,0.21,0.16),select(0.0,0.86,rod<0.0013));
 let castLine=sdSegment(uv,vec2f(0.494,0.304),vec2f(p.bobberX,p.bobberY));
 color=mix(color,vec3f(0.92,0.85,0.68),select(0.0,p.cast*0.58,castLine<0.0008));
 let bobber=length(uv-vec2f(p.bobberX,p.bobberY))-0.006;
 let bobberMask=(1.0-smoothstep(0.0,0.003,bobber))*p.bobberVisible;
 color=mix(color,vec3f(0.95,0.37,0.22),bobberMask);
 // A distant whale breaching briefly beyond the reef.
 let whaleCenter=vec2f(0.73,0.365+p.whale*0.045);
 let whaleBody=length((uv-whaleCenter)*vec2f(1.0,1.8))-0.025;
 let whaleTail=sdSegment(uv,whaleCenter+vec2f(-0.018,0.008),whaleCenter+vec2f(-0.037,0.022));
 let whaleMask=(1.0-smoothstep(-0.001,0.002,min(whaleBody,whaleTail-0.002)))*p.whale;
 color=mix(color,vec3f(0.10,0.27,0.32),whaleMask);

 var out:SceneOut; out.color=vec4f(color,1.0); out.velocity=vec2f(0.0); out.waterCode=select(0.0,1.0,water); return out;
}`;

const maskWGSL = /* wgsl */ `
struct VertexOut{@builtin(position) position:vec4f,@location(0) uv:vec2f};
@vertex fn vs(@builtin(vertex_index) index:u32)->VertexOut{var pts=array<vec2f,3>(vec2f(-1.0,-1.0),vec2f(3.0,-1.0),vec2f(-1.0,3.0));let pos=pts[index];var o:VertexOut;o.position=vec4f(pos,0.0,1.0);o.uv=vec2f(pos.x*0.5+0.5,0.5-pos.y*0.5);return o;}
@fragment fn fs(in:VertexOut)->@location(0) f32{let uv=in.uv;let d=clamp((uv.y-0.42)/0.58,0.0,1.0);let center=mix(0.31,0.52,d);let halfWidth=mix(0.019,0.17,d);return select(0.0,1.0,uv.y>0.418 && abs(uv.x-center)<halfWidth);}`;

const waterWGSL = /* wgsl */ `
struct Params { time:f32,bobberX:f32,bobberY:f32,bobberVisible:f32,cast:f32,tension:f32,whale:f32,day:f32,night:f32,pad0:f32,pad1:f32,pad2:f32,pad3:f32,pad4:f32,pad5:f32,pad6:f32 };
struct VertexOut{@builtin(position) position:vec4f,@location(0) uv:vec2f};
@group(0) @binding(0) var<uniform> p:Params;
struct DrawParams { offset:vec2f, zoom:f32, pad:f32 };
@group(0) @binding(1) var<uniform> draw:DrawParams;
@group(1) @binding(0) var opaqueCopy:texture_2d<f32>;
@group(1) @binding(1) var waterCode:texture_2d<f32>;
@group(1) @binding(2) var holeMask:texture_2d<f32>;
@group(1) @binding(3) var<storage,read> cascade0:array<vec4f>;
@group(1) @binding(4) var<storage,read> cascade1:array<vec4f>;
@group(1) @binding(5) var<storage,read> cascade2:array<vec4f>;
@group(1) @binding(6) var<storage,read> cascade3:array<vec4f>;
fn hash(v:vec2f)->f32{return fract(sin(dot(v,vec2f(127.1,311.7)))*43758.5453);}
fn noise(v:vec2f)->f32{let i=floor(v);let f=fract(v);let u=f*f*(3.0-2.0*f);return mix(mix(hash(i),hash(i+vec2f(1.0,0.0)),u.x),mix(hash(i+vec2f(0.0,1.0)),hash(i+vec2f(1.0,1.0)),u.x),u.y);}
fn sampleWave(field:ptr<storage,array<vec4f>,read>,world:vec2f,scale:f32)->vec4f{let uv=fract(world/scale+vec2f(0.5));let cell=vec2u(uv*64.0);let idx=cell.y*64u+cell.x;return (*field)[idx];}
@vertex fn vs(@builtin(vertex_index) index:u32)->VertexOut{var pts=array<vec2f,3>(vec2f(-1.0,-1.0),vec2f(3.0,-1.0),vec2f(-1.0,3.0));let raw=pts[index];let pos=raw*(1.0+draw.zoom)+draw.offset;var o:VertexOut;o.position=vec4f(pos,0.0,1.0);o.uv=vec2f(pos.x*0.5+0.5,0.5-pos.y*0.5);return o;}
@fragment fn fs(in:VertexOut)->@location(0) vec4f{
 let uv=in.uv;let dims=textureDimensions(waterCode);let pixel=vec2i(clamp(uv*vec2f(dims),vec2f(0.0),vec2f(dims)-vec2f(1.0)));
 if(textureLoad(waterCode,pixel,0).r<0.5 || textureLoad(holeMask,pixel,0).r>0.5 || uv.y<0.386){discard;}
 let world=vec2f((uv.x-0.5)*240.0,(uv.y-0.386)*560.0);
 let a=sampleWave(&cascade0,world,7.35);let b=sampleWave(&cascade1,world,31.7);let c=sampleWave(&cascade2,world,173.4);let d=sampleWave(&cascade3,world,733.2);
 let height=a.y*0.18+b.y*0.26+c.y*0.34+d.y*0.42;
 let chop=a.x*0.07+b.x*0.1+c.x*0.12+d.x*0.08;
 let depth=smoothstep(0.386,1.0,uv.y);
 let shallow=mix(vec3f(0.18,0.66,0.63),vec3f(0.035,0.31,0.40),depth);
 let deep=mix(shallow,vec3f(0.018,0.17,0.28),smoothstep(0.30,0.95,depth));
 let ripple1=sin(world.x*0.20+world.y*0.034+p.time*1.5+height*3.0+chop*12.0);
 let ripple2=sin(world.x*0.083-world.y*0.075-p.time*0.92+height*2.4);
 let glint=pow(max(0.0,ripple1*0.58+ripple2*0.36+0.28),10.0)*(0.12+0.22*(1.0-depth));
 let sunRay=exp(-abs(uv.x-(0.76+height*0.018))*36.0)*(1.0-depth)*0.22;
 let caustic=pow(max(0.0,sin(world.x*0.31+noise(world*0.024+p.time*0.11)*3.5)*sin(world.y*0.29-world.x*0.12+p.time*0.13)),14.0)*(1.0-depth)*0.25;
 let refractOffset=vec2i(i32(chop*4.0),i32(height*2.0));
 let reflectedPixel=vec2i(clamp(vec2f(f32(pixel.x),f32(dims.y)*0.73-(uv.y-0.386)*f32(dims.y)*0.34)+vec2f(refractOffset)),vec2f(0.0),vec2f(dims)-vec2f(1.0)));
 let reflection=textureLoad(opaqueCopy,reflectedPixel,0).rgb;
 let fresnel=pow(0.18+depth*0.65,2.0);
 var color=deep+vec3f(glint*0.82,glint*0.90,glint*0.77)+vec3f(sunRay*1.0,sunRay*0.68,sunRay*0.37)+vec3f(caustic*0.42,caustic*0.72,caustic*0.54);
 color=mix(color,reflection,0.09+fresnel*0.25);
 let foam=max(max(a.w*0.55,b.w*0.42),max(c.w*0.28,d.w*0.17));
 color=mix(color,vec3f(0.77,0.91,0.83),foam*0.7);
 let edgeFoam=pow(max(0.0,sin(world.x*0.14+world.y*0.08+p.time*0.7)),18.0)*(1.0-smoothstep(0.386,0.44,uv.y))*0.15;
 color+=vec3f(edgeFoam*0.72,edgeFoam,edgeFoam*0.78);
 let alpha=0.89+foam*0.09;return vec4f(color,alpha);
}`;

const presentWGSL = /* wgsl */ `
struct VertexOut{@builtin(position) position:vec4f,@location(0) uv:vec2f};
@group(0) @binding(0) var source:texture_2d<f32>;
@vertex fn vs(@builtin(vertex_index) index:u32)->VertexOut{var pts=array<vec2f,3>(vec2f(-1.0,-1.0),vec2f(3.0,-1.0),vec2f(-1.0,3.0));let pos=pts[index];var o:VertexOut;o.position=vec4f(pos,0.0,1.0);o.uv=vec2f(pos.x*0.5+0.5,0.5-pos.y*0.5);return o;}
@fragment fn fs(in:VertexOut)->@location(0) vec4f{let dims=textureDimensions(source);let pixel=vec2i(clamp(in.uv*vec2f(dims),vec2f(0.0),vec2f(dims)-vec2f(1.0)));let c=textureLoad(source,pixel,0).rgb;return vec4f(c,1.0);}`;

export class SceneRenderer {
  constructor(core, canvas, ocean) {
    this.core = core;
    this.canvas = canvas;
    this.ocean = ocean;
    this.uniform = core.makeUniformBuffer("scene and draw parameters", 64);
    this.resources = null;
    this.bundlePromise = this.createPipelines();
  }

  async createPipelines() {
    const { device, format } = this.core;
    const sceneModule = device.createShaderModule({ label: "opaque island scene", code: sceneWGSL });
    const maskModule = device.createShaderModule({ label: "dock hole mask", code: maskWGSL });
    const waterModule = device.createShaderModule({ label: "spectral water composition", code: waterWGSL });
    const presentModule = device.createShaderModule({ label: "scene present", code: presentWGSL });
    const descriptor = (label, module, targets, depthStencil) => ({
      label, layout: "auto", vertex: { module, entryPoint: "vs" },
      fragment: { module, entryPoint: "fs", targets },
      primitive: { topology: "triangle-list" }, ...(depthStencil ? { depthStencil } : {}),
    });
    const blend = { color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha", operation: "add" }, alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" } };
    const targets = [
      { format: "rgba16float" },
      { format: "rg16float" },
      { format: "r8unorm" },
    ];
    const requests = [
      ["scene-opaque", descriptor("MRT opaque scene", sceneModule, targets, { format: "depth32float", depthWriteEnabled: true, depthCompare: "always" })],
      ["scene-hole-mask", descriptor("dock hole mask", maskModule, [{ format: "r8unorm" }])],
      ["scene-water", descriptor("water and transparent overlay", waterModule, [{ format: "rgba16float", blend }], { format: "depth32float", depthWriteEnabled: false, depthCompare: "always" })],
      ["scene-present", descriptor("present scene", presentModule, [{ format }])],
    ];
    await this.core.prewarm(requests.map(([key, desc]) => [key, desc, "render"]));
    this.pipelines = Object.fromEntries(await Promise.all(requests.map(async ([key]) => [key, await this.core.pipelineCache.get(key)])));
    const drawBuffer = this.core.ensureDrawBuffer(1);
    this.sceneGroup = device.createBindGroup({ layout: this.pipelines["scene-opaque"].getBindGroupLayout(0), entries: [
      { binding: 0, resource: { buffer: this.uniform } },
      { binding: 1, resource: { buffer: drawBuffer, offset: 0, size: 256 } },
    ] });
    this.waterSceneGroup = device.createBindGroup({ layout: this.pipelines["scene-water"].getBindGroupLayout(0), entries: [
      { binding: 0, resource: { buffer: this.uniform } },
      { binding: 1, resource: { buffer: drawBuffer, offset: 0, size: 256 } },
    ] });
    return true;
  }

  refreshResources(width, height) {
    if (this.resources?.width === width && this.resources?.height === height) return;
    this.resources?.textures.forEach((texture) => texture.destroy());
    const usage = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST;
    const color = this.core.texture("scene color", width, height, "rgba16float", usage);
    const velocity = this.core.texture("scene velocity", width, height, "rg16float", usage);
    const code = this.core.texture("water code", width, height, "r8unorm", usage);
    const depth = this.core.texture("scene depth", width, height, "depth32float", GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING);
    const opaqueColor = this.core.texture("opaque color copy", width, height, "rgba16float", usage);
    const opaqueDepth = this.core.texture("opaque depth copy", width, height, "depth32float", GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING);
    const holes = this.core.texture("dock hole mask", width, height, "r8unorm", usage);
    const waveBuffers = this.ocean.waveBuffers;
    const waterGroup = this.core.device.createBindGroup({
      layout: this.pipelines["scene-water"].getBindGroupLayout(1),
      entries: [
        { binding: 0, resource: opaqueColor.createView() },
        { binding: 1, resource: code.createView() },
        { binding: 2, resource: holes.createView() },
        ...waveBuffers.map((buffer, index) => ({ binding: 3 + index, resource: { buffer } })),
      ],
    });
    this.resources = { width, height, textures: [color, velocity, code, depth, opaqueColor, opaqueDepth, holes], color, velocity, code, depth, opaqueColor, opaqueDepth, holes, waterGroup };
  }

  updateUniform(game, time) {
    const day = game.dayPhase;
    const data = new Float32Array(16);
    data.set([
      time,
      game.bobber.x,
      game.bobber.y,
      game.bobber.visible ? 1 : 0,
      game.castProgress,
      game.tension,
      game.whalePulse,
      day,
      1 - day,
      0, 0, 0, 0, 0, 0, 0,
    ]);
    this.core.queue.writeBuffer(this.uniform, 0, data);
    this.core.writeDrawRecords([[0, 0, 0, 0]]);
  }

  async render(game, time, deltaSeconds) {
    await this.bundlePromise;
    await this.ocean.pipelinePromise;
    // One command encoder owns ocean compute, opaque MRT, copies, mask, water, and presentation.
    const encoder = this.core.beginFrame();
    this.updateUniform(game, time);
    const { width, height } = this.core;
    this.refreshResources(width, height);
    await this.ocean.encode(encoder, deltaSeconds, time);
    const r = this.resources;
    const scenePass = encoder.beginRenderPass({
      label: "opaque island scene: color + velocity + water-code MRT",
      colorAttachments: [r.color, r.velocity, r.code].map((texture, index) => ({
        view: texture.createView(),
        clearValue: index === 0 ? { r: 0.03, g: 0.16, b: 0.2, a: 1 } : { r: 0, g: 0, b: 0, a: 0 },
        loadOp: "clear", storeOp: "store",
      })),
      depthStencilAttachment: { view: r.depth.createView(), depthClearValue: 1, depthLoadOp: "clear", depthStoreOp: "store" },
    });
    scenePass.setPipeline(this.pipelines["scene-opaque"]);
    scenePass.setBindGroup(0, this.sceneGroup);
    scenePass.draw(3);
    scenePass.end();

    encoder.copyTextureToTexture({ texture: r.color }, { texture: r.opaqueColor }, { width, height, depthOrArrayLayers: 1 });
    encoder.copyTextureToTexture({ texture: r.depth }, { texture: r.opaqueDepth }, { width, height, depthOrArrayLayers: 1 });

    const maskPass = encoder.beginRenderPass({ label: "dock and boat hole mask", colorAttachments: [{ view: r.holes.createView(), clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: "clear", storeOp: "store" }] });
    maskPass.setPipeline(this.pipelines["scene-hole-mask"]);
    maskPass.draw(3);
    maskPass.end();

    const waterPass = encoder.beginRenderPass({
      label: "spectral water, caustics, refraction, transparent layer",
      colorAttachments: [{ view: r.color.createView(), loadOp: "load", storeOp: "store" }],
      depthStencilAttachment: { view: r.depth.createView(), depthLoadOp: "load", depthStoreOp: "store" },
    });
    waterPass.setPipeline(this.pipelines["scene-water"]);
    waterPass.setBindGroup(0, this.waterSceneGroup);
    waterPass.setBindGroup(1, r.waterGroup);
    waterPass.draw(3);
    waterPass.end();

    const presentGroup = this.core.device.createBindGroup({ layout: this.pipelines["scene-present"].getBindGroupLayout(0), entries: [{ binding: 0, resource: r.color.createView() }] });
    const presentPass = encoder.beginRenderPass({ label: "tone map to browser canvas", colorAttachments: [{ view: this.core.context.getCurrentTexture().createView(), clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: "clear", storeOp: "store" }] });
    presentPass.setPipeline(this.pipelines["scene-present"]);
    presentPass.setBindGroup(0, presentGroup);
    presentPass.draw(3);
    presentPass.end();
    this.core.submit(encoder);
  }
}
