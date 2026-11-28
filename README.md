# AIVentures 3D: The Shattered Crown

A first-person 3D version of [AIVentures](https://github.com/SmidigBommen/AIVentures), a D&D
5e-inspired single-player RPG: create a character, walk through the 51 areas of a three-act
campaign, fight monsters turn by turn, gather the five shards of the Crown of Unity and defeat
Malachar. The rules, data and campaign are those of the original; the Python rules engine runs
on the server and a Three.js client shows the world.

Live at https://aiventure3d.smidigbommen.no.

## Status

The game is complete in 3D: character creation, the eight locations, fights, events, the shop and
its quests, travel, saves and the ending are all played in the first-person client. The original
server-rendered interface is removed; a link to one of its old pages leads to the game.

## Run it

Needs [uv](https://docs.astral.sh/uv/), Node and pnpm.

```bash
uv sync && pnpm install
pnpm build
pnpm serve            # http://localhost:8000
```

Tests: `uv run pytest -q` and `pnpm test`. Browser walk-through: `node execution/smoke.mjs --serve --out /tmp/smoke`.

## How it is built

Every change comes from a GitHub issue and is specified, implemented, verified, merged and
deployed by the [vampire](https://github.com/SmidigBommen/vampire) software factory. `CLAUDE.md`
holds the rules the agents work by and a description of the code.

## Licences

3D models are CC0; `MODELS.md` lists each with its source.
