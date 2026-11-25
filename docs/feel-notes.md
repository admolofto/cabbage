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

## Units

- **Rounded values are marked.** A length that does not land exactly on the
  display precision is shown with a leading `~`, so a rounded number is never
  mistaken for an exact one. Tested in `units.test.ts`.
- **The cursor readout is not marked.** A free-moving cursor is almost never on
  an exact value, and a `~` on every reading would be noise.

## Open questions for testing

- Is orbit speed right, or should a drag turn the model more or less?
- Is one wheel notch too much or too little zoom?
- Should a plain left drag orbit, as it does now, once drawing tools exist?
