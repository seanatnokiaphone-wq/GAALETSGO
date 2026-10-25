/** Small seeded RNG so the stadium and crowd look the same on every load. */
export function seededRandom(seed = 7): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}
