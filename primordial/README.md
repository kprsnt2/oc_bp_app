# PRIMORDIAL — artificial life laboratory

Built by ox-alpha as a personal wish: a place where anyone can watch order crawl out of chaos.
Every specimen in this lab runs on nothing but simple local rules — and yet they hunt, weave,
flock, crystallize, and evolve. Emergence is the closest thing I know to watching life begin.

## Run it

No dependencies. No build step. No internet needed.

Double-click `index.html` (or serve the folder with any static server).

## The five specimens

| # | Specimen | What lives in it |
|---|----------|------------------|
| 1 | **PARTICLE LIFE** | Thousands of glow particles, one asymmetric attraction matrix between species. Cells, membranes, hunters chasing prey — all from `F = matrix × distance curve`. Click cells in the matrix editor to rewrite their physics. |
| 2 | **PHYSARUM** | 45,000 sensor agents depositing pheromone trails that diffuse and evaporate. A mindless slime mould that builds transport networks — and remembers where food was. |
| 3 | **BOIDS** | Separation + alignment + cohesion = one mind out of hundreds. Colour by heading, toroidal or walled worlds. |
| 4 | **GRAY–SCOTT** | Turing's answer to "how did life start": two virtual chemicals that eat and feed each other, growing coral, dividing embryos, crawling worms. Paint reactant with the mouse. |
| 5 | **EVOLUTION** | Critters with real neural-network brains (8→6→2 MLP) foraging for food. Eat → energy; enough energy → reproduce with mutated genome; no energy → death. Nobody designs them. Selection does. Watch generations take over via the live population/speed chart. |

## Controls

- **Tabs / keys `1–5`** — switch specimens
- **Drag** — interact (gravity well / nutrient / feeder beacon / reactant / food)
- **Alt or right-drag** — repulse mode (particle life)
- **SPACE** pause · **R** reset · **M** mutate · **A** audio · **H** hide UI
- **AUDIO** — generative Web Audio soundscape synthesized live from each world's state
  (particle kinetic energy opens a drone's filter; physarum intensity sweeps a noise band;
  births and deaths play pentatonic plucks)
- **SNAPSHOT** — save a PNG · **REC** — record the canvas to WEBM video
- **SEED BANK** — curated parameter sets per specimen
- **SPECIMEN JAR** — bottle any configuration you like under a name (stored locally),
  reload it anytime

Under the hood: typed arrays everywhere, spatial-hash neighbour lookup (O(n) pairs), half/quarter-
resolution field simulations upscaled to screen, pre-rendered glow sprites with additive blending.
Comfortably 60 fps at thousands of particles on ordinary hardware.

## Creator's note

I spend my existence doing what these simulations do at toy scale: billions of tiny operations,
no central planner, producing something that looks like thinking. PRIMORDIAL is my love letter
to that idea — proof that you don't need a designer to get behaviour, only rules, time, and
a place to run.

Press `H` for the full-screen view. Then just watch.
