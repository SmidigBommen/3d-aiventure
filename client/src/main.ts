import * as THREE from 'three';
import {
  fetchBattle, fetchCharacter, fetchCreation, fetchEnding, fetchEvent, fetchJournal, fetchPreview, fetchSaves, fetchShop, fetchState, fetchTravel,
  postBattle, postBattleContinue, postBattleRevive, postEngage, postEnter, postEventChoose, postEventContinue, postImprove, postInventory, postMove,
  postNewGame, postRest, postSave, postSearch, postShopItem, postShopQuest, postTravel, postUnequip,
  type Ambush, type CharacterAnswer, type ShopAnswer, type WorldState,
} from './api';
import { buildBattleScene, type BattleScene, type Rage } from './battle/battleScene';
import { bossLook, enrageCue } from './battle/boss';
import { fxLook } from './battle/fx';
import { bindBattlePanel, flash, floatText, renderBattle, setHp, showBanner, showBattlePanel, showEnrage, showResult } from './battle/panel';
import { buildTimeline, type Cue, type Finale, type Timeline } from './battle/timeline';
import { actionForKey, type BattleAction, type BattleView } from './battle/view';
import {
  chooseClass, chooseRace, emptyChoices, nextStep, prevStep, requestBody, stepComplete, toggleSkill,
  type Choices, type CreationStep, type CreationView, type Opening, type PreviewView,
} from './creation';
import { buildEndingScene } from './endingScene';
import type { Vec2 } from './input/movement';
import type { SavesView } from './saves';
import { DEFAULT_SETTINGS, SETTINGS_KEY, parseSettings, serializeSettings, settingsTurn, type Settings } from './settings';
import { createSoundEngine } from './sound/audio';
import { ACTION_SOUNDS, ambienceFor, resultSounds, stepSound, turnSounds, type Ambience, type SoundCue } from './sound/cues';
import { DEFAULT_SOUND, SOUND_KEY, gains, parseSound, serializeSound, toggleMute, type SoundSettings } from './sound/volume';
import {
  bindCreationPanel, bindOpeningPanel, bindSavesPanel, bindSettingsPanel, forgetCreationStep, renderCreation, renderSaves, renderSettings, renderSound,
  showCreationFoot, showCreationPanel, showOpening, showSavesPanel, showSettingsPanel, type SaveConfirm, type SavesMode, type SlotAction,
} from './startPanel';
import { buildTitleScene } from './titleScene';
import {
  fade, hideHud, hideNotice, hideTitle, showHud, showLoading, showMenu, showMuted, showNotice, showPrompt, showRoadHud, showTitle, showVignette, veil,
} from './ui';
import { buildAreaScene, type AreaScene } from './world/areaScene';
import { airFor } from './world/atmosphere';
import {
  ARRIVAL_SECONDS, LOADING_CARD_SECONDS, arrivalTitle, endingSteps, loadingCard, travelChoiceForKey, travelChoices,
  type EndingView, type JournalView, type TravelView,
} from './world/campaign';
import {
  bindEndingPanel, bindJournalPanel, bindTravelPanel, drawCompass, renderJournal, renderTravel, showArrival, showEnding, showJournalPanel, showTravelPanel,
} from './world/campaignPanel';
import { isFree } from './world/collision';
import { compassMarks, type CompassMark } from './world/compass';
import { buildContentScene, contentModels, underCeiling, type ContentScene } from './world/contentScene';
import {
  battleStance, contentSolids, creatureLook, eventPlace, fightSlot, interactionAt, type AreaContents, type BossContent, type Interaction,
} from './world/contents';
import { ROAD_SPEC, dressArea, dressSpecOf, type Dressing, type Placement } from './world/dressing';
import { choiceForKey, type EventResult, type EventView } from './world/event';
import { bindBossIntro, bindEventPanel, renderEvent, renderEventResult, showBossIntro, showEventPanel } from './world/eventPanel';
import { EYE_HEIGHT, buildLayout, hash, spawnPoint, type AreaLayout, type Gate } from './world/layout';
import { loadFigures, loadModels, modelErrors, type Figure } from './world/modelLoader';
import { panelForKey, type InventoryView, type PanelKind, type SheetView } from './world/sheet';
import { bindSheetPanels, renderInventory, renderSheet, showSheetPanel, type PanelMessage } from './world/sheetPanel';
import { haggleFeedback, killAnnouncement, readyCount, tabForKey, type ShopTab, type ShopView } from './world/shop';
import { bindShopPanel, renderShop, showHaggle, showShopPanel, type HaggleShown } from './world/shopPanel';
import { bobOffset, gaitStep, shakeOf, startGait, vignette, type Shake } from './world/feel';
import { heldKeys, moveKey, turnTowards, turnView, walkStep, type View } from './world/walk';
import { startWander, wanderStep, type Wanderer } from './world/wander';

type Screen = 'title' | 'creation' | 'opening' | 'world' | 'pending' | 'battle' | 'event' | 'intro' | 'ending';
/** The panels that open over the world while `screen` stays 'world'. */
type OpenPanel = PanelKind | 'shop' | 'travel' | 'journal';

/** An event in the world: its choices while it waits for one (`view`), then its outcome (`result`). */
interface Happening {
  view: EventView | null;
  result: EventResult | null;
}

/** Elara's shop while its panel is open: the last view, the open tab and how the last haggle went. */
interface Store {
  view: ShopView;
  tab: ShopTab;
  haggle: HaggleShown | null;
}

/** Character creation: what the server offers, the step shown, the choices so far and the server's preview of them. */
interface Maker {
  view: CreationView;
  step: CreationStep;
  choices: Choices;
  preview: PreviewView | null;
}

/** The save slots while their panel is open. `confirm`: the question that waits for Yes or No. */
interface Slots {
  view: SavesView;
  mode: SavesMode;
  confirm: SaveConfirm | null;
}

/** A fight in the world: the view the server last answered and where its playback stands. */
interface Fight {
  view: BattleView;
  playing: boolean; // a turn is being played
  locked: boolean; // no action is taken: one is on its way, a turn is playing, or the fight is over
  result: 'victory' | 'defeat' | null; // set once the result panel is shown
}

// What the smoke test and the production check read. `ready` turns true after the first rendered
// frame. `lookAt` turns the view through the function a mouse move feeds; `interact` runs what the
// E key runs. `loading` is true from the moment an area is entered until its models are in and its
// scene is built; `layout` is the dressing's layout (with the slots): the player collides with it
// and with what the contents block. `contents` is what the server says the area holds,
// `interaction` what the player can turn to from where they stand, `prompt` the line shown for it.
// During a fight `screen` is 'battle', `battle` is the fight, `player` is the battle stance and
// there is no interaction or prompt. While the event panel is open `screen` is 'event' and `event`
// holds what it shows; while a boss is introduced `screen` is 'intro' and `intro` is the boss's id.
// While the inventory or the character sheet is on screen `panel` names it, `screen` stays 'world'
// and there is no interaction or prompt; `inventory` and `sheet` are the views of the last answer.
// `resting` is true from the E press at the rest landmark until the view has faded back in.
// While Elara's shop is open `panel` is 'shop' and `shop` holds the view, the tab and the last haggle.
// The map and the journal are panels too ('travel', 'journal'); `travel` and `journal` are the views of the
// last answer. `travelling` is true from the choice of a destination until the view has faded back in,
// `arrival` is what #arrival shows while it shows, `compass` the marks of the last frame while walking.
// `road` is true while the road of an ambush is the scene: there `contents`, `interaction` and `compass`
// are null and `state` is already the destination. During the epilogue `screen` is 'ending' and `ending`
// holds the view and the step shown. Before the world: `screen` is 'creation' while the character is made
// (`creation` holds the step, the choices and the server's preview) and 'opening' while the opening is read.
// `saves` is the save slots while their panel is open (from the menu, or from the title screen to load),
// `settings` the settings in use and `settingsOpen` whether their panel is on screen.
declare global {
  interface Window {
    __aiv: {
      ready: boolean;
      frames: number;
      readonly screen: Screen;
      readonly state: WorldState | null;
      readonly player: { x: number; z: number; yaw: number } | null;
      readonly layout: AreaLayout | null;
      readonly menuOpen: boolean;
      readonly loading: boolean;
      readonly modelErrors: string[];
      readonly dressing: Dressing | null;
      readonly triangles: number;
      readonly contents: AreaContents | null;
      readonly interaction: Interaction | null;
      readonly prompt: string | null;
      readonly battle: Fight | null;
      readonly event: Happening | null;
      readonly intro: string | null;
      readonly panel: OpenPanel | null;
      readonly travel: TravelView | null;
      readonly journal: JournalView | null;
      readonly arrival: { title: string; subtitle: string } | null;
      readonly compass: CompassMark[] | null;
      readonly road: boolean;
      readonly ending: { view: EndingView; step: number } | null;
      readonly travelling: boolean;
      readonly shop: Store | null;
      readonly inventory: InventoryView | null;
      readonly sheet: SheetView | null;
      readonly resting: boolean;
      readonly creation: { step: CreationStep; choices: Choices; preview: PreviewView | null } | null;
      readonly opening: Opening | null;
      readonly saves: Slots | null;
      readonly settings: Settings;
      readonly settingsOpen: boolean;
      // Sound and feel. `sound.cues`: the last 500 cues requested since the page loaded, oldest first (also when
      // muted; none before the first pointerdown or keydown), `count` how many in all. `monster`: where the
      // area's monster wanders (`layout.slots.monster` stays its home). `vignette`: the opacity of the red edge
      // in the last frame. `loadingCard`: what #loading shows while it shows the card of a location.
      readonly sound: { unlocked: boolean; settings: SoundSettings; cues: string[]; count: number; ambience: Ambience | null };
      readonly monster: { x: number; z: number; yaw: number; noticed: boolean } | null;
      readonly vignette: number;
      readonly loadingCard: { title: string; text: string } | null;
      lookAt: (x: number, z: number) => void;
      interact: () => void;
    };
  }
}

const canvas = document.getElementById('view') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const title = buildTitleScene();
// The settings live in this browser only.
function storedSettings(): Settings {
  try {
    return parseSettings(localStorage.getItem(SETTINGS_KEY));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}
let settings = storedSettings();
let settingsOpen = false;

// Sound. Nothing sounds, and no cue is recorded, before the first pointerdown or keydown of the page.
const CUE_LOG = 500;
const RESULT_GAP = 0.7; // s between the cues of a fight's result
const audio = createSoundEngine();
function storedSound(): SoundSettings {
  try {
    return parseSound(localStorage.getItem(SOUND_KEY));
  } catch {
    return { ...DEFAULT_SOUND };
  }
}
let soundSettings = storedSound();
const cueLog: string[] = [];
let cueCount = 0;
let ambience: Ambience | null = null;
let fanfare: { cue: SoundCue; at: number }[] = []; // the cues of a result still to come, by the frame clock
let soundClock = 0;
audio.setGains(gains(soundSettings));

/** Requests a cue: the one place that records and plays. A cue asked for before the unlock is dropped. */
function cue(name: SoundCue | null): void {
  if (name === null || !audio.unlocked) return;
  cueCount += 1;
  cueLog.push(name);
  if (cueLog.length > CUE_LOG) cueLog.shift();
  audio.play(name);
}

/** The cue of an action of ACTION_SOUNDS (cues.ts). */
function actionSound(key: string): void {
  cue(Object.prototype.hasOwnProperty.call(ACTION_SOUNDS, key) ? ACTION_SOUNDS[key] : null);
}

for (const kind of ['pointerdown', 'keydown'] as const) window.addEventListener(kind, () => audio.unlock(), { capture: true });

/** A change of the sound settings: in use and in the browser's storage at once. */
function useSound(next: SoundSettings): void {
  soundSettings = parseSound(serializeSound(next));
  audio.setGains(gains(soundSettings));
  try {
    localStorage.setItem(SOUND_KEY, serializeSound(soundSettings));
  } catch {
    /* no storage: the sound settings last until the page is left */
  }
  showMuted(soundSettings.muted);
  renderSound(soundSettings);
}
showMuted(soundSettings.muted);

// Feel: the stride of the walk, the shake of a blow, the red edge of low hit points.
let gait = startGait();
let shake: (Shake & { t: number }) | null = null;
let edge = 0; // the opacity of #vignette
let promptShown: string | null = null; // the prompt of the last frame: a new one sounds

// The monster of the area, wandering (wander.ts). `key` names the contents it belongs to.
let roamer: { key: string; seed: number; slot: Vec2; w: Wanderer; t: number } | null = null;
let fledTo: { key: string; x: number; z: number; yaw: number } | null = null; // where the fight stood that the monster was fled from

// The card of a location, shown while its first area loads.
let lastLocation: string | null = null; // the location whose area was last entered in this page load
let cardView: TravelView | null = null; // the travel view the cards are read from
let cardAsked = false; // asked for once per page load
let card: { title: string; text: string } | null = null;
const eye = new THREE.PerspectiveCamera(settings.fov, 1, 0.1, 400);
eye.rotation.order = 'YXZ';

let screen: Screen = 'title';
let state: WorldState | null = null;
let layout: AreaLayout | null = null;
let walkLayout: AreaLayout | null = null; // `layout` with what the contents block added
let dressing: Dressing | null = null;
let area: AreaScene | null = null;
let things: ContentScene | null = null; // what the area holds, drawn
let busy = false; // an engage, a search or an arrival is on its way to the server
let loading = false;
let entry = 0; // goes up with every area entered or left, so that a slower, older load does not take over
let triangles = 0;
let player: Vec2 = { x: 0, z: 0 };
let view: View = { yaw: 0, pitch: 0 };
let menuOpen = false;
let crossing = false; // a move to the next area is on its way to the server
let lockLostAt = -Infinity;
const held = new Set<string>();

// The fight, when there is one. The player stands at `stance`; the view moves there from `glide`.
const GLIDE_SECONDS = 0.4;
const TURN_KEY = 'aiv.turn'; // sessionStorage: the last turn this tab has played
let fight: Fight | null = null;
let stance = { x: 0, z: 0, yaw: 0 };
let stancePitch = 0;
let glide: { x: number; z: number; yaw: number; pitch: number; t: number } | null = null;
let duel: BattleScene | null = null; // the monster being fought, drawn
let duelBoss = false; // it is the boss of the area: the battle scene draws it, the contents do not
let duelOnEvent = false; // it stands where the event object stood: what is left of that is hidden meanwhile
let duelRage: Rage | null = null; // how this boss looks in its rage
let duelMet: { key: string; x: number; z: number; yaw: number } | null = null; // the wandering monster this fight is with, where it was met
let soundTrack: { t: number; cue: SoundCue; event: number }[] = []; // the sounds of the turn being played
let soundNext = 0;
let playback: { timeline: Timeline; t: number; next: number; enrageAt: number | null } | null = null;

let happening: Happening | null = null; // the event the panel shows
let introBoss: string | null = null; // the boss the introduction panel shows

// The inventory and the character sheet: which of the two is on screen, and the views of the last answer.
const REST_FADE_MS = 500;
let panel: OpenPanel | null = null;
let store: Store | null = null; // Elara's shop, while its panel is open
let panelAsked = 0; // goes up with every opening and closing, so that an older answer opens nothing
let panelLocked = false; // an action of a panel is on its way to the server
let panelMessage: PanelMessage | null = null;
let character: { inventory: InventoryView; sheet: SheetView } | null = null;
let resting = false;

// Travel, the journal and the ending.
let atlas: TravelView | null = null; // the map of the last answer
let journal: JournalView | null = null; // the journal of the last answer
let travelling = false; // a journey is under way: the view is black or fading
let road = false; // the scene is the road of an ambush, not the area the server holds
let ambush: { boss: Ambush; battle: BattleView; state: WorldState } | null = null; // the ambush the introduction shows
let arrival: { title: string; subtitle: string } | null = null;
let arrivalTimer: number | undefined;
let compass: CompassMark[] | null = null;
let ending: { view: EndingView; step: number } | null = null;
let epilogue: ReturnType<typeof buildEndingScene> | null = null; // the scene behind the ending

// Before the world, and the save slots.
let maker: Maker | null = null; // character creation, while its panel is open
let makerMessage: PanelMessage | null = null;
let makerLocked = false; // the new game is on its way to the server
let opening: Opening | null = null; // what the opening panel shows
let saveCount = 0; // how many saves the server last listed: the title screen offers Load game by it
let slots: Slots | null = null;
let slotsFrom: 'menu' | 'title' = 'menu';
let slotsMessage: PanelMessage | null = null;
let slotsLocked = false; // a save, a load or a delete is on its way to the server

// The title panel is on screen: plainly ('title'), or with the pending link when something is pending that
// could not be opened here ('pending'). New game and Load game work in both.
const atTitle = (): boolean => screen === 'title' || screen === 'pending';
const inWorld = (): boolean => screen === 'world' && layout !== null;
// A panel is open over the area: the player stands where they stood and nothing walks.
const inPanel = (): boolean => (screen === 'event' || screen === 'intro') && layout !== null;
const inFight = (): boolean => screen === 'battle' && layout !== null;
const turn = (dYaw: number, dPitch: number): void => {
  view = turnView(view, dYaw, dPitch);
};

// What the page reports of the area: nothing while one is loading, also on the way from gate to gate,
// when the area left behind is still under the veil.
const shown = (): boolean => (inWorld() || inFight() || inPanel()) && !loading;
const landmarkOf = (d: Dressing | null): Placement | null => d?.placements.find((p) => p.landmark === 'special') ?? null;
const stallOf = (d: Dressing | null): Placement | null => d?.placements.find((p) => p.landmark === 'shop') ?? null;
const signpostOf = (d: Dressing | null): Placement | null => d?.placements.find((p) => p.landmark === 'travel') ?? null;
// On the road of an ambush the state is already the destination's; nothing of what that area holds is here.
const contentsOf = (s: WorldState | null): AreaContents | null => (road ? null : (s?.contents ?? null));
/**
 * The wanderer of the monster the area holds now, or null when it holds none. It starts on the monster's slot
 * when the contents come to hold a monster; one that was fled from stays where the fight stood.
 */
function roaming(): typeof roamer {
  const contents = contentsOf(state);
  const slot = layout?.slots?.monster ?? null;
  if (!contents?.monster || !slot || !state?.location || !state.area) {
    roamer = null;
    return null;
  }
  const where = `${state.location.name}/${state.area.id}`;
  const key = `${where}/${contents.seq}/${contents.monster.id}`;
  if (roamer?.key !== key) {
    const w = startWander(slot);
    roamer = { key, seed: hash(where) + contents.seq, slot, w: fledTo?.key === key ? { ...w, x: fledTo.x, z: fledTo.z, yaw: fledTo.yaw } : w, t: 0 };
    fledTo = null;
  }
  return roamer;
}

/** The layout as the prompt and the fight see it: the monster's slot is where the monster is now. */
function layoutNow(): AreaLayout | null {
  const roams = layout ? roaming() : null;
  if (!layout || !layout.slots || !roams) return layout;
  return { ...layout, slots: { ...layout.slots, monster: { x: roams.w.x, z: roams.w.z } } };
}

const interactionNow = (): Interaction | null => {
  const here = inWorld() && !loading && !panel ? layoutNow() : null;
  return here ? interactionAt(player, here, contentsOf(state)) : null;
};
const promptNow = (): string | null => (menuOpen || busy || crossing || resting || travelling ? null : (interactionNow()?.prompt ?? null));
// Nobody walks, looks around or opens anything: a panel is on screen or the view is black for a rest or a journey.
const heldStill = (): boolean => panel !== null || resting || travelling;

window.__aiv = {
  ready: false,
  frames: 0,
  get screen() { return screen; },
  get state() { return state; },
  get player() {
    if (!shown()) return null;
    return inFight() ? { ...stance } : { x: player.x, z: player.z, yaw: view.yaw };
  },
  get layout() { return shown() ? layout : null; },
  get menuOpen() { return menuOpen; },
  get loading() { return loading; },
  get modelErrors() { return modelErrors(); },
  get dressing() { return shown() ? dressing : null; },
  get triangles() { return triangles; },
  get contents() { return shown() ? contentsOf(state) : null; },
  get interaction() { return interactionNow(); },
  get prompt() { return promptNow(); },
  get battle() { return fight; },
  get event() { return screen === 'event' ? happening : null; },
  get intro() { return screen === 'intro' ? introBoss : null; },
  get panel() { return panel; },
  get shop() { return panel === 'shop' ? store : null; },
  get inventory() { return character?.inventory ?? null; },
  get sheet() { return character?.sheet ?? null; },
  get resting() { return resting; },
  get creation() { return screen === 'creation' && maker ? { step: maker.step, choices: maker.choices, preview: maker.preview } : null; },
  get opening() { return screen === 'opening' ? opening : null; },
  get saves() { return slots; },
  get settings() { return settings; },
  get settingsOpen() { return settingsOpen; },
  get travel() { return atlas; },
  get journal() { return journal; },
  get arrival() { return arrival; },
  get compass() { return compass; },
  get road() { return road; },
  get ending() { return screen === 'ending' ? ending : null; },
  get travelling() { return travelling; },
  get sound() { return { unlocked: audio.unlocked, settings: soundSettings, cues: [...cueLog], count: cueCount, ambience }; },
  get monster() {
    const roams = shown() ? roaming() : null;
    return roams ? { x: roams.w.x, z: roams.w.z, yaw: roams.w.yaw, noticed: roams.w.noticed } : null;
  },
  get vignette() { return edge; },
  get loadingCard() { return loading ? card : null; },
  lookAt(x, z) {
    if (!inWorld() || loading || heldStill()) return;
    const t = turnTowards(view, player, { x, z });
    turn(t.dYaw, t.dPitch);
  },
  interact() {
    void interact();
  },
};

// --- screens -----------------------------------------------------------------------------------

function setLoading(on: boolean, shownCard: { title: string; text: string } | null = null): void {
  loading = on;
  card = on ? shownCard : null;
  showLoading(on, card);
}

/**
 * The card for the way into `location`, when that is another location than the one last entered in this page
 * load. The travel view it is read from is asked for once per page load; without it the plain text shows.
 */
async function cardFor(location: string): Promise<{ title: string; text: string } | null> {
  if (location === lastLocation) return null;
  if (!atlas && !cardView && !cardAsked) {
    cardAsked = true;
    const answer = await fetchTravel().catch(() => null);
    if (answer?.ok) cardView = answer.travel;
  }
  return loadingCard(atlas ?? cardView, lastLocation, location);
}

function leaveWorld(): void {
  entry += 1;
  setLoading(false);
  closeBattle();
  happening = null;
  introBoss = null;
  showEventPanel(false);
  showBossIntro(null);
  closePanel();
  closeEnding();
  closeCreation();
  opening = null;
  showOpening(null);
  hideArrival();
  road = false;
  ambush = null;
  things?.dispose();
  things = null;
  area?.dispose();
  area = null;
  layout = null;
  walkLayout = null;
  dressing = null;
  busy = false;
  showPrompt(null);
  hideNotice();
  held.clear();
  setMenu(false);
  if (document.pointerLockElement === canvas) document.exitPointerLock();
}

/**
 * The contents as they are drawn right now. The boss that is being fought is drawn by the battle scene, and a
 * monster that came out of an event stands in place of what the event left. The event whose panel is open has
 * left the server's contents already (it is pending); its object stays in view until the choice is made.
 */
function drawn(contents: AreaContents | null): AreaContents | null {
  if (!contents) return null;
  let seen = contents;
  if (duelBoss) seen = { ...seen, boss: null };
  if (duelOnEvent) seen = { ...seen, spent: null };
  const open = screen === 'event' ? (happening?.view ?? null) : null;
  if (open && !seen.event) seen = { ...seen, event: { id: open.id, title: open.title, object: open.object, label: open.label, landmark: open.landmark } };
  return seen;
}

/** Puts what the area holds on its slots, in place of what stood there, and lets it block the way. */
function placeContents(contents: AreaContents | null, figures: Map<string, Figure | null>): void {
  if (!layout || !area) return;
  if (things) {
    area.scene.remove(things.group);
    things.dispose();
  }
  things = buildContentScene(layout, drawn(contents), figures, landmarkOf(dressing), stallOf(dressing));
  area.scene.add(things.group);
  const solids = layout.slots ? contentSolids(layout.slots, contents) : [];
  walkLayout = { ...layout, props: [...layout.props, ...solids.map((box) => ({ ...box, kind: 'model' as const }))] };
}

/** Takes `next` as the state of the area that stands and redraws what it holds. */
async function showContents(next: WorldState): Promise<void> {
  if (!layout) return;
  const mine = entry;
  state = next;
  showHud(next, false);
  const figures = await loadFigures(contentModels(layout, drawn(contentsOf(next)), landmarkOf(dressing)));
  if (mine !== entry || state !== next) return;
  placeContents(contentsOf(next), figures);
}

/**
 * Loads the models of the area in `next`, builds its scene and puts the player in it: at `at` when given
 * (the place an encounter was started from), else at the gate from `cameFrom` or the default spawn.
 * Until then nobody walks.
 */
async function enterArea(next: WorldState, cameFrom: string | null, at: { x: number; z: number; yaw: number } | null = null): Promise<void> {
  if (!next.location || !next.area) return;
  const mine = ++entry;
  // Into another location: its card, for LOADING_CARD_SECONDS at least and until the models are in. The
  // indicator waits for the card (the travel view may have to be asked for), so that it never shows the plain
  // text first and the card a moment later; nobody walks meanwhile.
  if (next.location.name === lastLocation) setLoading(true);
  else {
    loading = true;
    card = null;
  }
  if (screen === 'title') hideTitle();
  const shownCard = await cardFor(next.location.name);
  if (mine !== entry) return;
  setLoading(true, shownCard);
  const spec = dressSpecOf({ location: next.location, area: next.area, exits: next.exits });
  const dressed = dressArea(buildLayout(spec), spec);
  // A model that fails to load comes back as null and is drawn as a box.
  const [models, figures] = await Promise.all([
    loadModels(dressed.placements.map((p) => p.model)),
    loadFigures(contentModels(dressed.layout, contentsOf(next), landmarkOf(dressed))),
    shownCard ? wait(LOADING_CARD_SECONDS * 1000) : null,
  ]);
  if (mine !== entry) return;
  things?.dispose();
  things = null;
  area?.dispose();
  area = buildAreaScene(dressed, next.exits, models, null, airFor(next.location.name, next.location.type));
  layout = dressed.layout;
  dressing = dressed;
  road = false;
  ambush = null;
  state = next;
  lastLocation = next.location.name;
  gait = startGait();
  placeContents(contentsOf(next), figures);
  const start = at && walkLayout && isFree(at, walkLayout) ? at : spawnPoint(dressed.layout, cameFrom);
  player = { x: start.x, z: start.z };
  view = { yaw: start.yaw, pitch: 0 };
  screen = 'world';
  showHud(next, true);
  setLoading(false);
}

/**
 * Builds the road an ambush is fought on, in place of the area: the dressing of ROAD_SPEC with a dirt road from
 * the player's place through the monster's. `next` is the state the server holds, which is the destination already.
 */
async function enterRoad(next: WorldState): Promise<void> {
  const mine = ++entry;
  setLoading(true);
  if (screen === 'title') hideTitle();
  const dressed = dressArea(buildLayout(ROAD_SPEC), ROAD_SPEC);
  const models = await loadModels(dressed.placements.map((p) => p.model));
  if (mine !== entry) return;
  things?.dispose();
  things = null;
  area?.dispose();
  const start = spawnPoint(dressed.layout, null);
  const foe = dressed.layout.slots?.monster ?? { x: start.x, z: start.z - 1 };
  area = buildAreaScene(dressed, [], models, { from: start, to: foe }, airFor(ROAD_SPEC.location, ROAD_SPEC.type));
  gait = startGait();
  layout = dressed.layout;
  dressing = dressed;
  road = true;
  state = next;
  placeContents(null, new Map());
  player = { x: start.x, z: start.z };
  view = { yaw: Math.atan2(-(foe.x - start.x), -(foe.z - start.z)), pitch: 0 };
  screen = 'world';
  showHud(next, false);
  showRoadHud();
  setLoading(false);
}

/** Shows what the server says: the title panel, the pending link, or (when already walking) the world. */
function apply(next: WorldState | null, keepWalking: boolean): void {
  state = next;
  if (next && next.has_character && !next.pending && next.location && next.area && keepWalking) {
    void enterArea(next, null);
    return;
  }
  leaveWorld();
  screen = next?.pending ? 'pending' : 'title';
  showTitle(next, saveCount);
}

// Where the player stood when an encounter was started, kept for the way back from the classic pages.
const RETURN_KEY = 'aiv.return';
interface ReturnPoint {
  location: string;
  area: string;
  x: number;
  z: number;
  yaw: number;
}

function savedReturn(): ReturnPoint | null {
  try {
    const point = JSON.parse(sessionStorage.getItem(RETURN_KEY) ?? 'null') as ReturnPoint | null;
    const fine = point !== null && typeof point.location === 'string' && typeof point.area === 'string'
      && [point.x, point.z, point.yaw].every((v) => typeof v === 'number' && Number.isFinite(v));
    return fine ? point : null;
  } catch {
    return null;
  }
}

function forgetReturn(): void {
  try {
    sessionStorage.removeItem(RETURN_KEY);
  } catch {
    /* no storage */
  }
}

// The gate signs and the name plates are drawn with the heading font; give it a moment to arrive.
const cinzel = document.fonts.load('600 96px Cinzel').catch(() => []);
const fontReady = (): Promise<unknown> => Promise.race([cinzel, new Promise((done) => setTimeout(done, 1500))]);

/**
 * Asks the server what is true and shows it. A player who was walking keeps walking; one who comes
 * back from an encounter started here is put where they stood, without the title screen.
 */
async function refresh(): Promise<void> {
  // A panel over the area (an event, a boss's introduction) is still a player standing in it.
  const wasWalking = screen === 'world' || screen === 'event' || screen === 'intro';
  busy = false;
  const sameArea = (next: WorldState): boolean =>
    wasWalking && !road && next.area?.id === state?.area?.id && next.location?.name === state?.location?.name && !next.pending;
  try {
    // The title screen offers Load game when there is a save.
    const [first, listed] = await Promise.all([fetchState(), fetchSaves()]);
    let next = first;
    if (listed.ok) saveCount = listed.saves.saves.length;
    const walkable = next.has_character && !next.pending && next.location !== null && next.area !== null;
    const saved = savedReturn();
    const matches = saved !== null && saved.location === next.location?.name && saved.area === next.area?.id;
    // Kept only while the encounter it belongs to is still going on.
    if (!(matches && next.pending)) forgetReturn();
    // An event that waits for a choice, or for its outcome to be read, goes on here, without the title screen.
    if (next.pending?.kind === 'event') {
      const now = await fetchEvent();
      if (now.ok && (now.event || now.result) && now.state.location && now.state.area) {
        const here = layout !== null && !road && (screen === 'world' || screen === 'event' || screen === 'intro')
          && now.state.area.id === state?.area?.id && now.state.location.name === state?.location?.name;
        if (!here) {
          hideTitle();
          await fontReady();
          await enterArea(now.state, null, matches ? saved : null);
        }
        if (layout && now.state.area.id === state?.area?.id) openEvent(now.event, now.result, now.state);
        return;
      }
    }
    // The event the panel shows is over (resolved elsewhere): the panel goes.
    if (screen === 'event') closeEvent();
    // A fight (or the defeat that ended one) goes on here, without the title screen.
    if (next.pending?.kind === 'battle' || next.pending?.kind === 'defeat') {
      const now = await fetchBattle();
      if (now.ok && (now.battle.phase === 'fight' || now.battle.phase === 'defeat') && now.state.location && now.state.area) {
        // An ambush is fought on the road, whatever area the server holds meanwhile.
        const onRoad = now.battle.monster.place === 'road';
        const here = layout !== null && road === onRoad && (screen === 'world' || screen === 'battle' || (onRoad && screen === 'intro'))
          && now.state.area.id === state?.area?.id && now.state.location.name === state?.location?.name;
        closeBattle();
        if (screen === 'intro') closeIntro();
        if (!here) {
          hideTitle();
          await fontReady();
          if (onRoad) await enterRoad(now.state);
          else await enterArea(now.state, null);
        }
        if (layout && now.state.area.id === state?.area?.id) await startBattle(now.battle, now.state);
        return;
      }
    }
    const back = walkable && matches ? saved : null;
    if (walkable && (wasWalking || back)) {
      // Arriving: the server rolls what the area holds when it has not yet.
      const arrived = await postEnter();
      if (arrived.ok) next = arrived.state;
    }
    if (sameArea(next) && layout) {
      await showContents(next);
    } else if (back && !wasWalking && !next.pending) {
      state = next;
      await fontReady();
      await enterArea(next, null, back);
    } else {
      apply(next, wasWalking);
    }
  } catch {
    apply(null, false);
  }
}

async function crossGate(gate: Gate): Promise<void> {
  const from = state?.area?.id ?? null;
  crossing = true;
  actionSound('gate');
  veil(true);
  const answer = await postMove(gate.exitId);
  if (answer.ok && !answer.state.pending && answer.state.area) {
    await enterArea(answer.state, from);
  } else {
    // Refused: show what the server says is true now, from the default spawn or the pending link.
    await fetchState().then((next) => apply(next, true), () => apply(null, false));
  }
  veil(false);
  crossing = false;
}

// --- what the area holds ------------------------------------------------------------------------

/** Meets the monster, event or boss with this id: the encounter goes on where the server says. */
async function engage(id: string): Promise<void> {
  if (busy || !state?.location || !state.area) return;
  busy = true;
  held.clear();
  // A wandering monster is fought where it stands at this moment.
  const roams = roaming();
  const met = roams && contentsOf(state)?.monster?.id === id ? { key: roams.key, x: roams.w.x, z: roams.w.z, yaw: roams.w.yaw } : null;
  const point: ReturnPoint = { location: state.location.name, area: state.area.id, x: player.x, z: player.z, yaw: view.yaw };
  try {
    sessionStorage.setItem(RETURN_KEY, JSON.stringify(point));
  } catch {
    /* no storage: a reload puts the player at the default spawn */
  }
  const answer = await postEngage(id);
  if (answer.ok && answer.battle) {
    // A fight is fought here; the saved place is for an event, which a reload has to find again.
    forgetReturn();
    await startBattle(answer.battle, answer.state, met);
    return;
  }
  if (answer.ok && answer.event) {
    if (layout?.slots) {
      const t = turnTowards(view, player, eventPlace(layout.slots, answer.event));
      turn(t.dYaw, t.dPitch);
    }
    openEvent(answer.event, null, answer.state);
    return;
  }
  if (answer.ok) {
    window.location.assign(answer.url);
    return;
  }
  forgetReturn();
  await refresh();
}

// --- the fight ----------------------------------------------------------------------------------

function playedTurn(): number | null {
  try {
    const kept = sessionStorage.getItem(TURN_KEY);
    return kept === null ? null : Number(kept);
  } catch {
    return null;
  }
}

function rememberTurn(seq: number): void {
  try {
    sessionStorage.setItem(TURN_KEY, String(seq));
  } catch {
    /* no storage: a reload plays the last turn again */
  }
}

/** Takes the fight off the screen. Where the player goes next is the caller's business. */
function closeBattle(): void {
  fight = null;
  playback = null;
  glide = null;
  duelBoss = false;
  duelOnEvent = false;
  duelRage = null;
  duelMet = null;
  soundTrack = [];
  fanfare = [];
  shake = null;
  if (duel) {
    area?.scene.remove(duel.group);
    duel.dispose();
    duel = null;
  }
  showBattlePanel(false);
}

/**
 * Opens the fight `battle` in the area that stands: the player is held at the battle stance in front
 * of the monster, which stands where the view's `place` says, and the turn in the view is shown.
 */
async function startBattle(battle: BattleView, next: WorldState, met: { key: string; x: number; z: number; yaw: number } | null = null): Promise<void> {
  if (!layout || !layout.slots || !area) return;
  const mine = entry;
  const slots = layout.slots;
  const bossId = battle.monster.boss_id;
  // `met`: the wandering monster was engaged where it stood; a fight found on a page load stands on its slot.
  const slot = met && fightSlot(slots, battle.monster.place) === slots.monster ? { x: met.x, z: met.z } : fightSlot(slots, battle.monster.place);
  closeBattle();
  duelMet = met;
  gait = startGait();
  stance = battleStance(player, slot, walkLayout ?? layout);
  stancePitch = 0;
  glide = { x: player.x, z: player.z, yaw: view.yaw, pitch: view.pitch, t: 0 };
  fight = { view: battle, playing: false, locked: true, result: null };
  duelBoss = bossId !== null && contentsOf(next)?.boss?.id === bossId;
  duelOnEvent = battle.monster.place === 'event';
  screen = 'battle';
  state = next;
  busy = false;
  held.clear();
  setMenu(false);
  closePanel();
  if (document.pointerLockElement === canvas) document.exitPointerLock();
  showPrompt(null);
  hideNotice();
  showHud(next, false);
  if (road) showRoadHud();

  // A boss is drawn larger than its kind, and larger again in its rage; in a dungeon it stays under the ceiling.
  const look = bossId !== null ? bossLook(bossId, false) : creatureLook(battle.monster.race);
  const scale = bossId !== null ? underCeiling(layout, look.model, look.scale) : look.scale;
  if (bossId !== null) {
    const hot = bossLook(bossId, true);
    duelRage = { factor: underCeiling(layout, hot.model, hot.scale) / scale, emissive: hot.emissive ?? '#ff3b2f', pulse: hot.pulse, period: hot.period };
  }
  const [figures, fighters] = await Promise.all([
    loadFigures(contentModels(layout, drawn(contentsOf(next)), landmarkOf(dressing))),
    loadFigures([look.model]),
  ]);
  if (mine !== entry || !layout || !area || fight?.view !== battle) return;
  placeContents(contentsOf(next), figures);
  duel = buildBattleScene({ ...look, scale }, fighters.get(look.model) ?? null, slot, stance);
  // A rage that the turn about to be played brings on shows when that turn reaches it.
  const toPlay = battle.turn.seq !== playedTurn() && battle.turn.events.some((event) => event.kind === 'enrage');
  duel.setEnraged(battle.monster.enraged && !toPlay ? duelRage : null);
  area.scene.add(duel.group);
  // The view is lowered to the monster, which then stands above the panel at the bottom.
  const tall = duel.head().y;
  stancePitch = Math.max(-0.6, Math.min(0.3, Math.atan2(tall * 0.3 - EYE_HEIGHT, Math.hypot(slot.x - stance.x, slot.z - stance.z))));
  showBattlePanel(true);
  present(battle);
}

/** Shows a view the server answered: plays its turn when this tab has not played it yet, else shows the result at once. */
function present(battle: BattleView): void {
  if (!fight) return;
  fight.view = battle;
  const fresh = battle.turn.seq !== playedTurn() && battle.turn.events.length > 0;
  rememberTurn(battle.turn.seq);
  if (!fresh) {
    settle(true);
    return;
  }
  const finale: Finale = battle.phase === 'victory' ? 'victory' : battle.phase === 'defeat' ? 'defeat' : null;
  const timeline = buildTimeline(battle.turn.events, { player: battle.player.hp, monster: battle.monster.hp }, finale);
  fight.playing = true;
  fight.locked = true;
  renderBattle(battle, true, timeline.start);
  playback = { timeline, t: 0, next: 0, enrageAt: enrageCue(battle.turn.events, timeline)?.t ?? null };
  soundTrack = turnSounds(battle.turn.events, timeline);
  soundNext = 0;
}

/** The view as it is after its turn: the buttons open again, or the result panel. `atOnce`: nothing was played. */
function settle(atOnce: boolean): void {
  if (!fight) return;
  const battle = fight.view;
  playback = null;
  fight.playing = false;
  fight.locked = battle.phase !== 'fight';
  showBanner(null);
  renderBattle(battle, fight.locked);
  duel?.setEnraged(battle.monster.enraged ? duelRage : null);
  if (atOnce) duel?.settle(battle.phase === 'victory' ? 'monster' : battle.phase === 'defeat' ? 'player' : null);
  if (battle.phase === 'victory' || battle.phase === 'defeat') {
    fight.result = battle.phase;
    showResult(battle);
    // The cues of the result, one after the other.
    fanfare = resultSounds(battle).map((name, i) => ({ cue: name, at: soundClock + i * RESULT_GAP }));
  }
}

/** Where on the screen the texts above the monster start. */
function aboveMonster(): { x: number; y: number } | null {
  if (!duel) return null;
  const point = duel.head().project(eye);
  return {
    x: Math.max(80, Math.min(window.innerWidth - 80, ((point.x + 1) / 2) * window.innerWidth)),
    y: Math.max(130, Math.min(window.innerHeight * 0.55, ((1 - point.y) / 2) * window.innerHeight)),
  };
}

function runCue(cue: Cue): void {
  if (cue.type === 'banner') showBanner(cue.text);
  else if (cue.type === 'hp') setHp(cue.side, cue.after);
  else if (cue.type === 'float') floatText(cue.side, cue.text, cue.style, cue.side === 'monster' ? aboveMonster() : null);
  else {
    duel?.run(cue);
    if (cue.type === 'fx' && cue.side === 'player') flash(fxLook(cue.fx));
  }
}

/** One frame of the playback: every cue whose time has come, and the end of the turn. */
function advancePlayback(dt: number): void {
  if (!playback) return;
  playback.t += dt;
  const { cues, inputAt } = playback.timeline;
  while (playback.next < cues.length && cues[playback.next].t <= playback.t) runCue(cues[playback.next++]);
  // Each event sounds, and shakes the view when it is a blow, as its effect shows.
  while (soundNext < soundTrack.length && soundTrack[soundNext].t <= playback.t) {
    const sounded = soundTrack[soundNext++];
    cue(sounded.cue);
    const jolt = fight ? shakeOf(fight.view.turn.events[sounded.event]) : null;
    if (jolt) shake = { ...jolt, t: 0 };
  }
  if (playback.enrageAt !== null && playback.t >= playback.enrageAt && fight) {
    // The boss flies into its rage: its line across the view, and its look from here on.
    playback.enrageAt = null;
    showEnrage(fight.view.monster.enrage_text);
    duel?.setEnraged(duelRage);
  }
  if (playback.t >= inputAt) settle(false);
}

/** Back to walking, from the battle stance, in the area as `next` describes it. */
async function resumeWalk(next: WorldState): Promise<void> {
  closeBattle();
  if (road) {
    // The fight was on the road: the journey ends where it was going.
    await finishJourney(next);
    return;
  }
  player = { x: stance.x, z: stance.z };
  view = { yaw: stance.yaw, pitch: stancePitch };
  screen = 'world';
  await showContents(next);
}

/** What a battle button or hotkey does: the action goes to the server and the turn it answers is played. */
async function act(action: BattleAction): Promise<void> {
  if (!fight || fight.locked || fight.playing || fight.view.phase !== 'fight') return;
  fight.locked = true;
  renderBattle(fight.view, true);
  const mine = entry;
  const name = fight.view.monster.name;
  const answer = await postBattle(action);
  if (mine !== entry || !fight) return;
  if (!answer.ok) {
    // Refused: say why and show what the server says is true now.
    actionSound('refused');
    showNotice(answer.message);
    const now = await fetchBattle();
    if (mine !== entry || !fight) return;
    if (!now.ok) {
      await refresh();
    } else if (now.battle.phase === 'none') {
      await resumeWalk(now.state);
    } else {
      state = now.state;
      present(now.battle);
    }
    return;
  }
  if (answer.battle.phase === 'fled' || answer.battle.phase === 'none') {
    // The monster that was fled from stays where the fight stood.
    if (answer.battle.phase === 'fled') {
      fledTo = duelMet;
      actionSound('fled');
    }
    await resumeWalk(answer.state);
    if (answer.battle.phase === 'fled') showNotice(`You slip away from ${name}!`);
    return;
  }
  state = answer.state;
  present(answer.battle);
}

/** Continue after a victory: the rewards are taken as seen and the player walks on. */
async function proceed(): Promise<void> {
  if (!fight || fight.result !== 'victory' || busy) return;
  busy = true;
  actionSound('battle_continue');
  const mine = entry;
  const announcement = killAnnouncement(fight.view.rewards?.quest_updates ?? []);
  const crowned = fight.view.rewards?.boss?.campaign_complete === true;
  const answer = await postBattleContinue();
  busy = false;
  if (mine !== entry) return;
  if (!answer.ok) {
    await refresh();
    return;
  }
  // The last boss has fallen: the epilogue, when the server agrees that the crown is whole.
  if (crowned && await playEnding()) return;
  if (mine !== entry) return;
  await resumeWalk(answer.state);
  // What the kill did for a quest, once more, now that the tracker shows it.
  if (announcement !== null) showNotice(announcement);
}

/** Rise Again after a defeat: the healer's price is paid and the player stands in the area the server names. */
async function riseAgain(): Promise<void> {
  if (!fight || fight.result !== 'defeat' || busy) return;
  busy = true;
  const mine = entry;
  const answer = await postBattleRevive();
  busy = false;
  if (mine !== entry) return;
  if (!answer.ok || !answer.state.area) {
    actionSound('refused');
    await refresh();
    return;
  }
  actionSound('revive');
  closeBattle();
  if (road) {
    await finishJourney(answer.state);
    return;
  }
  screen = 'world';
  await enterArea(answer.state, null);
}

bindBattlePanel({ act: (action) => void act(action), proceed: () => void proceed(), revive: () => void riseAgain() });
// Start Over is a link to the classic creation page: it sounds as it is followed.
document.getElementById('battle-result')?.addEventListener('click', (event) => {
  if ((event.target as HTMLElement).closest('a')) actionSound('start_over');
});

function battleKey(event: KeyboardEvent): void {
  if (event.ctrlKey || event.altKey || event.metaKey) return;
  // The keys that walk, interact or scroll do none of that in a fight.
  if (moveKey(event.code) || event.code === 'KeyE' || event.code === 'Space') event.preventDefault();
  if (event.repeat || !fight) return;
  if (fight.result === 'victory') {
    if (event.code === 'Enter' || event.code === 'NumpadEnter' || event.code === 'Space') void proceed();
    return;
  }
  if (fight.locked || fight.playing) return;
  const action = actionForKey(fight.view, event.code);
  if (action) void act(action);
}

// --- events and the moment before a boss -------------------------------------------------------

/** Holds the player where they stand while a panel is open over the area. */
function holdStill(): void {
  busy = false;
  held.clear();
  setMenu(false);
  closePanel();
  if (document.pointerLockElement === canvas) document.exitPointerLock();
  showPrompt(null);
  hideNotice();
}

/** Opens the event panel on a pending event (`shownView`) or on the outcome of one (`result`), in the area as `next` describes it. */
function openEvent(shownView: EventView | null, result: EventResult | null, next: WorldState): void {
  happening = { view: result ? null : shownView, result };
  screen = 'event';
  holdStill();
  if (result) renderEventResult(result, false);
  else if (shownView) renderEvent(shownView, false);
  showEventPanel(true);
  void showContents(next);
}

function closeEvent(): void {
  happening = null;
  showEventPanel(false);
  forgetReturn();
  if (screen === 'event') screen = 'world';
}

/** What a choice button or digit key does: the choice goes to the server and the outcome it answers is shown. */
async function chooseEvent(index: number): Promise<void> {
  const open = screen === 'event' ? (happening?.view ?? null) : null;
  if (!open || busy || !open.choices.some((choice) => choice.index === index)) return;
  busy = true;
  renderEvent(open, true);
  const mine = entry;
  const answer = await postEventChoose(index);
  busy = false;
  if (mine !== entry || screen !== 'event') return;
  if (!answer.ok || !answer.result) {
    // Refused: show what the server says is true now.
    actionSound('refused');
    closeEvent();
    await refresh();
    return;
  }
  actionSound(answer.result.leveled_up ? 'event_levelup' : answer.result.success ? 'event_success' : 'event_failure');
  happening = { view: null, result: answer.result };
  renderEventResult(answer.result, false);
  await showContents(answer.state);
}

/** Continue after the outcome: on with the walk, or into the fight the outcome started. */
async function proceedEvent(): Promise<void> {
  const result = screen === 'event' ? (happening?.result ?? null) : null;
  if (!result || busy) return;
  busy = true;
  actionSound('event_continue');
  renderEventResult(result, true);
  const mine = entry;
  const answer = await postEventContinue();
  busy = false;
  if (mine !== entry || screen !== 'event') return;
  closeEvent();
  if (!answer.ok) {
    await refresh();
    return;
  }
  if (answer.battle && answer.battle.phase !== 'none') {
    await startBattle(answer.battle, answer.state);
    return;
  }
  let next = answer.state;
  if (!next.pending && !contentsOf(next)) {
    // The event was met on the classic pages: what the area holds is rolled on arriving here.
    const arrived = await postEnter();
    if (mine !== entry) return;
    if (arrived.ok) next = arrived.state;
  }
  await showContents(next);
}

function eventKey(event: KeyboardEvent): void {
  if (event.ctrlKey || event.altKey || event.metaKey) return;
  // The keys that walk, interact or scroll do none of that while the panel is open.
  if (moveKey(event.code) || event.code === 'KeyE' || event.code === 'Space') event.preventDefault();
  if (event.repeat || !happening) return;
  if (happening.result) {
    if (['Enter', 'NumpadEnter', 'Space', 'KeyE'].includes(event.code)) void proceedEvent();
    return;
  }
  const choice = happening.view ? choiceForKey(happening.view, event.code) : null;
  if (choice !== null) void chooseEvent(choice);
}

/** Opens the introduction of a boss: the player turns to it (it turns to the player by itself) and nothing is sent yet. */
function openIntro(boss: BossContent, at: Vec2): void {
  introBoss = boss.id;
  screen = 'intro';
  holdStill();
  const t = turnTowards(view, player, at);
  turn(t.dYaw, t.dPitch);
  showBossIntro(boss);
}

/** Step back: the panel closes and nothing has changed. */
function closeIntro(): void {
  introBoss = null;
  ambush = null;
  showBossIntro(null);
  if (screen === 'intro') screen = 'world';
}

/** Fight: the challenge goes to the server and the fight starts. */
async function fightBoss(): Promise<void> {
  if (screen !== 'intro' || introBoss === null) return;
  actionSound('intro_fight');
  if (ambush) {
    // The fight began with the journey; here it is shown.
    const met = ambush;
    closeIntro();
    await startBattle(met.battle, met.state);
    return;
  }
  const id = introBoss;
  closeIntro();
  await engage(id);
}

function introKey(event: KeyboardEvent): void {
  if (event.ctrlKey || event.altKey || event.metaKey) return;
  if (moveKey(event.code) || event.code === 'KeyE' || event.code === 'Space') event.preventDefault();
  if (event.repeat) return;
  if (['Enter', 'NumpadEnter', 'Space', 'KeyE'].includes(event.code)) void fightBoss();
  else if (event.code === 'Escape') stepBack();
}

/** Step back from a boss's introduction, by key or button. Nobody steps back from an ambush. */
function stepBack(): void {
  if (ambush || screen !== 'intro') return;
  actionSound('intro_back');
  closeIntro();
}

bindEventPanel({ choose: (index) => void chooseEvent(index), proceed: () => void proceedEvent() });
bindBossIntro({ fight: () => void fightBoss(), back: stepBack });

/** Searches the area further: the server rolls again and the new contents take their slots. */
async function search(): Promise<void> {
  if (busy) return;
  busy = true;
  const mine = entry;
  const answer = await postSearch();
  if (!answer.ok) actionSound('refused');
  if (mine !== entry) return;
  if (!answer.ok) {
    await refresh();
    return;
  }
  await showContents(answer.state);
  const found = contentsOf(answer.state);
  if (found && !found.monster && !found.event) showNotice('You find nothing.');
  busy = false;
}

// --- inventory, character sheet and rest ---------------------------------------------------------

function drawPanel(): void {
  showTravelPanel(panel === 'travel');
  showJournalPanel(panel === 'journal');
  if (panel === 'travel' || panel === 'journal') {
    showSheetPanel(null);
    showShopPanel(false);
    if (panel === 'travel' && atlas) renderTravel(atlas, panelMessage, panelLocked);
    if (panel === 'journal' && journal) renderJournal(journal);
    return;
  }
  if (panel === 'shop') {
    if (!store) return;
    renderShop(store.view, store.tab, panelMessage, panelLocked);
    showSheetPanel(null);
    showShopPanel(true);
    return;
  }
  if (!panel || !character) return;
  showShopPanel(false);
  if (panel === 'inventory') renderInventory(character.inventory, character.sheet, panelMessage, panelLocked);
  else renderSheet(character.sheet, panelMessage, panelLocked);
  showSheetPanel(panel);
}

function closePanel(): void {
  panelAsked += 1;
  panel = null;
  panelLocked = false;
  panelMessage = null;
  store = null;
  showSheetPanel(null);
  showShopPanel(false);
  showTravelPanel(false);
  showJournalPanel(false);
}

/** The player closes the panel that is open (its key, Esc or its Close button). */
function dismissPanel(): void {
  if (panel) actionSound('panel_close');
  closePanel();
}

/** Whether I, C and the menu entries open a panel now: walking in the world, nothing else going on. */
const panelAllowed = (): boolean => inWorld() && !loading && !crossing && !busy && !resting && !travelling && !road;

/** Opens the inventory or the character sheet: asks the server and shows the panel when the answer is in. */
async function openPanel(kind: PanelKind): Promise<void> {
  if (!panelAllowed() || menuOpen) return;
  const asked = ++panelAsked;
  const mine = entry;
  const answer = await fetchCharacter();
  if (asked !== panelAsked || mine !== entry || !panelAllowed() || menuOpen) return;
  if (!answer.ok) {
    actionSound('refused');
    showNotice(answer.message);
    return;
  }
  actionSound('panel_open');
  character = { inventory: answer.inventory, sheet: answer.sheet };
  state = answer.state;
  showHud(answer.state, false);
  panel = kind;
  panelLocked = false;
  panelMessage = null;
  held.clear();
  showPrompt(null);
  drawPanel();
  if (document.pointerLockElement === canvas) document.exitPointerLock();
}

/** What I, C, J and the menu entries do: the key of the open panel closes it, another one switches. */
function togglePanel(kind: PanelKind | 'journal'): void {
  if (panel === kind) dismissPanel();
  else if (kind === 'journal') void openJournal();
  else void openPanel(kind);
}

/** Takes an answer of the character API: both views and the state, so that every number on screen is the new one. */
function takeCharacter(answer: CharacterAnswer): string {
  if (!answer.ok) return answer.message;
  character = { inventory: answer.inventory, sheet: answer.sheet };
  state = answer.state;
  showHud(answer.state, false);
  return answer.message ?? '';
}

/** What a button of a panel does: the action goes to the server and the panel is drawn again from the answer. */
async function panelAction(send: () => Promise<CharacterAnswer>, sound: string): Promise<void> {
  if (!panel || panelLocked) return;
  panelLocked = true;
  drawPanel();
  const asked = panelAsked;
  const answer = await send();
  // The action sounds when the answer is in, also when the panel was closed meanwhile.
  actionSound(answer.ok ? sound : 'refused');
  if (asked !== panelAsked) return;
  panelLocked = false;
  panelMessage = { text: takeCharacter(answer), refused: !answer.ok };
  drawPanel();
}

bindSheetPanels({
  item: (action, index) => void panelAction(() => postInventory(action, index), action === 'use' ? 'use_potion' : 'equip'),
  unequip: (what) => void panelAction(() => postUnequip(what), 'unequip'),
  improve: (ability) => void panelAction(() => postImprove(ability), 'improve'),
  close: () => dismissPanel(),
});

// --- Elara's shop ----------------------------------------------------------------------------------

/** Opens the shop panel: the player turns to Elara at `at`, the server is asked and the panel shows its answer. */
async function openShop(at: Vec2): Promise<void> {
  if (!panelAllowed() || menuOpen) return;
  const asked = ++panelAsked;
  const mine = entry;
  const answer = await fetchShop();
  if (asked !== panelAsked || mine !== entry || !panelAllowed() || menuOpen) return;
  if (!answer.ok) {
    actionSound('refused');
    showNotice(answer.message);
    return;
  }
  const t = turnTowards(view, player, at);
  turn(t.dYaw, t.dPitch);
  store = { view: answer.shop, tab: 'wares', haggle: null };
  state = answer.state;
  showHud(answer.state, false);
  panel = 'shop';
  panelLocked = false;
  panelMessage = null;
  held.clear();
  showPrompt(null);
  showHaggle(null, false);
  drawPanel();
  if (document.pointerLockElement === canvas) document.exitPointerLock();
}

function shopTab(tab: ShopTab): void {
  if (panel !== 'shop' || !store) return;
  if (store.tab !== tab) actionSound('tab');
  store.tab = tab;
  drawPanel();
}

const SHOP_SOUNDS: Record<string, string> = {
  buy: 'buy', sell: 'sell', accept: 'quest_accept', 'turn-in': 'quest_turn_in', abandon: 'quest_abandon',
};

/** What a button of the shop does: the action goes to the server and the panel is drawn again from the answer. */
async function shopAction(send: () => Promise<ShopAnswer>, action: string): Promise<void> {
  if (panel !== 'shop' || !store || panelLocked) return;
  panelLocked = true;
  drawPanel();
  const asked = panelAsked;
  const answer = await send();
  // The action sounds when the answer is in, also when the panel was closed meanwhile.
  if (!answer.ok) actionSound('refused');
  else if (action === 'haggle') actionSound(answer.haggle && answer.haggle.discount > 0 ? 'haggle_success' : 'haggle_failure');
  else actionSound(SHOP_SOUNDS[action] ?? 'refused');
  if (asked !== panelAsked || !store) return;
  panelLocked = false;
  if (answer.ok) {
    store.view = answer.shop;
    state = answer.state;
    showHud(answer.state, false);
    if (answer.haggle) {
      store.haggle = haggleFeedback(answer.haggle);
      showHaggle(store.haggle, true);
    }
    panelMessage = answer.message === null ? null : { text: answer.message, refused: false };
  } else {
    // Refused: Elara may have a line for it.
    if (answer.dialog) store.view = { ...store.view, dialog: answer.dialog };
    panelMessage = { text: answer.message, refused: true };
  }
  drawPanel();
}

bindShopPanel({
  item: (action, index) => void shopAction(() => postShopItem(action, index), action),
  quest: (action, id) => void shopAction(() => postShopQuest(action, id), action),
  tab: (tab) => shopTab(tab),
  close: () => dismissPanel(),
});

const wait = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

// --- travel, the journal and the ending ------------------------------------------------------------

/** Opens the map at the signpost: the player turns to it, the server is asked and the panel shows its answer. */
async function openTravel(at: Vec2): Promise<void> {
  if (!panelAllowed() || menuOpen) return;
  const asked = ++panelAsked;
  const mine = entry;
  const answer = await fetchTravel();
  if (asked !== panelAsked || mine !== entry || !panelAllowed() || menuOpen) return;
  if (!answer.ok) {
    actionSound('refused');
    showNotice(answer.message);
    return;
  }
  const t = turnTowards(view, player, at);
  turn(t.dYaw, t.dPitch);
  atlas = answer.travel;
  state = answer.state;
  showHud(answer.state, false);
  panel = 'travel';
  panelLocked = false;
  panelMessage = null;
  held.clear();
  showPrompt(null);
  drawPanel();
  if (document.pointerLockElement === canvas) document.exitPointerLock();
}

/** What a location of the map does, by key or click: the journey, or the reason there is none. */
function chooseTravel(location: string): void {
  if (panel !== 'travel' || !atlas || panelLocked) return;
  const choice = travelChoices(atlas).find((made) => made.location === location);
  if (!choice) return;
  if (!choice.enabled) {
    actionSound('refused');
    panelMessage = { text: choice.reason ?? '', refused: true };
    drawPanel();
    return;
  }
  void travelTo(choice.location);
}

function hideArrival(): void {
  window.clearTimeout(arrivalTimer);
  arrival = null;
  showArrival(null);
}

/** The name of the place and its act, large, for a moment. */
function announceArrival(next: WorldState): void {
  if (!next.location) return;
  window.clearTimeout(arrivalTimer);
  arrival = arrivalTitle({ location: next.location });
  showArrival(arrival);
  arrivalTimer = window.setTimeout(hideArrival, ARRIVAL_SECONDS * 1000);
}

/** The journey: the view goes black, the server moves the character, the new area (or the road of an ambush) is built, the view comes back. */
async function travelTo(location: string): Promise<void> {
  if (travelling || !inWorld() || loading) return;
  travelling = true;
  actionSound('travel_depart');
  closePanel();
  held.clear();
  showPrompt(null);
  hideNotice();
  const mine = entry;
  fade(true);
  const [answer] = await Promise.all([postTravel(location), wait(REST_FADE_MS)]);
  if (!answer.ok) actionSound('refused');
  if (mine === entry) {
    if (!answer.ok) {
      showNotice(answer.message);
    } else if (answer.ambush && answer.battle) {
      atlas = answer.travel;
      await enterRoad(answer.state);
      if (layout && road) {
        ambush = { boss: answer.ambush, battle: answer.battle, state: answer.state };
        introBoss = answer.ambush.id;
        screen = 'intro';
        holdStill();
        showBossIntro(answer.ambush, false);
      }
    } else if (answer.state.pending || !answer.state.area) {
      apply(answer.state, false);
    } else {
      atlas = answer.travel;
      await enterArea(answer.state, null);
      if (screen === 'world' && state === answer.state) announceArrival(answer.state);
    }
  }
  fade(false);
  await wait(REST_FADE_MS);
  travelling = false;
}

/** The end of a journey that an ambush interrupted: the view fades, the destination is entered and named. */
async function finishJourney(next: WorldState): Promise<void> {
  if (next.pending || !next.area) {
    await refresh();
    return;
  }
  travelling = true;
  screen = 'world';
  fade(true);
  await wait(REST_FADE_MS);
  await enterArea(next, null);
  if (screen === 'world' && state === next) announceArrival(next);
  fade(false);
  await wait(REST_FADE_MS);
  travelling = false;
}

bindTravelPanel({ choose: (location) => chooseTravel(location), close: () => dismissPanel() });

/** Opens the journal: asks the server and shows the panel when the answer is in. */
async function openJournal(): Promise<void> {
  if (!panelAllowed() || menuOpen) return;
  const asked = ++panelAsked;
  const mine = entry;
  const answer = await fetchJournal();
  if (asked !== panelAsked || mine !== entry || !panelAllowed() || menuOpen) return;
  if (!answer.ok) {
    actionSound('refused');
    showNotice(answer.message);
    return;
  }
  actionSound('panel_open');
  journal = answer.journal;
  state = answer.state;
  showHud(answer.state, false);
  panel = 'journal';
  panelLocked = false;
  panelMessage = null;
  store = null;
  held.clear();
  showPrompt(null);
  drawPanel();
  if (document.pointerLockElement === canvas) document.exitPointerLock();
}

function closeEnding(): void {
  ending = null;
  showEnding(null);
  epilogue?.dispose();
  epilogue = null;
}

/** Plays the epilogue when the server gives it. False (and nothing changed) when it does not. */
async function playEnding(): Promise<boolean> {
  const answer = await fetchEnding();
  if (!answer.ok) return false;
  leaveWorld();
  epilogue = buildEndingScene(answer.ending.shards);
  resize();
  ending = { view: answer.ending, step: 0 };
  state = answer.state;
  screen = 'ending';
  actionSound('ending');
  hideHud();
  showEnding(ending.view, 0);
  return true;
}

/** Continue in the epilogue: the next step, or after the last one the title screen. */
function advanceEnding(): void {
  if (screen !== 'ending' || !ending) return;
  actionSound('ending_step');
  if (ending.step >= endingSteps(ending.view).length - 1) {
    closeEnding();
    void fetchState().then((next) => apply(next, false), () => apply(null, false));
    return;
  }
  ending.step += 1;
  showEnding(ending.view, ending.step);
}

/** "Relive the ending" in the journal. */
async function reliveEnding(): Promise<void> {
  if (panel !== 'journal' || panelLocked) return;
  panelLocked = true;
  if (!(await playEnding())) {
    actionSound('refused');
    panelLocked = false;
    showNotice('The crown is not yet whole.');
  }
}

bindJournalPanel({ ending: () => void reliveEnding(), close: () => dismissPanel() });
bindEndingPanel({
  proceed: () => {
    // The button keeps no focus, so that Space and Enter are not a click as well.
    (document.activeElement as HTMLElement | null)?.blur();
    advanceEnding();
  },
});

/** Rests at the rest landmark: the view goes black, the server restores, the view comes back. */
async function rest(): Promise<void> {
  if (busy || resting) return;
  resting = true;
  held.clear();
  showPrompt(null);
  hideNotice();
  const mine = entry;
  fade(true);
  const [answer] = await Promise.all([postRest(), wait(REST_FADE_MS)]);
  actionSound(answer.ok ? 'interact_rest' : 'refused');
  if (mine === entry) showNotice(takeCharacter(answer));
  fade(false);
  await wait(REST_FADE_MS);
  resting = false;
}

/** What E does: whatever the prompt says. */
async function interact(): Promise<void> {
  if (!shown() || menuOpen || crossing || busy || heldStill()) return;
  const hit = interactionNow();
  if (!hit) return;
  if (hit.locked) {
    actionSound('interact_locked');
    return;
  }
  const boss = hit.kind === 'boss' ? (contentsOf(state)?.boss ?? null) : null;
  // Resting sounds when the server's answer is in.
  if (hit.kind !== 'rest') actionSound(`interact_${hit.kind}`);
  if (hit.kind === 'rest') await rest();
  else if (hit.kind === 'shop') await openShop({ x: hit.x, z: hit.z });
  else if (hit.kind === 'travel') await openTravel(signpostOf(dressing) ?? { x: hit.x, z: hit.z });
  else if (hit.kind === 'search') await search();
  else if (boss) openIntro(boss, { x: hit.x, z: hit.z });
  else if (hit.id !== null) await engage(hit.id);
}

// --- the beginning: creation, the opening and Continue ---------------------------------------------

function drawCreation(): void {
  if (maker) renderCreation(maker.view, maker.step, maker.choices, maker.preview, makerMessage, makerLocked);
}

function closeCreation(): void {
  maker = null;
  makerMessage = null;
  makerLocked = false;
  showCreationPanel(false);
}

/** Asks the server what the race and class chosen make; the client computes none of it. */
async function askPreview(): Promise<void> {
  if (!maker) return;
  const mine = maker;
  const { race, class_name: className } = mine.choices;
  if (!race || !className) return;
  if (mine.preview?.race === race && mine.preview.class_name === className) return;
  mine.preview = null;
  drawCreation();
  const answer = await fetchPreview(race, className);
  if (maker !== mine || mine.choices.race !== race || mine.choices.class_name !== className) return;
  if (!answer.ok) return;
  mine.preview = answer.preview;
  drawCreation();
}

/** New game on the title screen: the creation steps over the title scene. */
async function openCreation(): Promise<void> {
  if (!atTitle() || busy || slots) return;
  actionSound('title_button');
  busy = true;
  const answer = await fetchCreation();
  busy = false;
  if (!atTitle()) return;
  if (!answer.ok) {
    showTitle(null);
    return;
  }
  maker = { view: answer.creation, step: 'race', choices: emptyChoices(), preview: null };
  makerMessage = null;
  makerLocked = false;
  screen = 'creation';
  hideTitle();
  forgetCreationStep();
  showCreationPanel(true);
  drawCreation();
}

/** A card of the step shown was clicked. */
function creationChoose(value: string): void {
  if (!maker || makerLocked) return;
  const { view: offered, step, choices } = maker;
  if (step === 'race') maker.choices = chooseRace(choices, value);
  else if (step === 'class') maker.choices = chooseClass(choices, offered, value);
  else if (step === 'skills') maker.choices = toggleSkill(choices, offered, value);
  else if (step === 'weapon') maker.choices = { ...choices, weapon: value };
  else if (step === 'armour') maker.choices = { ...choices, armor: value === '' ? null : value };
  else if (step === 'portrait') maker.choices = { ...choices, portrait: value };
  else return;
  actionSound('creation_choice');
  makerMessage = null;
  drawCreation();
  void askPreview();
}

function creationName(text: string): void {
  if (!maker || makerLocked) return;
  maker.choices = { ...maker.choices, name: text };
  // The field keeps its caret: only the Next button is shown anew.
  showCreationFoot(maker.view, maker.step, maker.choices, makerLocked);
}

/** Back (Esc): the step before, and from the first one the title screen. Every choice is kept on the way. */
function creationBack(): void {
  if (!maker || makerLocked) return;
  const before = prevStep(maker.step);
  actionSound('creation_step');
  if (before === null) {
    closeCreation();
    // Back on the title panel as it was: with the pending link when something of the earlier game is pending.
    screen = state?.pending ? 'pending' : 'title';
    showTitle(state, saveCount);
    return;
  }
  maker.step = before;
  makerMessage = null;
  drawCreation();
}

/** Next (Enter): on from a complete step; on the summary the character is made and the new game starts. */
async function creationNext(): Promise<void> {
  if (!maker || makerLocked) return;
  const mine = maker;
  if (mine.step !== 'summary') {
    const after = nextStep(mine.step, mine.choices, mine.view);
    if (after === mine.step) return;
    actionSound('creation_step');
    mine.step = after;
    makerMessage = null;
    drawCreation();
    return;
  }
  if (!stepComplete('summary', mine.choices, mine.view)) return;
  makerLocked = true;
  makerMessage = null;
  drawCreation();
  const answer = await postNewGame(requestBody(mine.choices));
  actionSound(answer.ok ? 'new_game' : 'refused');
  if (maker !== mine) return;
  makerLocked = false;
  if (!answer.ok) {
    makerMessage = { text: answer.message, refused: true };
    drawCreation();
    return;
  }
  closeCreation();
  forgetReturn();
  state = answer.state;
  opening = answer.opening;
  screen = 'opening';
  showOpening(opening);
  (document.activeElement as HTMLElement | null)?.blur();
}

bindCreationPanel({ choose: creationChoose, name: creationName, back: creationBack, next: () => void creationNext() });
bindOpeningPanel({
  proceed: () => {
    // The button keeps no focus, so that Space and Enter are not a click as well.
    (document.activeElement as HTMLElement | null)?.blur();
    void enterGame();
  },
});

/** Continue on the title screen and after the opening: into the area the character stands in. */
async function enterGame(): Promise<void> {
  const from = screen;
  if ((from !== 'title' && from !== 'opening') || !state || !state.has_character || state.pending || busy || slots) return;
  actionSound(from === 'opening' ? 'opening_continue' : 'title_button');
  busy = true;
  // Arriving: the server rolls what the area holds when it has not yet.
  const [arrived] = await Promise.all([postEnter(), fontReady()]);
  busy = false;
  if (screen !== from || loading) return;
  if (from === 'opening') {
    opening = null;
    showOpening(null);
    screen = 'title';
  }
  if (!arrived.ok) {
    await refresh();
  } else if (arrived.state.pending || !arrived.state.area) {
    apply(arrived.state, false);
  } else {
    void enterArea(arrived.state, null);
  }
}

// --- the save slots, the settings and the way back to the title ------------------------------------

function drawSaves(): void {
  if (slots) renderSaves(slots.view, slots.mode, slots.confirm, slotsMessage, slotsLocked);
}

/** Whether the save slots or the settings can open from where the player is: the menu, or the title screen. */
const menuShown = (): boolean => inWorld() && menuOpen && !slots && !settingsOpen;
const titleShown = (): boolean => atTitle() && !busy && !loading && !slots;

/** Opens the save slots: from the menu to save or load, from the title screen to load. */
async function openSaves(mode: SavesMode): Promise<void> {
  const from = atTitle() ? 'title' : 'menu';
  const allowed = from === 'title' ? titleShown : menuShown;
  if (!allowed()) return;
  actionSound(from === 'title' ? 'title_button' : 'panel_open');
  const answer = await fetchSaves();
  if (!allowed()) return;
  if (!answer.ok) {
    actionSound('refused');
    if (from === 'menu') showNotice(answer.message);
    return;
  }
  saveCount = answer.saves.saves.length;
  slots = { view: answer.saves, mode, confirm: null };
  slotsFrom = from;
  slotsMessage = null;
  slotsLocked = false;
  if (from === 'title') hideTitle();
  else showMenu(false);
  showSavesPanel(true);
  drawSaves();
}

/** Takes the save slots off the screen. `back`: to where they were opened from, the menu or the title screen. */
function closeSaves(back = true): void {
  if (!slots) return;
  slots = null;
  slotsMessage = null;
  slotsLocked = false;
  showSavesPanel(false);
  if (!back) return;
  if (slotsFrom === 'title') showTitle(state, saveCount);
  else showMenu(true);
}

/** Esc and Close: not while a save, a load or a delete is on its way, whose answer the panel has to show. */
function dismissSaves(): void {
  if (slotsLocked || !slots) return;
  actionSound('panel_close');
  closeSaves();
}

/** A button of a slot: "Overwrite" and "Delete" ask first, "Save here" and "Load" act at once. */
function slotPressed(action: SlotAction, id: string | null): void {
  if (!slots || slotsLocked || slots.confirm) return;
  if ((action === 'overwrite' || action === 'delete') && id !== null) {
    actionSound('confirm_ask');
    slots.confirm = { action, id };
    slotsMessage = null;
    drawSaves();
    return;
  }
  void slotSend(action, id);
}

async function slotSend(action: SlotAction, id: string | null): Promise<void> {
  if (!slots || slotsLocked) return;
  const mine = slots;
  slotsLocked = true;
  mine.confirm = null;
  drawSaves();
  const answer = await postSave(action === 'overwrite' ? 'save' : action, id);
  actionSound(!answer.ok ? 'refused' : action === 'overwrite' ? 'save' : action);
  if (slots !== mine) {
    // The panel was taken away meanwhile (the world was left). What the server did still holds: after a
    // load the session is the loaded game, so the client goes on with it.
    if (answer.ok) saveCount = answer.saves.saves.length;
    if (answer.ok && action === 'load' && answer.state) await resumeLoaded(answer.state, answer.message);
    return;
  }
  if (!answer.ok) {
    // The slots are everybody's: show them as they are now.
    const now = await fetchSaves();
    if (slots !== mine) return;
    if (now.ok) mine.view = now.saves;
  } else {
    mine.view = answer.saves;
  }
  saveCount = mine.view.saves.length;
  slotsLocked = false;
  slotsMessage = { text: answer.message, refused: !answer.ok };
  drawSaves();
  if (answer.ok && action === 'load' && answer.state) await resumeLoaded(answer.state, answer.message);
}

/** After a load: on as a page load with that session goes on, into the area or into what is pending. */
async function resumeLoaded(next: WorldState, message: string): Promise<void> {
  forgetReturn();
  closeSaves(false);
  leaveWorld();
  screen = 'title';
  hideHud();
  state = next;
  if (!next.pending && next.area) {
    busy = true;
    const [arrived] = await Promise.all([postEnter(), fontReady()]);
    busy = false;
    if (screen !== 'title') return;
    if (arrived.ok && !arrived.state.pending && arrived.state.area) {
      await enterArea(arrived.state, null);
      showNotice(message);
      return;
    }
  }
  await refresh();
}

bindSavesPanel({
  act: slotPressed,
  yes: () => {
    if (slots?.confirm) void slotSend(slots.confirm.action, slots.confirm.id);
  },
  no: () => {
    if (!slots || slotsLocked) return;
    actionSound('panel_close');
    slots.confirm = null;
    drawSaves();
  },
  close: dismissSaves,
});

/** A change in the settings panel: in use and in the browser's storage at once. */
function useSettings(next: Settings): void {
  actionSound('settings_change');
  settings = next;
  eye.fov = next.fov;
  eye.updateProjectionMatrix();
  try {
    localStorage.setItem(SETTINGS_KEY, serializeSettings(next));
  } catch {
    /* no storage: the settings last until the page is left */
  }
  renderSettings(settings);
}

function openSettings(): void {
  if (!menuShown()) return;
  settingsOpen = true;
  actionSound('panel_open');
  showMenu(false);
  renderSettings(settings);
  renderSound(soundSettings);
  showSettingsPanel(true);
}

function closeSettings(back = true): void {
  if (!settingsOpen) return;
  settingsOpen = false;
  showSettingsPanel(false);
  if (back) showMenu(true);
}

/** Esc and Close in the settings. */
function dismissSettings(): void {
  if (!settingsOpen) return;
  actionSound('panel_close');
  closeSettings();
}

bindSettingsPanel({
  change: useSettings,
  sound: (next) => {
    useSound(next);
    actionSound('settings_change');
  },
  close: dismissSettings,
});

/** Quit to title: nothing is sent; the session keeps its character, so Continue is offered. */
function quitToTitle(): void {
  if (!menuShown()) return;
  actionSound('quit');
  leaveWorld();
  screen = 'title';
  showTitle(state, saveCount);
}

// --- menu and input ----------------------------------------------------------------------------

function requestLock(): void {
  // A refused lock (no gesture, or too soon after Esc) is not an error worth reporting.
  try {
    const asked = canvas.requestPointerLock() as unknown as Promise<void> | undefined;
    asked?.catch?.(() => {});
  } catch {
    /* refused */
  }
}

function setMenu(open: boolean): void {
  menuOpen = open;
  // The save slots and the settings are part of the menu: they go with it.
  closeSaves(false);
  closeSettings(false);
  showMenu(open);
  if (open) {
    held.clear();
    if (document.pointerLockElement === canvas) document.exitPointerLock();
  }
}

canvas.addEventListener('click', () => {
  if (inWorld() && !menuOpen && !heldStill()) requestLock();
});
document.addEventListener('pointerlockerror', () => {});
document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement === canvas) return;
  lockLostAt = performance.now();
  if (inWorld() && !menuOpen && !heldStill()) {
    actionSound('menu_open');
    setMenu(true);
  }
});
document.addEventListener('mousemove', (event) => {
  if (document.pointerLockElement !== canvas || !inWorld() || menuOpen || heldStill()) return;
  const t = settingsTurn(event.movementX, event.movementY, settings);
  turn(t.dYaw, t.dPitch);
});

/** Whether the key was typed into a text field, which keeps its letters. */
function typing(event: KeyboardEvent): boolean {
  const target = event.target as HTMLElement | null;
  if (!target || !target.tagName) return false;
  if (target.tagName === 'TEXTAREA' || target.isContentEditable) return true;
  if (target.tagName !== 'INPUT') return false;
  return !['checkbox', 'radio', 'range', 'button', 'submit'].includes((target as HTMLInputElement).type);
}

window.addEventListener('keydown', (event) => {
  if (event.code === 'KeyN' && !event.ctrlKey && !event.altKey && !event.metaKey && !typing(event)) {
    // N mutes and unmutes on every screen.
    if (!event.repeat) {
      useSound(toggleMute(soundSettings));
      actionSound('mute');
    }
    return;
  }
  if (screen === 'creation') {
    // Enter is Next and Esc is Back; every other key is for the name field.
    if (event.ctrlKey || event.altKey || event.metaKey) return;
    if (event.code === 'Enter' || event.code === 'NumpadEnter' || event.code === 'Escape') {
      event.preventDefault();
      if (event.repeat) return;
      if (event.code === 'Escape') creationBack();
      else void creationNext();
    }
    return;
  }
  if (screen === 'opening') {
    if (event.ctrlKey || event.altKey || event.metaKey) return;
    if (['Enter', 'NumpadEnter', 'Space'].includes(event.code)) {
      event.preventDefault();
      if (!event.repeat) void enterGame();
    }
    return;
  }
  if (slots || settingsOpen) {
    // The save slots or the settings are open: Esc closes them; the arrow keys belong to the sliders.
    if (event.code === 'Escape' && !event.repeat) {
      if (slots) dismissSaves();
      else dismissSettings();
    }
    return;
  }
  if (screen === 'battle') {
    battleKey(event);
    return;
  }
  if (screen === 'event') {
    eventKey(event);
    return;
  }
  if (screen === 'intro') {
    introKey(event);
    return;
  }
  if (screen === 'ending') {
    if (event.ctrlKey || event.altKey || event.metaKey) return;
    if (['Enter', 'NumpadEnter', 'Space', 'KeyE'].includes(event.code)) {
      event.preventDefault();
      if (!event.repeat) advanceEnding();
    }
    return;
  }
  if (!inWorld() || event.ctrlKey || event.altKey || event.metaKey) return;
  if (resting || travelling) {
    // The view is black: keys do nothing.
    if (moveKey(event.code) || event.code === 'KeyE') event.preventDefault();
    return;
  }
  if (panel === 'shop') {
    // The shop is open: 1, 2, 3 switch tabs and Esc closes; nothing walks, and E, I, C and M do nothing.
    if (moveKey(event.code) || event.code === 'KeyE') event.preventDefault();
    if (event.repeat) return;
    const tab = tabForKey(event.code);
    if (event.code === 'Escape') dismissPanel();
    else if (tab) shopTab(tab);
    return;
  }
  if (panel === 'travel') {
    // The map is open: 1 to 8 travel (or say why not) and Esc closes; nothing walks, and E, I, C, J and M do nothing.
    if (moveKey(event.code) || event.code === 'KeyE') event.preventDefault();
    if (event.repeat) return;
    const choice = atlas ? travelChoiceForKey(atlas, event.code) : null;
    if (event.code === 'Escape') dismissPanel();
    else if (choice) chooseTravel(choice.location);
    return;
  }
  const wanted = event.code === 'KeyJ' ? 'journal' : panelForKey(event.code);
  if (panel) {
    // A panel is open: its own key or Esc closes it, the other key switches; nothing walks, E and M do nothing.
    if (moveKey(event.code) || event.code === 'KeyE') event.preventDefault();
    if (event.repeat) return;
    if (event.code === 'Escape') dismissPanel();
    else if (wanted) togglePanel(wanted);
    return;
  }
  if (wanted) {
    if (!event.repeat && !menuOpen) togglePanel(wanted);
    return;
  }
  if (event.code === 'KeyM' || event.code === 'Escape') {
    if (event.repeat) return;
    // Esc with the mouse captured releases it, which already opened the menu.
    if (event.code === 'Escape' && performance.now() - lockLostAt < 300) return;
    actionSound(menuOpen ? 'menu_close' : 'menu_open');
    setMenu(!menuOpen);
    return;
  }
  if (event.code === 'KeyE') {
    if (!event.repeat) void interact();
    return;
  }
  if (moveKey(event.code)) {
    event.preventDefault();
    if (!menuOpen) held.add(event.code);
  }
});
window.addEventListener('keyup', (event) => held.delete(event.code));
window.addEventListener('blur', () => held.clear());

document.getElementById('menu-back')?.addEventListener('click', () => {
  actionSound('menu_close');
  setMenu(false);
  requestLock();
});

// The menu entries of the panels: the menu closes and the panel opens.
for (const [id, kind] of [['menu-inventory', 'inventory'], ['menu-character', 'sheet'], ['menu-journal', 'journal']] as [string, PanelKind | 'journal'][]) {
  document.getElementById(id)?.addEventListener('click', () => {
    setMenu(false);
    if (kind === 'journal') void openJournal();
    else void openPanel(kind);
  });
}

document.getElementById('menu-save')?.addEventListener('click', () => void openSaves('save'));
document.getElementById('menu-load')?.addEventListener('click', () => void openSaves('load'));
document.getElementById('menu-settings')?.addEventListener('click', () => openSettings());
document.getElementById('menu-quit')?.addEventListener('click', () => quitToTitle());

document.getElementById('btn-continue')?.addEventListener('click', () => void enterGame());
document.getElementById('btn-new-game')?.addEventListener('click', () => void openCreation());
document.getElementById('btn-load-game')?.addEventListener('click', () => void openSaves('load'));

// --- frame loop --------------------------------------------------------------------------------

function resize(): void {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  for (const camera of [title.camera, eye, ...(epilogue ? [epilogue.camera] : [])]) {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  }
}
window.addEventListener('resize', resize);
resize();

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = clock.getDelta();
  const time = clock.elapsedTime;
  // The compass shows while the player walks or stands in an area; not in a fight, on the road or under a veil.
  compass = inWorld() && !road && !loading && layout && state
    ? compassMarks(layout, state.exits, contentsOf(state), { x: player.x, z: player.z, yaw: view.yaw })
    : null;
  drawCompass(compass, view.yaw);
  // Sound: the cues of a result that are due, and the bed of where the player is.
  soundClock += dt;
  while (fanfare.length > 0 && fanfare[0].at <= soundClock) cue(fanfare.shift()!.cue);
  const heard = ambienceFor((inWorld() || inFight() || inPanel()) && layout ? layout.type : null, inFight());
  if (heard?.bed !== ambience?.bed || heard?.tense !== ambience?.tense) {
    ambience = heard;
    audio.setAmbience(heard);
  }
  // The red edge: by the hit points the screen shows, and none where there is no character to be hurt.
  let hurt = 0;
  if (inFight() && fight) hurt = vignette(fight.view.player.hp, fight.view.player.max_hp);
  else if ((inWorld() || inPanel()) && state?.character) hurt = vignette(state.character.current_hit_points, state.character.max_hit_points);
  if (hurt !== edge) {
    edge = hurt;
    showVignette(edge);
  }
  const walking = inWorld() && !inFight() && layout !== null && area !== null;
  if (!walking) promptShown = null;
  if (screen === 'ending' && epilogue) {
    epilogue.update(time);
    renderer.render(epilogue.scene, epilogue.camera);
  } else if (inFight() && area) {
    advancePlayback(dt);
    duel?.update(dt);
    // The view: on its way to the battle stance, then held there, moved only by what is played.
    let at = { x: stance.x, z: stance.z, yaw: stance.yaw, pitch: stancePitch };
    if (glide) {
      glide.t += dt;
      const p = Math.min(glide.t / GLIDE_SECONDS, 1);
      const ease = p * p * (3 - 2 * p);
      const around = Math.atan2(Math.sin(stance.yaw - glide.yaw), Math.cos(stance.yaw - glide.yaw)); // the short way round
      at = {
        x: glide.x + (stance.x - glide.x) * ease,
        z: glide.z + (stance.z - glide.z) * ease,
        yaw: glide.yaw + around * ease,
        pitch: glide.pitch + (stancePitch - glide.pitch) * ease,
      };
      if (p >= 1) glide = null;
    }
    const off = { ...(duel?.eye() ?? { forward: 0, side: 0, up: 0, roll: 0 }) };
    if (shake) {
      // The jolt of a blow: never further than its amplitude, fading out over its seconds.
      shake.t += dt;
      const left = 1 - shake.t / shake.seconds;
      if (left <= 0) {
        shake = null;
      } else {
        off.side += shake.amplitude * left * Math.sin(shake.t * 97) * 0.7;
        off.up += shake.amplitude * left * Math.sin(shake.t * 131 + 1) * 0.7;
      }
    }
    const sin = Math.sin(at.yaw);
    const cos = Math.cos(at.yaw);
    eye.position.set(at.x - sin * off.forward + cos * off.side, EYE_HEIGHT + off.up, at.z - cos * off.forward - sin * off.side);
    eye.rotation.set(at.pitch, at.yaw, off.roll);
    area.update(stance.x, stance.z, time);
    things?.update(stance.x, stance.z, time, dt);
    renderer.render(area.scene, eye);
  } else if ((inWorld() || inPanel()) && layout && area) {
    // The monster of the area goes its round, and turns to the player who comes near.
    const roams = inWorld() ? roaming() : null;
    if (roams) {
      if (!loading && !crossing && !travelling && !resting && !busy) {
        const before = roams.w.noticed;
        const passed = Math.min(Math.max(dt, 0), 0.1);
        roams.w = wanderStep(roams.w, roams.slot, layout, roams.seed, roams.t, passed, player);
        roams.t += passed;
        if (roams.w.noticed && !before) actionSound('notice');
      }
      things?.setMonster(roams.w, dt);
    }
    let moved = 0;
    if (inWorld() && !menuOpen && !crossing && !loading && !busy && !heldStill()) {
      const step = walkStep(player, view.yaw, heldKeys(held), dt, walkLayout ?? layout);
      moved = Math.hypot(step.pos.x - player.x, step.pos.z - player.z);
      player = step.pos;
      if (step.gate) {
        void crossGate(step.gate);
      } else {
        // A monster that is walked into starts the fight by itself.
        const hit = interactionNow();
        if (hit?.auto && hit.id !== null) {
          actionSound('interact_monster');
          void engage(hit.id);
        }
      }
    }
    // The stride: a footstep per STRIDE metres walked, and the bob of the eye with it.
    const stride = gaitStep(gait, moved, dt);
    gait = stride.gait;
    if (stride.step && inWorld()) cue(stepSound(layout.type));
    const offered = promptNow();
    if (inWorld()) {
      if (offered !== null && offered !== promptShown) actionSound('prompt');
      promptShown = offered;
    }
    showPrompt(offered);
    things?.setQuestReady(readyCount(state?.quests ?? []) > 0);
    // No bob behind a panel: the view stands still there.
    eye.position.set(player.x, EYE_HEIGHT + (inWorld() && panel === null ? bobOffset(gait) : 0), player.z);
    eye.rotation.set(view.pitch, view.yaw, 0);
    area.update(player.x, player.z, time);
    things?.update(player.x, player.z, time, dt);
    renderer.render(area.scene, eye);
  } else {
    title.update(time);
    renderer.render(title.scene, title.camera);
  }
  triangles = renderer.info.render.triangles;
  window.__aiv.frames += 1;
  window.__aiv.ready = true;
});

// The state is asked for on load, and again when the page comes back from the browser's
// back/forward cache (after a visit to a classic page). On the way back from an encounter the
// title panel stays away while the answer is on its way.
if (savedReturn()) hideTitle();
void refresh();
window.addEventListener('pageshow', (event) => {
  if (event.persisted) void refresh();
});
