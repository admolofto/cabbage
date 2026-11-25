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

1. **Viewport.** 3D view with a floor grid, orbit, pan, zoom, and units.
2. **Draw boards.** Board tool, typed measurements, snapping, undo.
3. **Edit boards.** Pull, move, rotate, full inference, guides, measuring.
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

The code is layered so the parts that matter most can be tested without a
browser:

- `src/core` holds exact units and other pure model code.
- `src/viewport` holds the 3D view. Camera math lives in `camera-math.ts`, apart
  from the code that listens to the mouse and touch screen.
- `src/app` holds the panels and controls around the view.

Notes on how the controls should feel, and why, are kept in
[docs/feel-notes.md](docs/feel-notes.md).

## License

[MIT](LICENSE)
