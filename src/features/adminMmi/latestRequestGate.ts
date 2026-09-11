export type LatestRequestGate = Readonly<{
  begin: () => number;
  isCurrent: (request: number) => boolean;
}>;

/** Makes an older asynchronous result a no-op after a newer request starts. */
export function createLatestRequestGate(): LatestRequestGate {
  let latest = 0;
  return Object.freeze({
    begin: () => ++latest,
    isCurrent: (request) => request === latest,
  });
}
