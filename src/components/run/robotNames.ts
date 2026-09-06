/** Current robot metadata owns group labels; run names are historical snapshots. */
export function getCurrentRobotNames(recordings: readonly unknown[]): Map<string, string> {
  const names = new Map<string, string>();
  for (const recording of recordings) {
    if (!recording || typeof recording !== 'object' || !('recording_meta' in recording)) continue;
    const meta = recording.recording_meta;
    if (!meta || typeof meta !== 'object' || !('id' in meta) || !('name' in meta)) continue;
    if (typeof meta.id === 'string' && typeof meta.name === 'string') {
      names.set(meta.id, meta.name);
    }
  }
  return names;
}
