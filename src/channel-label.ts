// User overrides are optional; derived labels follow renames without changing identity.
export function channelShortName(
  name: string,
  override?: string | null,
): string {
  if (override?.trim()) return override.trim();
  const words = name.match(/[\p{L}\p{N}]+/gu) ?? [];
  const initials =
    words.length > 1
      ? words
          .slice(0, 4)
          .map((word) => Array.from(word)[0])
          .join("")
      : Array.from(words[0] ?? name.trim())
          .slice(0, 4)
          .join("");
  return initials.toLocaleUpperCase("en-US") || "TV";
}
