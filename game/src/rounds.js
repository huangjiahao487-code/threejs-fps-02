// The match: rounds, phases and the timer. One state machine, driven by main.js.
// menu -> buy (15 s, frozen, buy menu open) -> live (100 s) -> roundEnd (4 s banner)
// -> buy ... -> matchEnd (first to 8, sudden death at 7-7). A round ends when one
// team is eliminated, the bomb blows or is defused, or the live timer runs out.
export const BUY_SECONDS = 15;
export const LIVE_SECONDS = 100;
export const ROUND_END_SECONDS = 4;
export const WIN_ROUNDS = 8;
export const MAX_ROUNDS = 15;

export function createRounds() {
  const state = {
    phase: 'menu', // menu | buy | live | roundEnd | matchEnd
    round: 1,
    score: { ember: 0, vanta: 0 },
    timer: BUY_SECONDS,
    banner: '',
    bannerSub: '',
    winner: null,
  };

  function startMatch() {
    state.phase = 'buy';
    state.round = 1;
    state.score = { ember: 0, vanta: 0 };
    state.timer = BUY_SECONDS;
    state.banner = '';
    state.winner = null;
  }

  function startRound() {
    state.phase = 'buy';
    state.timer = BUY_SECONDS;
    state.banner = '';
  }

  function startLive() {
    state.phase = 'live';
    state.timer = LIVE_SECONDS;
  }

  function endRound(winner, banner, sub) {
    if (state.phase === 'roundEnd' || state.phase === 'matchEnd') return false;
    state.score[winner] += 1;
    state.phase = 'roundEnd';
    state.timer = ROUND_END_SECONDS;
    state.banner = banner;
    state.bannerSub = sub;
    const matchOver = state.score[winner] >= WIN_ROUNDS || state.round >= MAX_ROUNDS;
    if (matchOver) state.winner = state.score.ember > state.score.vanta ? 'ember' : 'vanta';
    return true;
  }

  function step(dt) {
    if (state.phase === 'buy' || state.phase === 'live' || state.phase === 'roundEnd') {
      state.timer -= dt;
    }
    if (state.phase === 'buy' && state.timer <= 0) startLive();
    if (state.phase === 'roundEnd' && state.timer <= 0) {
      if (state.winner) {
        state.phase = 'matchEnd';
      } else {
        state.round += 1;
        startRound();
      }
    }
  }

  return { state, startMatch, startRound, startLive, endRound, step };
}
