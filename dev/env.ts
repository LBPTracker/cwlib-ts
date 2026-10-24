/**
 * An environment variable a harness cannot run without.
 *
 * ⚠️ **No default, on purpose.** These name folders on one person's machine --
 * the installed game, a toolkit checkout, the archive's index -- and a default
 * is a path that exists nowhere else. steering/tools.md, *Environment
 * variables*, says what each one is.
 */
export function required(name: string, what: string): string {
  const value = process.env[name];
  if (value) return value;
  console.error(`${name} is not set: it is ${what} (steering/tools.md, *Environment variables*).`);
  process.exit(2);
}
