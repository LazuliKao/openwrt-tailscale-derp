type NamedSection = readonly [name: string, type: string];

export function ensureNamedSections(
  uci: typeof L.uci,
  config: string,
  sections: readonly NamedSection[],
): void {
  for (const [name, type] of sections) {
    if (!uci.get(config, name)) {
      uci.add(config, type, name);
    }
  }
}
