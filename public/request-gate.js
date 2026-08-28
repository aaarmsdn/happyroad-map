export function createRequestGate() {
  let current = 0;
  return {
    begin: () => ++current,
    cancel: () => { current += 1; },
    isCurrent: request => request === current
  };
}
