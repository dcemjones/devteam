// whisper-1 verbose_json returns the detected language as a lowercase English name
// (e.g. "spanish") on /transcriptions; ADR-002 ASSUMES the same for /translations (RK-6).
// Fallback when the field is absent: "auto-detected" (architecture §4).

const SPECIAL: Record<string, string> = {
  // ISO codes, in case the endpoint ever returns codes instead of names.
  es: "Spanish", pt: "Portuguese", fr: "French", de: "German", ja: "Japanese",
  ko: "Korean", id: "Indonesian", en: "English", zh: "Chinese", hi: "Hindi",
  ar: "Arabic", ru: "Russian", it: "Italian", nl: "Dutch", tr: "Turkish",
  vi: "Vietnamese", th: "Thai", pl: "Polish", sv: "Swedish", tl: "Tagalog",
};

export const LANGUAGE_FALLBACK = "auto-detected";

export function displayLanguage(raw: string | undefined | null): string {
  if (!raw) return LANGUAGE_FALLBACK;
  const t = raw.trim().toLowerCase();
  if (!t) return LANGUAGE_FALLBACK;
  if (SPECIAL[t]) return SPECIAL[t];
  // "spanish" -> "Spanish"; "haitian creole" -> "Haitian Creole"
  return t.replace(/\b\p{L}/gu, (c) => c.toUpperCase());
}

export function isEnglish(displayed: string): boolean {
  return displayed.toLowerCase() === "english";
}
