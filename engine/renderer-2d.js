const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/** Art-directed Canvas fallback. It keeps the game playable without WebGPU support. */
export class CanvasSceneRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });
    this.dpr = 1;
  }

  resize() {
    const mobile = window.matchMedia("(max-width:650px)").matches;
    const ratio = this.dpr = Math.min(window.devicePixelRatio || 1, mobile ? 1.35 : 2);
    const width = Math.max(1, Math.round(this.canvas.clientWidth * ratio));
    const height = Math.max(1, Math.round(this.canvas.clientHeight * ratio));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    this.ctx.setTransform(width, 0, 0, height, 0, 0);
  }

  draw(game, time) {
    if (!this.ctx) return;
    this.resize();
    const c = this.ctx;
    const t = time;
    const w = this.canvas.width / this.dpr;
    const h = this.canvas.height / this.dpr;
    c.setTransform(w, 0, 0, h, 0, 0);
    const horizon = 0.382;

    const sky = c.createLinearGradient(0, 0, 0, horizon);
    sky.addColorStop(0, game.dayPhase < 0.16 ? "#284e6a" : "#76c7cd");
    sky.addColorStop(0.58, game.dayPhase < 0.16 ? "#bc8878" : "#bde0d2");
    sky.addColorStop(1, game.dayPhase < 0.16 ? "#edbd86" : "#f4d0a1");
    c.fillStyle = sky;
    c.fillRect(0, 0, 1, horizon + 0.02);

    // Atmospheric veil and slow cloud banks.
    c.globalAlpha = 0.64;
    for (let i = 0; i < 5; i += 1) {
      const x = ((i * 0.235 + t * (0.0015 + i * 0.00015)) % 1.32) - 0.12;
      const y = 0.12 + (i % 3) * 0.053 + Math.sin(t * 0.08 + i) * 0.004;
      const scale = 0.072 + (i % 2) * 0.029;
      c.fillStyle = i % 2 ? "rgba(255,247,227,.58)" : "rgba(234,248,231,.65)";
      c.beginPath();
      c.ellipse(x, y, scale, scale * 0.12, 0, 0, Math.PI * 2);
      c.ellipse(x - scale * 0.32, y + 0.004, scale * 0.45, scale * 0.16, 0, 0, Math.PI * 2);
      c.ellipse(x + scale * 0.27, y - 0.006, scale * 0.38, scale * 0.17, 0, 0, Math.PI * 2);
      c.fill();
    }
    c.globalAlpha = 1;

    // Sun halo and a gentle volumetric light cone.
    const sx = 0.76 + Math.sin(t * 0.011) * 0.025;
    const sy = 0.21 + Math.cos(t * 0.01) * 0.012;
    const halo = c.createRadialGradient(sx, sy, 0.008, sx, sy, 0.19);
    halo.addColorStop(0, "rgba(255,239,181,.95)");
    halo.addColorStop(0.09, "rgba(255,225,164,.25)");
    halo.addColorStop(1, "rgba(255,224,157,0)");
    c.fillStyle = halo;
    c.fillRect(sx - 0.2, 0.02, 0.4, 0.42);
    c.fillStyle = "#fff2c9";
    c.beginPath(); c.arc(sx, sy, 0.018, 0, Math.PI * 2); c.fill();

    // Distant island profiles.
    const ridge = (color, baseY, peaks) => {
      c.fillStyle = color;
      c.beginPath(); c.moveTo(0, baseY);
      peaks.forEach(([x, y]) => c.lineTo(x, y));
      c.lineTo(1, baseY); c.lineTo(1, horizon + 0.035); c.lineTo(0, horizon + 0.035); c.closePath(); c.fill();
    };
    ridge("#637e70", 0.375, [[0.02, 0.365], [0.09, 0.33], [0.145, 0.339], [0.21, 0.288], [0.27, 0.312], [0.35, 0.342], [0.43, 0.318], [0.49, 0.348], [0.61, 0.354], [0.69, 0.332], [0.78, 0.348], [0.91, 0.339], [1, 0.36]]);
    ridge("#385f4d", 0.39, [[0, 0.373], [0.07, 0.35], [0.14, 0.366], [0.2, 0.321], [0.25, 0.335], [0.3, 0.365], [0.4, 0.351], [0.49, 0.376], [0.56, 0.359], [0.64, 0.37], [0.73, 0.35], [0.84, 0.37], [0.95, 0.351], [1, 0.36]]);
    c.fillStyle = "rgba(241,208,159,.88)";
    c.beginPath(); c.moveTo(0.10, 0.381); c.quadraticCurveTo(0.31, 0.36, 0.47, 0.38); c.lineTo(0.47, 0.386); c.lineTo(0.10, 0.386); c.fill();

    // Palms with curved trunks and simple fronds.
    const palm = (x, y, s, color) => {
      c.strokeStyle = color; c.lineCap = "round"; c.lineWidth = 0.0035 * s;
      c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x - 0.006 * s, y - 0.025 * s, x + 0.008 * s, y - 0.052 * s); c.stroke();
      const cx = x + 0.008 * s; const cy = y - 0.052 * s;
      for (let j = 0; j < 5; j += 1) {
        const a = -2.88 + j * 0.77;
        c.lineWidth = 0.0026 * s;
        c.beginPath(); c.moveTo(cx, cy); c.quadraticCurveTo(cx + Math.cos(a) * 0.014 * s, cy + Math.sin(a) * 0.006 * s, cx + Math.cos(a) * 0.029 * s, cy + Math.sin(a) * 0.015 * s); c.stroke();
      }
    };
    palm(0.16, 0.36, 0.9, "#263f36"); palm(0.23, 0.331, 0.8, "#2d4839"); palm(0.3, 0.362, 0.68, "#263f36"); palm(0.41, 0.354, 0.58, "#2d4839");

    const sea = c.createLinearGradient(0, horizon, 0, 1);
    sea.addColorStop(0, "#3c9998"); sea.addColorStop(0.22, "#267f86"); sea.addColorStop(0.65, "#155a69"); sea.addColorStop(1, "#124b5d");
    c.fillStyle = sea; c.fillRect(0, horizon, 1, 1 - horizon);

    // Sun path shimmer and near-shore caustics.
    const glimmerX = 0.76;
    for (let row = 0; row < 19; row += 1) {
      const y = horizon + 0.03 + row * 0.029;
      const width = 0.018 + row * 0.005;
      const x = glimmerX + Math.sin(t * 0.78 + row * 1.7) * (0.008 + row * 0.0014);
      c.globalAlpha = (0.09 + Math.sin(t + row) * 0.035) * (1 - row / 25);
      c.strokeStyle = row % 3 === 0 ? "#f9dfad" : "#d6f3cf";
      c.lineWidth = 0.0012 + row * 0.00008;
      c.beginPath(); c.moveTo(x - width, y); c.quadraticCurveTo(x, y + 0.002 * Math.sin(t + row), x + width, y); c.stroke();
    }
    c.globalAlpha = 1;
    for (let row = 0; row < 8; row += 1) {
      for (let col = 0; col < 13; col += 1) {
        const x = 0.03 + col * 0.038 + Math.sin(t * 0.38 + row * 1.9 + col) * 0.006;
        const y = 0.43 + row * 0.038 + Math.cos(t * 0.31 + col) * 0.003;
        const shine = Math.max(0, Math.sin(t * 1.3 + row * 1.9 + col * 2.2));
        c.globalAlpha = shine * 0.11 * (1 - row / 10);
        c.fillStyle = "#d6f3c4";
        c.beginPath(); c.ellipse(x, y, 0.005 + row * 0.0003, 0.0018, 0.3, 0, Math.PI * 2); c.fill();
      }
    }
    c.globalAlpha = 1;

    // Procedural swell lines — visual fallback for the GPU spectral field.
    for (let layer = 0; layer < 8; layer += 1) {
      const depth = layer / 7;
      const y = horizon + 0.06 + depth * 0.54;
      c.strokeStyle = `rgba(197,237,218,${0.15 - depth * 0.075})`;
      c.lineWidth = 0.0009 + depth * 0.001;
      c.beginPath();
      for (let x = -0.02; x <= 1.02; x += 0.009) {
        const wave = Math.sin(x * (20 + depth * 21) - t * (0.55 + depth * 0.35) + layer) * (0.0012 + depth * 0.0023);
        if (x < 0) c.moveTo(x, y + wave); else c.lineTo(x, y + wave);
      }
      c.stroke();
    }

    // Gentle breakers by the reef.
    c.strokeStyle = "rgba(231,244,218,.48)"; c.lineWidth = 0.0015;
    for (let i = 0; i < 4; i += 1) {
      const x = 0.04 + i * 0.095 + ((t * 0.01 + i * 0.17) % 0.08);
      const y = horizon + 0.025 + Math.sin(t * 0.3 + i) * 0.004;
      c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x + 0.018, y - 0.003, x + 0.038, y + 0.002); c.stroke();
    }

    // Whale breach that appears on a short, readable cycle.
    if (game.whalePulse > 0.01) {
      const x = 0.735; const y = 0.389 - game.whalePulse * 0.07;
      c.save(); c.globalAlpha = Math.min(1, game.whalePulse * 1.8); c.fillStyle = "#254f57";
      c.beginPath(); c.ellipse(x, y, 0.043, 0.017, -0.12, Math.PI, Math.PI * 2); c.fill();
      c.beginPath(); c.moveTo(x - 0.027, y - 0.007); c.lineTo(x - 0.048, y - 0.031); c.lineTo(x - 0.01, y - 0.016); c.fill();
      c.restore();
      for (let i = 0; i < 5; i += 1) { c.globalAlpha = game.whalePulse * 0.16; c.strokeStyle = "#eff4d3"; c.lineWidth = 0.0017; c.beginPath(); c.ellipse(x, 0.396, 0.026 + i * 0.009, 0.004 + i * 0.001, 0, 0, Math.PI * 2); c.stroke(); }
      c.globalAlpha = 1;
    }

    // Perspective timber jetty. The matching GPU pass writes its water hole mask.
    const centerAt = (y) => 0.31 + clamp((y - 0.42) / 0.58, 0, 1) * 0.21;
    const halfAt = (y) => 0.019 + clamp((y - 0.42) / 0.58, 0, 1) * 0.151;
    c.fillStyle = "#634328"; c.beginPath(); c.moveTo(centerAt(0.418) - halfAt(0.418), 0.418); c.lineTo(centerAt(1) - halfAt(1), 1); c.lineTo(centerAt(1) + halfAt(1), 1); c.lineTo(centerAt(0.418) + halfAt(0.418), 0.418); c.closePath(); c.fill();
    const dockGrad = c.createLinearGradient(0.3, 0.43, 0.52, 1); dockGrad.addColorStop(0, "#bb8851"); dockGrad.addColorStop(0.45, "#9a673c"); dockGrad.addColorStop(1, "#71472d");
    c.fillStyle = dockGrad; c.beginPath(); c.moveTo(centerAt(0.418) - halfAt(0.418) * 0.82, 0.418); c.lineTo(centerAt(1) - halfAt(1) * 0.92, 1); c.lineTo(centerAt(1) + halfAt(1) * 0.92, 1); c.lineTo(centerAt(0.418) + halfAt(0.418) * 0.82, 0.418); c.closePath(); c.fill();
    for (let i = 1; i < 18; i += 1) {
      const y = 0.418 + (i / 18) ** 1.5 * 0.582;
      const hw = halfAt(y) * 0.86;
      c.strokeStyle = i % 3 === 0 ? "rgba(246,199,126,.46)" : "rgba(74,45,28,.26)";
      c.lineWidth = i % 3 === 0 ? 0.0018 : 0.001;
      c.beginPath(); c.moveTo(centerAt(y) - hw, y); c.lineTo(centerAt(y) + hw, y); c.stroke();
    }
    for (let i = 0; i < 6; i += 1) {
      const y = 0.47 + i * 0.077; const x = centerAt(y) - halfAt(y) + 0.008;
      c.fillStyle = "#473622"; c.fillRect(x, y, 0.004 + i * 0.001, 0.005 + i * 0.0015);
    }
    // Bollards and a rope edge catch the warm light.
    c.strokeStyle = "rgba(244,205,148,.55)"; c.lineWidth = 0.002;
    c.beginPath(); c.moveTo(centerAt(0.43) - halfAt(0.43), 0.43); c.lineTo(centerAt(0.94) - halfAt(0.94), 0.94); c.stroke();

    // Fisher, rod and bobber sit above the jetty.
    c.fillStyle = "#e5c995";
    c.beginPath(); c.ellipse(0.39, 0.46, 0.010, 0.011, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = "#544a39"; c.beginPath(); c.ellipse(0.39, 0.447, 0.014, 0.0042, -0.08, 0, Math.PI * 2); c.fill();
    c.fillStyle = "#729082"; c.beginPath(); c.moveTo(0.378, 0.474); c.quadraticCurveTo(0.39, 0.466, 0.401, 0.474); c.lineTo(0.405, 0.505); c.lineTo(0.375, 0.505); c.closePath(); c.fill();
    c.strokeStyle = "#3d3529"; c.lineWidth = 0.002; c.lineCap = "round";
    c.beginPath(); c.moveTo(0.382, 0.503); c.lineTo(0.38, 0.514); c.moveTo(0.398, 0.503); c.lineTo(0.402, 0.512); c.stroke();
    c.strokeStyle = "#42372d"; c.lineWidth = 0.0013; c.beginPath(); c.moveTo(0.398, 0.473); c.quadraticCurveTo(0.442, 0.399, 0.494, 0.301); c.stroke();
    if (game.bobber.visible) {
      c.strokeStyle = "rgba(255,241,208,.68)"; c.lineWidth = 0.0008; c.beginPath(); c.moveTo(0.494, 0.301); c.lineTo(game.bobber.x, game.bobber.y); c.stroke();
      c.fillStyle = "rgba(241,251,228,.5)"; c.beginPath(); c.ellipse(game.bobber.x, game.bobber.y + 0.003, 0.022, 0.003, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = game.bite ? "#ffe58e" : "#ec875e"; c.beginPath(); c.ellipse(game.bobber.x, game.bobber.y, 0.006, 0.009, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = "#fff5cf"; c.beginPath(); c.arc(game.bobber.x, game.bobber.y - 0.004, 0.0022, 0, Math.PI * 2); c.fill();
    }

    // Subtle foliage foreground framing.
    c.globalAlpha = 0.56; c.fillStyle = "#173d36";
    for (let i = 0; i < 7; i += 1) {
      const x = (i * 0.19 + 0.03) % 1; const y = 0.39 + (i % 2) * 0.02;
      c.beginPath(); c.ellipse(x, y, 0.05, 0.011, -0.12, 0, Math.PI * 2); c.fill();
    }
    c.globalAlpha = 1;
  }
}
