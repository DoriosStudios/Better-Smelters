import { system, world } from "@minecraft/server";
import { furnaces } from "./config.js";

export const FURNACE_ENTITY_ID = "better_smelters:furnace";
const FURNACE_IDS = new Set(furnaces);
const OUTLINE_ID = "better_smelters:block_container_outline";
const BLOCK_SELECTION = "better_smelters:has_selection";
const EMPTY = "better_smelters:selection_empty";
const VISIBLE = "better_smelters:selection_visible";
const REACH = 6;
const viewers = new Map();
let active = new Map();

function valid(entity) {
  return entity?.isValid === true;
}

function isFurnace(entity) {
  return valid(entity) && entity.typeId === FURNACE_ENTITY_ID;
}

export function getFurnaceBlock(entity) {
  if (!isFurnace(entity)) return undefined;
  const { x, y, z } = entity.location;
  const location = { x: Math.floor(x), y: Math.floor(y), z: Math.floor(z) };
  if (!entity.dimension.isChunkLoaded(location)) return undefined;
  const block = entity.dimension.getBlock(location);
  return block && FURNACE_IDS.has(block.typeId) ? block : undefined;
}

function positionFurnace(entity, block) {
  const expected = { x: block.location.x + 0.5, y: block.location.y, z: block.location.z + 0.5 };
  const actual = entity.location;
  if (Math.abs(actual.x - expected.x) > 0.0001
    || Math.abs(actual.y - expected.y) > 0.0001
    || Math.abs(actual.z - expected.z) > 0.0001) {
    entity.teleport(expected);
  }
}

function setMode({ entity, block }, empty, reset = false) {
  if (!isFurnace(entity) || !block.dimension.isChunkLoaded(block.location)
    || !FURNACE_IDS.has(block.typeId)) return;
  positionFurnace(entity, block);
  if (entity.getProperty(EMPTY) !== empty) {
    entity.triggerEvent(empty ? "better_smelters:selection_empty" : "better_smelters:selection_full");
  }
  const enabled = reset || empty;
  if (block.permutation.getState(BLOCK_SELECTION) !== enabled) {
    block.setPermutation(block.permutation.withState(BLOCK_SELECTION, enabled));
  }
}

export function resetFurnaceSelection(entity) {
  const block = getFurnaceBlock(entity);
  if (block) setMode({ entity, block }, false, true);
}

function key(block) {
  const { x, y, z } = block.location;
  return `${block.dimension.id}:${x},${y},${z}`;
}

function prepare(entity, cache) {
  const block = getFurnaceBlock(entity);
  if (!block) return undefined;
  const id = key(block);
  if (cache.has(id)) return cache.get(id);
  positionFurnace(entity, block);
  const target = { entity, block };
  cache.set(id, target);
  return target;
}

function resolve(player, cache) {
  const hit = player.getBlockFromViewDirection({ maxDistance: REACH, includePassableBlocks: true });
  const head = player.getHeadLocation();
  const distance = hit ? Math.hypot(
    hit.block.location.x + hit.faceLocation.x - head.x,
    hit.block.location.y + hit.faceLocation.y - head.y,
    hit.block.location.z + hit.faceLocation.z - head.z,
  ) : Infinity;
  let nearest;
  for (const candidate of player.getEntitiesFromViewDirection({ maxDistance: REACH })) {
    if (candidate.distance > distance + 0.01 || (nearest && candidate.distance >= nearest.distance)) continue;
    if (isFurnace(candidate.entity) && getFurnaceBlock(candidate.entity)) nearest = candidate;
  }
  // Entity hits keep the target available while its block selection is disabled.
  if (nearest) return prepare(nearest.entity, cache);
  const block = hit?.block;
  if (!block || !FURNACE_IDS.has(block.typeId)) return undefined;
  const id = key(block);
  if (cache.has(id)) return cache.get(id);
  const entity = block.dimension.getEntitiesAtBlockLocation(block.location).find(candidate => {
    const owner = getFurnaceBlock(candidate);
    return owner && key(owner) === id;
  });
  const target = prepare(entity, cache);
  cache.set(id, target);
  return target;
}

function removeOutline(outline) {
  if (valid(outline)) outline.remove();
}

function createOutline(player, target) {
  if (!target || player.isSneaking) return undefined;
  const outline = target.block.dimension.spawnEntity(OUTLINE_ID, target.block.center());
  try {
    player.setPropertyOverrideForEntity(outline, VISIBLE, true);
    return outline;
  } catch (error) {
    removeOutline(outline);
    throw error;
  }
}

// Separate from furnace processing: two raycasts per player every two ticks.
system.runInterval(() => {
  const next = new Map();
  const online = new Set();
  const cache = new Map();
  for (const player of world.getAllPlayers()) {
    online.add(player.id);
    const previous = viewers.get(player.id);
    let outline;
    try {
      const target = resolve(player, cache);
      removeOutline(previous?.outline);
      outline = createOutline(player, target);
      if (!target) { viewers.delete(player.id); continue; }
      viewers.set(player.id, { ...target, outline });
      const entry = next.get(target.entity.id) ?? { ...target, standing: false };
      entry.standing ||= !player.isSneaking;
      next.set(target.entity.id, entry);
    } catch {
      try { removeOutline(previous?.outline); removeOutline(outline); } catch {}
      viewers.delete(player.id);
    }
  }
  for (const [id, viewer] of viewers) if (!online.has(id)) {
    try { removeOutline(viewer.outline); } catch {}
    viewers.delete(id);
  }
  for (const [id, target] of active) if (!next.has(id)) {
    try { setMode(target, false, true); } catch { /* The chunk may have unloaded. */ }
  }
  // Standing viewers take precedence when several players target the same furnace.
  for (const target of next.values()) {
    try { setMode(target, !target.standing); } catch { /* The target may have changed. */ }
  }
  active = next;
}, 2);

// Reset saved selection and recenter entities from the old y + 0.25 placement.
world.afterEvents.entityLoad.subscribe(({ entity }) => {
  if (!isFurnace(entity)) return;
  system.run(() => {
    try { resetFurnaceSelection(entity); } catch { /* The chunk may have unloaded again. */ }
  });
});
