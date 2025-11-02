import './doriosAPI/main.js'
import { world, system, ItemStack } from '@minecraft/server'
import { furnaceRecipes, solidFuels, baseSettings, upgrades } from './config.js'

const FUELSLOT = 2
const INPUTSLOT = 3
const OUTPUTSLOT = 4

system.beforeEvents.startup.subscribe(({ blockComponentRegistry }) => {
    blockComponentRegistry.registerCustomComponent("better_smelters:furnace", {
        onPlace({ block }) {
            let { x, y, z } = block.location
            y += 0.250, x += 0.5, z += 0.5
            const entity = block.dimension.spawnEntity('better_smelters:furnace', { x, y, z })
            const inv = entity.getComponent('minecraft:inventory')?.container;
            const tier = block.typeId.split(':')[1].split('_furnace')[0]
            entity.nameTag = `entity.better_smelters:${tier}.name`

            inv.setItem(0, new ItemStack('better_smelters:flame_0', 1))
            inv.setItem(1, new ItemStack('better_smelters:arrow_right_0', 1))

            entity.setDynamicProperty('better_smelters:fuelR', 0)
            entity.setDynamicProperty('better_smelters:fuelV', 0)
            entity.setDynamicProperty('better_smelters:progress', 0)
        },
        onTick({ block }, { params: settings }) {
            const entity = block.dimension.getEntitiesAtBlockLocation(block.center())[0]
            if (!entity || entity.typeId != 'better_smelters:furnace') return
            const inv = entity.getComponent('inventory').container

            pullItems(block, inv, 3, "input"); // pulls from front block
            pullItems(block, inv, 3, "input", "leftRight"); // izquierda → input
            pushOutput(block, inv, "leftRight");         // derecha  → output

            let progress = entity.getDynamicProperty('better_smelters:progress') ?? 0
            let fuelV = entity.getDynamicProperty('better_smelters:fuelV') ?? 0
            let fuelR = entity.getDynamicProperty('better_smelters:fuelR') ?? 0

            let speed = 2.5 * baseSettings.baseSpeed * (settings.speed ?? 1)

            let inputItem = inv.getItem(INPUTSLOT)
            let fuelItem = inv.getItem(FUELSLOT)
            let outputItem = inv.getItem(OUTPUTSLOT)
            const recipe = furnaceRecipes[inputItem?.typeId]

            if (!recipe || outputItem?.amount >= (outputItem?.maxAmount ?? 64)) {
                inv.setItem(1, new ItemStack('better_smelters:arrow_right_0', 1))
                entity.setDynamicProperty('better_smelters:progress', 0)
                block?.setPermutation(block?.permutation.withState('better_smelters:on', false))
                return;
            }

            if (outputItem && outputItem?.typeId != recipe.output) {
                inv.setItem(1, new ItemStack('better_smelters:arrow_right_0', 1))
                entity.setDynamicProperty('better_smelters:progress', 0)
                block?.setPermutation(block?.permutation.withState('better_smelters:on', false))
                return;
            }

            if (fuelR == 0) {
                entity.setDynamicProperty('better_smelters:fuelR', 0)
                inv.setItem(0, new ItemStack('better_smelters:flame_0', 1))
                if (fuelItem) {
                    const fuelData = solidFuels.find(fuel => fuelItem.typeId.includes(fuel.id))
                    if (fuelData) {
                        speed = Math.min(fuelData.value / 10, speed)
                        fuelR = fuelData.value / 10
                        fuelItem.amount > 1 ? fuelItem.amount -= 1 : fuelItem = undefined;
                        inv.setItem(2, fuelItem);
                        if (fuelData.transformToItem) inv.setItem(2, new ItemStack(fuelData.transformToItem, 1))
                        entity.setDynamicProperty('better_smelters:fuelV', fuelData.value / 10)
                    } else {
                        block?.setPermutation(block?.permutation.withState('better_smelters:on', false))
                        return
                    }
                } else {
                    block?.setPermutation(block?.permutation.withState('better_smelters:on', false))
                    return
                }
            }

            // Facing direction
            const { x, y, z } = block.location;

            // Base center position
            let px = x + 0.5;
            let py = y + 0.4; // altura visual buena para salida frontal
            let pz = z + 0.5;

            if (Math.random() > 0.9) {
                const facing = block.permutation.getState('minecraft:cardinal_direction');
                // Offsets para colocar la partícula justo al frente
                const facingOffsets = {
                    north: [0, 0, -0.501],
                    south: [0, 0, 0.501],
                    west: [-0.501, 0, 0],
                    east: [0.501, 0, 0],
                };

                const offset = facingOffsets[facing];
                if (offset) {
                    px += offset[0];
                    py += offset[1];
                    pz += offset[2];
                }

                // Pequeño movimiento aleatorio para simular variación de humo/flama
                px += (Math.random() - 0.5) * 0.2;
                py += Math.random() * 0.1;
                pz += (Math.random() - 0.5) * 0.2;

                // Spawn de partículas exactamente al frente
                const dim = block.dimension;
                if (block.typeId.includes('netherite')) {
                    dim.spawnParticle('minecraft:blue_flame_particle', { x: px, y: py, z: pz });
                } else {
                    dim.spawnParticle('minecraft:basic_flame_particle', { x: px, y: py, z: pz });
                }
                dim.spawnParticle('minecraft:basic_smoke_particle', { x: px, y: py + 0.1, z: pz });
            }

            const baseCost = baseSettings.baseCost
            if (progress >= baseCost) {
                let progressCount = Math.min(inputItem.amount, Math.floor(progress / baseCost))
                if (outputItem) {
                    if (block.typeId == 'better_smelters:nether_star_furnace') progressCount = Math.min(inputItem.amount, 64 - outputItem.amount)
                    outputItem.amount += progressCount
                    inv.setItem(4, outputItem)
                } else {
                    if (block.typeId == 'better_smelters:nether_star_furnace') progressCount = inputItem.amount
                    inv.setItem(4, new ItemStack(recipe.output, progressCount));
                }
                progress -= progressCount * baseCost;
                inputItem.amount > progressCount ? inputItem.amount -= progressCount : inputItem = undefined;
                inv.setItem(3, inputItem);
            } else {
                let usedFuel = speed * settings.efficiency
                if (usedFuel > fuelR) { usedFuel = fuelR }
                progress += usedFuel / settings.efficiency;
                fuelR -= usedFuel;
            }

            // Display fuel
            let fuelRValue = Math.max(0, Math.min(13, Math.ceil(13 * fuelR / fuelV))) || 0
            entity.setDynamicProperty('better_smelters:fuelR', fuelR)
            inv.setItem(0, new ItemStack(`better_smelters:flame_${fuelRValue}`));

            // Display progress
            let progressValue = Math.max(0, Math.min(16, Math.ceil(16 * progress / baseCost)));
            inv.setItem(1, new ItemStack(`better_smelters:arrow_right_${progressValue}`));

            block?.setPermutation(block?.permutation.withState('better_smelters:on', true))
            entity.setDynamicProperty('better_smelters:progress', progress)

            if (block.typeId == 'better_smelters:oak_wood_furnace' && Math.random() > 0.99) {
                block.setType('air')
                if (inv.getItem(2)) block.dimension.spawnItem(inv.getItem(2), { x, y, z })
                if (inv.getItem(3)) block.dimension.spawnItem(inv.getItem(3), { x, y, z })
                if (inv.getItem(4)) block.dimension.spawnItem(inv.getItem(4), { x, y, z })
                entity.remove()
            }
        },
        onPlayerBreak({ block }) {
            let { x, y, z } = block.location
            x += 0.5, z += 0.5, y += 0.250
            const ent = block.dimension.getEntitiesAtBlockLocation(block.center())[0]
            if (!ent) return
            const inv = ent.getComponent('minecraft:inventory').container

            system.run(() => {
                if (inv.getItem(2)) block.dimension.spawnItem(inv.getItem(2), { x, y, z })
                if (inv.getItem(3)) block.dimension.spawnItem(inv.getItem(3), { x, y, z })
                if (inv.getItem(4)) block.dimension.spawnItem(inv.getItem(4), { x, y, z })
                ent.remove()
            });
        },
        onPlayerInteract() { }
    })
})

world.afterEvents.playerInteractWithBlock.subscribe(e => {
    const { block, itemStack } = e
    if (!itemStack) return
    if (!block.typeId.includes('furnace')) return
    const upgrade = upgrades[itemStack.typeId]
    if (!upgrade) return

    if (block.typeId != upgrade.initialF) return

    const direction = block.permutation.getState('minecraft:cardinal_direction')

    if (itemStack.typeId == 'better_smelters:upgrade_to_copper' || itemStack.typeId == 'better_smelters:upgrade_to_iron') {
        const furnace = block.getComponent('minecraft:inventory').container
        let { x, y, z } = block.location
        y += 0.250, x += 0.5, z += 0.5

        const entity = block.dimension.spawnEntity('better_smelters:furnace', { x, y, z })
        const inv = entity.getComponent('minecraft:inventory')?.container;
        const tier = upgrade.nextF.split(':')[1].split('_furnace')[0]
        entity.nameTag = `entity.better_smelters:${tier}.name`

        inv.setItem(0, new ItemStack('better_smelters:flame_0', 1))
        inv.setItem(1, new ItemStack('better_smelters:arrow_right_0', 1))
        furnace.moveItem(1, 2, inv)
        furnace.moveItem(0, 3, inv)
        furnace.moveItem(2, 4, inv)

        entity.setDynamicProperty('better_smelters:fuelR', 0)
        entity.setDynamicProperty('better_smelters:fuelV', 0)
        entity.setDynamicProperty('better_smelters:progress', 0)
    }

    block.setType(upgrade.nextF)
    block.setPermutation(block.permutation.withState('minecraft:cardinal_direction',
        `${direction}`))
})

// Utilidades de dirección relativas al cardinal del bloque
function getOffsetsByMode(block, directionMode) {
    const facing = block.permutation.getState("minecraft:cardinal_direction");
    const base = {
        north: { front: [0, 0, 1], back: [0, 0, -1], left: [1, 0, 0], right: [-1, 0, 0] },
        south: { front: [0, 0, -1], back: [0, 0, 1], left: [-1, 0, 0], right: [1, 0, 0] },
        west: { front: [1, 0, 0], back: [-1, 0, 0], left: [0, 0, -1], right: [0, 0, 1] },
        east: { front: [-1, 0, 0], back: [1, 0, 0], left: [0, 0, 1], right: [0, 0, -1] },
    }[facing];


    // Modo por defecto: frente = input, atrás = output
    if (directionMode === "leftRight") {
        return { input: base.left, output: base.right };
    }
    return { input: base.front, output: base.back };
}

/**
 * Pulls items from an adjacent container block into the machine’s inventory.
 *
 * @param {Block} block
 * @param {Container} inv
 * @param {number} targetSlot   // 2=fuel, 3=input
 * @param {"input"|"fuel"} type
 * @param {"frontBack"|"leftRight"} [directionMode="frontBack"]
 */
function pullItems(block, inv, targetSlot, type, directionMode = "frontBack") {
    const dim = block.dimension;
    const slotItem = inv.getItem(targetSlot);

    let sourceBlock;
    if (type === "fuel") {
        const { x, y, z } = block.location;
        sourceBlock = dim.getBlock({ x, y: y + 1, z }); // arriba
    } else {
        const { input } = getOffsetsByMode(block, directionMode);
        const { x, y, z } = block.location;
        sourceBlock = dim.getBlock({ x: x + input[0], y: y + input[1], z: z + input[2] });
    }

    if (!sourceBlock || !DoriosAPI.constants.vanillaContainers.includes(sourceBlock.typeId)) return;
    const source = sourceBlock.getComponent("minecraft:inventory")?.container;
    if (!source) return;

    for (let i = 0; i < source.size; i++) {
        let item = source.getItem(i);
        if (!item) continue;

        if (slotItem && item.typeId !== slotItem.typeId) continue;

        const canMove = Math.min(item.amount, 64 - (slotItem?.amount ?? 0));
        if (canMove <= 0) continue;

        if (item.amount > canMove) item.amount -= canMove; else item = undefined;

        if (slotItem) {
            slotItem.amount += canMove;
            inv.setItem(targetSlot, slotItem);
        } else {
            const placed = source.getItem(i);
            placed.amount = canMove;
            inv.setItem(targetSlot, placed);
        }

        source.setItem(i, item);
        break;
    }
}

/**
 * Pushes the output items from the furnace into the adjacent container
 * behind (or at a chosen direction) using DoriosAPI's transfer system.
 *
 * @param {Block} block The furnace block.
 * @param {Container} inv The furnace entity's inventory container.
 * @param {"frontBack"|"leftRight"} [directionMode="frontBack"] Directional mode.
 */
function pushOutput(block, inv, directionMode = "frontBack") {
    const dim = block.dimension;

    // Determinar dirección de salida
    const { output } = getOffsetsByMode(block, directionMode);
    const { x, y, z } = block.location;
    const targetLoc = { x: x + output[0], y: y + output[1], z: z + output[2] };

    // Transferir ítems usando DoriosAPI
    try {
        DoriosAPI.containers.transferItemsAt(inv, targetLoc, dim, OUTPUTSLOT);
    } catch { }
}

