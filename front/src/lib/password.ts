// A hint while typing. The server applies the same rules and has the last word.
export function newPasswordProblem(current: string, next: string, repeat: string): string | null {
  if (!next) return null;
  if (next.trim().length < 12) return "Use at least 12 characters.";
  if (next.length > 256) return "Use at most 256 characters.";
  if (next === current) return "Choose a different password.";
  if (repeat && repeat !== next) return "The passwords do not match.";
  return null;
}
