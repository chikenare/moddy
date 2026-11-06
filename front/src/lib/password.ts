export type PasswordProblem = "tooShort" | "tooLong" | "same" | "mismatch";

// A hint while typing. The server applies the same rules and has the last word.
export function newPasswordProblem(current: string, next: string, repeat: string): PasswordProblem | null {
  if (!next) return null;
  if (next.trim().length < 12) return "tooShort";
  if (next.length > 256) return "tooLong";
  if (next === current) return "same";
  if (repeat && repeat !== next) return "mismatch";
  return null;
}
