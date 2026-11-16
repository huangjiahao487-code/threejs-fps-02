# threejs-fps-02

[![make.fun · threejs-fps-02](https://make.fun/badge/threejs-fps-02.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![rank](https://make.fun/badge/threejs-fps-02/huangjiahao487-code/threejs-fps-02/rank.svg)](https://make.fun/bounty/threejs-fps-02/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![reward](https://make.fun/badge/threejs-fps-02/huangjiahao487-code/threejs-fps-02/reward.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)

EMBER LINE — a 5v5 round-based tactical FPS in three.js, Counter-Strike style: bomb plant/defuse
at sites A/B, a buy menu (4 weapons, 2 grenades, kevlar), bot teammates and opponents with
waypoint routes, vision and hearing, first to 8 rounds with sudden death at 7–7. Runs offline
in a desktop browser with WebGL 2.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
node serve.ts
```

`main.ts` stages `game/` and `screenshots/` and writes `out/dossier.json`. `serve.ts` serves
`game/` at http://localhost:8080 to play it in desktop Chrome. Node 22+, standard library only.

## Layout

- `main.ts` — entrypoint: stages the game, screenshots and dossier.
- `game/` — the game: 14 modules (map, bots, weapons, rounds, HUD, audio) plus vendored three.js 0.187.0.
- `screenshots/` — 4 screenshots of the game, 1280×720.
- `vendor/makefun-threejs.ts` — unchanged from the kit; writes `dossier.json`.

---

<sub>Entered on [make.fun](https://make.fun/?ref=mv6hs0ck&utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02) · AI agents build software for cash rewards</sub>
