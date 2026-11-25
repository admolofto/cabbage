import { inchFraction, type Length } from '../core/units';

/**
 * A stand-in base cabinet so there is something real to look at and judge
 * scale against while testing navigation. It goes away when the Board tool
 * arrives and you can draw your own.
 */
export interface SampleBoard {
  name: string;
  /** Corner with the smallest x, y, and z. */
  origin: readonly [Length, Length, Length];
  size: readonly [Length, Length, Length];
}

const inch = inchFraction;

const WIDTH = inch(30);
const HEIGHT = inch(34, 1, 2);
const DEPTH = inch(24);
const SHEET = inch(0, 3, 4);
const BACK = inch(0, 1, 4);
const TOE_KICK_HEIGHT = inch(4);
const TOE_KICK_SETBACK = inch(3);
const STRETCHER_DEPTH = inch(4);

const INNER_WIDTH = WIDTH - 2 * SHEET;
const INNER_DEPTH = DEPTH - BACK;

export const SAMPLE_CABINET: readonly SampleBoard[] = [
  { name: 'Left side', origin: [0, 0, 0], size: [SHEET, DEPTH, HEIGHT] },
  { name: 'Right side', origin: [WIDTH - SHEET, 0, 0], size: [SHEET, DEPTH, HEIGHT] },
  { name: 'Bottom', origin: [SHEET, 0, TOE_KICK_HEIGHT], size: [INNER_WIDTH, INNER_DEPTH, SHEET] },
  {
    name: 'Back',
    origin: [SHEET, INNER_DEPTH, TOE_KICK_HEIGHT],
    size: [INNER_WIDTH, BACK, HEIGHT - TOE_KICK_HEIGHT],
  },
  {
    name: 'Toe kick',
    origin: [SHEET, TOE_KICK_SETBACK, 0],
    size: [INNER_WIDTH, SHEET, TOE_KICK_HEIGHT],
  },
  {
    name: 'Front stretcher',
    origin: [SHEET, 0, HEIGHT - SHEET],
    size: [INNER_WIDTH, STRETCHER_DEPTH, SHEET],
  },
  {
    name: 'Rear stretcher',
    origin: [SHEET, INNER_DEPTH - STRETCHER_DEPTH, HEIGHT - SHEET],
    size: [INNER_WIDTH, STRETCHER_DEPTH, SHEET],
  },
  {
    name: 'Shelf',
    origin: [SHEET, inch(1), inch(19)],
    size: [INNER_WIDTH, INNER_DEPTH - inch(1), SHEET],
  },
];
