export const GAUGES = [
  { mm2: 0.14, awg: 26 },
  { mm2: 0.25, awg: 24 },
  { mm2: 0.34, awg: 22 },
  { mm2: 0.5, awg: 20 },
  { mm2: 0.75, awg: 18 },
  { mm2: 1, awg: 17 },
  { mm2: 1.5, awg: 16 },
  { mm2: 2.5, awg: 14 },
  { mm2: 4, awg: 12 },
  { mm2: 6, awg: 10 },
  { mm2: 10, awg: 8 },
  { mm2: 16, awg: 6 },
  { mm2: 25, awg: 4 },
  { mm2: 35, awg: 2 },
  { mm2: 50, awg: 1 },
];

const BASE_WIDTH = 1.8;
const WIDTH_STEP = 0.4;

const indexOf = (gauge: number | undefined): number => GAUGES.findIndex(g => g.mm2 === gauge);

export const gaugeLabel = (gauge: number | undefined): string => {
  const found = GAUGES[indexOf(gauge)];
  return found ? `${found.mm2} mm² / AWG ${found.awg}` : '';
};

export const wireWidth = (gauge: number | undefined): number => BASE_WIDTH + (indexOf(gauge) + 1) * WIDTH_STEP;

// One step below the smallest size is "not set", which is undefined.
export const stepGauge = (gauge: number | undefined, step: 1 | -1): number | undefined =>
  GAUGES[Math.max(-1, Math.min(GAUGES.length - 1, indexOf(gauge) + step))]?.mm2;
