// The DOM HUD: crosshair, hit marker, health, ammo, money, timer, score, kill feed,
// bomb status, buy menu and the one overlay panel. It never touches the simulation;
// main.js pushes numbers in and reads callbacks out. DOM writes are cached so a steady
// value costs no layout work.
import { WEAPONS, BUY_ORDER } from './weapons.js';
import { GRENADES, ARMOR_PRICE } from './economy.js';

const COPY = {
  start: { title: 'EMBER LINE', copy: 'Duskworks Yard. Five on five, first to eight rounds. Plant the charge on Site A or Site B — or clear the Vanta team. Click to play.', action: 'Click to play' },
  paused: { title: 'EMBER LINE', copy: 'Paused. Click to resume.', action: 'Click to resume' },
  matchEnd: { title: '', copy: '', action: 'Play again' },
};

export function createHud() {
  const $ = (id) => document.getElementById(id);
  const overlay = $('overlay');
  const title = $('overlay-title');
  const copy = $('overlay-copy');
  const play = $('play');
  const ammoMag = $('ammo-mag');
  const ammoReserve = $('ammo-reserve');
  const ammoWeapon = $('ammo-weapon');
  const healthFill = $('health-fill');
  const healthNum = $('health-num');
  const armorTag = $('armor-tag');
  const moneyValue = $('money-value');
  const timerEl = $('timer');
  const scoreEmber = $('score-ember');
  const scoreVanta = $('score-vanta');
  const roundLabel = $('round-label');
  const phaseLabel = $('phase-label');
  const killfeed = $('killfeed');
  const bombStatus = $('bomb-status');
  const bombText = $('bomb-text');
  const bombFill = $('bomb-bar-fill');
  const crosshair = $('crosshair');
  const hitmarker = $('hitmarker');
  const vignette = $('damage-vignette');
  const flashOverlay = $('flash-overlay');
  const banner = $('banner');
  const bannerTitle = $('banner-title');
  const bannerSub = $('banner-sub');
  const buyMenu = $('buy-menu');
  const buyMoney = $('buy-money');
  const buyList = $('buy-list');
  const spectate = $('spectate');
  const damageDir = $('damage-dir');
  const ammoState = $('ammo-state');
  const buyCallout = $('buy-callout');
  const teamPanel = $('team-panel');

  let last = {};
  let hitTimer = 0;
  let vignetteTimer = 0;
  let damageTimer = 0;
  let buyHandler = null;
  let teamRows = null;
  let lastTeamKey = '';

  function setText(el, key, value) {
    if (last[key] === value) return;
    last[key] = value;
    el.textContent = value;
  }

  function buildBuy() {
    buyList.innerHTML = '';
    BUY_ORDER.forEach((id, i) => {
      const def = WEAPONS[id];
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'buy-row';
      row.dataset.buy = `weapon:${id}`;
      row.innerHTML = `<span class="buy-key">${i + 1}</span><span class="buy-name">${def.name}</span><span class="buy-stat">${def.damage} dmg · ${def.mag} mag</span><span class="buy-price">${def.price === 0 ? 'OWNED' : '$' + def.price}</span>`;
      buyList.appendChild(row);
    });
    for (const [id, def] of Object.entries(GRENADES)) {
      const key = id === 'flash' ? '5' : '6';
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'buy-row';
      row.dataset.buy = `grenade:${id}`;
      row.innerHTML = `<span class="buy-key">${key}</span><span class="buy-name">${def.name}</span><span class="buy-stat">${def.blurb}</span><span class="buy-price">$${def.price}</span>`;
      buyList.appendChild(row);
    }
    const armor = document.createElement('button');
    armor.type = 'button';
    armor.className = 'buy-row';
    armor.dataset.buy = 'armor';
    armor.innerHTML = `<span class="buy-key">7</span><span class="buy-name">Kevlar vest</span><span class="buy-stat">Damage taken × 0.6 for the round</span><span class="buy-price">$${ARMOR_PRICE}</span>`;
    buyList.appendChild(armor);
    buyList.addEventListener('click', (event) => {
      const row = event.target.closest('[data-buy]');
      if (row && buyHandler) buyHandler(row.dataset.buy);
    });
  }
  buildBuy();

  return {
    setAmmo(mag, reserve, weaponName) {
      setText(ammoMag, 'mag', String(mag));
      setText(ammoReserve, 'reserve', `/ ${reserve}`);
      setText(ammoWeapon, 'weapon', weaponName);
      $('ammo').classList.toggle('empty', mag === 0);
    },
    setHealth(hp, armor) {
      const pct = Math.max(0, Math.min(100, hp));
      if (last.hp !== pct) {
        last.hp = pct;
        healthFill.style.width = `${pct}%`;
        healthFill.classList.toggle('low', pct <= 30);
        setText(healthNum, 'hpnum', String(Math.ceil(pct)));
      }
      armorTag.hidden = !armor;
    },
    setMoney(n) { setText(moneyValue, 'money', `$${n}`); setText(buyMoney, 'buymoney', `$${n}`); },
    setScore(ember, vanta, round) {
      setText(scoreEmber, 'se', String(ember));
      setText(scoreVanta, 'sv', String(vanta));
      setText(roundLabel, 'round', `ROUND ${round}`);
      const buyRound = $('buy-round');
      if (buyRound) buyRound.textContent = String(round);
    },
    setTimer(seconds, phase) {
      const s = Math.max(0, Math.ceil(seconds));
      setText(timerEl, 'timer', `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
      setText(phaseLabel, 'phase', phase === 'buy' ? 'BUY PHASE' : phase === 'live' ? 'LIVE' : phase === 'roundEnd' ? 'ROUND OVER' : phase === 'matchEnd' ? 'MATCH OVER' : '');
      timerEl.classList.toggle('low', phase === 'live' && seconds <= 10);
    },
    setBomb(text, frac) {
      bombStatus.hidden = false;
      setText(bombText, 'bomb', text);
      bombFill.style.width = `${Math.max(0, Math.min(1, frac)) * 100}%`;
    },
    hideBomb() { bombStatus.hidden = true; },
    setCrosshairSpread(px) {
      crosshair.style.setProperty('--gap', `${Math.round(px)}px`);
    },
    hitMarker(killed, holdMs = 90) {
      hitmarker.classList.add('on');
      hitmarker.classList.toggle('kill', killed);
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => hitmarker.classList.remove('on', 'kill'), holdMs);
    },
    damageFlash() {
      vignette.classList.add('on');
      clearTimeout(vignetteTimer);
      vignetteTimer = setTimeout(() => vignette.classList.remove('on'), 180);
    },
    // An arc around the crosshair that points at the threat: rotate(-angle)
    // because a threat to the player's right has a negative relative angle
    // under this game's yaw convention.
    damageFrom(angleRad) {
      damageDir.style.transform = `rotate(${-angleRad}rad)`;
      damageDir.classList.add('on');
      clearTimeout(damageTimer);
      damageTimer = setTimeout(() => damageDir.classList.remove('on'), 700);
    },
    setReloading(on) {
      setText(ammoState, 'reload', on ? 'RELOADING' : '');
    },
    setAttackSite(site) {
      setText(buyCallout, 'callout', `Team call: ${site}`);
    },
    // Teammate status: one row per Ember bot, alive or struck through, plus
    // the living Vanta count. Rows are built once; only changes touch the DOM.
    setTeam(botList) {
      if (!teamRows) {
        teamRows = {};
        for (const bot of botList) {
          if (bot.team !== 'ember') continue;
          const row = document.createElement('div');
          row.className = 'team-row';
          row.innerHTML = `<b>${bot.name.toUpperCase()}</b> <span>●</span>`;
          teamPanel.appendChild(row);
          teamRows[bot.name] = row;
        }
        const vanta = document.createElement('div');
        vanta.id = 'team-vanta';
        teamPanel.appendChild(vanta);
        teamRows.vanta = vanta;
      }
      let key = '';
      let vantaAlive = 0;
      for (const bot of botList) {
        if (bot.team === 'ember') key += bot.alive ? '1' : '0';
        else if (bot.alive) vantaAlive += 1;
      }
      key += `v${vantaAlive}`;
      if (key === lastTeamKey) return;
      lastTeamKey = key;
      for (const bot of botList) {
        if (bot.team !== 'ember') continue;
        teamRows[bot.name].classList.toggle('dead', !bot.alive);
      }
      teamRows.vanta.textContent = `VANTA — ${vantaAlive} ALIVE`;
    },
    flashBlind(ms) {
      flashOverlay.classList.add('on');
      setTimeout(() => flashOverlay.classList.remove('on'), ms);
    },
    killfeed(killer, victim, headshot, killerTeam) {
      const line = document.createElement('div');
      line.className = 'feed-line';
      line.innerHTML = `<b class="${killerTeam}">${killer}</b> ${headshot ? '⌖' : '—'} <b>${victim}</b>`;
      killfeed.prepend(line);
      while (killfeed.children.length > 4) killfeed.removeChild(killfeed.lastChild);
      setTimeout(() => line.remove(), 6000);
    },
    showBanner(titleText, sub) {
      bannerTitle.textContent = titleText;
      bannerSub.textContent = sub;
      banner.hidden = false;
    },
    hideBanner() { banner.hidden = true; },
    showOverlay(mode, data = {}) {
      if (mode === 'matchEnd') {
        title.textContent = data.winner === 'ember' ? 'EMBER WINS THE MATCH' : 'VANTA WINS THE MATCH';
        copy.textContent = `Final score ${data.score.ember} — ${data.score.vanta}.`;
        play.textContent = COPY.matchEnd.action;
      } else {
        const text = COPY[mode];
        title.textContent = text.title;
        copy.textContent = text.copy;
        play.textContent = text.action;
      }
      overlay.hidden = false;
      play.focus();
    },
    hideOverlay() { overlay.hidden = true; },
    showBuy(open) {
      buyMenu.hidden = !open;
    },
    markOwned(economy, currentWeapon) {
      for (const row of buyList.querySelectorAll('[data-buy]')) {
        const [type, id] = row.dataset.buy.split(':');
        const owned = type === 'weapon' ? economy.state.owned.has(id) : false;
        row.classList.toggle('owned', owned || (type === 'weapon' && id === currentWeapon));
        row.querySelector('.buy-price').textContent = owned ? 'OWNED' : type === 'weapon'
          ? (WEAPONS[id].price === 0 ? 'OWNED' : `$${WEAPONS[id].price}`)
          : type === 'grenade' ? `$${GRENADES[id].price} ×${economy.state.grenades[id]}` : `$${ARMOR_PRICE}`;
      }
    },
    setSpectate(name) {
      if (name) {
        spectate.hidden = false;
        spectate.textContent = `You are down — spectating ${name}`;
      } else {
        spectate.hidden = true;
      }
    },
    onBuy(handler) { buyHandler = handler; },
    onPlay(handler) { play.addEventListener('click', handler); },
  };
}
