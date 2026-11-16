import { FISH, GEAR } from "./fish.js";

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export class FishingGame {
  constructor(onEvent = () => {}) {
    this.onEvent = onEvent;
    this.randomSeed = 0x713c0f;
    this.mode = "idle";
    this.castProgress = 0;
    this.bobber = { x: 0.58, y: 0.49, visible: false };
    this.bite = false;
    this.biteWindow = 0;
    this.waitTimer = 0;
    this.catchFish = null;
    this.reeling = false;
    this.tension = 0;
    this.energy = 100;
    this.lineLength = 100;
    this.slackTime = 0;
    this.snapTime = 0;
    this.sprintTime = 0;
    this.sprintCooldown = 0;
    this.pull = 0.28;
    this.whalePulse = 0;
    this.whaleTimer = 34;
    this.daySeconds = 7 * 3600 + 42 * 60;
    this.dayPhase = this.daySeconds / 86400;
    this.worldTime = 0;
    this.wind = 3.2;
    this.spot = "dock";
    this.coins = 240;
    this.inventory = [];
    this.seen = new Set();
    this.gear = { rod: 0, line: 0, reel: 0 };
    this.xp = 0;
    this.level = 1;
    this.totalCaught = 0;
    this.totalSold = 0;
    this.lastEvent = null;
  }

  random() {
    let x = this.randomSeed;
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    this.randomSeed = x >>> 0;
    return this.randomSeed / 0x100000000;
  }

  get lineStrength() { return 82 + this.gear.line * 6 + this.gear.rod * 4; }
  get fatigueMultiplier() { return 1 + this.gear.reel * 0.22; }
  get nextLevelXP() { return 80 + (this.level - 1) * 55; }

  cast(target = null) {
    if (!["idle", "snapped", "escaped", "landed"].includes(this.mode)) return;
    if (target) {
      this.bobber.x = clamp(target.x, 0.42, 0.94);
      this.bobber.y = clamp(target.y, 0.405, 0.82);
    } else {
      const distance = this.spot === "beach" ? 0.18 : 0.29;
      this.bobber.x = clamp((this.spot === "beach" ? 0.36 : 0.42) + distance + this.random() * 0.14, 0.47, 0.88);
      this.bobber.y = 0.445 + this.random() * 0.13;
    }
    this.mode = "casting";
    this.castProgress = 0;
    this.bobber.visible = true;
    this.bite = false;
    this.reeling = false;
    this.onEvent("cast", { spot: this.spot });
  }

  hook() {
    if (this.mode !== "bite" || !this.catchFish) return;
    this.mode = "fight";
    this.bite = false;
    this.energy = 100;
    this.tension = 26 + this.catchFish.pull * 12;
    this.lineLength = 100;
    this.slackTime = 0;
    this.snapTime = 0;
    this.sprintCooldown = 1.2 + this.random() * 1.8;
    this.sprintTime = 0;
    this.onEvent("hooked", { fish: this.catchFish });
  }

  setReeling(value) { this.reeling = Boolean(value); }

  toggleSpot() {
    this.spot = this.spot === "dock" ? "beach" : "dock";
    this.onEvent("spot", { spot: this.spot });
  }

  chooseFish() {
    const depth = this.spot === "beach" ? 0.28 + this.gear.rod * 0.08 : 0.46 + this.gear.rod * 0.1;
    const time = this.dayPhase;
    const weights = FISH.map((fish) => {
      const depthMid = (fish.depth[0] + fish.depth[1]) * 0.5;
      const timeMid = (fish.time[0] + fish.time[1]) * 0.5;
      const depthFit = Math.max(0.12, 1 - Math.abs(depth - depthMid) / ((fish.depth[1] - fish.depth[0]) * 0.75 + 0.18));
      const tdist = Math.min(Math.abs(time - timeMid), 1 - Math.abs(time - timeMid));
      const timeFit = Math.max(0.18, 1 - tdist / ((fish.time[1] - fish.time[0]) * 0.75 + 0.12));
      const rarity = fish.rarity === "传说" ? 0.13 : fish.rarity === "稀有" ? 0.36 : fish.rarity === "少见" ? 0.7 : 1;
      return depthFit * timeFit * rarity;
    });
    const sum = weights.reduce((a, b) => a + b, 0);
    let pick = this.random() * sum;
    let index = 0;
    for (; index < weights.length - 1; index += 1) { pick -= weights[index]; if (pick <= 0) break; }
    return FISH[index];
  }

  update(dt) {
    dt = Math.min(Math.max(dt, 0), 0.05);
    this.worldTime += dt;
    this.daySeconds = (this.daySeconds + dt * 480) % 86400;
    this.dayPhase = this.daySeconds / 86400;
    this.wind = 3.1 + Math.sin(this.worldTime * 0.09) * 0.9 + Math.cos(this.worldTime * 0.033) * 0.4;
    this.whaleTimer -= dt;
    if (this.whaleTimer <= 0) { this.whalePulse = 1; this.whaleTimer = 50 + this.random() * 35; this.onEvent("whale"); }
    if (this.whalePulse > 0) this.whalePulse = Math.max(0, this.whalePulse - dt * 0.62);

    if (this.mode === "casting") {
      this.castProgress = Math.min(1, this.castProgress + dt * 1.15);
      if (this.castProgress >= 1) {
        this.mode = "waiting";
        this.waitTimer = 3.1 + this.random() * 3.1 - this.gear.rod * 0.3;
        this.onEvent("landed-cast");
      }
    } else if (this.mode === "waiting") {
      this.waitTimer -= dt;
      if (this.waitTimer <= 0) {
        this.mode = "bite";
        this.bite = true;
        this.biteWindow = 2.35;
        this.catchFish = this.chooseFish();
        this.onEvent("bite", { fish: this.catchFish });
      }
    } else if (this.mode === "bite") {
      this.biteWindow -= dt;
      if (this.biteWindow <= 0) {
        this.mode = "escaped";
        this.bobber.visible = false;
        this.catchFish = null;
        this.onEvent("missed-bite");
      }
    } else if (this.mode === "fight") {
      this.updateFight(dt);
    } else if (["snapped", "escaped", "landed"].includes(this.mode)) {
      this.waitTimer -= dt;
      if (this.waitTimer <= 0) {
        this.mode = "idle";
        this.catchFish = null;
        this.bobber.visible = false;
      }
    }
  }

  updateFight(dt) {
    const fish = this.catchFish;
    if (!fish) return;
    const energyRatio = this.energy / 100;
    this.sprintCooldown -= dt;
    if (this.sprintCooldown <= 0 && this.sprintTime <= 0) {
      // Healthy, high-energy fish make sudden runs more often.
      const healthFactor = 0.55 + energyRatio * 0.85;
      this.sprintTime = (0.72 + this.random() * 0.6) * healthFactor;
      this.sprintCooldown = (3.4 + this.random() * 2.6) / healthFactor;
      this.onEvent("sprint", { fish });
    }
    const sprinting = this.sprintTime > 0;
    this.sprintTime = Math.max(0, this.sprintTime - dt);
    const wavePull = 0.78 + 0.22 * Math.sin(this.worldTime * 2.5 + this.randomSeed * 0.0001);
    const fishPull = fish.pull * (0.32 + energyRatio * 0.64) * wavePull;
    const target = 8 + fishPull * 34 + (sprinting ? 24 + fish.pull * 16 : 0) + (this.reeling ? 30 : 0);
    const smooth = 1 - Math.exp(-dt * (this.reeling ? 3.2 : 2.5));
    this.tension += (target - this.tension) * smooth;
    this.tension = clamp(this.tension, 0, 116);

    const inSweetSpot = this.tension >= 38 && this.tension <= 64;
    if (inSweetSpot) {
      const fatigue = (5.2 + fish.pull * 5.4 + (this.reeling ? 2.1 : 0)) * this.fatigueMultiplier;
      this.energy = Math.max(0, this.energy - fatigue * dt / fish.stamina);
    } else if (this.tension > 76) {
      this.energy = Math.max(0, this.energy - 0.6 * dt);
    }
    if (this.reeling && inSweetSpot) {
      this.lineLength = Math.max(0, this.lineLength - (5.6 + this.gear.reel * 2.1) * dt);
    }

    if (this.tension > this.lineStrength) this.snapTime += dt;
    else this.snapTime = Math.max(0, this.snapTime - dt * 1.8);
    if (this.snapTime >= 0.45) {
      this.mode = "snapped"; this.waitTimer = 2.1; this.reeling = false; this.bobber.visible = false;
      this.onEvent("line-snap", { fish }); return;
    }

    if (this.tension < 13) this.slackTime += dt;
    else this.slackTime = Math.max(0, this.slackTime - dt * 2);
    if (this.slackTime >= 4) {
      this.mode = "escaped"; this.waitTimer = 2.1; this.reeling = false; this.bobber.visible = false;
      this.onEvent("slack-escape", { fish }); return;
    }

    if (this.energy <= 0 || this.lineLength <= 0) this.landFish();
  }

  landFish() {
    const fish = this.catchFish;
    if (!fish) return;
    const weightRange = fish.max - fish.min;
    const sizeFactor = 0.14 + Math.pow(this.random(), 1.5) * 0.86;
    const weight = fish.min + weightRange * sizeFactor;
    const quality = weight / Math.max(fish.max, 0.5);
    const value = Math.round(fish.base * (0.58 + quality * 1.15));
    const item = { ...fish, weight, value, quality: quality > 0.72 ? "珍品" : quality > 0.45 ? "上品" : "鲜活" };
    this.inventory.unshift(item);
    this.seen.add(fish.id);
    this.totalCaught += 1;
    this.mode = "landed";
    this.waitTimer = 2.2;
    this.reeling = false;
    this.bobber.visible = false;
    this.xp += Math.round(12 + fish.base * 0.07);
    while (this.xp >= this.nextLevelXP) {
      this.xp -= this.nextLevelXP;
      this.level += 1;
      this.onEvent("level-up", { level: this.level });
    }
    this.onEvent("fish-landed", { item });
  }

  sellAll() {
    if (!this.inventory.length) return 0;
    const earnings = this.inventory.reduce((sum, fish) => sum + fish.value, 0);
    const count = this.inventory.length;
    this.coins += earnings;
    this.totalSold += count;
    this.inventory = [];
    this.onEvent("sold", { earnings, count });
    return earnings;
  }

  buyGear(id) {
    const item = GEAR.find((gear) => gear.id === id);
    if (!item) return { ok: false, message: "没有找到这件装备。" };
    const level = this.gear[id];
    if (level >= item.max) return { ok: false, message: "这件装备已经满级了。" };
    const price = item.price * (level + 1);
    if (this.coins < price) return { ok: false, message: `还差 $${price - this.coins}。` };
    this.coins -= price;
    this.gear[id] += 1;
    this.onEvent("gear-up", { item, level: this.gear[id] });
    return { ok: true, item, level: this.gear[id] };
  }
}
