import { GameMode, ItemStack, system, world } from "@minecraft/server";
import { baseSettings, furnaceRecipes, furnaces, solidFuels, upgrades } from "./config.js";
import * as DoriosLib from "./DoriosLib/index.js";

DoriosLib.container.initialize();

const FURNACE_ENTITY_ID = "better_smelters:furnace";
const FURNACE_COMPONENT_ID = "better_smelters:furnace";
const UI_OPEN_STATE = "better_smelters:ui_open";
const UI_VIEWERS_PROPERTY = "better_smelters:ui_viewers";

const FLAME_SLOT = 0;
const PROGRESS_SLOT = 1;
const FUEL_SLOT = 2;
const INPUT_SLOT = 3;
const OUTPUT_SLOT = 4;

const OPEN_TICK_INTERVAL = 2;
const CLOSED_TICK_INTERVAL = 20;
const NETHER_STAR_CLOSED_TICK_INTERVAL = 4;
const NETHER_STAR_FURNACE_ID = "better_smelters:nether_star_furnace";
const OAK_FURNACE_ID = "better_smelters:oak_wood_furnace";
const FURNACE_IDS = new Set(furnaces);
const REGISTERED_FURNACE_CONTAINERS = new Set();
const EPSILON = 0.000001;
const FACE_OFFSETS = {
  north: [0, 0, -1],
  south: [0, 0, 1],
  east: [1, 0, 0],
  west: [-1, 0, 0],
  up: [0, 1, 0],
  down: [0, -1, 0],
};
const OPPOSITE_FACES = {
  north: "south",
  south: "north",
  east: "west",
  west: "east",
  up: "down",
  down: "up",
};
const AUTOMATION_FACES_BY_FACING = {
  north: { input: "east", output: "west" },
  south: { input: "west", output: "east" },
  west: { input: "north", output: "south" },
  east: { input: "south", output: "north" },
};

function getFurnaceNameTag(typeId) {
  const tier = typeId.split(":")[1].replace(/_furnace$/, "");
  return `entity.better_smelters:${tier}.name`;
}

function getFurnaceEntity(block) {
  return block.dimension
    .getEntitiesAtBlockLocation(block.location)
    .find((entity) => entity.typeId === FURNACE_ENTITY_ID);
}

function getFurnaceBlock(entity) {
  const { x, y, z } = entity.location;
  const block = entity.dimension.getBlock({
    x: Math.floor(x),
    y: Math.floor(y),
    z: Math.floor(z),
  });
  return block && FURNACE_IDS.has(block.typeId) ? block : undefined;
}

function setBooleanState(block, stateId, value) {
  if (!block || block.permutation.getState(stateId) === value) return;
  block.setPermutation(block.permutation.withState(stateId, value));
}

function initializeFurnaceEntity(entity, furnaceTypeId) {
  const inventory = entity.getComponent("minecraft:inventory")?.container;
  if (!inventory) return undefined;

  entity.nameTag = getFurnaceNameTag(furnaceTypeId);
  inventory.setItem(FLAME_SLOT, new ItemStack("better_smelters:flame_0"));
  inventory.setItem(PROGRESS_SLOT, new ItemStack("better_smelters:arrow_right_0"));
  entity.setDynamicProperty("better_smelters:fuelR", 0);
  entity.setDynamicProperty("better_smelters:fuelV", 0);
  entity.setDynamicProperty("better_smelters:progress", 0);
  entity.setProperty(UI_VIEWERS_PROPERTY, 0);
  configureFurnaceContainer(entity);
  return inventory;
}

function spawnFurnaceEntity(block, furnaceTypeId = block.typeId) {
  const { x, y, z } = block.location;
  const entity = block.dimension.spawnEntity(FURNACE_ENTITY_ID, {
    x: x + 0.5,
    y: y + 0.25,
    z: z + 0.5,
  });
  initializeFurnaceEntity(entity, furnaceTypeId);
  return entity;
}

function updateFurnaceOpenState(entity, viewerDelta) {
  if (entity.typeId !== FURNACE_ENTITY_ID) return;

  const current = Number(entity.getProperty(UI_VIEWERS_PROPERTY)) || 0;
  const viewers = Math.max(0, Math.min(64, current + viewerDelta));
  entity.setProperty(UI_VIEWERS_PROPERTY, viewers);

  const block = getFurnaceBlock(entity);
  if (block) setBooleanState(block, UI_OPEN_STATE, viewers > 0);
}

function resetFurnaceOpenState(entity) {
  if (entity.typeId !== FURNACE_ENTITY_ID) return;
  entity.setProperty(UI_VIEWERS_PROPERTY, 0);
  const block = getFurnaceBlock(entity);
  if (block) setBooleanState(block, UI_OPEN_STATE, false);
}

world.afterEvents.entityContainerOpened.subscribe(({ entity }) => {
  updateFurnaceOpenState(entity, 1);
});

world.afterEvents.entityContainerClosed.subscribe(({ entity }) => {
  updateFurnaceOpenState(entity, -1);
});

world.afterEvents.entityRemove.subscribe(({ removedEntityId }) => {
  REGISTERED_FURNACE_CONTAINERS.delete(removedEntityId);
});

world.afterEvents.worldLoad.subscribe(() => {
  system.run(() => {
    for (const dimensionId of ["overworld", "nether", "the_end"]) {
      const dimension = world.getDimension(dimensionId);
      for (const entity of dimension.getEntities({ type: FURNACE_ENTITY_ID })) {
        resetFurnaceOpenState(entity);
        const block = getFurnaceBlock(entity);
        if (block) configureFurnaceContainer(entity);
      }
    }
  });
});

system.beforeEvents.startup.subscribe(({ blockComponentRegistry }) => {
  blockComponentRegistry.registerCustomComponent(FURNACE_COMPONENT_ID, {
    onPlace({ block }) {
      const existingEntity = getFurnaceEntity(block);
      const entity = existingEntity ?? spawnFurnaceEntity(block);
      if (existingEntity) {
        entity.nameTag = getFurnaceNameTag(block.typeId);
        configureFurnaceContainer(entity);
      }
      setBooleanState(block, UI_OPEN_STATE, false);
    },

    onTick({ block }, { params: settings }) {
      tickFurnace(block, settings);
    },

    onPlayerBreak({ block }) {
      dropFurnaceContents(block);
    },
  });
});

function getTickInterval(block) {
  if (block.permutation.getState(UI_OPEN_STATE) === true) return OPEN_TICK_INTERVAL;
  return block.typeId === NETHER_STAR_FURNACE_ID
    ? NETHER_STAR_CLOSED_TICK_INTERVAL
    : CLOSED_TICK_INTERVAL;
}

function getRecipeCapacity(recipe, outputItem) {
  if (outputItem) {
    if (outputItem.typeId !== recipe.output) return 0;
    return Math.max(0, outputItem.maxAmount - outputItem.amount);
  }

  try {
    return new ItemStack(recipe.output).maxAmount;
  } catch {
    return 0;
  }
}

function consumeFuel(inventory) {
  let fuelItem = inventory.getItem(FUEL_SLOT);
  if (!fuelItem) return undefined;

  const fuel = solidFuels.find(({ id }) => fuelItem.typeId.includes(id));
  if (!fuel || !(fuel.value > 0)) return undefined;

  if (fuelItem.amount > 1) {
    fuelItem.amount -= 1;
    inventory.setItem(FUEL_SLOT, fuelItem);
  } else {
    inventory.setItem(
      FUEL_SLOT,
      fuel.transformToItem ? new ItemStack(fuel.transformToItem) : undefined,
    );
  }

  return fuel.value / 10;
}

function processWork(inventory, settings, workBudget, fuelR, fuelV) {
  const efficiency = Math.max(EPSILON, settings.efficiency ?? 1);
  let completedWork = 0;
  let remainingWork = workBudget;

  while (remainingWork > EPSILON) {
    if (fuelR <= EPSILON) {
      const loadedFuel = consumeFuel(inventory);
      if (!loadedFuel) break;
      fuelR = loadedFuel;
      fuelV = loadedFuel;
    }

    const requestedFuel = remainingWork * efficiency;
    const usedFuel = Math.min(requestedFuel, fuelR);
    const work = usedFuel / efficiency;

    completedWork += work;
    remainingWork -= work;

    if (settings.infinite) {
      remainingWork = 0;
    } else {
      fuelR = Math.max(0, fuelR - usedFuel);
    }
  }

  return { completedWork, fuelR, fuelV };
}

function craftAvailableItems(block, inventory, recipe, progress) {
  const inputItem = inventory.getItem(INPUT_SLOT);
  const outputItem = inventory.getItem(OUTPUT_SLOT);
  if (!inputItem || progress < baseSettings.baseCost) {
    return { crafted: 0, progress };
  }

  const capacity = getRecipeCapacity(recipe, outputItem);
  if (capacity <= 0) return { crafted: 0, progress };

  const isNetherStar = block.typeId === NETHER_STAR_FURNACE_ID;
  const affordable = isNetherStar
    ? inputItem.amount
    : Math.floor(progress / baseSettings.baseCost);
  const crafted = Math.min(inputItem.amount, capacity, affordable);
  if (crafted <= 0) return { crafted: 0, progress };

  if (outputItem) {
    outputItem.amount += crafted;
    inventory.setItem(OUTPUT_SLOT, outputItem);
  } else {
    inventory.setItem(OUTPUT_SLOT, new ItemStack(recipe.output, crafted));
  }

  if (inputItem.amount > crafted) {
    inputItem.amount -= crafted;
    inventory.setItem(INPUT_SLOT, inputItem);
  } else {
    inventory.setItem(INPUT_SLOT, undefined);
  }

  return {
    crafted,
    progress: isNetherStar ? 0 : Math.max(0, progress - crafted * baseSettings.baseCost),
  };
}

function updateDisplays(inventory, progress, fuelR, fuelV) {
  const flame = fuelV > 0
    ? Math.max(0, Math.min(13, Math.ceil((13 * fuelR) / fuelV)))
    : 0;
  const arrow = Math.max(
    0,
    Math.min(22, Math.floor((22 * progress) / baseSettings.baseCost)),
  );

  inventory.setItem(FLAME_SLOT, new ItemStack(`better_smelters:flame_${flame}`));
  inventory.setItem(PROGRESS_SLOT, new ItemStack(`better_smelters:arrow_right_${arrow}`));
}

function pauseFurnace(block, entity, inventory) {
  entity.setDynamicProperty("better_smelters:progress", 0);
  inventory.setItem(PROGRESS_SLOT, new ItemStack("better_smelters:arrow_right_0"));
  setBooleanState(block, "better_smelters:on", false);
}

function tickFurnace(block, settings) {
  const entity = getFurnaceEntity(block);
  const inventory = entity?.getComponent("minecraft:inventory")?.container;
  if (!entity || !inventory) return;

  const containerReady = REGISTERED_FURNACE_CONTAINERS.has(entity.id)
    || configureFurnaceContainer(entity);
  if (containerReady) {
    pullItems(block, entity, FUEL_SLOT, "up");
    const automationFaces = getAutomationFaces(block);
    if (automationFaces) {
      pullItems(block, entity, INPUT_SLOT, automationFaces.input);
      pushOutput(block, entity, automationFaces.output);
    }
  }

  const inputItem = inventory.getItem(INPUT_SLOT);
  const outputItem = inventory.getItem(OUTPUT_SLOT);
  const recipe = furnaceRecipes[inputItem?.typeId];
  if (!recipe || getRecipeCapacity(recipe, outputItem) <= 0) {
    pauseFurnace(block, entity, inventory);
    return;
  }

  const interval = getTickInterval(block);
  const elapsedFactor = interval / OPEN_TICK_INTERVAL;
  const speed = 2.5 * baseSettings.baseSpeed * (settings.speed ?? 1);
  let progress = Number(entity.getDynamicProperty("better_smelters:progress")) || 0;
  let fuelR = Number(entity.getDynamicProperty("better_smelters:fuelR")) || 0;
  let fuelV = Number(entity.getDynamicProperty("better_smelters:fuelV")) || 0;

  const result = processWork(inventory, settings, speed * elapsedFactor, fuelR, fuelV);
  progress += result.completedWork;
  fuelR = result.fuelR;
  fuelV = result.fuelV;

  const craftResult = craftAvailableItems(block, inventory, recipe, progress);
  progress = craftResult.progress;
  const active = result.completedWork > 0 || craftResult.crafted > 0;

  entity.setDynamicProperty("better_smelters:fuelR", fuelR);
  entity.setDynamicProperty("better_smelters:fuelV", fuelV);
  entity.setDynamicProperty("better_smelters:progress", progress);
  updateDisplays(inventory, progress, fuelR, fuelV);
  setBooleanState(block, "better_smelters:on", active);

  if (!active) return;
  spawnFurnaceParticles(block);

  if (block.typeId === OAK_FURNACE_ID && rollElapsedChance(0.01, elapsedFactor)) {
    destroyOakFurnace(block, entity, inventory);
  }
}

function rollElapsedChance(chancePerOpenTick, elapsedFactor) {
  return Math.random() < 1 - Math.pow(1 - chancePerOpenTick, elapsedFactor);
}

function spawnFurnaceParticles(block) {
  if (Math.random() <= 0.9) return;

  const facing = block.permutation.getState("minecraft:cardinal_direction");
  const facingOffsets = {
    north: [0, 0, -0.501],
    south: [0, 0, 0.501],
    west: [-0.501, 0, 0],
    east: [0.501, 0, 0],
  };
  const offset = facingOffsets[facing];
  if (!offset) return;

  const { x, y, z } = block.location;
  const position = {
    x: x + 0.5 + offset[0] + (Math.random() - 0.5) * 0.2,
    y: y + 0.4 + offset[1] + Math.random() * 0.1,
    z: z + 0.5 + offset[2] + (Math.random() - 0.5) * 0.2,
  };

  const flame = block.typeId.includes("netherite")
    ? "minecraft:blue_flame_particle"
    : "minecraft:basic_flame_particle";
  block.dimension.spawnParticle(flame, position);
  block.dimension.spawnParticle("minecraft:basic_smoke_particle", {
    x: position.x,
    y: position.y + 0.1,
    z: position.z,
  });
}

function configureFurnaceContainer(entity) {
  try {
    // DoriosLib calls this schema "complex" because it is face-aware. The
    // mapping itself is fixed: Better Smelters has no configurable IO modes.
    const registered = DoriosLib.container.setConfig(entity, {
      version: 1,
      type: "complex",
      anyInputSlots: [],
      anyOutputSlots: [],
      inputConfig: {
        up: [FUEL_SLOT],
        down: [FUEL_SLOT],
        north: [INPUT_SLOT],
        south: [INPUT_SLOT],
        east: [INPUT_SLOT],
        west: [INPUT_SLOT],
      },
      outputConfig: {
        north: [OUTPUT_SLOT],
        south: [OUTPUT_SLOT],
        east: [OUTPUT_SLOT],
        west: [OUTPUT_SLOT],
        up: [OUTPUT_SLOT],
        down: [OUTPUT_SLOT],
      },
    });
    if (registered) REGISTERED_FURNACE_CONTAINERS.add(entity.id);
    return registered;
  } catch (error) {
    console.warn(`[Better Smelters] Failed to register furnace container: ${error}`);
    return false;
  }
}

function getAutomationFaces(block) {
  const facing = block.permutation.getState("minecraft:cardinal_direction");
  return AUTOMATION_FACES_BY_FACING[facing];
}

function getAdjacentLocation(block, face) {
  const offset = FACE_OFFSETS[face];
  if (!offset) return undefined;

  const { x, y, z } = block.location;
  return {
    x: x + offset[0],
    y: y + offset[1],
    z: z + offset[2],
  };
}

function pullItems(block, entity, targetSlot, targetFace) {
  const sourceLocation = getAdjacentLocation(block, targetFace);
  if (!sourceLocation) return false;

  const source = DoriosLib.container.resolveAt(block.dimension, sourceLocation);
  if (!source) return false;

  const targetSlots = DoriosLib.container.getInputSlots(entity, { face: targetFace });
  if (!targetSlots.includes(targetSlot)) return false;

  const sourceFace = OPPOSITE_FACES[targetFace];
  for (const sourceSlot of DoriosLib.container.getOutputSlots(source, { face: sourceFace })) {
    const moved = DoriosLib.container.transfer(source, {
      sourceSlot,
      target: entity,
      targetFace,
    });
    if (moved > 0) return true;
  }

  return false;
}

function pushOutput(block, entity, outputFace) {
  const targetLocation = getAdjacentLocation(block, outputFace);
  if (!targetLocation) return false;

  const target = DoriosLib.container.resolveAt(block.dimension, targetLocation);
  if (!target) return false;

  const targetFace = OPPOSITE_FACES[outputFace];
  for (const sourceSlot of DoriosLib.container.getOutputSlots(entity, { face: outputFace })) {
    const moved = DoriosLib.container.transfer(entity, {
      sourceSlot,
      target,
      targetFace,
    });
    if (moved > 0) return true;
  }

  return false;
}

function dropInventorySlots(block, inventory, slots) {
  const { x, y, z } = block.location;
  const dropLocation = { x: x + 0.5, y: y + 0.25, z: z + 0.5 };
  for (const slot of slots) {
    const item = inventory.getItem(slot);
    if (!item) continue;
    block.dimension.spawnItem(item, dropLocation);
    inventory.setItem(slot, undefined);
  }
}

function dropFurnaceContents(block) {
  const entity = getFurnaceEntity(block);
  const inventory = entity?.getComponent("minecraft:inventory")?.container;
  if (!entity || !inventory) return;

  dropInventorySlots(block, inventory, [FUEL_SLOT, INPUT_SLOT, OUTPUT_SLOT]);
  try {
    entity.remove();
  } catch {}
}

function destroyOakFurnace(block, entity, inventory) {
  dropInventorySlots(block, inventory, [FUEL_SLOT, INPUT_SLOT, OUTPUT_SLOT]);
  block.setType("minecraft:air");
  try {
    entity.remove();
  } catch {}
}

world.afterEvents.playerInteractWithBlock.subscribe(({ block, itemStack, player }) => {
  if (!itemStack || !block.typeId.includes("furnace")) return;
  const upgrade = upgrades[itemStack.typeId];
  if (!upgrade || block.typeId !== upgrade.initialF) return;

  const direction = block.permutation.getState("minecraft:cardinal_direction");
  if (block.typeId === "minecraft:furnace") {
    const vanillaInventory = block.getComponent("minecraft:inventory")?.container;
    const entity = spawnFurnaceEntity(block, upgrade.nextF);
    const inventory = entity.getComponent("minecraft:inventory")?.container;
    if (!vanillaInventory || !inventory) return;

    vanillaInventory.moveItem(1, FUEL_SLOT, inventory);
    vanillaInventory.moveItem(0, INPUT_SLOT, inventory);
    vanillaInventory.moveItem(2, OUTPUT_SLOT, inventory);
  } else {
    const entity = getFurnaceEntity(block);
    if (entity) entity.nameTag = getFurnaceNameTag(upgrade.nextF);
  }

  block.setType(upgrade.nextF);
  let permutation = /** @type {any} */ (block.permutation).withState(
    "better_smelters:ui_open",
    false,
  );
  if (direction !== undefined) {
    permutation = permutation.withState("minecraft:cardinal_direction", direction);
  }
  block.setPermutation(permutation);

  if (player.getGameMode() === GameMode.Survival) {
    player.runCommand(`clear @s ${itemStack.typeId} 0 1`);
  }
});

system.afterEvents.scriptEventReceive.subscribe(({ id, message, sourceEntity }) => {
  if (id !== "better_smelters:destroy_furnace") return;

  try {
    const [x, y, z] = message.split(",").map(Number);
    if (![x, y, z].every(Number.isFinite)) {
      console.warn(`[Better Smelters] Invalid furnace coordinates: ${message}`);
      return;
    }

    const dimension = sourceEntity?.dimension ?? world.getDimension("overworld");
    const block = dimension.getBlock({ x, y, z });
    const entity = block ? getFurnaceEntity(block) : undefined;
    const inventory = entity?.getComponent("minecraft:inventory")?.container;
    if (!block || !entity || !inventory) return;

    dropInventorySlots(block, inventory, [FUEL_SLOT, INPUT_SLOT, OUTPUT_SLOT]);
    entity.remove();
    dimension.runCommand(`fill ${x} ${y} ${z} ${x} ${y} ${z} air destroy`);
  } catch (error) {
    console.warn(`[Better Smelters] Failed to destroy furnace: ${error}`);
  }
});
