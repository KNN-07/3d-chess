export const STRENGTH_PRESETS = Object.freeze([
  ...[1320, 1500, 1700, 1900, 2100, 2400, 2800, 3190].map(elo =>
    Object.freeze({ id: String(elo), elo, label: `${elo} Elo` })),
  Object.freeze({ id: 'full', elo: null, label: 'Full strength' }),
]);
export const DEFAULT_STRENGTH = '1500';

export function restoreStrength(saved) {
  if (STRENGTH_PRESETS.some(preset => preset.id === String(saved?.strength))) return String(saved.strength);
  return ({ 1: '1320', 2: '1500', 3: '2100' })[saved?.level] || DEFAULT_STRENGTH;
}

export function getStrength(id) {
  return STRENGTH_PRESETS.find(preset => preset.id === id) || STRENGTH_PRESETS[1];
}
