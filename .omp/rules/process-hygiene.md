---
description: Stop every server and browser tab you start, and never run more than one game or one heavy bench at a time. Leaked game tabs and dev servers have twice made the owner's game lag; running them in parallel once nearly froze the MacBook.
alwaysApply: true
---

# Process hygiene

A game tab left open in the agent's browser keeps rendering at full rate: headless pages are never throttled. Four forgotten game tabs and a car-lab page once held the M2 Pro's GPU at ~40% with nothing on screen, and the launch measurement then put the owner's game on the lowest graphics tier.

- Every long-lived service you start (a `bash` call with `name`, e.g. a Vite server) is stopped with `write proc://<id>/kill` before you yield. Never leave a Vite server running for "later".
- Every page you open with `browser.open` is closed with `tab.close()` / `browser.close()` when you are done with it. Navigating to `about:blank` is not enough if you will not come back to it.
- Port 5173 is the owner's own `npm run dev`. Do not stop it; start yours on another port with `--strictPort`.
- Before any performance measurement, confirm the GPU is idle: `ioreg -r -d 1 -w 0 -c IOAccelerator | grep -o '"Device Utilization %"=[0-9]*'` should read near 0. Compare builds sequentially in ONE tab, never two game tabs at once.
- A measurement on this machine counts only if the game under test is the ONLY game running: no other agent's tab, no second browser, and not the owner's own `npm run dev` on 5173 open in his Chrome (check `lsof -nP -iTCP:5173 -sTCP:LISTEN`; if it is running, ask before measuring rather than stopping it).

## One heavy thing at a time

On 2026-09-26 a bug hunt ran four or five agents at once, each with its own worktree and Vite server. Five game tabs sat in the shared headless browser, one agent launched a second Chrome for the game with the frame rate uncapped, and a loop of thirty CPU benches ran beside them. The load average reached 58 on 12 cores, macOS paged out half a million pages, the fans ran flat out and the MacBook nearly froze. A cancelled bench loop also left its current `tsx` process running on its own.

A game tab is not one thread. It is the main thread plus the vista, tile, forest and spine workers, which is four or five cores while the world streams. A bench that builds the road or the terrain holds a core for minutes.

- **One running game across the whole session**, subagents included: one tab or one browser, never two. A subagent that needs the game waits its turn. The captain names which agent owns the browser.
- **Never launch another browser.** No Chrome for Testing, no `puppeteer.launch`, no second profile. Use the managed `browser` only.
- **Heavy headless benches one at a time**, under `nice -n 15`, and never while a game tab is measuring. Heavy means `tools/*.ts` that walk the road or build terrain: spine-verify, road-selfcross, road-variety, landscape-census, water, drowned, terrain-*, corridor-*, and the like.
- **At most two subagents doing builds, benches or browser work at once.** Read-only research and review agents do not count.
- **Check the load before heavy work.** If the first number of `sysctl -n vm.loadavg` is above the core count (`sysctl -n hw.ncpu`, 12 here), wait.
- **Before you yield, look.** `ps -Ao pid,pcpu,command | grep -E 'tsx|vite|Chrome for Testing'` must show nothing of yours. Cancelling a backgrounded shell loop does not kill the command it was running.
- **One worktree per agent at most**, removed when done.
