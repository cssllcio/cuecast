export type Lexicon = Record<string, string>;

export function mergeLexicons(base: Lexicon, override: Lexicon): Lexicon {
  return { ...base, ...override };
}

export function applyLexicon(text: string, lexicon: Lexicon): string {
  let result = text;
  for (const [term, respelling] of Object.entries(lexicon)) {
    const pattern = new RegExp(`\\b${escapeRegExp(term)}\\b`, "gi");
    result = result.replace(pattern, respelling);
  }
  return result;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
