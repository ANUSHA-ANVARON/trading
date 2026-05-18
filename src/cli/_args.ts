export function getArgValue(flag: string): string | null {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return null;
  const next = process.argv[idx + 1];
  if (!next || next.startsWith("--")) return null;
  return next;
}

export function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

export function getArgValues(flag: string): string[] {
  const values: string[] = [];
  for (let i = 0; i < process.argv.length; i++) {
    if (process.argv[i] === flag) {
      const next = process.argv[i + 1];
      if (next && !next.startsWith("--")) values.push(next);
    }
  }
  return values;
}

export function usageAndExit(message: string, code = 1): never {
  // eslint-disable-next-line no-console
  console.error(message);
  process.exit(code);
}
