# Cabbage

Cabbage is an open source, browser-based 3D modeler for people who design and
build their own cabinets.

You draw with direct controls: draw a rectangle, pull it to size, type an exact
measurement, and snap to corners, edges, midpoints, and guides. Everything you
draw is a board with a thickness, a material, and a grain direction, so the cut
list is always correct.

## Status

Early development. Nothing here is usable for real projects yet.

## Roadmap

The first usable version is a board modeler with a correct cut list:

1. **Viewport.** 3D view with a floor grid, orbit, pan, zoom, and units. Done.
2. **Draw boards.** Board tool, typed measurements, snapping, undo. Done.
3. **Edit boards.** Pull, move and copy, rotate, guides, measuring, box select.
   In review.
4. **Cut list.** Materials, grain, edge banding, cut list export, save and open.

Later phases add parametric cabinets (frameless and face frame), sheet layout
for track saw cutting, cost estimates, rooms, shop drawings, and exchange with
Blender and SketchUp.

## Development

Cabbage is a static TypeScript site built with Vite, React, and Three.js. It
needs Node 22 or newer.

```sh
npm install
npm run dev        # start a local server
npm run check      # type check, lint, test, and build
```

To try a build without a server, run `npm run build:standalone`. It writes
`dist-standalone/cabbage.html`, a single file that opens with a double-click.

The code is layered so the parts that matter most can be tested without a
browser:

- `src/core` holds the model: exact units, boards, guides, the document, undo
  history, typed measurement parsing, the math for moving, pulling, and turning
  boards, and the editor that ties them together.
- `src/inference` decides what the cursor snaps to: corners, midpoints, edges,
  guides, faces, and the floor, and notices when the cursor follows an axis.
- `src/tools` holds the tools: Select, Board, Pull, Move, Rotate, and Tape. Each
  one is a small state machine that is fed pointer and key events and never
  touches the screen.
- `src/viewport` holds the 3D view. Camera math lives in `camera-math.ts`, apart
  from the code that listens to the mouse and touch screen.
- `src/app` holds the panels and controls around the view.

The model is saved in the browser's own storage as you work. Saving to a file
comes with milestone 4.

Notes on how the controls should feel, and why, are kept in
[docs/feel-notes.md](docs/feel-notes.md).

## License

[MIT](LICENSE)
