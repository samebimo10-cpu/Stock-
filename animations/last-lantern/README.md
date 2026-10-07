# The Last Lantern

A 30-second 3D animation (Three.js) of the short story *The Last Lantern*: old Tamuno lights a mango-colored paper lantern on a harbor jetty at dusk, whispers his late wife Ebiere's name, and lets it drift past the mangroves into the dark.

- `the-last-lantern.mp4` — rendered film, 1280×720, 30 fps, 30 s, with an ambient soundtrack (sea noise and a slow chord that turns major at the smile).
- `index.html` — the live, real-time version. Open it in a browser and press play; it has a scrubber and optional generated sound.
- `scene.html` — the same scene without the document wrapper (used for publishing).

## Shot list

| Time | Shot |
| --- | --- |
| 0–5 s | The harbor at dusk from the water: bruised purple sky, quay lamps, crane, moored boats, the jetty |
| 5–11 s | Face to face with Tamuno; a match flares and the lantern catches |
| 11–16 s | Out past the mangroves: silver foam curling around black roots |
| 16–20 s | Profile: he whispers "Ebiere" and lowers the lantern onto the water |
| 20–27 s | Over his shoulder as the lantern drifts through the mangrove channel and fades |
| 27–30 s | Close on his face as he smiles; fade to title |

Every frame is a pure function of time (`renderAt(t)`), so the film can be re-rendered frame-exactly by loading `scene.html?capture` in a headless browser and calling `window.renderAt(t)` per frame.
