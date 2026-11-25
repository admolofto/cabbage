# Feel notes

A running record of how Cabbage's controls should feel, and why each choice was
made. Feedback from testing lands here, so a later change does not quietly undo
an earlier fix. Where a note can be checked by a test, the test is named.

## Navigation (milestone 1)

- **Orbit turns around what you grabbed.** A drag orbits around the point under
  the cursor when it started, on a board or on the floor, so that point stays
  put on screen. Tested in `camera-math.test.ts`.
- **The floor always stays level.** Orbit is a turntable: it never rolls the
  horizon. It stops just short of straight up and straight down.
- **Zoom goes toward the cursor.** The point under the cursor stays under the
  cursor while zooming in or out. One wheel notch changes the distance by about
  16 percent.
- **Pan is one to one.** The point you grab stays under the cursor for the whole
  drag.
- **No coasting.** The view stops the moment you stop. Nothing drifts or eases
  after a drag, because drifting makes precise work harder.
- **Standard views swing, they do not cut.** Front, Right, Top, and Home move
  the camera around the model over about a quarter second.
- **Touch.** One finger uses the active tool. Two fingers pan and pinch
  together. When one finger of a pinch lifts, the other does nothing until it
  lifts too, so the view never jumps.
- **Views are in perspective for now.** Front, Right, and Top are not yet flat,
  parallel views. A parallel projection option is a candidate for later.

## Drawing boards (milestone 2)

- **Three steps, and the last one is free.** A board is a corner, the opposite
  corner, and a thickness. The thickness starts at the usual sheet, 3/4" or
  18 mm, and Enter accepts it, so the common case is two clicks and a key.
  Tested in `board-tool.test.ts`.
- **Typing never needs a click first.** Digits typed while drawing go straight
  to the measurement box. `24, 34 1/2` sets both sizes, `, 12` sets only the
  second, and a size goes the way the cursor is already heading. Units can be
  mixed: `18mm` works in an inch project.
- **A typed thickness can follow the board.** Right after a board is drawn,
  typing a thickness corrects that board without adding an undo step. The chance
  ends as soon as anything else changes.
- **Bad text is kept, not thrown away.** Text that is not a measurement turns
  the box red and stays there to be fixed.
- **Dragged sizes land on round numbers.** A free drag snaps to the roundest
  step that is still within about 8 pixels of the cursor: whole inches when
  zoomed out, finer fractions as you zoom in, never finer than the display
  precision. A quick drag gives 24" and not 23 15/16".
- **The usual thickness is sticky.** While setting a thickness by hand, the
  cursor catches on 3/4" or 18 mm when it passes within a few pixels.
- **Snaps are exact.** Snapping to a corner returns the corner's own stored
  coordinates, not a rounded copy of where the cursor was. Corners win over
  midpoints and the origin, which win over edges, then faces, then the floor.
  Hidden corners do not snap. Tested in `inference.test.ts`.
- **Things line up across space.** While drawing on a plane, a corner or edge
  under the cursor is carried onto the plane, with a dotted line back to it and
  an "In line with" label.
- **Boards lie flat unless told otherwise.** The face is drawn on the floor or
  on the board face that was clicked. Arrow keys stand it up: Right for a face
  square to X, Left for Y, Up for flat, Down for automatic.
- **Thickness grows the sensible way.** Up from the floor, away from the face it
  was drawn on, and otherwise toward the viewer.
- **Escape and undo back out one step.** In the middle of drawing, both cancel
  the current step and leave finished boards alone.
- **Digits always mean measurements.** The number keys no longer switch views.
- **Touch aims, then places.** A finger moves the preview while it is down and
  places the point when it lifts. Two fingers still pan and zoom.

## Selecting

- **The left button belongs to the active tool.** With Select or Board active, a
  left drag no longer orbits. Orbit is the middle button, the Orbit tool, or two
  fingers.
- **Drawing starts with nothing selected.** Switching to the Board tool clears
  the selection, so Delete can never remove something that is out of mind.

## Units

- **Rounded values are marked.** A length that does not land exactly on the
  display precision is shown with a leading `~`, so a rounded number is never
  mistaken for an exact one. Tested in `units.test.ts`.
- **The cursor readout is not marked.** A free-moving cursor is almost never on
  an exact value, and a `~` on every reading would be noise.

## Open questions for testing

- Is orbit speed right, or should a drag turn the model more or less?
- Is one wheel notch too much or too little zoom?
- Do round-number drags help, or do they get in the way of placing a point
  exactly where the cursor is?
- Is the snap reach of 10 pixels too grabby or too shy?
- Should the Board tool stay active after a board, as it does now, or go back
  to Select?
- Should a left drag on empty space orbit while Select is active?
