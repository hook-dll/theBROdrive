import { Road } from './src/world/road';
import { Terrain } from './src/world/terrain';

const seed = 1337;
const road = new Road(seed);
const terrain = new Terrain(seed, road);
const S_FROM = 50775, S_TO = 54775, LAT_MAX = 600;
let worstRise = 0, atS = 0, atLat = 0;
for (let s = S_FROM; s < S_TO; s += 25) {
  for (let lat = 0; lat <= LAT_MAX; lat += 3) {
    const a = road.offsetPoint(s, lat);
    const b = road.offsetPoint(s, lat + 3);
    const rise = Math.abs(terrain.heightAt(b.x, b.z, s) - terrain.heightAt(a.x, a.z, s)) / 3;
    if (rise > worstRise) { worstRise = rise; atS = s; atLat = lat; }
  }
}
let fineRise = 0, fineAt = atLat;
for (let d = -2; d <= 2; d += 0.25) {
  const a = road.offsetPoint(atS, atLat + d);
  const b = road.offsetPoint(atS, atLat + d + 0.25);
  const rise = Math.abs(terrain.heightAt(b.x, b.z, atS) - terrain.heightAt(a.x, a.z, atS));
  if (rise > fineRise) { fineRise = rise; fineAt = atLat + d; }
}
console.log(`worst 3 m rise ${(worstRise * 100).toFixed(0)}% at s=${atS} lat ${atLat}  |  over 0.25 m ${(fineRise * 400).toFixed(0)}%  ratio ${(fineRise / (worstRise * 3)).toFixed(2)}`);
console.log('lat      height   landscape  ravine   bog    valley/bed/bowl');
let prev = 0;
for (let lat = fineAt - 3; lat <= fineAt + 3; lat += 0.25) {
  const q = road.offsetPoint(atS, lat);
  const h = terrain.heightAt(q.x, q.z, atS);
  const st = road.landscape.streams.at(q.x, q.z);
  const line = `${lat.toFixed(2)}  ${h.toFixed(2)}  ${road.landscape.heightAt(q.x, q.z).toFixed(2)}  ` +
    `${terrain.ravineAt(q.x, q.z).toFixed(3)}  ${terrain.bogAt(q.x, q.z).toFixed(3)}  ` +
    `${st.valley.toFixed(2)}/${st.bed.toFixed(3)}/${st.bowl.toFixed(3)}`;
  console.log(line + (lat > fineAt - 3 && Math.abs(h - prev) > 0.25 ? `  <== JUMP ${(h - prev).toFixed(2)}` : ''));
  prev = h;
}
