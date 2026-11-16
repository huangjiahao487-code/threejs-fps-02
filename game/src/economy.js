// Money between rounds: what a round pays, and what the buy menu sells. The player
// starts on $800; a win pays $3250, a loss $1900 plus $500 per consecutive loss (capped
// at $3400), a kill $300, a plant $300. Nothing else in the game touches money.
import { WEAPONS } from './weapons.js';

export const START_MONEY = 800;
export const MAX_MONEY = 16000;
export const KILL_REWARD = 300;
export const WIN_REWARD = 3250;
export const LOSS_REWARD = 1900;
export const LOSS_STREAK_BONUS = 500;
export const LOSS_REWARD_CAP = 3400;
export const PLANT_REWARD = 300;

export const GRENADES = {
  flash: { id: 'flash', name: 'Flashburst', price: 300, max: 2, blurb: 'Blinds bots that see it burst' },
  frag: { id: 'frag', name: 'Splinter frag', price: 300, max: 2, blurb: 'Blast damage in a 7 m radius' },
};

export const ARMOR_PRICE = 650;

export function createEconomy() {
  const state = { money: START_MONEY, lossStreak: 0, owned: new Set(['pistol']), grenades: { flash: 0, frag: 0 } };

  function roundEnd(won) {
    if (won) {
      state.money = Math.min(MAX_MONEY, state.money + WIN_REWARD);
      state.lossStreak = 0;
    } else {
      const pay = Math.min(LOSS_REWARD_CAP, LOSS_REWARD + LOSS_STREAK_BONUS * state.lossStreak);
      state.money = Math.min(MAX_MONEY, state.money + pay);
      state.lossStreak += 1;
    }
  }

  function buyWeapon(id) {
    const def = WEAPONS[id];
    if (!def || state.owned.has(id)) return state.owned.has(id);
    if (state.money < def.price) return false;
    state.money -= def.price;
    state.owned.add(id);
    return true;
  }

  function buyGrenade(id) {
    const def = GRENADES[id];
    if (!def || state.grenades[id] >= def.max || state.money < def.price) return false;
    state.money -= def.price;
    state.grenades[id] += 1;
    return true;
  }

  function buyArmor() {
    if (state.money < ARMOR_PRICE) return false;
    state.money -= ARMOR_PRICE;
    return true;
  }

  return {
    state,
    roundEnd,
    buyWeapon,
    buyGrenade,
    buyArmor,
    kill() { state.money = Math.min(MAX_MONEY, state.money + KILL_REWARD); },
    plant() { state.money = Math.min(MAX_MONEY, state.money + PLANT_REWARD); },
    reset() {
      state.money = START_MONEY;
      state.lossStreak = 0;
      state.owned = new Set(['pistol']);
      state.grenades = { flash: 0, frag: 0 };
    },
  };
}
