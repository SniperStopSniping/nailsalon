export type CalendarOpening = {
  technicianId: string;
  technicianName: string;
  date: string;
  time: string;
  startTime: string;
  endTime: string;
};

type Window = { startMs: number; endMs: number };

/** Return usable starts and the actual end of each uninterrupted free window. */
export function findCalendarGaps(
  working: Window,
  busy: Window[],
  starts: number[],
  minimumMinutes: number,
): Window[] {
  const gaps: Window[] = [];
  let cursor = working.startMs;
  const addGap = (endMs: number) => {
    const startMs = starts.find(start => start >= cursor && start + minimumMinutes * 60_000 <= endMs);
    if (startMs !== undefined) {
      gaps.push({ startMs, endMs });
    }
  };

  for (const block of [...busy].sort((a, b) => a.startMs - b.startMs)) {
    if (block.endMs <= cursor) {
      continue;
    }
    if (block.startMs >= working.endMs) {
      break;
    }
    addGap(block.startMs);
    cursor = block.endMs;
  }

  addGap(working.endMs);
  return gaps;
}
