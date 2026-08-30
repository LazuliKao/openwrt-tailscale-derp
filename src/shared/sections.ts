type NamedSection = readonly [
  name: string,
  type: string,
  defaults?: Readonly<Record<string, string | string[]>>,
];

export function ensureNamedSections(
  uci: typeof L.uci,
  config: string,
  sections: readonly NamedSection[],
): void {
  for (const [name, type, defaults] of sections) {
    if (uci.get(config, name)) continue;

    uci.add(config, type, name);
    for (const [option, value] of Object.entries(defaults ?? {})) {
      uci.set(config, name, option, value);
    }
  }
}
