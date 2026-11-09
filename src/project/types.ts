export type Point = { x: number; y: number };
export type Side = 'left' | 'right' | 'top' | 'bottom';

export type Pin = {
  id: string;
  number: string;
  net: string;
  userName: string;
  side: Side;
  order: number;
};

export type Block = {
  id: string;
  name: string;
  label: string;
  kicadLinked: boolean;
  x: number;
  y: number;
  pins: Pin[];
};

export type WireEnd = { blockId: string; pinId: string };

export type Wire = {
  id: string;
  from: WireEnd;
  to: WireEnd;
  corners: Point[];
  colours: string[];
};

export type Harness = { id: string; name: string; wireIds: string[]; arc: Point };
export type Zone = { id: string; name: string; x: number; y: number; w: number; h: number };
export type Note = { id: string; text: string; x: number; y: number };
export type Colour = { name: string; hex: string };

export type Project = {
  version: 1;
  blocks: Block[];
  wires: Wire[];
  harnesses: Harness[];
  zones: Zone[];
  notes: Note[];
  customColours: Colour[];
};

export type Selection = {
  blocks: string[];
  wires: string[];
  notes: string[];
  zones: string[];
  harnesses: string[];
};
