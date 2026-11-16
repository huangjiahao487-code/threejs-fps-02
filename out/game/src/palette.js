// The look plan, in one place. Duskworks Yard at dusk: deep indigo air, warm amber sun,
// rusted steel and concrete, Ember amber against Vanta teal. No other colour appears in
// the code. The same names are the CSS custom properties in index.html.
export const PALETTE = {
  canvas: '#191d29',
  surface: '#232833',
  hairline: '#313845',
  ink: '#ece7db',
  muted: '#93a0ae',
  accent: '#f0a830',
  ember: '#f0a830',
  vanta: '#35c4b5',
  danger: '#e5484d',
  ground: '#33302a',
  rust: '#8a5a34',
  container: '#4a5a66',
  containerB: '#6b4a3a',
};

export function shade(name) {
  return PALETTE[name];
}
