import { FishingGame } from "./game/fishing-game.js";
import { FISH, GEAR } from "./game/fish.js";
import { GPUCore } from "./engine/gpu.js";
import { OceanFFT } from "./engine/ocean.js";
import { SceneRenderer } from "./engine/renderer.js";
import { CanvasSceneRenderer } from "./engine/renderer-2d.js";

const $ = (selector) => document.querySelector(selector);
const gpuCanvas = $("#gpu-canvas");
const fallbackCanvas = $("#fallback-canvas");
const toastStack = $("#toast-stack");
let renderer = null;
let rendererMode = "starting";
let game;
let rafId = 0;
let lastFrame = 0;
let uiAccumulator = 0;
let renderPending = false;
let manualClock = false;
let soundEnabled = false;
let audioContext = null;
let audioUnlocked = false;

const relativePointer = (event) => {
  const rect = event.currentTarget.getBoundingClientRect();
  return { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height };
};

function playTone(frequency = 420, duration = 0.07, type = "sine", gain = 0.035) {
  if (!soundEnabled || !audioUnlocked) return;
  try {
    audioContext ||= new AudioContext();
    const oscillator = audioContext.createOscillator();
    const volume = audioContext.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, audioContext.currentTime);
    volume.gain.setValueAtTime(gain, audioContext.currentTime);
    volume.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + duration);
    oscillator.connect(volume).connect(audioContext.destination);
    oscillator.start(); oscillator.stop(audioContext.currentTime + duration);
  } catch { /* Audio is an optional enhancement. */ }
}

function pushToast(message, highlight = "") {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.innerHTML = highlight ? `<b>${highlight}</b>${message}` : message;
  toastStack.append(toast);
  window.setTimeout(() => toast.remove(), 2700);
}

let noticeTimer = 0;
function sceneNotice(message, duration = 2300) {
  const notice = $("#scene-toast");
  notice.textContent = message;
  notice.classList.add("show");
  window.clearTimeout(noticeTimer);
  noticeTimer = window.setTimeout(() => notice.classList.remove("show"), duration);
}

function gameEvent(name, detail = {}) {
  switch (name) {
    case "cast":
      playTone(285, 0.12, "triangle", 0.05);
      sceneNotice(detail.spot === "beach" ? "饵钩落入浅滩" : "饵钩落入珊瑚湾", 1500);
      break;
    case "landed-cast": sceneNotice("海面安静下来，等等看……", 1800); break;
    case "bite":
      playTone(740, 0.16, "sine", 0.07); window.setTimeout(() => playTone(920, 0.13, "sine", 0.045), 100);
      sceneNotice(`${detail.fish.name} 试探鱼饵！扬竿！`, 2100);
      break;
    case "hooked":
      playTone(360, 0.14, "triangle", 0.06); sceneNotice(`挂住了：${detail.fish.name}`, 1400); break;
    case "missed-bite": pushToast("鱼讯很轻，鱼饵被叼走了。", "错过了 · "); break;
    case "sprint": playTone(180, 0.11, "sawtooth", 0.022); break;
    case "line-snap":
      playTone(90, 0.22, "sawtooth", 0.075); pushToast("鱼线承受不住冲刺，断开了。", "啪 · "); break;
    case "slack-escape": pushToast("鱼线松弛太久，鱼挣脱了。", "脱钩 · "); break;
    case "fish-landed":
      playTone(590, 0.11, "triangle", 0.052); window.setTimeout(() => playTone(840, 0.14, "sine", 0.045), 85);
      pushToast(`${detail.item.name} · ${detail.item.weight.toFixed(1)} kg · $${detail.item.value}`, "上鱼了 · ");
      break;
    case "level-up":
      playTone(670, 0.26, "sine", 0.07); pushToast(`你现在是 ${detail.level} 级岛民。`, "升级 · "); break;
    case "sold": playTone(520, 0.08, "triangle", 0.05); pushToast(`Elias 收下了渔获，付给你 $${detail.earnings}。`, "卖出 · "); break;
    case "gear-up": pushToast(`${detail.item.name} 已升至 ${detail.level} 级。`, "装备升级 · "); break;
    case "spot": sceneNotice(detail.spot === "beach" ? "地点切换 · 海湾沙滩" : "地点切换 · Palm Point 栈桥", 1500); break;
    case "whale": sceneNotice("远处有鲸鱼跃出海面。", 2600); playTone(115, 0.7, "sine", 0.018); break;
    default: break;
  }
  updateUI();
}

game = new FishingGame(gameEvent);

function updateCatchList() {
  const list = $("#catch-list");
  if (!game.inventory.length) {
    list.innerHTML = '<div class="empty-catch">还没有渔获<br /><span>等一阵海风吧</span></div>';
  } else {
    list.innerHTML = game.inventory.slice(0, 10).map((fish) => `
      <div class="catch-row">
        <span class="catch-emoji">${fish.emoji}</span>
        <span class="catch-info"><b>${fish.name}</b><small>${fish.weight.toFixed(1)} kg · ${fish.quality}</small></span>
        <span class="catch-price">$${fish.value}</span>
      </div>`).join("");
  }
  $("#haul-count").textContent = String(game.inventory.length);
  $("#sell-button").disabled = game.inventory.length === 0;
}

function updateUI() {
  if (!game) return;
  $("#coin-label").textContent = `$ ${game.coins}`;
  $("#level-badge").textContent = String(game.level).padStart(2, "0");
  $("#level-name").textContent = ["海风新手", "潮汐熟客", "珊瑚湾行家", "蓝水钓手", "外海旅人"][Math.min(game.level - 1, 4)];
  $("#xp-label").textContent = `${game.xp} / ${game.nextLevelXP} XP`;
  $("#xp-fill").style.width = `${Math.min(100, game.xp / game.nextLevelXP * 100)}%`;
  $("#codex-count").textContent = String(game.seen.size);
  $("#rod-label").textContent = `珊瑚海 · ${["轻型竿", "礁影远投竿 I", "礁影远投竿 II", "礁影远投竿 III"][game.gear.rod]}`;
  $("#location-tag").dataset.spot = game.spot;
  const spotLabel = $("#location-tag").querySelector("small");
  if (spotLabel) spotLabel.textContent = game.spot === "beach" ? "月牙湾沙滩" : "南侧栈桥";

  const castButton = $("#cast-button");
  const title = castButton.querySelector("b");
  const key = castButton.querySelector("small");
  const canCast = ["idle", "snapped", "escaped", "landed"].includes(game.mode);
  castButton.disabled = !canCast && game.mode !== "bite";
  castButton.classList.toggle("is-hook", game.mode === "bite");
  if (game.mode === "bite") { title.textContent = "扬竿！"; key.textContent = "HOOK NOW"; }
  else if (game.mode === "casting") { title.textContent = "抛投中"; key.textContent = "CASTING"; }
  else if (game.mode === "waiting") { title.textContent = "等鱼讯"; key.textContent = `${Math.max(0, game.waitTimer).toFixed(1)} SEC`; }
  else if (game.mode === "fight") { title.textContent = "搏鱼中"; key.textContent = "KEEP TENSION"; }
  else if (game.mode === "landed") { title.textContent = "再抛一次"; key.textContent = "SPACE"; }
  else if (game.mode === "snapped") { title.textContent = "重新抛竿"; key.textContent = "LINE SNAPPED"; }
  else if (game.mode === "escaped") { title.textContent = "重新抛竿"; key.textContent = "FISH ESCAPED"; }
  else { title.textContent = "抛竿"; key.textContent = "SPACE"; }
  const touchLayout = window.matchMedia("(max-width:650px)").matches;
  if (touchLayout) {
    const touchLabels = { bite:"点按扬竿", casting:"抛投中", waiting:"等待鱼讯", fight:"搏鱼中", landed:"点按再抛", snapped:"线断了 · 再试", escaped:"鱼脱钩 · 再试", idle:"触摸抛竿" };
    key.textContent = touchLabels[game.mode] || "触摸抛竿";
    $("#reel-button small").textContent = "按住收线";
  } else {
    $("#reel-button small").textContent = "HOLD TO REEL";
  }

  const stateLabels = { idle:"准备就绪", casting:"正在抛投…", waiting:"浮漂轻轻晃动", bite:"鱼讯！立即扬竿", fight:game.catchFish ? `搏鱼中 · ${game.catchFish.name}` : "搏鱼中", landed:"渔获入篓", snapped:"鱼线断开", escaped:"鱼已脱钩" };
  $("#fishing-state").textContent = stateLabels[game.mode] || "准备就绪";
  $("#fight-panel").classList.toggle("active", game.mode === "fight");
  $("#fight-panel").setAttribute("aria-hidden", game.mode === "fight" ? "false" : "true");
  $("#bite-indicator").classList.toggle("show", game.mode === "bite");
  $("#tension-value").textContent = String(Math.round(game.tension));
  $("#tension-needle").style.left = `${Math.min(98, game.tension)}%`;
  $("#fish-energy-fill").style.width = `${game.energy}%`;
  $("#fish-energy-label").textContent = `${Math.round(game.energy)}%`;
  $("#dock-hint").style.opacity = game.mode === "fight" ? "0" : "1";
  $("#water-readout").textContent = game.mode === "fight" ? (game.tension > game.lineStrength ? "魚線快要斷了" : game.tension > 37 && game.tension < 65 ? "张力正合适" : "海流轻轻推着浮漂") : game.mode === "waiting" ? "等一阵海风" : "海面有细小涟漪";
  updateCatchList();

  const clockHours = Math.floor(game.daySeconds / 3600);
  const clockMinutes = Math.floor((game.daySeconds % 3600) / 60);
  $("#clock-label").textContent = `${String(clockHours).padStart(2, "0")}:${String(clockMinutes).padStart(2, "0")}`;
  const dayText = game.dayPhase < 0.22 ? "黎明" : game.dayPhase < 0.64 ? "日间" : game.dayPhase < 0.78 ? "黄昏" : "夜色";
  $("#day-label").textContent = `第 ${Math.floor(game.worldTime / 180) + 1} 天 · ${dayText}`;
  $("#sun-dot").style.left = `${Math.round(game.dayPhase * 30)}px`;
  $("#wind-label").textContent = game.wind < 3.1 ? "微风" : game.wind < 4 ? "和风" : "海风";
  $("#weather-label").textContent = game.wind > 4.2 ? "海风" : "晴朗";
  $("#weather-icon").textContent = game.wind > 4.2 ? "〰" : game.dayPhase > 0.78 ? "☾" : "☼";
}

function openModal(title, overline, content) {
  $("#modal-title").textContent = title;
  $("#modal-overline").textContent = overline;
  $("#modal-content").innerHTML = content;
  $("#modal-backdrop").hidden = false;
  window.setTimeout(() => $("#modal-close").focus(), 0);
}

function closeModal() { $("#modal-backdrop").hidden = true; }

function openShop() {
  const markup = `<p style="margin-top:-10px">Elias 的小铺只在涨潮前后开着。好竿和好线不替你拉鱼，但能让你多一分从容。</p><div class="shop-grid">${GEAR.map((item) => {
    const level = game.gear[item.id]; const price = item.price * (level + 1); const full = level >= item.max; const affordable = game.coins >= price;
    return `<div class="shop-item"><span class="shop-emoji">${item.icon}</span><span><b>${item.name} · Lv.${level}</b><small>${item.detail}</small></span><button class="shop-buy" data-buy="${item.id}" ${full || !affordable ? "disabled" : ""}>${full ? "已满级" : `$${price}`}</button></div>`;
  }).join("")}</div>`;
  openModal("码头杂货铺", "ELIAS’ TACKLE · PALM POINT", markup);
}

function openCodex() {
  const cards = FISH.map((fish) => {
    const found = game.seen.has(fish.id);
    return `<div class="codex-cell ${found ? "found" : ""}" title="${found ? fish.latin : "尚未发现"}"><span>${found ? fish.emoji : "◌"}</span><b>${found ? fish.name : "？？？"}</b></div>`;
  }).join("");
  openModal("珊瑚湾鱼类图鉴", `FIELD NOTES · ${String(game.seen.size).padStart(2, "0")} / 18`, `<p style="margin-top:-10px">渔夫说，风向、水深和太阳的位置都会改变鱼群。慢慢钓，慢慢认。</p><div class="codex-grid">${cards}</div>`);
}

function sellHaul() {
  const earnings = game.sellAll();
  if (!earnings) pushToast("鱼篓空空的，先去海边试试手气。", "Elias · ");
}

function castOrHook(target = null) {
  audioUnlocked = true;
  if (game.mode === "bite") game.hook();
  else game.cast(target);
  updateUI();
}

$("#cast-button").addEventListener("click", () => castOrHook());
$("#reel-button").addEventListener("pointerdown", (event) => {
  event.preventDefault(); audioUnlocked = true;
  $("#reel-button").setPointerCapture(event.pointerId);
  $("#reel-button").classList.add("is-pressed"); game.setReeling(true);
});
const releaseReel = () => { $("#reel-button").classList.remove("is-pressed"); game.setReeling(false); };
$("#reel-button").addEventListener("pointerup", releaseReel);
$("#reel-button").addEventListener("pointercancel", releaseReel);
$("#reel-button").addEventListener("lostpointercapture", releaseReel);
$("#sell-button").addEventListener("click", sellHaul);
$("#shop-open").addEventListener("click", openShop);
$("#codex-open").addEventListener("click", openCodex);
$("#location-tag").addEventListener("click", () => game.toggleSpot());
$("#modal-close").addEventListener("click", closeModal);
$("#modal-backdrop").addEventListener("click", (event) => { if (event.target === $("#modal-backdrop")) closeModal(); });
$("#modal-content").addEventListener("click", (event) => {
  const button = event.target.closest("[data-buy]");
  if (!button) return;
  const result = game.buyGear(button.dataset.buy);
  if (!result.ok) { pushToast(result.message); return; }
  openShop();
});
$("#sound-toggle").addEventListener("click", () => {
  soundEnabled = !soundEnabled; audioUnlocked = true;
  $("#sound-toggle").textContent = soundEnabled ? "♫" : "♪";
  $("#sound-toggle").classList.toggle("is-muted", !soundEnabled);
  if (soundEnabled) playTone(500, 0.08, "sine", 0.03);
  pushToast(soundEnabled ? "海湾音效已开启。" : "海湾音效已关闭。");
});
$("#fullscreen-toggle").addEventListener("click", toggleFullscreen);

function toggleFullscreen() {
  if (!document.fullscreenElement) document.querySelector(".game-shell").requestFullscreen?.();
  else document.exitFullscreen?.();
}

window.addEventListener("keydown", (event) => {
  if (["Space", "ArrowUp", "ArrowDown"].includes(event.code)) event.preventDefault();
  if (event.repeat) return;
  audioUnlocked = true;
  if (event.code === "Space") {
    if (!$("#modal-backdrop").hidden) return;
    if (game.mode === "bite") castOrHook();
    else if (["idle", "landed", "snapped", "escaped"].includes(game.mode)) castOrHook();
  } else if (event.code === "KeyF") toggleFullscreen();
  else if (event.code === "Escape") {
    if (!$("#modal-backdrop").hidden) closeModal();
    else if (document.fullscreenElement) document.exitFullscreen?.();
  } else if (event.code === "KeyE" && game.mode === "fight") {
    game.setReeling(true); $("#reel-button").classList.add("is-pressed");
  }
});
window.addEventListener("keyup", (event) => {
  if (event.code === "KeyE") releaseReel();
});

function onCanvasPointer(event, canvas) {
  if (event.button !== undefined && event.button !== 0) return;
  if (!["idle", "landed", "snapped", "escaped"].includes(game.mode)) return;
  const point = relativePointer(event);
  if (point.y > 0.40) castOrHook(point);
}
gpuCanvas.addEventListener("pointerdown", (event) => onCanvasPointer(event, gpuCanvas));
fallbackCanvas.addEventListener("pointerdown", (event) => onCanvasPointer(event, fallbackCanvas));

async function initRenderer() {
  try {
    const core = await GPUCore.create(gpuCanvas);
    if (core) {
      const ocean = new OceanFFT(core);
      renderer = new SceneRenderer(core, gpuCanvas, ocean);
      await Promise.all([ocean.pipelinePromise, renderer.bundlePromise]);
      rendererMode = "webgpu";
      fallbackCanvas.style.display = "none";
      gpuCanvas.style.display = "block";
      $("#renderer-badge").innerHTML = "<i></i><span>GPU · 4 级联 FFT 海浪</span>";
      return;
    }
  } catch (error) {
    console.warn("Custom WebGPU renderer could not initialize; using Canvas fallback.", error);
  }
  gpuCanvas.style.display = "none";
  fallbackCanvas.style.display = "block";
  renderer = new CanvasSceneRenderer(fallbackCanvas);
  rendererMode = "canvas2d";
  $("#renderer-badge").innerHTML = "<i></i><span>自研 Canvas 渲染引擎</span>";
}

function renderScene() {
  if (!renderer) return;
  if (rendererMode === "webgpu") {
    if (renderPending) return;
    renderPending = true;
    renderer.render(game, game.worldTime, 1 / 60)
      .catch((error) => {
        console.error("GPU frame failed; switching to Canvas fallback.", error);
        gpuCanvas.style.display = "none";
        fallbackCanvas.style.display = "block";
        renderer = new CanvasSceneRenderer(fallbackCanvas);
        rendererMode = "canvas2d";
        $("#renderer-badge").innerHTML = "<i></i><span>自研 Canvas 渲染引擎</span>";
      })
      .finally(() => { renderPending = false; });
  } else {
    renderer.draw(game, game.worldTime);
  }
}

function loop(timestamp) {
  rafId = requestAnimationFrame(loop);
  if (!lastFrame) lastFrame = timestamp;
  const elapsed = Math.min(0.05, Math.max(0, (timestamp - lastFrame) / 1000));
  lastFrame = timestamp;
  if (!manualClock) {
    game.update(elapsed);
    uiAccumulator += elapsed;
    if (uiAccumulator >= 0.12) { uiAccumulator = 0; updateUI(); }
  }
  renderScene();
}

window.render_game_to_text = () => JSON.stringify({
  game: "T Waterter",
  renderer: rendererMode,
  coordinateSystem: "canvas origin top-left; x rightward, y downward; normalized 0..1",
  mode: game.mode,
  location: game.spot,
  bobber: game.bobber.visible ? { x: +game.bobber.x.toFixed(3), y: +game.bobber.y.toFixed(3) } : null,
  fish: game.catchFish ? { name: game.catchFish.name, energy: Math.round(game.energy), pull: +game.catchFish.pull.toFixed(2) } : null,
  tension: Math.round(game.tension), lineStrength: game.lineStrength, lineLength: +game.lineLength.toFixed(1),
  biteIn: game.mode === "waiting" ? +game.waitTimer.toFixed(1) : null,
  inventory: game.inventory.map(({ id, name, weight, value }) => ({ id, name, weight: +weight.toFixed(1), value })),
  codex: { found: game.seen.size, total: FISH.length },
  coins: game.coins, level: game.level, xp: game.xp, dayPhase: +game.dayPhase.toFixed(3), wind: +game.wind.toFixed(1),
});

window.advanceTime = (ms) => {
  manualClock = true;
  const steps = Math.max(1, Math.round(ms / (1000 / 60)));
  for (let i = 0; i < steps; i += 1) game.update(1 / 60);
  updateUI();
  renderScene();
};

window.addEventListener("gpu-device-lost", () => {
  gpuCanvas.style.display = "none"; fallbackCanvas.style.display = "block";
  renderer = new CanvasSceneRenderer(fallbackCanvas); rendererMode = "canvas2d";
  $("#renderer-badge").innerHTML = "<i></i><span>自研 Canvas 渲染引擎</span>";
});

window.addEventListener("resize", () => { if (rendererMode === "canvas2d") renderer?.resize(); updateUI(); });
updateUI();
initRenderer().then(() => { updateUI(); renderScene(); }).catch((error) => console.error(error));
rafId = requestAnimationFrame(loop);

