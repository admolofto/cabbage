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

## Materials, board details, and the cut list (milestone 4)

- **A material is a kind of stock, not a thickness.** Plywood is one material
  whether it is 1/4" or 3/4". The thickness belongs to the board, and the cut
  list groups by material and thickness together. That keeps the list of
  materials short and lets a board be pulled thicker without changing what it
  is made of.
- **New boards take the stock shown at the top left.** The material and the
  starting thickness are picked there, and remembered between visits.
  Switching units swaps the thickness for its usual partner, so 3/4" becomes
  18 mm.
- **A board is thick along its thinnest side.** A side drawn as a 3/4" by 12"
  strip on the floor and pulled up 36" is a 36" by 12" part in 3/4" stock, not
  a 12" by 3/4" part in 36" stock. The first build got this wrong. Tested in
  `cut-list.test.ts` and `board-tool.test.ts`.
- **Length runs with the grain.** For a material with grain, the cut list's
  length is the side the grain follows, even when that is the shorter side.
  Grain starts out along the longer side. Without grain, length is the longer
  side.
- **Grain and banding are named by where they are in the room.** "Left to
  right" and "Front" need no knowledge of which side of a part is its length.
  The cut list translates them into length and width edges. They turn with the
  board when it is rotated.
- **Banded edges show in the view.** A banded edge is painted darker, so a
  missed one can be seen without opening the list.
- **Identical parts share a line.** Parts merge when material, thickness,
  length, width, and banding all match. Names do not have to match: a line
  lists every name on it. Typing a name on a line renames every board on it.
- **Clicking a line selects its boards.** It is the quickest way to find where
  a part is, and to change all of them at once.
- **Sheet counts are a floor, not a plan.** "At least 2 sheets" is the area
  divided by a 4 x 8 ft sheet. A real layout needs more, and comes with the
  sheet layout phase. A part bigger than a sheet is flagged.
- **The print view is only the list.** With the cut list open, printing leaves
  out the 3D view and the controls.

## Cabinets (milestone 5)

- **A cabinet is a few sizes, and its boards follow.** Width, height, depth,
  toe kick, and a number of shelves. The boards are worked out from those
  every time they are needed and never saved, so the view and the cut list
  cannot disagree with the cabinet. Tested in `cabinet.test.ts`.
- **A cabinet is one thing.** Clicking any of its boards selects the whole
  cabinet. Select, Move, copy, Rotate, and Delete treat it the way they treat a
  board. Its boards cannot be changed one at a time until it is unlocked.
- **Unlock is a one-way door, with undo.** "Unlock into boards" leaves the
  plain boards the cabinet was made of, selected and ready to change. They no
  longer resize together.
- **The first build is the plainest one.** Frameless, butt joints, the sides
  running floor to top, the bottom and top between them, a 1/4" back applied
  over the back edges, and a toe kick board set back 3". A base cabinet gets
  two 4" stretchers in place of a top, since a countertop covers it. Shelves
  are loose: 1/8" narrower than the opening and 1/4" shy of the front. Fronts
  of the sides, bottom, top, front stretcher, and shelves are banded. Other
  ways of building arrive with build styles.
- **The toe kick notch is not drawn yet.** The sides are full rectangles in
  the view and in the cut list. Cutting the notch is left to the shop until
  boards can carry cutouts.
- **Depth is the case and its back.** Doors will sit in front of it.
- **Usual sizes to start.** Base 24 x 34 1/2 x 24 with a 4" toe kick, wall
  24 x 30 x 12, tall 24 x 84 x 24. In millimeters: 600 x 870 x 560 with a
  150 toe kick, 600 x 720 x 320, and 600 x 2100 x 560. The case stock and
  material come from the picker at the top left.
- **A cabinet is held by its back left corner.** The back is what goes against
  the wall, so clicking the back corner of one cabinet sets the next beside
  it. If it would land inside the cabinet that was clicked, it goes to the
  left of the corner instead.
- **Cabinets line up with the outside of other cabinets.** While placing, a
  cabinet already in the model counts as the plain box around it. The first
  build snapped to the boards inside, and a click near a back corner could
  land on the corner of a side, 1/4" out of line. Tested in
  `cabinet-tools.test.ts`.
- **The floor decides the height.** Base and tall cabinets always stand on the
  floor, and wall cabinets hang with their bottom at 54" (1400 mm), wherever
  the click lands. Move changes it afterward.
- **A typed size is for the next cabinet, or the one just placed.** `30` is a
  width, and `30, 34 1/2, 24` is width, height, and depth. Each kind remembers
  its own. A cabinet set to the left of a corner grows to the left.
- **Pull resizes a cabinet by its outside.** Pulling a side changes the width,
  the front or back the depth, the top or bottom the height, and every board
  follows. Faces inside the cabinet are not offered.
- **A cabinet stays upright.** Rotate turns it about the upright line only.
- **Sizes are changed in the panel, too.** Each change is checked against what
  can be built: an opening is never less than 50 mm, and a toe kick is either
  left out or at least as tall as the stock is thick. A size that cannot be
  built is turned down and the box goes back to what is there.
- **Width grows to the right.** Changing the width in the panel keeps the back
  left corner where it is. Neighbors do not move out of the way.
- **Parts from cabinets are named by the cabinet.** In the cut list, clicking
  such a line selects the cabinets it came from. Its name cannot be typed
  over.

## Files

- **The project takes the name of its file.** Saving as `Hall bookcase.cabbage`
  names the project Hall bookcase, and a file renamed on disk opens under its
  new name.
- **Save writes back to the same file where the browser allows it.** The first
  save asks where. Browsers without direct file access download the file
  instead.
- **Nothing unsaved is thrown away without asking.** New and Open ask first
  when the model has changes that are not in a file. An empty model has nothing
  to lose and is never asked about.
- **The browser still keeps a copy.** The model is kept in the browser's own
  storage as before, so closing the tab loses nothing. The dot beside the name
  means the file on disk is behind.
- **Older saves open.** A model from before materials opens with every board
  in plywood.

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
- Are five built-in materials the right starting list, and should a custom
  material carry more than a name and a grain setting, such as a sheet size or
  a price?
- Is naming banded edges by Front, Back, Left, and Right clear, or would
  picking the edge in the 3D view be better?
- Does the cut list need more columns, such as a part number or notes?
- Should a part's length always follow the grain, as it does now, even when
  that makes length the shorter number?
- Is the cut list better docked under the view, as it is now, or beside it?
- Is a cabinet built the way you build one? Sides to the floor with a toe
  kick board between them, or a separate base? Back applied over the edges, or
  set in a groove? Stretchers or a full top on a base cabinet?
- Are the usual sizes, the 3" toe kick setback, and the shelf allowances right
  for your shop?
- Is holding a cabinet by its back left corner right, or should it follow the
  cursor by its front?
- Should a cabinet be turned while it is being placed, for a run along another
  wall? It is placed facing the front and turned with Rotate now.
- Should wall cabinets hang at 54", and should that height be typed with the
  size?
- When a cabinet gets wider, should the ones beside it move over?
- Is a mixed selection of boards and cabinets worth a panel of its own? It has
  none now.
