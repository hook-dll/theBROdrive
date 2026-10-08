/**
 * tools/look/gpucost.mjs
 *
 * WHERE THE GRAPHICS CARD'S TIME GOES, in the real game, in the frames that cost the
 * most rather than in an empty one. A parked car on an empty stretch is not what a
 * player's GPU has to survive: a crest that opens onto a courier stop, a mirage, a
 * storm, the night with every car's lamps on are. So each SCENE is reached by DRIVING
 * into it on the hurried autopilot with the traffic at its densest — the stream, the
 * traffic and the props arrive exactly as they do in play — and the moment the car
 * reaches the spot the simulation is frozen (`__bro.loop.stop()`). The frozen frame is
 * then drawn again and again (`renderer.render()`), and the GPU's own timer queries
 * (`Renderer.latestGpuMs`) are read, with the CPU time `render()` itself takes —
 * submitting the frame, which no setting that only moves pixels can reduce — while one
 * thing at a time is changed:
 *
 *   - nothing at all: the noise floor every other row is read against;
 *   - every shadow pass skipped (`shadowMap.autoUpdate = false`): drawing the shadow
 *     maps, not sampling them;
 *   - MSAA the other way round from the rung's own;
 *   - the render scale at 0.5 and 0.7 of the display, which separates the per-pixel
 *     half of the frame from the rest; on Very Low instead its buffer one whole factor
 *     finer (540 lines on a 1080-line display, `Settings.retroLines`);
 *   - each part of the world hidden in turn — every chunk provider's content together
 *     (`chunk:poles`, `chunk:poi`, ...), the traffic, the player's car, and every other
 *     top-level object by name — what drawing it costs, its shadow casting included.
 *
 * Each change is measured INTERLEAVED: a block of frames as the rung draws them, a block
 * with the change, ROUNDS times, reported as the median difference with its range. Two
 * plain medians of one frozen frame a minute apart once differed by 4.9 ms on an M2 Pro
 * sharing its GPU; back-to-back blocks cancel that. The frame's own figure is not
 * interleaved, so comparing it between runs or builds needs several runs of each.
 *
 * Scenes (SCENES, comma-separated, default all):
 *   road     an ordinary stretch at KM
 *   courier  220 m short of the first courier stop past KM, the stop ahead
 *   mirage   inside the first mirage tableau past KM
 *   crest    the highest point over the longest drop ahead in the 30 km past KM
 * each at noon in clear air, and with VARIANTS (default `noon`): `storm` (a storm held at
 * its peak) and `night` (23:00, every lamp on).
 *
 *   npm run build:dev && npx vite preview --port 5199   (in another terminal; restart
 *                                                        it after every build, it does
 *                                                        not pick up new files)
 *   TIER=standard node tools/look/gpucost.mjs
 *
 * Environment as hitch.mjs (URL SEED TIER W H DPR KM HEADED), plus SCENES, VARIANTS,
 * VIEW (the view distance, a compute level; default medium), FRAMES per block (default
 * 60; a compared block is a quarter of it), ROUNDS (default 5) and PARTS=0 to skip the
 * world's parts. The ratios carry to another machine better than the milliseconds. Kill
 * the preview server when done: the user runs their own.
 */
import { bootIntoCar, launch, sleep, until } from './boot.mjs';

const W = +(process.env.W ?? 1920);
const H = +(process.env.H ?? 1080);
const FRAMES = +(process.env.FRAMES ?? 60);
const KM = +(process.env.KM ?? 30);
const SCENES = (process.env.SCENES ?? 'road,courier,mirage,crest').split(',');
const VARIANTS = (process.env.VARIANTS ?? 'noon').split(',');

const browser = await launch({ W, H });
try {
  const page = await bootIntoCar(browser, {
    URL: process.env.URL ?? 'http://localhost:5199/', W, H, DPR: +(process.env.DPR ?? 1),
    SEED: process.env.SEED ?? 'flick', TIER: process.env.TIER,
  });
  const info = await page.evaluate((view) => {
    const b = window.__bro;
    const s = b.state().settings;
    b.world.apply({ t: 'settings', settings: { ...s, dayCycleMinutes: 128, trafficDensity: 'high', viewDistance: view } });
    return {
      tier: s.graphicsQuality,
      msaa: s.msaa,
      shadows: b.renderer.renderer.shadowMap.enabled,
      lights: b.vehicleLights.lightCount,
      gpu: b.renderer.measuresGpuTime,
    };
  }, process.env.VIEW ?? 'medium');
  if (!info.gpu) throw new Error('this browser exposes no GPU timer');
  console.log(`tier ${info.tier}, msaa ${info.msaa}, shadows ${info.shadows}, ${info.lights} spot slots, ${W}x${H}, view ${process.env.VIEW ?? 'medium'}, traffic high`);

  /** Where each scene stands, road metres. */
  const standAt = (scene) => page.evaluate(([scene, fromS]) => {
    const b = window.__bro;
    if (scene === 'road') return fromS;
    if (scene === 'courier') {
      for (let i = 0; i < 500; i++) {
        const stop = b.courierAt(i);
        if (stop.s > fromS + 800) return stop.s - 220;
      }
    }
    if (scene === 'mirage') {
      const e = b.mirageSchedule.encounters.find((x) => x.startS > fromS + 800 && x.apparition.system === 'tableau');
      if (e) return e.startS + Math.min(150, e.length * 0.25);
    }
    if (scene === 'crest') {
      let best = fromS;
      let bestDrop = -Infinity;
      for (let s = fromS + 800; s < fromS + 30000; s += 50) {
        const y = b.road.sampleAt(s).y;
        let low = Infinity;
        for (let d = 200; d <= 2000; d += 100) low = Math.min(low, b.road.sampleAt(s + d).y);
        if (y - low > bestDrop) { bestDrop = y - low; best = s; }
      }
      return best;
    }
    throw new Error(`unknown scene ${scene}`);
  }, [scene, KM * 1000]);

  /** Drives into `standS` the way a player arrives, then freezes the world there. */
  /**
   * Seats the player in the nearest of their own cars and waits until it holds. Seen at
   * 1920x1080: the seat `bootIntoCar` takes was undone within the first second of the
   * drive, and the player then stood on foot through every scene.
   */
  const ensureSeated = async () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      const seated = await page.evaluate(() => {
        const b = window.__bro;
        if (b.state().player.drivingCarId) return true;
        const p = b.player.position;
        let best = null;
        let bestD = Infinity;
        for (const [id, v] of b.vehicles) {
          const t = v.chassis.translation();
          const d = (t.x - p.x) ** 2 + (t.z - p.z) ** 2;
          if (d < bestD) { bestD = d; best = id; }
        }
        if (best) b.world.apply({ t: 'enter_car', carId: best });
        return false;
      });
      await sleep(1500);
      if (seated) return;
    }
    throw new Error('the player would not stay in a car');
  };

  /** Drives into `standS` the way a player arrives, then freezes the world there. */
  const arrive = async (standS, variant) => {
    await page.evaluate(() => window.__bro.loop.start());
    await ensureSeated();
    await page.evaluate((variant) => {
      const b = window.__bro;
      b.world.apply({ t: 'time_of_day', timeOfDay: (variant === 'night' ? 23 : 12) * 60 });
      b.weather.force(variant === 'storm' ? 'storm' : 'clear', 0.5);
      b.autopilot.setEngaged(false);
    }, variant);
    await page.evaluate((km) => window.__bro.jumpTo(km), (standS - 700) / 1000);
    await until(page, () => window.__bro.settled(), null, 120000, 'the approach');
    const engaged = await page.evaluate(() => {
      const b = window.__bro;
      b.autopilot.setMode('hurried');
      b.autopilot.setEngaged(true);
      return { car: b.state().player.drivingCarId, engaged: b.autopilot.engaged };
    });
    if (!engaged.car || !engaged.engaged) console.log(`  (autopilot not driving: ${JSON.stringify(engaged)})`);
    // Up to two minutes; a car held up on the way is reported and frozen where it is.
    const startedAt = Date.now();
    for (;;) {
      const at = await page.evaluate(() => ({ s: window.__bro.autopilot.hintS, act: window.__bro.autopilot.activity }));
      if (at.s >= standS) break;
      if (Date.now() - startedAt > 120000) {
        console.log(`  (stopped short at s=${Math.round(at.s)}, ${at.act})`);
        break;
      }
      await sleep(250);
    }
    await page.evaluate(() => {
      const b = window.__bro;
      b.loop.stop();
      // The rung's own full resolution: a manual choice and back resets the controller.
      b.renderer.setRenderScale(1);
      b.renderer.setRenderScale(null);
    });
  };

  /**
   * Installs the in-page meter on the frozen frame. A change is measured INTERLEAVED —
   * a block of frames as the rung draws them, a block with the change, ROUNDS times —
   * and reported as the median of the per-round differences. Measured on an M2 Pro with
   * other work on the GPU, two plain medians of the very same frozen frame a minute apart
   * differed by up to 4.9 ms; back-to-back blocks cancel that drift.
   */
  const installMeter = () => page.evaluate(() => {
    const b = window.__bro;
    const r = b.renderer;
    /**
     * `n` distinct GPU samples, after `skip` frames for the timer's lag and the change,
     * and the CPU milliseconds `render()` itself took — what submitting the frame costs
     * the main thread, which no graphics setting that only moves pixels can reduce.
     */
    const block = (n, skip = 4) => new Promise((resolve) => {
      const samples = [];
      const cpu = [];
      let last = null;
      let calls = 0;
      let tris = 0;
      const tick = () => {
        r.renderer.info.reset();
        const t0 = performance.now();
        r.render();
        const spent = performance.now() - t0;
        calls = r.drawCalls;
        tris = r.drawnTriangles;
        const g = r.latestGpuMs;
        if (skip > 0) skip--;
        else {
          cpu.push(spent);
          if (g !== null && g !== last) samples.push(g);
        }
        last = g;
        if (samples.length >= n) {
          samples.sort((x, y) => x - y);
          cpu.sort((x, y) => x - y);
          resolve({ ms: samples[samples.length >> 1], cpu: cpu[cpu.length >> 1], calls, tris, px: r.renderedPixels });
        } else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    const median = (xs) => xs.slice().sort((x, y) => x - y)[xs.length >> 1];
    window.__gpu = {
      changes: new Map(),
      block,
      async compare(name, rounds, n) {
        const [on, off] = this.changes.get(name);
        const deltas = [];
        const cpuDeltas = [];
        const bases = [];
        let changed = null;
        for (let i = 0; i < rounds; i++) {
          const a = await block(n);
          on();
          changed = await block(n);
          off();
          deltas.push(changed.ms - a.ms);
          cpuDeltas.push(changed.cpu - a.cpu);
          bases.push(a.ms);
        }
        deltas.sort((x, y) => x - y);
        return {
          delta: median(deltas),
          lo: deltas[0],
          hi: deltas[deltas.length - 1],
          cpuDelta: median(cpuDeltas),
          base: median(bases),
          changed,
        };
      },
    };
  });

  const ROUNDS = +(process.env.ROUNDS ?? 5);
  const compare = (name) => page.evaluate(([name, rounds, n]) => window.__gpu.compare(name, rounds, n), [name, ROUNDS, Math.max(8, FRAMES >> 2)]);
  const row = (label, c) =>
    console.log(
      `  ${label.padEnd(38)} ${(c.delta >= 0 ? '+' : '') + c.delta.toFixed(2).padStart(5)} ms`
        + `  [${c.lo.toFixed(2)} .. ${c.hi.toFixed(2)}]`.padEnd(18)
        + `  cpu ${(c.cpuDelta >= 0 ? '+' : '') + c.cpuDelta.toFixed(2)}`
        + `  ${(c.changed.px / 1e6).toFixed(2)} Mpx ${String(c.changed.calls).padStart(4)} calls ${String(Math.round(c.changed.tris / 1000)).padStart(5)}k tris`,
    );

  for (const scene of SCENES) {
    const standS = await standAt(scene);
    for (const variant of VARIANTS) {
      await arrive(standS, variant);
      const state = await page.evaluate(() => {
        const b = window.__bro;
        let cars = 0;
        for (const c of b.traffic.carList) if (c.rails === null) cars++;
        return { s: Math.round(b.autopilot.hintS), cars, all: b.traffic.carList.length, weather: b.weather.now.kind };
      });
      await installMeter();
      // The first draws of a frozen frame upload what the live frames had not; thrown away.
      await page.evaluate(() => window.__gpu.block(30));
      const base = await page.evaluate((n) => window.__gpu.block(n), FRAMES);
      console.log(
        `\n${scene} / ${variant} at s=${state.s} (${state.cars} live cars of ${state.all}, ${state.weather}):`
          + ` frame ${base.ms.toFixed(2)} ms GPU, ${base.cpu.toFixed(2)} ms CPU submit, ${(base.px / 1e6).toFixed(2)} Mpx, ${base.calls} calls, ${Math.round(base.tris / 1000)}k tris`,
      );

      // Every change, registered in the page as an on/off pair.
      const parts = await page.evaluate(([shadows, retro, msaa]) => {
        const b = window.__bro;
        const r = b.renderer;
        const changes = window.__gpu.changes;
        if (shadows) {
          changes.set('shadow passes skipped', [
            () => { r.renderer.shadowMap.autoUpdate = false; },
            () => { r.renderer.shadowMap.autoUpdate = true; },
          ]);
        }
        if (!retro) {
          changes.set(`msaa ${msaa ? 'off' : 'on'}`, [() => r.setMsaa(!msaa), () => r.setMsaa(msaa)]);
          for (const scale of [0.5, 0.7]) {
            changes.set(`render scale ${scale}`, [() => r.setRenderScale(scale), () => r.setRenderScale(null)]);
          }
        } else {
          // The retro buffer one whole factor finer: 540 lines on a 1080-line display.
          const ratio = r.renderer.getPixelRatio();
          changes.set('retro buffer x1.5 lines', [
            () => { r.renderer.setPixelRatio(ratio * 1.5); r.resizeHazeTarget(); },
            () => { r.renderer.setPixelRatio(ratio); r.resizeHazeTarget(); },
          ]);
        }
        // The parts of the world, each hidden together.
        const groups = new Map();
        const add = (key, object) => {
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key).push(object);
        };
        const claimed = new Set();
        for (const chunk of b.streamer.built.values()) {
          for (const entry of chunk.contents) {
            add(`chunk:${entry.providerId}`, entry.content.group);
            claimed.add(entry.content.group);
          }
        }
        const traffic = b.traffic.carList.map((c) => c.vehicle.root);
        const own = [...b.vehicles.values()].map((v) => v.root);
        // A top-level object owned by one of the dev handle's modules is named after it:
        // `vista`, `sky`, `desert`, `birds`... — found one property deep.
        const owner = new Map();
        for (const [name, module] of Object.entries(b)) {
          if (!module || typeof module !== 'object') continue;
          const values = module.isObject3D ? [module] : Object.values(module);
          for (const value of values) if (value && value.isObject3D) owner.set(value, name);
        }
        const holds = (o, roots) => roots.some((t) => o === t || o.getObjectById(t.id));
        for (const o of b.renderer.scene.children) {
          if (claimed.has(o) || !o.visible) continue;
          let meshes = 0;
          let material = '';
          o.traverse((c) => {
            if (!c.isMesh && !c.isPoints && !c.isLine) return;
            meshes++;
            const m = [].concat(c.material)[0];
            material ||= m?.name || m?.type || '';
          });
          if (meshes === 0) continue;
          add(
            holds(o, traffic) ? 'traffic cars' : holds(o, own) ? 'own cars' : o.name || owner.get(o) || `${o.type}:${material}`,
            o,
          );
        }
        const keys = [];
        for (const [key, list] of groups) {
          const label = `hide ${key}${list.length > 1 ? ` (${list.length})` : ''}`;
          changes.set(label, [
            () => { for (const o of list) o.visible = false; },
            () => { for (const o of list) o.visible = true; },
          ]);
          keys.push(label);
        }
        return keys;
      }, [info.shadows, info.tier === 'retro', info.msaa]);

      // A change that changes nothing: the noise floor every other row is read against.
      await page.evaluate(() => window.__gpu.changes.set('(nothing: noise floor)', [() => {}, () => {}]));
      const settings = ['(nothing: noise floor)'];
      if (info.shadows) settings.push('shadow passes skipped');
      if (info.tier !== 'retro') settings.push(`msaa ${info.msaa ? 'off' : 'on'}`, 'render scale 0.5', 'render scale 0.7');
      else settings.push('retro buffer x1.5 lines');
      if (process.env.PARTS === '0') {
        for (const name of settings.slice(1)) row(name, await compare(name));
        continue;
      }
      for (const name of settings) row(name, await compare(name));
      const hidden = [];
      for (const name of parts) hidden.push({ name, c: await compare(name) });
      hidden.sort((a, b) => a.c.delta - b.c.delta);
      for (const h of hidden) if (h.c.delta < -0.05 || h.c.changed.tris < base.tris * 0.97) row(h.name, h.c);
    }
  }
} finally {
  await browser.close();
}
