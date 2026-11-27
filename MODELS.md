# Models

Every 3D model in the game is CC0. The files are binary glTF (.glb) with embedded textures under
`client/public/`, so `models/creatures/goblin.glb` below is served at `/models/creatures/goblin.glb`.
The licence text of each pack is in `licenses/`. 176 files, 32.4 MB.

`node tools/validate_models.mjs client/public/models` loads every file and prints size, triangles,
bounds, skin and clip names (needs `@gltf-transform/core` as a dev dependency).
`node tools/make_model_manifest.mjs` measures the same bounds and triangle counts without any
package and writes them to `client/src/world/models.json`, which the area dressing reads.

The environment models and props that the area dressing uses (`client/src/world/dressing.ts`) have
been drawn in the browser; what turned out differently from this table is noted under
"Seen on screen". Creatures and NPCs have not been rendered yet: their scale factors come from
rest-pose bounds, and the choice of stand-ins from pack previews. Correct this table when a model
turns out wrong on screen.

Heights and scale factors are computed from the rest pose and are approximate. Units differ per source, so apply the scale column.
Clip names are exact. Several files prefix clips with the armature name, for example `CharacterArmature|Idle`.
In the tables a pipe inside a clip name is written `\|` because of Markdown table syntax. The real name has a plain `|`.
A tint is a colour multiplied into every material (`material.color.multiply`). "none" means use the model as shipped.

## 1. Creatures, bosses and NPCs

| For | File | Pack | Fit | Tint | Scale | Idle | Attack | Hurt | Death | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| Goblin | `models/creatures/goblin.glb` | Quaternius Ultimate Animated Character | exact | none | 0.4 (to 1.2 m; file is 2.98 units tall) | `Idle` | `SwordSlash` | `RecieveHit` | `Death` | unarmed; `Punch` also works as attack |
| Orc | `models/creatures/orc.glb` | Quaternius Ultimate Monsters | exact | none | 0.62 (to 1.9 m; file is 3.05 units tall) | `Idle` | `Punch` | `HitReact` | `Death` | cartoon style, holds a club (`Weapon` clip swings it) |
| Troll | `models/creatures/yeti.glb` | Quaternius Ultimate Monsters | stand-in (yeti) | #5f7f4a | 0.98 (to 2.6 m; file is 2.64 units tall) | `Idle` | `Punch` | `HitReact` | `Death` |  |
| Blighted Dryad | `models/creatures/tree_spirit.glb` | Quaternius Cute Animated Monsters | stand-in (round tree-stump monster) | #6b4a6e | 0.7 (to 2.0 m; file is 2.86 units tall) | `Idle` | `Bite_Front` | `HitRecieve` | none | no death clip; fade or sink it |
| Fire Salamander | `models/creatures/dragon.glb` | Quaternius Ultimate Monsters | stand-in (small winged dragon) | #ff5a1f | 0.6 (to 0.9 m; file is 1.51 units tall) | `Flying_Idle` | `Punch` | `HitReact` | `Death` | hovers, mesh starts 1.6 units above origin; `Headbutt` is a second attack |
| Sea Serpent | `models/creatures/snake.glb` | poly.pizza (Quaternius) | stand-in (snake) | #2f7fa8 | 0.94 (to 3.0 m; file is 3.18 units tall) | `SnakeArmature\|Snake_Idle` | `SnakeArmature\|Snake_Attack` | none | none | no hurt or death clip |
| Shadow Knight | `models/creatures/knight.glb` | Quaternius Ultimate Animated Character | exact after tint | #2a2a3a | 0.56 (to 1.9 m; file is 3.42 units tall) | `Idle` | `SwordSlash` | `RecieveHit` | `Death` | no sword mesh in the file |
| Shadow Wraith | `models/creatures/ghost_skull.glb` | Quaternius Ultimate Monsters | exact | #3a2a55, opacity 0.8 | 0.59 (to 1.8 m; file is 3.04 units tall) | `Flying_Idle` | `Punch` | `HitReact` | `Death` | cartoon ghost with skull face |
| Wind Specter | `models/creatures/ghost.glb` | Quaternius Ultimate Monsters | exact | #bfe8ff, opacity 0.6 | 0.59 (to 1.8 m; file is 3.06 units tall) | `Flying_Idle` | `Headbutt` | `HitReact` | `Death` | same body as Shadow Wraith with a different head |
| Stone Golem | `models/creatures/giant.glb` | poly.pizza (Quaternius) | stand-in (blocky giant) | #8a8a86 | 0.67 (to 2.6 m; file is 3.88 units tall) | `EnemyArmature\|EnemyArmature\|EnemyArmature\|Idle` | `EnemyArmature\|EnemyArmature\|EnemyArmature\|Attack` | `EnemyArmature\|EnemyArmature\|EnemyArmature\|HitRecieve` | `EnemyArmature\|EnemyArmature\|EnemyArmature\|Death` |  |
| Crystal Golem | `models/creatures/giant.glb` | poly.pizza (Quaternius) | stand-in (blocky giant) | #6fd6ff, emissive #1a4a66 | 0.67 (to 2.6 m; file is 3.88 units tall) | `EnemyArmature\|EnemyArmature\|EnemyArmature\|Idle` | `EnemyArmature\|EnemyArmature\|EnemyArmature\|Attack` | `EnemyArmature\|EnemyArmature\|EnemyArmature\|HitRecieve` | `EnemyArmature\|EnemyArmature\|EnemyArmature\|Death` | reuses the Stone Golem model |
| Void Fiend | `models/creatures/demon.glb` | Quaternius Ultimate Monsters | exact | #4b1f7a | 0.75 (to 2.2 m; file is 2.93 units tall) | `Idle` | `Punch` | `HitReact` | `Death` | cartoon horned demon |
| The Shard Guardian | `models/creatures/robot.glb` | poly.pizza (Quaternius) | stand-in (robot as construct) | #7fd0e0 | 0.67 (to 3.0 m; file is 4.5 units tall) | `RobotArmature\|Robot_Idle` | `RobotArmature\|Robot_Punch` | none | `RobotArmature\|Robot_Death` | no hurt clip; `Robot_No` (head shake) can substitute |
| Captain Aldric the Unresting | `models/creatures/skeleton_warrior.glb` | KayKit Skeletons | exact | #9fb0c8 | 0.77 (to 2.0 m; file is 2.59 units tall) | `Idle` | `1H_Melee_Attack_Chop` | `Hit_A` | `Death_A` | 95 clips; also `Idle_Combat`, `Taunt`, `Skeletons_Awaken_Floor`, `Death_C_Skeletons`; attach props/sword.glb to the hand bone |
| Lady Vex | `models/creatures/witch.glb` | Quaternius Ultimate Animated Character | exact | #6a2a8a | 0.43 (to 1.8 m; file is 4.15 units tall) | `Idle` | `Punch` | `RecieveHit` | `Death` | witch with hat; the face is flat black by design of the pack |
| Lady Vex Unbound | `models/creatures/blue_demon.glb` | Quaternius Ultimate Monsters | stand-in (horned demon) | #8a2be2 | 1.06 (to 2.8 m; file is 2.65 units tall) | `Idle` | `Punch` | `HitReact` | `Death` | no visual link to the witch model |
| High Flamecaller Ssarak | `models/creatures/dino.glb` | Quaternius Ultimate Monsters | stand-in (biped lizard) | #c8452a | 0.73 (to 2.2 m; file is 3.03 units tall) | `Idle` | `Punch` | `HitReact` | `Death` | no robes or staff |
| High Priest Oren | `models/creatures/cleric.glb` | Quaternius RPG Characters | exact after tint | #5a5a6a | 0.6 (to 1.8 m; file is 2.98 units tall) | `Idle` | `Staff_Attack` | `RecieveHit` | `Death` | `Spell1` is a casting attack |
| Khal Toruun the First Rider | `models/creatures/king.glb` | poly.pizza (Quaternius) | stand-in (armoured old king) | #7fe0d0, opacity 0.7 | 1.06 (to 2.0 m; file is 1.88 units tall) | `CharacterArmature\|Idle` | `CharacterArmature\|Sword_Slash` | `CharacterArmature\|HitRecieve` | `CharacterArmature\|Death` | no horse, no nomad clothing |
| Ghorrum the Mountain's Heart | `models/creatures/giant.glb` | poly.pizza (Quaternius) | stand-in (blocky giant) | #6b5a45 | 1.29 (to 5.0 m; file is 3.88 units tall) | `EnemyArmature\|EnemyArmature\|EnemyArmature\|Idle` | `EnemyArmature\|EnemyArmature\|EnemyArmature\|Attack` | `EnemyArmature\|EnemyArmature\|EnemyArmature\|HitRecieve` | `EnemyArmature\|EnemyArmature\|EnemyArmature\|Death` | third use of the giant model |
| Malachar the Void-touched | `models/creatures/wizard.glb` | Quaternius RPG Characters | exact after tint | #2a1f4a | 0.65 (to 2.0 m; file is 3.06 units tall) | `Idle` | `Spell1` | `RecieveHit` | `Death` | `Spell2` and `Staff_Attack` are further attacks |
| Elara (shopkeeper) | `models/npcs/woman_dress.glb` | poly.pizza (Quaternius) | exact | none | 0.37 (to 1.7 m; file is 4.65 units tall) | `HumanArmature\|Female_Idle` | `HumanArmature\|Female_Punch` | none | `HumanArmature\|Female_Death` | woman in a red dress, lowest detail of the humans |
| Innkeeper | `models/npcs/farmer.glb` | poly.pizza (Quaternius) | stand-in (farmer in overalls and hat) | none | 0.99 (to 1.8 m; file is 1.82 units tall) | `CharacterArmature\|Idle` | `CharacterArmature\|Punch_Right` | `CharacterArmature\|HitRecieve` | `CharacterArmature\|Death` | `Wave` and `Interact` suit dialogue |
| Townsfolk 1 | `models/npcs/adventurer_male.glb` | poly.pizza (Quaternius) | exact | none | 0.98 (to 1.8 m; file is 1.83 units tall) | `CharacterArmature\|Idle` | `CharacterArmature\|Punch_Right` | `CharacterArmature\|HitRecieve` | `CharacterArmature\|Death` | bearded man with backpack |
| Townsfolk 2 | `models/npcs/adventurer_female.glb` | poly.pizza (Quaternius) | exact | none | 0.98 (to 1.75 m; file is 1.79 units tall) | `CharacterArmature\|Idle` | `CharacterArmature\|Punch_Right` | `CharacterArmature\|HitRecieve` | `CharacterArmature\|Death` | woman with backpack |
| Traveller | `models/npcs/hooded_adventurer.glb` | poly.pizza (Quaternius) | exact | none | 0.95 (to 1.75 m; file is 1.84 units tall) | `CharacterArmature\|Idle` | `CharacterArmature\|Sword_Slash` | `CharacterArmature\|HitRecieve` | `CharacterArmature\|Death` | hooded woman carrying a sword |

Monsters and bosses: 10 exact, 11 stand-ins. Every character file has a skin and animation clips.

## 2. Environment and props

Native size is width x height x depth in file units. Scale is the factor that gives the stated real size.
KayKit dungeon-grid pieces use 0.73. The door in `wall_doorway.glb` is 2.75 units tall, so it becomes 2.0 m and a wall tile becomes 2.9 m square.
KayKit Medieval Hexagon pieces are strategy-map miniatures. Their factors are chosen per piece and the buildings have no modelled interior.

| File | Pack | Description | KB | Tris | Native size | Scale | Size after scale (m) |
|---|---|---|---|---|---|---|---|
| `models/env/town/house_a.glb` | KayKit Medieval Hexagon | small house, blue roof; strategy-map miniature, closed shell with no interior | 71 | 1011 | 0.79 x 0.93 x 0.85 | 6.99 | 5.52 x 6.5 x 5.94 |
| `models/env/town/house_b.glb` | KayKit Medieval Hexagon | taller house with chimney, blue roof; miniature | 97 | 1393 | 0.87 x 1.28 x 1.1 | 6.25 | 5.44 x 8 x 6.88 |
| `models/env/town/tavern.glb` | KayKit Medieval Hexagon | tavern / inn building, red roof; miniature | 184 | 2992 | 1.17 x 1.4 x 1.33 | 6.07 | 7.1 x 8.5 x 8.08 |
| `models/env/town/blacksmith.glb` | KayKit Medieval Hexagon | blacksmith building with forge; miniature | 137 | 2410 | 1.29 x 0.99 x 1.25 | 6.57 | 8.47 x 6.5 x 8.21 |
| `models/env/town/blacksmith_forge.glb` | poly.pizza (Quaternius) | larger blacksmith workshop with forge and chimney | 655 | 7659 | 3.89 x 3 x 3.28 | 1.5 | 5.83 x 4.5 x 4.92 |
| `models/env/town/market.glb` | KayKit Medieval Hexagon | market building with awnings and goods; miniature | 165 | 3125 | 1.8 x 0.98 x 1.32 | 4.08 | 7.35 x 4 x 5.39 |
| `models/env/town/market_stand.glb` | poly.pizza (Quaternius) | single market stall with canopy | 83 | 1548 | 0.95 x 1.05 x 1.19 | 2.48 | 2.35 x 2.6 x 2.95 |
| `models/env/town/church.glb` | KayKit Medieval Hexagon | church with tower; miniature | 104 | 1601 | 1.03 x 1.65 x 1.16 | 7.27 | 7.49 x 12 x 8.44 |
| `models/env/town/well.glb` | KayKit Medieval Hexagon | roofed stone well; miniature | 58 | 726 | 0.65 x 0.83 x 0.75 | 3.61 | 2.35 x 3 x 2.71 |
| `models/env/town/tent.glb` | KayKit Medieval Hexagon | canvas tent; miniature | 23 | 86 | 0.52 x 0.52 x 0.52 | 4.81 | 2.5 x 2.5 x 2.5 |
| `models/env/town/fence_wood.glb` | KayKit Medieval Hexagon | wooden fence section | 31 | 212 | 0.1 x 0.55 x 1.15 | 2 | 0.2 x 1.1 x 2.3 |
| `models/env/town/fence_wood_gate.glb` | KayKit Medieval Hexagon | wooden fence gate | 36 | 308 | 0.14 x 0.65 x 1.15 | 2 | 0.28 x 1.3 x 2.3 |
| `models/env/town/fence_stone.glb` | KayKit Medieval Hexagon | low stone wall section | 30 | 284 | 0.2 x 0.27 x 1.15 | 3.33 | 0.67 x 0.9 x 3.83 |
| `models/env/town/signpost.glb` | poly.pizza (Kenney) | wooden signpost | 6 | 84 | 0.21 x 0.46 x 0.04 | 4.35 | 0.91 x 2 x 0.17 |
| `models/env/town/lantern_standing.glb` | KayKit Halloween Bits | lantern standing on the ground | 28 | 264 | 0.64 x 0.93 x 0.64 | 0.73 | 0.47 x 0.68 x 0.47 |
| `models/env/town/lantern_post.glb` | KayKit Halloween Bits | lantern hanging from a wooden post | 42 | 568 | 0.64 x 3.3 x 1.57 | 0.73 | 0.47 x 2.4 x 1.14 |
| `models/env/town/lantern_hanging.glb` | KayKit Halloween Bits | lantern on a chain, for ceilings or brackets | 35 | 472 | 0.64 x 1.41 x 0.64 | 0.73 | 0.47 x 1.03 x 0.47 |
| `models/env/town/cart.glb` | poly.pizza (Quaternius) | two-wheeled wooden cart | 106 | 2659 | 0.46 x 0.8 x 0.93 | 2 | 0.92 x 1.6 x 1.86 |
| `models/env/town/wheelbarrow.glb` | KayKit Medieval Hexagon | wheelbarrow | 35 | 396 | 0.24 x 0.19 x 0.51 | 3 | 0.72 x 0.57 x 1.53 |
| `models/env/town/barrel.glb` | KayKit Medieval Hexagon | small barrel | 32 | 240 | 0.2 x 0.21 x 0.2 | 4.29 | 0.86 x 0.9 x 0.86 |
| `models/env/town/barrel_large.glb` | KayKit Dungeon Remastered | large barrel | 43 | 561 | 1.8 x 2 x 1.8 | 0.73 | 1.31 x 1.45 x 1.31 |
| `models/env/town/barrel_stack.glb` | KayKit Dungeon Remastered | three small barrels stacked | 96 | 1149 | 1.85 x 1.77 x 1 | 0.73 | 1.34 x 1.29 x 0.73 |
| `models/env/town/keg.glb` | KayKit Dungeon Remastered | keg on a stand, for the inn | 59 | 807 | 1.8 x 2.05 x 2 | 0.73 | 1.31 x 1.49 x 1.45 |
| `models/env/town/crate_big.glb` | KayKit Medieval Hexagon | closed crate | 24 | 132 | 0.21 x 0.21 x 0.21 | 3.81 | 0.8 x 0.8 x 0.8 |
| `models/env/town/crate_small.glb` | KayKit Medieval Hexagon | small closed crate | 24 | 132 | 0.14 x 0.14 x 0.14 | 3.57 | 0.5 x 0.5 x 0.5 |
| `models/env/town/crate_open.glb` | KayKit Medieval Hexagon | open crate | 29 | 260 | 0.33 x 0.21 x 0.2 | 3.81 | 1.26 x 0.8 x 0.76 |
| `models/env/town/crates_stacked.glb` | KayKit Dungeon Remastered | pile of crates | 101 | 1331 | 2.09 x 2.14 x 2.25 | 0.73 | 1.52 x 1.56 x 1.64 |
| `models/env/town/sack.glb` | KayKit Medieval Hexagon | grain sack | 20 | 92 | 0.11 x 0.06 x 0.16 | 5 | 0.55 x 0.3 x 0.8 |
| `models/env/town/bucket_water.glb` | KayKit Medieval Hexagon | bucket of water | 24 | 128 | 0.14 x 0.11 x 0.14 | 3.18 | 0.45 x 0.35 x 0.45 |
| `models/env/town/weapon_rack.glb` | KayKit Medieval Hexagon | weapon rack | 20 | 42 | 0.2 x 0.24 x 0.13 | 5.83 | 1.17 x 1.4 x 0.76 |
| `models/env/town/bench.glb` | KayKit Halloween Bits | wooden bench | 27 | 172 | 2 x 0.5 x 0.75 | 0.73 | 1.45 x 0.36 x 0.55 |
| `models/env/town/table.glb` | KayKit Dungeon Remastered | square wooden table | 33 | 256 | 2 x 1 x 2 | 0.73 | 1.45 x 0.73 x 1.45 |
| `models/env/town/stool.glb` | KayKit Dungeon Remastered | stool | 28 | 172 | 0.75 x 0.5 x 0.75 | 0.73 | 0.55 x 0.36 x 0.55 |
| `models/env/wilderness/tree_a.glb` | KayKit Medieval Hexagon | round-crowned tree, very low poly | 20 | 50 | 0.57 x 1.2 x 0.55 | 5.83 | 3.33 x 7 x 3.21 |
| `models/env/wilderness/tree_b.glb` | KayKit Medieval Hexagon | conifer, very low poly | 24 | 220 | 0.68 x 1.21 x 0.72 | 5.79 | 3.93 x 7 x 4.17 |
| `models/env/wilderness/tree_c.glb` | poly.pizza (Quaternius) | broadleaf tree with branches | 45 | 2412 | 4.27 x 5.59 x 2.64 | 1.25 | 5.35 x 7 x 3.31 |
| `models/env/wilderness/trees_group_a.glb` | KayKit Medieval Hexagon | clump of round trees on one base | 72 | 864 | 1.95 x 0.93 x 1.97 | 6.45 | 12.6 x 6 x 12.7 |
| `models/env/wilderness/trees_group_b.glb` | KayKit Medieval Hexagon | clump of conifers on one base | 53 | 1100 | 1.86 x 1.17 x 1.83 | 5.98 | 11.1 x 7 x 10.9 |
| `models/env/wilderness/tree_dead_large.glb` | KayKit Halloween Bits | large dead tree | 23 | 256 | 2.3 x 5.07 x 1.38 | 1.18 | 2.72 x 6 x 1.63 |
| `models/env/wilderness/tree_dead_medium.glb` | KayKit Halloween Bits | dead tree | 22 | 216 | 1.81 x 4.19 x 0.47 | 1.19 | 2.16 x 5 x 0.56 |
| `models/env/wilderness/tree_pine_autumn.glb` | KayKit Halloween Bits | pine with orange foliage | 33 | 318 | 4.76 x 7.48 x 4.15 | 1.07 | 5.09 x 8 x 4.44 |
| `models/env/wilderness/tree_pine_yellow.glb` | KayKit Halloween Bits | pine with yellow foliage | 33 | 318 | 3.33 x 5.87 x 3.12 | 1.11 | 3.69 x 6.5 x 3.45 |
| `models/env/wilderness/tree_stump.glb` | KayKit Medieval Hexagon | cut tree stump | 18 | 16 | 0.17 x 0.33 x 0.16 | 1.82 | 0.31 x 0.6 x 0.29 |
| `models/env/wilderness/tree_stump_moss.glb` | poly.pizza (Quaternius) | mossy stump with roots | 15 | 232 | 1.36 x 0.62 x 1.03 | 0.97 | 1.32 x 0.6 x 1 |
| `models/env/wilderness/logs.glb` | KayKit Medieval Hexagon | stack of cut logs | 28 | 220 | 0.69 x 0.21 x 0.33 | 4 | 2.76 x 0.84 x 1.32 |
| `models/env/wilderness/rock_a.glb` | KayKit Medieval Hexagon | flat rock, 18 triangles | 18 | 18 | 0.3 x 0.07 x 0.28 | 6 | 1.8 x 0.42 x 1.68 |
| `models/env/wilderness/rock_b.glb` | KayKit Medieval Hexagon | rock | 18 | 26 | 0.29 x 0.13 x 0.25 | 6 | 1.74 x 0.78 x 1.5 |
| `models/env/wilderness/rock_c.glb` | KayKit Medieval Hexagon | rock | 19 | 40 | 0.34 x 0.19 x 0.34 | 6 | 2.04 x 1.14 x 2.04 |
| `models/env/wilderness/rock_d.glb` | KayKit Medieval Hexagon | rock | 18 | 22 | 0.29 x 0.16 x 0.25 | 6 | 1.74 x 0.96 x 1.5 |
| `models/env/wilderness/stone_pile.glb` | KayKit Medieval Hexagon | pile of cut stone blocks | 28 | 220 | 0.42 x 0.28 x 0.36 | 5 | 2.1 x 1.4 x 1.8 |
| `models/env/wilderness/hill.glb` | KayKit Medieval Hexagon | grassy mound | 20 | 60 | 1.11 x 0.31 x 0.81 | 10 | 11.1 x 3.1 x 8.1 |
| `models/env/wilderness/bush.glb` | poly.pizza (Quaternius) | leafy bush (alpha-textured leaves) | 128 | 360 | 2.07 x 1.19 x 2.07 | 0.84 | 1.74 x 1 x 1.74 |
| `models/env/wilderness/tall_grass.glb` | poly.pizza (Quaternius) | tall grass tuft (alpha-textured) | 86 | 326 | 0.9 x 1.87 x 0.99 | 0.37 | 0.34 x 0.7 x 0.37 |
| `models/env/wilderness/mushroom.glb` | poly.pizza (Quaternius) | single mushroom | 10 | 138 | 0.71 x 0.7 x 0.69 | 0.43 | 0.3 x 0.3 x 0.3 |
| `models/env/wilderness/pumpkin.glb` | KayKit Halloween Bits | pumpkin | 25 | 306 | 1 x 0.7 x 1 | 0.73 | 0.73 x 0.51 x 0.73 |
| `models/env/wilderness/water_plant.glb` | KayKit Medieval Hexagon | reeds | 20 | 66 | 0.2 x 0.13 x 0.22 | 4 | 0.8 x 0.52 x 0.88 |
| `models/env/wilderness/water_lily.glb` | KayKit Medieval Hexagon | lily pad | 19 | 68 | 0.15 x 0.02 x 0.14 | 4 | 0.6 x 0.08 x 0.56 |
| `models/env/wilderness/campfire.glb` | poly.pizza (Quaternius) | campfire: ring of logs, no flame mesh | 30 | 602 | 0.41 x 0.11 x 0.36 | 3 | 1.23 x 0.33 x 1.08 |
| `models/env/wilderness/bridge_a.glb` | KayKit Medieval Hexagon | stone bridge segment; miniature | 42 | 604 | 1.33 x 1.25 x 1.92 | 3 | 3.99 x 3.75 x 5.76 |
| `models/env/wilderness/bridge_small.glb` | poly.pizza (Quaternius) | arched wooden footbridge with railings | 71 | 2880 | 6.94 x 2.62 x 2.64 | 1 | 6.94 x 2.62 x 2.64 |
| `models/env/dungeon/wall.glb` | KayKit Dungeon Remastered | stone wall, 4 x 4 x 1 units | 52 | 494 | 4 x 4 x 1 | 0.73 | 2.91 x 2.91 x 0.73 |
| `models/env/dungeon/wall_half.glb` | KayKit Dungeon Remastered | half-width wall | 36 | 272 | 2 x 4 x 1 | 0.73 | 1.45 x 2.91 x 0.73 |
| `models/env/dungeon/wall_corner.glb` | KayKit Dungeon Remastered | wall corner | 48 | 443 | 2.5 x 4 x 2.5 | 0.73 | 1.82 x 2.91 x 1.82 |
| `models/env/dungeon/wall_tsplit.glb` | KayKit Dungeon Remastered | T junction | 59 | 596 | 4 x 4 x 2.5 | 0.73 | 2.91 x 2.91 x 1.82 |
| `models/env/dungeon/wall_endcap.glb` | KayKit Dungeon Remastered | wall end piece | 33 | 222 | 1.07 x 4 x 1 | 0.73 | 0.78 x 2.91 x 0.73 |
| `models/env/dungeon/wall_pillar.glb` | KayKit Dungeon Remastered | wall with engaged pillar | 54 | 540 | 4 x 4 x 1.5 | 0.73 | 2.91 x 2.91 x 1.09 |
| `models/env/dungeon/wall_broken.glb` | KayKit Dungeon Remastered | wall with broken top | 68 | 784 | 4 x 4 x 1 | 0.73 | 2.91 x 2.91 x 0.73 |
| `models/env/dungeon/wall_cracked.glb` | KayKit Dungeon Remastered | cracked wall | 135 | 2010 | 4 x 4 x 1.26 | 0.73 | 2.91 x 2.91 x 0.92 |
| `models/env/dungeon/wall_window_closed.glb` | KayKit Dungeon Remastered | wall with shuttered window | 60 | 664 | 4 x 4 x 1 | 0.73 | 2.91 x 2.91 x 0.73 |
| `models/env/dungeon/wall_doorway.glb` | KayKit Dungeon Remastered | wall with wooden door; door is the separate node `wall_doorway_door`, 2.75 units tall | 98 | 1068 | 4 x 4 x 1 | 0.73 | 2.91 x 2.91 x 0.73 |
| `models/env/dungeon/wall_arched.glb` | KayKit Dungeon Remastered | wall with open archway | 68 | 724 | 4 x 4 x 1 | 0.73 | 2.91 x 2.91 x 0.73 |
| `models/env/dungeon/wall_gated.glb` | KayKit Dungeon Remastered | wall with iron-barred opening | 45 | 449 | 4 x 4 x 1 | 0.73 | 2.91 x 2.91 x 0.73 |
| `models/env/dungeon/arch_stone.glb` | KayKit Halloween Bits | free-standing stone arch | 44 | 436 | 4.22 x 4.41 x 0.77 | 0.73 | 3.07 x 3.21 x 0.56 |
| `models/env/dungeon/arch_gate_iron.glb` | KayKit Halloween Bits | stone arch with iron gate | 74 | 868 | 4.22 x 4.41 x 0.77 | 0.73 | 3.07 x 3.21 x 0.56 |
| `models/env/dungeon/fence_iron_bars.glb` | KayKit Halloween Bits | iron bar fence section | 42 | 380 | 4 x 2.2 x 0.5 | 0.73 | 2.91 x 1.6 x 0.36 |
| `models/env/dungeon/fence_iron_gate.glb` | KayKit Halloween Bits | iron bar gate | 58 | 620 | 4 x 3 x 0.5 | 0.73 | 2.91 x 2.18 x 0.36 |
| `models/env/dungeon/floor_tile_large.glb` | KayKit Dungeon Remastered | stone floor, 4 x 4 units | 27 | 188 | 4 x 0.15 x 4 | 0.73 | 2.91 x 0.11 x 2.91 |
| `models/env/dungeon/floor_tile_small.glb` | KayKit Dungeon Remastered | stone floor, 2 x 2 units | 20 | 66 | 2 x 0.15 x 2 | 0.73 | 1.45 x 0.11 x 1.45 |
| `models/env/dungeon/floor_tile_small_broken_a.glb` | KayKit Dungeon Remastered | broken floor tile | 22 | 94 | 2 x 0.15 x 2 | 0.73 | 1.45 x 0.11 x 1.45 |
| `models/env/dungeon/floor_tile_big_grate.glb` | KayKit Dungeon Remastered | floor tile with drain grate | 35 | 292 | 4 x 1.05 x 4 | 0.73 | 2.91 x 0.76 x 2.91 |
| `models/env/dungeon/floor_dirt_large.glb` | KayKit Dungeon Remastered | dirt floor, 4 x 4 units | 24 | 104 | 4 x 0.21 x 4 | 0.73 | 2.91 x 0.15 x 2.91 |
| `models/env/dungeon/floor_wood_large.glb` | KayKit Dungeon Remastered | plank floor, 4 x 4 units | 35 | 272 | 4 x 0.15 x 4 | 0.73 | 2.91 x 0.11 x 2.91 |
| `models/env/dungeon/floor_spike_trap.glb` | KayKit Dungeon Remastered | floor tile with spikes | 79 | 638 | 4 x 2.1 x 4 | 0.73 | 2.91 x 1.53 x 2.91 |
| `models/env/dungeon/pillar.glb` | KayKit Dungeon Remastered | square stone pillar, full wall height | 25 | 136 | 1.5 x 4 x 1.5 | 0.73 | 1.09 x 2.91 x 1.09 |
| `models/env/dungeon/pillar_decorated.glb` | KayKit Dungeon Remastered | pillar with banner and torch | 61 | 761 | 2.23 x 4 x 1.71 | 0.73 | 1.62 x 2.91 x 1.24 |
| `models/env/dungeon/pillar_grave.glb` | KayKit Halloween Bits | slim stone pillar | 22 | 94 | 1 x 4.4 x 1 | 0.73 | 0.73 x 3.2 x 0.73 |
| `models/env/dungeon/column.glb` | KayKit Dungeon Remastered | short round column | 20 | 44 | 0.7 x 1.4 x 0.7 | 0.73 | 0.51 x 1.02 x 0.51 |
| `models/env/dungeon/stairs.glb` | KayKit Dungeon Remastered | stone stairs up one storey | 42 | 358 | 5 x 5.1 x 4 | 0.73 | 3.63 x 3.71 x 2.91 |
| `models/env/dungeon/stairs_wide.glb` | KayKit Dungeon Remastered | wide stone stairs | 42 | 358 | 7 x 5.1 x 4 | 0.73 | 5.09 x 3.71 x 2.91 |
| `models/env/dungeon/stairs_walled.glb` | KayKit Dungeon Remastered | stairs with side walls | 70 | 790 | 5 x 4 x 4 | 0.73 | 3.63 x 2.91 x 2.91 |
| `models/env/dungeon/rubble_large.glb` | KayKit Dungeon Remastered | large rubble pile | 59 | 788 | 8.13 x 3.5 x 3.18 | 0.73 | 5.91 x 2.54 x 2.31 |
| `models/env/dungeon/rubble_half.glb` | KayKit Dungeon Remastered | rubble pile | 38 | 390 | 4 x 3.5 x 3 | 0.73 | 2.91 x 2.54 x 2.18 |
| `models/env/dungeon/barrier.glb` | KayKit Dungeon Remastered | low stone barrier | 23 | 90 | 4 x 1.1 x 0.5 | 0.73 | 2.91 x 0.8 x 0.36 |
| `models/env/dungeon/torch.glb` | KayKit Dungeon Remastered | unlit hand torch | 29 | 216 | 0.55 x 1.04 x 0.55 | 0.73 | 0.4 x 0.76 x 0.4 |
| `models/env/dungeon/torch_lit.glb` | KayKit Dungeon Remastered | lit hand torch with flame mesh | 31 | 270 | 0.55 x 1.13 x 0.55 | 0.73 | 0.4 x 0.82 x 0.4 |
| `models/env/dungeon/torch_mounted.glb` | KayKit Dungeon Remastered | lit torch on wall bracket | 32 | 278 | 0.55 x 1.06 x 0.62 | 0.73 | 0.4 x 0.77 x 0.45 |
| `models/env/dungeon/candle_lit.glb` | KayKit Dungeon Remastered | lit candle | 22 | 120 | 0.33 x 1.05 x 0.33 | 0.3 | 0.1 x 0.32 x 0.1 |
| `models/env/dungeon/candle_triple.glb` | KayKit Dungeon Remastered | three candles | 28 | 198 | 0.5 x 0.87 x 0.39 | 0.4 | 0.2 x 0.35 x 0.16 |
| `models/env/dungeon/banner_red.glb` | KayKit Dungeon Remastered | red wall banner | 24 | 97 | 1.5 x 3.2 x 0.31 | 0.73 | 1.09 x 2.33 x 0.23 |
| `models/env/dungeon/banner_shield_blue.glb` | KayKit Dungeon Remastered | blue banner with shield | 54 | 639 | 2.23 x 3.2 x 0.37 | 0.73 | 1.62 x 2.33 x 0.27 |
| `models/env/dungeon/bed_floor.glb` | KayKit Dungeon Remastered | bedroll on the floor | 25 | 232 | 1.5 x 0.56 x 3 | 0.73 | 1.09 x 0.41 x 2.18 |
| `models/env/dungeon/altar_table.glb` | KayKit Dungeon Remastered | long table with cloth and dishes, usable as altar | 121 | 2035 | 2.06 x 1.89 x 4 | 0.73 | 1.5 x 1.37 x 2.91 |
| `models/env/dungeon/altar_shrine_candles.glb` | KayKit Halloween Bits | small stone shrine with candles, usable as altar | 35 | 360 | 1.1 x 1.79 x 1.1 | 0.73 | 0.8 x 1.3 x 0.8 |
| `models/env/dungeon/coffin.glb` | KayKit Halloween Bits | wooden coffin | 34 | 316 | 2 x 1.32 x 3 | 0.73 | 1.45 x 0.96 x 2.18 |
| `models/env/dungeon/crypt.glb` | KayKit Halloween Bits | crypt building, 6 x 8 x 8 units | 73 | 952 | 6 x 8 x 8 | 0.73 | 4.36 x 5.82 x 5.82 |
| `models/props/chest.glb` | KayKit Dungeon Remastered | wooden treasure chest, lid is a separate node | 80 | 728 | 1.7 x 1.3 x 1.45 | 0.73 | 1.24 x 0.95 x 1.05 |
| `models/props/chest_gold.glb` | KayKit Dungeon Remastered | chest filled with gold | 137 | 1568 | 1.7 x 1.3 x 1.45 | 0.73 | 1.24 x 0.95 x 1.05 |
| `models/props/trunk.glb` | KayKit Dungeon Remastered | small trunk | 26 | 148 | 0.95 x 0.73 x 0.88 | 0.73 | 0.69 x 0.53 x 0.64 |
| `models/props/box_small.glb` | KayKit Dungeon Remastered | decorated wooden box | 71 | 928 | 1.49 x 1.48 x 1.49 | 0.4 | 0.6 x 0.59 x 0.6 |
| `models/props/shrine.glb` | KayKit Halloween Bits | roadside stone shrine | 22 | 94 | 1.1 x 2.4 x 1.1 | 0.73 | 0.8 x 1.74 x 0.8 |
| `models/props/plaque_candles.glb` | KayKit Halloween Bits | stone plaque with candles | 38 | 418 | 2 x 1.13 x 2 | 0.73 | 1.45 x 0.82 x 1.45 |
| `models/props/statue_stag.glb` | poly.pizza (Quaternius) | stag statue on plinth | 123 | 4042 | 2.31 x 4.63 x 1.27 | 0.65 | 1.5 x 3 x 0.82 |
| `models/props/statue_horse.glb` | poly.pizza (Quaternius) | rearing horse statue on plinth | 117 | 1849 | 1.74 x 5.85 x 3.38 | 0.6 | 1.04 x 3.5 x 2.02 |
| `models/props/potion_green.glb` | KayKit Dungeon Remastered | slim green bottle with label | 26 | 144 | 0.37 x 0.89 x 0.37 | 0.35 | 0.13 x 0.31 x 0.13 |
| `models/props/potion_brown.glb` | KayKit Dungeon Remastered | round brown bottle | 26 | 144 | 0.55 x 0.89 x 0.55 | 0.35 | 0.19 x 0.31 x 0.19 |
| `models/props/potion_flask_green.glb` | KayKit Dungeon Remastered | wide green flask | 26 | 144 | 0.74 x 0.91 x 0.74 | 0.35 | 0.26 x 0.32 x 0.26 |
| `models/props/coin.glb` | KayKit Dungeon Remastered | single gold coin | 21 | 80 | 0.36 x 0.13 x 0.36 | 0.3 | 0.11 x 0.04 x 0.11 |
| `models/props/coins_small.glb` | KayKit Dungeon Remastered | small stack of coins | 38 | 416 | 0.96 x 0.48 x 0.9 | 0.4 | 0.38 x 0.19 x 0.36 |
| `models/props/coins_large.glb` | KayKit Dungeon Remastered | large pile of coins | 99 | 1776 | 1.44 x 1.16 x 1.66 | 0.5 | 0.72 x 0.58 x 0.83 |
| `models/props/key.glb` | KayKit Dungeon Remastered | key | 24 | 160 | 0.9 x 0.4 x 0.14 | 0.3 | 0.27 x 0.12 x 0.04 |
| `models/props/sword.glb` | KayKit Adventurers | one-handed sword | 28 | 300 | 0.5 x 1.78 x 0.13 | 0.73 | 0.36 x 1.29 x 0.09 |
| `models/props/sword_2handed.glb` | KayKit Adventurers | two-handed sword | 35 | 412 | 0.84 x 2.37 x 0.25 | 0.73 | 0.61 x 1.72 x 0.18 |
| `models/props/axe.glb` | KayKit Adventurers | one-handed axe | 28 | 274 | 0.71 x 1.24 x 0.18 | 0.73 | 0.52 x 0.9 x 0.13 |
| `models/props/dagger.glb` | KayKit Adventurers | dagger | 25 | 172 | 0.26 x 1.21 x 0.15 | 0.5 | 0.13 x 0.6 x 0.07 |
| `models/props/staff.glb` | KayKit Adventurers | wizard staff | 35 | 440 | 0.58 x 2.15 x 0.29 | 0.73 | 0.42 x 1.56 x 0.21 |
| `models/props/wand.glb` | KayKit Adventurers | wand | 23 | 150 | 0.16 x 0.97 x 0.16 | 0.5 | 0.08 x 0.48 x 0.08 |
| `models/props/shield_round.glb` | KayKit Adventurers | round shield | 27 | 284 | 0.88 x 0.88 x 0.33 | 0.73 | 0.64 x 0.64 x 0.24 |
| `models/props/shield_badge.glb` | KayKit Adventurers | heater shield | 26 | 262 | 0.88 x 1.02 x 0.25 | 0.73 | 0.64 x 0.74 x 0.18 |
| `models/props/shield_square.glb` | KayKit Adventurers | tower shield | 26 | 262 | 0.88 x 1.19 x 0.3 | 0.73 | 0.64 x 0.87 x 0.22 |
| `models/props/sword_shield_wall.glb` | KayKit Dungeon Remastered | wall decoration: crossed swords behind a shield | 47 | 542 | 2.23 x 1.67 x 0.34 | 0.73 | 1.62 x 1.21 x 0.25 |
| `models/props/sword_shield_wall_gold.glb` | KayKit Dungeon Remastered | same, gold | 47 | 542 | 2.23 x 1.67 x 0.34 | 0.73 | 1.62 x 1.21 x 0.25 |
| `models/props/spellbook_open.glb` | KayKit Adventurers | open spellbook | 32 | 292 | 0.83 x 0.57 x 0.22 | 0.73 | 0.6 x 0.41 x 0.16 |
| `models/props/spellbook_closed.glb` | KayKit Adventurers | closed spellbook | 31 | 292 | 0.29 x 0.57 x 0.43 | 0.73 | 0.21 x 0.41 x 0.31 |
| `models/props/mug_full.glb` | KayKit Adventurers | full mug | 31 | 426 | 0.53 x 0.55 x 0.4 | 0.3 | 0.16 x 0.17 x 0.12 |
| `models/props/plate_food.glb` | KayKit Dungeon Remastered | plate of food | 40 | 547 | 1.02 x 0.79 x 0.97 | 0.4 | 0.41 x 0.32 x 0.39 |
| `models/props/tombstone.glb` | KayKit Halloween Bits | wide gravestone | 28 | 271 | 1.4 x 1.6 x 0.4 | 0.73 | 1.02 x 1.16 x 0.29 |
| `models/props/gravemarker_a.glb` | KayKit Halloween Bits | rounded grave marker | 20 | 56 | 0.81 x 1.2 x 0.28 | 0.73 | 0.59 x 0.87 x 0.2 |
| `models/props/gravemarker_b.glb` | KayKit Halloween Bits | cross grave marker | 26 | 136 | 0.8 x 1.18 x 0.41 | 0.73 | 0.58 x 0.86 x 0.3 |
| `models/props/grave_a.glb` | KayKit Halloween Bits | grave mound with headstone | 31 | 323 | 2 x 2.13 x 1 | 0.73 | 1.45 x 1.55 x 0.73 |
| `models/props/grave_b.glb` | KayKit Halloween Bits | grave slab with headstone | 30 | 190 | 2 x 2.2 x 1 | 0.73 | 1.45 x 1.6 x 0.73 |
| `models/props/skull.glb` | KayKit Halloween Bits | skull | 28 | 344 | 0.92 x 0.9 x 0.91 | 0.3 | 0.28 x 0.27 x 0.27 |
| `models/props/bone.glb` | KayKit Halloween Bits | bone | 24 | 204 | 0.71 x 0.28 x 0.2 | 0.4 | 0.28 x 0.11 x 0.08 |
| `models/props/ribcage.glb` | KayKit Halloween Bits | ribcage | 67 | 1240 | 0.85 x 0.86 x 0.75 | 0.6 | 0.51 x 0.52 x 0.45 |
| `models/props/crystal_big.glb` | poly.pizza (Quaternius) | large crystal cluster | 33 | 590 | 1.48 x 1.65 x 1.48 | 0.91 | 1.35 x 1.5 x 1.35 |
| `models/props/crystal_cluster.glb` | poly.pizza (Quaternius) | small mineral cluster | 88 | 896 | 0.59 x 0.44 x 0.56 | 1.14 | 0.67 x 0.5 x 0.64 |
| `models/props/anvil.glb` | poly.pizza (Kenney) | anvil on a workbench block | 20 | 258 | 0.31 x 0.27 x 0.27 | 2.22 | 0.69 x 0.6 x 0.6 |
| `models/props/bookshelf.glb` | KayKit Furniture Bits | low two-shelf bookcase with books | 42 | 482 | 2 x 0.82 x 0.5 | 1 | 2 x 0.82 x 0.5 |
| `models/props/bookshelf_small.glb` | KayKit Furniture Bits | small bookcase with books | 39 | 532 | 1 x 1.01 x 0.57 | 1 | 1 x 1.01 x 0.57 |
| `models/props/shelves.glb` | KayKit Dungeon Remastered | tall empty shelving unit | 26 | 152 | 2 x 1.95 x 0.5 | 1 | 2 x 1.95 x 0.5 |
| `models/props/shelf_large.glb` | KayKit Dungeon Remastered | wall shelf | 21 | 76 | 2 x 0.45 x 0.5 | 0.73 | 1.45 x 0.33 x 0.36 |
| `models/props/cabinet.glb` | KayKit Furniture Bits | cabinet with decoration | 64 | 1018 | 2.04 x 1.83 x 1 | 1 | 2.04 x 1.83 x 1 |
| `models/props/book_set.glb` | KayKit Furniture Bits | row of books | 28 | 196 | 0.78 x 0.5 x 0.36 | 0.6 | 0.47 x 0.3 x 0.22 |

### Seen on screen

- The dressing sets its own scale per use (a target height in metres), so the Scale column above is a
  starting point, not what is drawn. The town buildings stand outside the town wall as a backdrop at
  6 to 11 m; the inn front (`tavern.glb`) stands inside at 6.2 m.
- Bounding boxes are not centred on the origin (`fence_stone.glb` sits 1 unit off in x,
  `lantern_post.glb` reaches from -0.22 to 1.35 in z). Models are placed by bounding box.
- `arch_stone.glb`: the legs stand 3.0 units apart up to 2 units of height, the capitals narrow the
  opening to 2.78 units, the curve starts at 2.75 and the opening is 3.5 units high in the middle.
- `floor_tile_large.glb` is irregular flagstones, not square tiles, and takes a tint well.
  `floor_dirt_large.glb` is a thin dirt slab with loose stones; from above it reads as scattered pebbles.
- `tavern.glb` carries a large barrel over the door, which makes it readable as an inn from across an area.
- `market_stand.glb` is a dark timber frame with a small awning, darker than the pack preview suggests.
- `hill.glb` scaled to 6 m is a flat-topped mesa about 20 m wide; it works as a mountain backdrop.
- `crystal_cluster.glb` carries shape keys (morph targets). They are dropped on load, because the scenery is drawn instanced.
- `bush.glb` is the only file with a blended material; it is drawn cut out (`alphaTest`) and double-sided.

### Event objects and search markers

What stands on the event slot and the search slot of an area (`EVENT_OBJECTS` and `SEARCH_MARKERS` in
`client/src/world/contents.ts`). The server names the object kind of an event (`json/event_objects.json`);
the height is in metres after scaling. Wide models are kept low so that they stay about 2 m across.

| Object kind | File | Height | Tint | Events |
|---|---|---|---|---|
| chest | `models/props/chest.glb` | 0.8 | none | abandoned_chest, cellar_cache, and any event without an entry |
| treasure | `models/props/chest_gold.glb` | 0.9 | none | drowned_treasury |
| shrine | `models/props/shrine.glb` | 1.8 | none | mossy_shrine |
| altar | `models/env/dungeon/altar_table.glb` | 0.8 | none | altar_of_winds |
| traveller | `models/npcs/hooded_adventurer.glb` | 1.7 | none | wounded_traveler (plays its idle clip) |
| townsfolk | `models/npcs/farmer.glb` | 1.7 | none | gambling_stranger, tavern_tale (plays its idle clip) |
| spirit | `models/creatures/ghost.glb` | 1.8 | #bfe8ff | restless_spirit (plays its idle clip) |
| trap | `models/env/dungeon/floor_spike_trap.glb` | 0.5 | none | trapped_corridor |
| rubble | `models/env/dungeon/rubble_large.glb` | 0.7 | none | unstable_ceiling |
| tracks | `models/props/bone.glb` | 0.3 | none | strange_tracks |
| snare | `models/env/dungeon/barrier.glb` | 0.45 | none | caged_beast |
| herbs | `models/env/wilderness/water_plant.glb` | 0.7 | #cfe8d8 | herb_patch |
| bridge | `models/env/wilderness/bridge_small.glb` | 0.6 | none | rope_bridge |
| runestone | `models/props/gravemarker_a.glb` | 1.3 | #9fc8d8 | bridge_runes |
| forge | `models/props/anvil.glb` | 0.8 | none | dwarven_forge |
| crystal | `models/props/crystal_big.glb` | 1.6 | none | geode_chamber, crystal_grove |
| doorway | `models/env/dungeon/wall_doorway.glb` | 2 | none | priests_passage |
| lookout | `models/env/dungeon/wall_window_closed.glb` | 2 | none | shadow_towers |
| bars | `models/env/dungeon/fence_iron_bars.glb` | 1.2 | none | prisoner_cells |
| book | `models/props/spellbook_open.glb` | 0.4 | none | malachars_laboratory |

| Search marker | Location type | File | Height |
|---|---|---|---|
| trail marker | wilderness | `models/env/town/signpost.glb` | 1.1 |
| pile of rubble | dungeon | `models/env/dungeon/rubble_half.glb` | 0.5 |
| open crate | town | `models/env/town/crate_open.glb` | 0.7 |

An event object gets a gold point light and a gold emissive pulse. The search marker carries a faint gold
emissive, and is darkened while a monster or an event is in the area.

## 3. Packs

| Pack | Author | Source | Licence | Evidence |
|---|---|---|---|---|
| KayKit Adventurers 1.0 | Kay Lousberg | https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0 | CC0 | `licenses/kaykit_adventurers.txt` (pack LICENSE.txt): "License: (Creative Commons Zero, CC0)" |
| KayKit Skeletons 1.0 | Kay Lousberg | https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Skeletons-1.0 | CC0 | `licenses/kaykit_skeletons.txt` (pack LICENSE.txt): "License: (Creative Commons Zero, CC0)" |
| KayKit Dungeon Remastered 1.0 | Kay Lousberg | https://github.com/KayKit-Game-Assets/KayKit-Dungeon-Remastered-1.0 | CC0 | `licenses/kaykit_dungeon_remastered.txt` (pack LICENSE.txt): "License: (Creative Commons Zero, CC0)" |
| KayKit Medieval Hexagon 1.0 | Kay Lousberg | https://github.com/KayKit-Game-Assets/KayKit-Medieval-Hexagon-Pack-1.0 | CC0 | `licenses/kaykit_medieval_hexagon.txt` (pack LICENSE.txt): "License: (Creative Commons Zero, CC0)" |
| KayKit Halloween Bits 1.0 | Kay Lousberg | https://github.com/KayKit-Game-Assets/KayKit-Halloween-Bits-1.0 | CC0 | `licenses/kaykit_halloween_bits.txt` (pack LICENSE.txt): "License: (Creative Commons Zero, CC0)" |
| KayKit Furniture Bits 1.0 | Kay Lousberg | https://github.com/KayKit-Game-Assets/KayKit-Furniture-Bits-1.0 | CC0 | `licenses/kaykit_furniture_bits.txt` (pack LICENSE.txt): "License: (Creative Commons Zero, CC0)" |
| Quaternius Ultimate Monsters | Quaternius | https://quaternius.com/packs/ultimatemonsters.html | CC0 | `licenses/quaternius_ultimate_monsters.txt` (License.txt in the pack's Drive folder): "CC0 1.0 Universal (CC0 1.0) Public Domain Dedication". The file's header names another pack ("Ultimate Platformer Pack"); the pack page also says "License CC0". |
| Quaternius Ultimate Animated Character | Quaternius | https://quaternius.com/packs/ultimatedanimatedcharacter.html | CC0 | `licenses/quaternius_ultimate_animated_character.txt` (License.txt in the Drive folder): "CC0 1.0 Universal (CC0 1.0) Public Domain Dedication" |
| Quaternius RPG Characters | Quaternius | https://quaternius.com/packs/rpgcharacters.html | CC0 | `licenses/quaternius_rpg_characters.txt` (License.txt in the Drive folder): "CC0 1.0 Universal (CC0 1.0) Public Domain Dedication" |
| Quaternius Cute Animated Monsters | Quaternius | https://quaternius.com/packs/cutemonsters.html | CC0 | No licence file in the download. Pack page: "License CC0", linked to creativecommons.org/publicdomain/zero/1.0/. Record in `licenses/quaternius_cute_monsters.txt`. |
| poly.pizza (Quaternius), 23 single models | Quaternius | https://poly.pizza/u/Quaternius | CC0 | Each model page's data: "Licence: CC0 1.0"; visible text "Public Domain (CC0)". Per-model page URLs in `licenses/polypizza_models.txt`. The original pack of each model is not named on the page. |
| poly.pizza (Kenney), 2 single models | Kenney | https://poly.pizza/u/Kenney | CC0 | Same evidence, in `licenses/polypizza_models.txt`. kenney.nl itself returned HTTP 403 to automated requests, so the licence was not cross-checked there. |

## 4. Missing or weak

Creatures
- No CC0 glTF model was found for a golem, troll, dryad, salamander, sea serpent, lizardfolk, earth elemental or a monstrous sorceress. Those eleven roles use the stand-ins in table 1.
- `giant.glb` serves three roles (Stone Golem, Crystal Golem, Ghorrum). Only tint and scale tell them apart.
- `ghost.glb` and `ghost_skull.glb` share one body; Shadow Wraith and Wind Specter differ by head and tint.
- Lady Vex Unbound (`blue_demon.glb`) has no visual link to Lady Vex (`witch.glb`).
- Khal Toruun has no mount and no nomad clothing; the model is an armoured old king.
- Missing clips: `tree_spirit.glb` has no death; `snake.glb` has no hurt and no death; `robot.glb` has no hurt.
- `knight.glb`, `goblin.glb`, `witch.glb` and `skeleton_warrior.glb` carry no weapon mesh. Attach `props/sword.glb` or `props/staff.glb` to a hand bone if a weapon should show.
- `dragon.glb`, `ghost.glb` and `ghost_skull.glb` are modelled hovering above the origin (0.3 to 1.6 units). Place them by bounding box, not by origin.

Style
- Five art styles are mixed. Ultimate Monsters are big-eyed cartoon creatures. Ultimate Animated Character figures (goblin, knight, witch) have flat black faces and no texture. RPG Characters (cleric, wizard) are textured and faceless. KayKit pieces are chunky with a shared palette texture. The poly.pizza humans (NPCs, king) have realistic proportions.
- Tint multiplies the existing colours. On the brightly coloured Ultimate Monsters a dark tint gives a muddy result; replacing `material.color` or adding emissive works better there.

Environment
- Town buildings come from a hex strategy kit: miniatures without interiors, doors too small to measure. Their scale factors target overall building height, not a 2 m door. Only `blacksmith_forge.glb` and `market_stand.glb` are modelled at walk-up scale.
- Wilderness is thin: one bush, one grass tuft, one mushroom, four rocks of 18 to 40 triangles. The campfire has no flame mesh.
- No dedicated altar or forge prop. `altar_table.glb` and `altar_shrine_candles.glb` stand in for the altar; the anvil is a small workbench anvil; the forge exists only inside the two blacksmith buildings.
- The signpost is a plain 84-triangle post with blank boards.
- `bush.glb` and `tall_grass.glb` use alpha-textured leaves; set `alphaTest` and `side: DoubleSide`.

Sources not used
- Kenney: kenney.nl answered HTTP 403 to automated requests, so no Kenney pack was downloaded. Two Kenney models came through poly.pizza.
- Quaternius megakits (Medieval Village, Fantasy Props, Stylized Nature, Bestiary Dungeon Monsters, Fantasy Races) are distributed through itch.io only and were not fetched. Bestiary Dungeon Monsters and Fantasy Races are the likeliest source of better golem, troll and lizardfolk models.
- Older Quaternius packs (Ultimate Nature, Modular Dungeon, Medieval Village, Easy Enemy, Animated Monster) ship FBX/OBJ only.
- Google Drive began refusing downloads partway through, which stopped Quaternius Ultimate Fantasy RTS and Ultimate Stylized Nature.

Checks not done
- Files were loaded with glTF-Transform (`_tools/validate.mjs`), not with Three.js GLTFLoader in a browser. The only extension in use is `KHR_materials_unlit` (3 files), which GLTFLoader supports.
- No model was rendered. Choices rest on pack preview images, poly.pizza thumbnails and file names. Environment and prop descriptions are from file names and bounds.
- Scale factors come from rest-pose bounds. Attack and death poses extend beyond them.

Size
- `skeleton_warrior.glb` is 4.6 MB because it carries 95 clips. Removing unused clips would save about 4 MB.

