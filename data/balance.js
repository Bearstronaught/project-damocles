// data/balance.js
// Every balance number in the game, written by the Export tab of the
// Project Damocles balance sheet. Don't edit this file by hand: change
// the numbers in the sheet, then copy column A of the Export tab here.
// (Names and descriptions live in data/content.js.)

export const BALANCE = {
  items: {
    iron_ore: { sellPrice: 5, hubPrice: 8 },
    nickel_ore: { sellPrice: 12, hubPrice: 19 },
    iron_bar: { sellPrice: 14, hubPrice: 22 },
    nickel_bar: { sellPrice: 34, hubPrice: 54 },
    steel: { sellPrice: 22, hubPrice: 35 },
    hull_plating: { sellPrice: 19, hubPrice: 30 },
    wiring_coils: { sellPrice: 46, hubPrice: 74 },
    structural_frames: { sellPrice: 30, hubPrice: 48 },
    cargo_pod: { sellPrice: 31, hubPrice: 50 },
    thruster_assembly: { sellPrice: 51, hubPrice: 82 },
  },
  ships: {
    prospector: { role: 'mining', size: 'small', skill: 'mining', unlockLevel: 1, cost: 5000, cargoCapacity: 120, miningRate: 120, speed: 1 },
    excavator: { role: 'mining', size: 'medium', skill: 'mining', unlockLevel: 10, cost: 60000, cargoCapacity: 480, miningRate: 240, speed: 0.75 },
    courier: { role: 'freight', size: 'small', skill: 'trade', unlockLevel: 1, cost: 50000, cargoCapacity: 600, speed: 1 },
  },
  fields: {
    inner_belt: { yields: 'iron_ore', travelSeconds: 45, tonnesPerXp: 10, unlockLevel: 1 },
    outer_belt: { yields: 'nickel_ore', travelSeconds: 90, tonnesPerXp: 5, unlockLevel: 5 },
  },
  recipes: {
    iron_bar: { unlockLevel: 1, inputs: { iron_ore: 60 }, output: 'iron_bar', outputAmount: 30, seconds: 60, xp: 8 },
    nickel_bar: { unlockLevel: 5, inputs: { nickel_ore: 60 }, output: 'nickel_bar', outputAmount: 30, seconds: 90, xp: 20 },
    steel: { unlockLevel: 15, inputs: { iron_ore: 60, nickel_ore: 30 }, output: 'steel', outputAmount: 45, seconds: 120, xp: 30 },
  },
  workshopRecipes: {
    hull_plating: { unlockLevel: 1, inputs: { iron_bar: 30 }, output: 'hull_plating', outputAmount: 30, seconds: 90, xp: 12 },
    wiring_coils: { unlockLevel: 5, inputs: { nickel_bar: 30 }, output: 'wiring_coils', outputAmount: 30, seconds: 120, xp: 20 },
    structural_frames: { unlockLevel: 10, inputs: { steel: 30 }, output: 'structural_frames', outputAmount: 30, seconds: 150, xp: 30 },
    cargo_pod: { unlockLevel: 15, inputs: { hull_plating: 40, structural_frames: 20 }, output: 'cargo_pod', outputAmount: 60, seconds: 240, xp: 55 },
    thruster_assembly: { unlockLevel: 20, inputs: { structural_frames: 30, wiring_coils: 30 }, output: 'thruster_assembly', outputAmount: 60, seconds: 300, xp: 80 },
  },
  upgrades: {
    furnace_lining_1: { building: 'refinery', skill: 'refining', level: 8, requires: null, costs: { hull_plating: 20 }, credits: 15000, effect: 'refineSpeed', value: 0.1 },
    improved_yield_1: { building: 'refinery', skill: 'refining', level: 12, requires: null, costs: { wiring_coils: 60 }, credits: 40000, effect: 'refineYield', value: 0.1 },
    furnace_lining_2: { building: 'refinery', skill: 'refining', level: 20, requires: 'furnace_lining_1', costs: { structural_frames: 120 }, credits: 100000, effect: 'refineSpeed', value: 0.1 },
    improved_yield_2: { building: 'refinery', skill: 'refining', level: 30, requires: 'improved_yield_1', costs: { cargo_pod: 180 }, credits: 200000, effect: 'refineYield', value: 0.1 },
    furnace_lining_3: { building: 'refinery', skill: 'refining', level: 40, requires: 'furnace_lining_2', costs: { thruster_assembly: 300 }, credits: 400000, effect: 'refineSpeed', value: 0.1 },
    refinery_slot_4: { building: 'refinery', skill: 'refining', level: 50, requires: null, costs: { structural_frames: 300, thruster_assembly: 300 }, credits: 750000, effect: 'refineSlot', value: 1 },
    precision_tooling_1: { building: 'workshop', skill: 'manufacturing', level: 3, requires: null, costs: { hull_plating: 30 }, credits: 15000, effect: 'workshopSpeed', value: 0.1 },
    scrap_recovery_1: { building: 'workshop', skill: 'manufacturing', level: 7, requires: null, costs: { wiring_coils: 30 }, credits: 25000, effect: 'workshopScrap', value: 0.05 },
    smart_queue: { building: 'workshop', skill: 'manufacturing', level: 14, requires: null, costs: { wiring_coils: 60 }, credits: 30000, effect: 'smartQueue', value: 1 },
    bigger_orders_1: { building: 'workshop', skill: 'manufacturing', level: 16, requires: null, costs: { cargo_pod: 60 }, credits: 60000, effect: 'orderSize', value: 20 },
    precision_tooling_2: { building: 'workshop', skill: 'manufacturing', level: 18, requires: 'precision_tooling_1', costs: { structural_frames: 120 }, credits: 100000, effect: 'workshopSpeed', value: 0.1 },
    scrap_recovery_2: { building: 'workshop', skill: 'manufacturing', level: 28, requires: 'scrap_recovery_1', costs: { cargo_pod: 120 }, credits: 150000, effect: 'workshopScrap', value: 0.05 },
    bigger_orders_2: { building: 'workshop', skill: 'manufacturing', level: 32, requires: 'bigger_orders_1', costs: { cargo_pod: 240 }, credits: 250000, effect: 'orderSize', value: 20 },
    precision_tooling_3: { building: 'workshop', skill: 'manufacturing', level: 40, requires: 'precision_tooling_2', costs: { thruster_assembly: 300 }, credits: 400000, effect: 'workshopSpeed', value: 0.1 },
  },
  hullSizes: {
    small: { commandPoints: 1 },
    medium: { commandPoints: 2 },
    large: { commandPoints: 4 },
    capital: { commandPoints: 8 },
  },
  command: { startPoints: 4, pointsPerUpgrade: 2, firstUpgradeCost: 80000, costMultiplier: 2, maxUpgrades: 10 },
  sellRate: 0.5,
  shipPriceGrowth: 1.6,
  fleetXpExponent: 0.6,
  trade: { tonneMinutesPerXp: 15 },
  hub: { travelSeconds: 180, tradeSeconds: 30 },
  refinery: { slotLevels: [1, 10, 25], speedPerLevel: 0.005, openAtMiningLevel: 8 },
  workshop: { openAtRefiningLevel: 8, slotLevels: [1, 12, 35], queueLevels: [8, 25], baseQueue: 3, maxOrderBatches: 20, speedPerLevel: 0.005 },
  rules: { offlineCapHours: 24 },
};
