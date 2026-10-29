// data/balance.js
// Every balance number in the game, written by the Export tab of the
// Project Damocles balance sheet. Don't edit this file by hand: change
// the numbers in the sheet, then copy column A of the Export tab here.
// (Names and descriptions live in data/content.js.)

export const BALANCE = {
  items: {
    iron_ore: { sellPrice: 5, hubPrice: 8 },
    nickel_ore: { sellPrice: 12, hubPrice: 19 },
  },
  ships: {
    prospector: { role: 'mining', size: 'small', skill: 'mining', unlockLevel: 1, cost: 8000, cargoCapacity: 120, miningRate: 120, speed: 1 },
    excavator: { role: 'mining', size: 'medium', skill: 'mining', unlockLevel: 10, cost: 30000, cargoCapacity: 480, miningRate: 240, speed: 0.75 },
    courier: { role: 'freight', size: 'small', skill: 'trade', unlockLevel: 3, cost: 25000, cargoCapacity: 600, speed: 1 },
  },
  fields: {
    inner_belt: { yields: 'iron_ore', travelSeconds: 45, tonnesPerXp: 10, unlockLevel: 1 },
    outer_belt: { yields: 'nickel_ore', travelSeconds: 90, tonnesPerXp: 5, unlockLevel: 5 },
  },
  hullSizes: {
    small: { commandPoints: 1 },
    medium: { commandPoints: 2 },
    large: { commandPoints: 4 },
    capital: { commandPoints: 8 },
  },
  command: { startPoints: 4, pointsPerUpgrade: 2, firstUpgradeCost: 20000, costMultiplier: 2, maxUpgrades: 10 },
  sellRate: 0.5,
  trade: { creditsPerXp: 100, hubTonnesPerBonusXp: 10 },
  hub: { travelSeconds: 180, tradeSeconds: 30 },
  rules: { offlineCapHours: 24 },
};
