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

## Editing boards (milestone 3)

Tested in `edit-tools.test.ts` unless a note says otherwise.

- **Every tool reads the same way.** Click to start, move, click to finish, or
  type a number and press Enter. Typing again right after a step corrects that
  step without adding an undo step. Arrow keys lock an axis: Right for X, Left
  for Y, Up for Z, Down for free. Shift holds the axis the cursor is already on.
- **Typed sums work.** `36 - 3/4 * 2` gives the space between two 3/4" sides.
  Plus and minus need a space on each side, so `-3` and `1-1/2` keep their
  usual meaning. Tested in `transform.test.ts`.
- **Text that was turned down is replaced, not added to.** After the box turns
  red, the next number typed starts over. Backspace still edits what is there.
- **Pull works on the face under the cursor.** No selecting first. A typed
  number is a distance the way the face is heading, and `=30` sets the full
  size. A face cannot be pushed through the far side of its own board.
- **Pull does not snap to what the board hides.** The board being pulled never
  snaps to itself, but it still covers whatever is behind it.
- **Move stays level unless told otherwise.** A free move slides in the
  horizontal plane through the grabbed point. It follows an axis when the
  cursor heads along one, and goes exactly to a corner, midpoint, edge, or
  guide it reaches. Faces and the floor do not pull it off level. Up locks Z to
  lift a board.
- **Move takes what you clicked.** With nothing selected, Move picks up the
  board under the cursor. With a selection, it moves all of it by the point you
  grab.
- **Ctrl turns a move into a copy.** Press it any time before the second click.
  After a copy, `3x` makes three in a row and `/3` spaces three evenly up to
  where the copy landed. The copies become the selection.
- **A locked move takes a distance even when a snap holds it at zero.** The
  typed distance goes the way the cursor is heading along the locked axis.
- **Rotate is quarter turns for now.** Click the point to turn about, then swing
  a grabbed point around or type `90`, `180`, or `-90`. It turns about Z unless
  an arrow key picks another axis or the click lands on a face. Boards stay
  square to the axes until the model can hold tilted ones. Tested in
  `transform.test.ts`.
- **Tape measures, and pulls guides.** Two clicks on points give a length.
  Starting on an edge or on a guide pulls a guide off it instead, sideways,
  the way the cursor heads. A typed number sets the offset.
- **Guides are lines with no ends.** They run along one axis, snap like edges,
  mark where they cross edges and each other, and are saved with the model.
  Select and delete them like boards. Tested in `inference.test.ts`.
- **Guides are never hidden.** They are drawn over the model so one behind a
  cabinet can still be found.
- **Guides must not slow the view.** A guide is drawn only where it is in view.
  The first build handed the browser the whole kilometer of dashed line, and
  placing a guide lagged badly (reported 2026-11-24). Tested in `clip.test.ts`.

## Selecting

- **The left button belongs to the active tool.** With Select or Board active, a
  left drag no longer orbits. Orbit is the middle button, the Orbit tool, or two
  fingers.
- **Tools that ignore the selection start with nothing selected.** Switching to
  Board, Pull, or Tape clears the selection, so Delete can never remove
  something that is out of mind. Move and Rotate keep it, because they use it.
- **A dragged box selects.** Dragged to the right, it takes boards that are
  entirely inside. Dragged to the left, it takes anything it touches. Shift
  adds to what was selected, and Escape puts the selection back.
- **A guide wins over a board under the same click.** A guide is thin, so it
  gets first claim.

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
- Should a left drag on empty space orbit while Select is active? It draws a
  selection box as of milestone 3.
- Should a free move stay level, as it does now, or follow faces and the floor
  under the cursor?
- Is Ctrl the right key for a copy, and should it be held or tapped? It is a
  tap now.
- Are quarter turns enough for Rotate until tilted boards arrive?
- Should guides stay until deleted, as they do now, or is a "clear all guides"
  command needed?
