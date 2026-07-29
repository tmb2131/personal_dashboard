import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guards the palette in globals.css against WCAG AA (4.5:1) regressions.
 *
 * Much of this UI renders at 10-12px in the muted/subtle tones, so a token
 * nudged a few shades lighter stops being readable rather than merely looking
 * softer. Parsing the stylesheet keeps the check honest — it tests the values
 * that ship, not a copy of them.
 */
const AA_NORMAL_TEXT = 4.5;

function channelLuminance(component: number): number {
  return component <= 0.04045
    ? component / 12.92
    : ((component + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hex: string): number {
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) =>
    channelLuminance(Number.parseInt(h.slice(i, i + 2), 16) / 255),
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(foreground: string, background: string): number {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function tokensIn(css: string, pattern: RegExp): Record<string, string> {
  const block = pattern.exec(css)?.[1] ?? "";
  return Object.fromEntries(
    [...block.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6});/g)].map((m) => [m[1], m[2]]),
  );
}

const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

const palettes: Record<string, Record<string, string>> = {
  "light (:root)": tokensIn(css, /^:root \{([\s\S]*?)^\}/m),
  "dark (prefers-color-scheme)": tokensIn(
    css,
    /@media \(prefers-color-scheme: dark\) \{\s*:root \{([\s\S]*?)\}/,
  ),
  "dark (.theme-dark)": tokensIn(css, /:root\.theme-dark \{([\s\S]*?)\}/),
  "light (.theme-light)": tokensIn(css, /:root\.theme-light \{([\s\S]*?)\}/),
};

// Every text tone paired with each surface it actually gets rendered on.
const pairs: [string, string][] = [
  ["fg", "bg"],
  ["fg", "bg-elevated"],
  ["fg-muted", "bg"],
  ["fg-muted", "bg-elevated"],
  ["fg-subtle", "bg"],
  ["fg-subtle", "bg-elevated"],
  ["pill-fg", "pill-bg"],
  ["danger", "bg"],
  ["danger", "bg-elevated"],
  ["warning", "bg"],
  ["success", "bg"],
];

describe("theme contrast", () => {
  it("parses every palette out of globals.css", () => {
    for (const [name, tokens] of Object.entries(palettes)) {
      expect(Object.keys(tokens).length, `${name} should define tokens`).toBeGreaterThan(0);
      expect(tokens.bg, `${name} should define --bg`).toBeDefined();
    }
  });

  for (const [paletteName, tokens] of Object.entries(palettes)) {
    for (const [fg, bg] of pairs) {
      it(`${paletteName}: --${fg} on --${bg} meets AA`, () => {
        const foreground = tokens[fg];
        const background = tokens[bg];
        expect(foreground, `--${fg} missing from ${paletteName}`).toBeDefined();
        expect(background, `--${bg} missing from ${paletteName}`).toBeDefined();

        const ratio = contrastRatio(foreground, background);
        expect(
          Number(ratio.toFixed(2)),
          `--${fg} (${foreground}) on --${bg} (${background}) is ${ratio.toFixed(2)}:1`,
        ).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
      });
    }
  }
});
