export const PANEL_BACKGROUND = "#f9f9fb";
export const CARD_BACKGROUND = "#ffffff";
export const FALLBACK_TEXT = "#2e3440";
export const FALLBACK_MARK = "#4c566a";
const MIN_CONTRAST = 1.35;

function luminance(hex: string): number | null {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!match?.[1]) {
    return null;
  }
  const digits =
    match[1].length === 3 ? [...match[1]].map((digit) => digit + digit).join("") : match[1];
  const value = parseInt(digits, 16);
  const channel = (shift: number) => {
    const c = ((value >> shift) & 255) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(16) + 0.7152 * channel(8) + 0.0722 * channel(0);
}

export function readable(color: string, background: string, fallback: string): string {
  const own = luminance(color);
  const behind = luminance(background);
  if (own === null || behind === null) {
    return fallback;
  }
  const [light, dark] = own > behind ? [own, behind] : [behind, own];
  return (light + 0.05) / (dark + 0.05) >= MIN_CONTRAST ? color : fallback;
}
