# Lighting handoff (2026-10-15, closed)

Everything on the remaining list is done. tsc is clean, nothing is committed. The browser tab is closed, Vite on 5199 is stopped and the `/tmp/lighting-head` worktree is removed. The CHANGELOG entry ("COLOUR PIPELINE DONE PROPERLY") has the final numbers.

## Added in the final session

- **GPU ms, HEAD vs new.** Interleaved runs, live loop, stationary car at noon, traffic cleared, render scale pinned. Median ms over 12 s, two runs each; raw numbers in /tmp/lighting/gpu_ab.json.

  | Tier | Pixels | HEAD | New |
  |---|---|---|---|
  | Standard | 1.44 Mpx | 8.17 / 8.33 | 7.98 / 8.64 |
  | Blessing | 1.44 Mpx | 8.46 / 8.58 | 8.61 / 8.26 |
  | Blessing at 1.5× | 3.24 Mpx | 10.45 / 10.70 | 10.68 / 11.01 |

  At 3.24 Mpx the exact display transform inside the FXAA and ink taps cost about +1 ms. Those taps now use `sqrt(clamp(rgb))` (`displayTap`, render/hazeshader.ts).
- **Photo capture, day and night:** matches HEAD. No change. Sheet: /tmp/lighting/ab_photo.png.
- **Retro rung:** the dither works. Dusk is lifter and the sunset more saturated than HEAD. Sheet: /tmp/lighting/ab_retro.png.
- **Mobile (iPhone 13 emulation):** half float is used. Sheet: /tmp/lighting/mobile.png.
- **Car-lab:** the ground was a two-triangle 4 km plane, and the per-vertex fog depth hazed it sky-blue. It is now segmented 100×100 (car-lab.ts). Sheet: /tmp/lighting/ab_carlab.png.
- **Cabin re-shoot** with the warm ground bounce: /tmp/lighting/ab_cabin.png.

The earlier sheets are still in /tmp/lighting: ab_v3.png (same-frame A/B), taste.png, operators.png and mirrors_v4.png.
