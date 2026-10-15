# 08. Zoom buttons and iPad touch checks

Status: proposed 2026-10-15, from the play-test (docs/FEEDBACK.md, entry 2: Frank "cannot enlarge the map and make the hexagons bigger"). Roadmap "Next up" item 4. Words only; the build notes go under "As built" when it is done.

## Goal

Frank, on an iPad, can make the map and the hexes as big as he likes, and get back to the whole map, with one finger or two, without reading any instructions. A visible set of buttons does it; pinching and the mouse wheel keep working.

## What we found (before building anything)

We tried to make it fail the way Frank said it did. The test used a browser pretending to be an iPad (touch screen, real two-finger pinch sent as raw touch events, four iPad sizes in both orientations: 1024x768, 1180x820, 820x1180, 768x1024, plus a phone). **We could not get a real iPad Safari here** (only a Chrome-family browser is installed), so everything below says what was shown in that stand-in and what stays unproven.

**Shown to work today.** A two-finger pinch zooms the map at all four iPad sizes, up to a hex 140 to 180 screen pixels wide and a counter 100 to 130 pixels wide: the largest zoom (12 times the whole map) is more than enough, so we do not raise it. The page itself does not zoom. A tap still selects after zooming. The zoom survives turning the iPad over and turning it back (it comes back exactly). A double tap on the map does nothing odd (no page zoom).

**Shown to be fragile.**

| What | What happens | Why it matters |
|---|---|---|
| The map is small and there is no sign that it can be zoomed | The first view after set-up shows hexes 22 to 32 pixels wide (counters 16 to 23); "Whole map" shows hexes 12 to 15 pixels wide (counters 8 to 11). The only visible control is "Whole map". Apple's guideline for a thing you tap is 44 pixels. | Most likely the real reason for the complaint: nothing on screen says "pinch me", and the picture is small. |
| The map relies on one browser setting (`touch-action: none` on the map) | With it taken away the browser zooms the whole page instead of the map (page zoom went to 4.3 times). It is set today, so this is not the bug, but it is the one thing that decides it. | Safari is stricter than Chrome about this setting and has its own pinch events (`gesturestart`). We add belt and braces for those, but **only a real iPad can confirm them**. |
| A pinch that starts on the side panel zooms the whole page | Page zoom 3.5 times, layout broken until pinched back. | This is how Safari treats a pinch outside the map, and it is also a feature for people who need big text. We leave it alone and say so. |
| The first small movement of a pinch is lost, and two fingers moving together jump | With two fingers dragged side by side the map zoomed out by about 17 percent instead of staying put. A real pinch loses a small jump at its start. | A real bug in our own pinch code, caused by measuring the gap between the fingers only after one finger has already moved. |
| Two fingers dragged together do not move the map | Only the zoom is read. | A natural thing to do on a touch screen; fingers resting on the glass while pinching also drift. |
| Fingers touching (gap of 0) zoom the map out to its limit in one go | The viewBox jumped to 1.2 times the whole map. | A division by zero: a crossed or touching pinch is rare but it makes the map vanish. |

**Not the cause, checked.** The tap slop (6 pixels) only decides tap versus drag, it never stops a pinch (a second finger cancels the tap). The viewport tag in `index.html` (`width=device-width, initial-scale=1`) is right; Safari on iPad ignores `user-scalable=no` since 2016, and blocking page zoom would hurt people who need it, so we do not add it. A re-draw of the panels never resets the zoom. The only automatic re-zoom is the existing one, once when each nation's set-up begins and once when set-up ends.

**Cannot be checked here, to ask Frank.** Whether his iPad asks for the "desktop" version of the page (the Safari default on newer iPads), which makes everything smaller; and whether he pinched on the map or on the panel beside it.

## The controls

A column of four round-cornered buttons in the top-right corner of the map, each at least 44 by 44 pixels, with a name read aloud by a screen reader and a tooltip:

| Button | Name | What it does |
|---|---|---|
| + | "Zoom in" | Doubles the size, about the middle of the map. Stops at the largest zoom (hex about 140 pixels wide on an iPad). |
| - | "Zoom out" | Halves the size, about the middle. Stops at the smallest zoom (a little more than the whole map). |
| Map icon | "Show the whole map" | The same as the existing "Whole map" button in the header (which stays). |
| Target icon | "Zoom to the selected counter" | Fits the view to the hexes that are outlined in yellow (where the chosen stack can go, or where the chosen counter can be placed or built), with a margin. Does nothing, and says so, when nothing is selected. |

- Keyboard: the buttons are ordinary buttons (Tab, then Enter or Space). After each press a short line is read aloud ("Zoom 2 times", "Zoomed in as far as it goes").
- On a phone turned on its side the map is only about 130 to 170 pixels tall, so the four buttons lie in a row along the bottom-right edge instead, and the hex info line and the refused-move line make room for them.
- They never sit over the legend, the hex info line, the refused-move line, the "Control and zones" button or the panel column. A test measures this at every size below.

**Pinch, drag and wheel (existing, fixed).** The gap between the fingers is read the moment the second finger lands. Two fingers moving together now also move the map. Fingers closer than 4 pixels are ignored. The page's own zoom is blocked on the map itself in three ways (the CSS setting on the map and its frame, Safari's `gesturestart` events, and the touch-move event when two fingers are down), without touching zoom elsewhere on the page.

## Decisions

| # | Question | Decision |
|---|---|---|
| 1 | Double-tap to zoom? | **No.** A tap on the map already means something at once (choose a stack, choose where it goes, place a counter), and tapping the same stack twice means "let go of it". A double tap would either delay every tap by a third of a second or undo the player's choice before zooming. The buttons and the pinch cover the need. Safari's own double-tap zoom is off on the map and we test that it stays off. |
| 2 | Highest zoom | Unchanged: 12 times the whole map. Measured: enough at every iPad size. |
| 3 | Step of the buttons | Twice or half, so three presses take the whole map to about the size of a nation. |
| 4 | Limits | Still measured against the whole map just fitting the screen; the zoom to a selection is held inside the same limits. |
| 5 | Zoom and turning the iPad | Unchanged and now tested: the same map point stays in the middle and the same share of the map stays in view. |
| 6 | Bigger map panel | Not in this task. Making the map panel itself taller on a portrait iPad (now 46 percent of the height) is a layout change to discuss; zoom already enlarges what is inside it. |
| 7 | Page zoom elsewhere | Left alone on purpose (accessibility). |

## Tests

- Unit (no browser): the zoom maths for the buttons (step, limits, the level shown), the fit to a selection held inside the limits, the pinch step (gap read from the second finger down, two fingers moving together move the map, gap of 0 ignored, a lift of one finger ends the pinch), the gesture events from Safari, the buttons' markup and names.
- Browser, with a mouse and with a touch screen, at 1024x768, 1180x820, 820x1180, 768x1024 and a phone in both orientations: each button works; the pinch zooms the map and not the page; a tap on a hex still works after zooming (and after a pinch); the zoom survives turning the iPad and turning it back; a double tap does not zoom the page; the buttons are at least 44 pixels, inside the map, and clear of the other things on the map and of the panel column.
- Mutation checks (break it, see a test fail, restore): the step of the zoom-in button, the lock on the highest zoom, and the pinch gap being read at the wrong time.

## Out of scope

- A real-iPad run. The product owner or Frank should open the new build on the iPad and try: pinch the map; press + three times; press "Show the whole map". Anything different is a bug report for this spec.
- Double-tap to zoom, a "zoom slider", a bigger map panel, remembering the zoom between visits, zooming the labels apart from the map (city names scale with the map).
- Anything in the rules or the engine.

## As built

- **Buttons**: `src/ui/zoomControls.ts` (markup, names, the spoken line, the click handling), mounted by `shell.ts` inside the map frame and bound in `main.ts`. A column in the map's top-right corner; on a phone on its side (under 480 px tall) a row along the bottom-right, with the hex info line, the refused-move line and the key narrowed to leave room (`style.css`). The refused-move line and the key also stay 4 rem clear of the column in the normal layouts. Each press doubles or halves (`BUTTON_ZOOM_STEP`); the target button fits the yellow-outlined hexes (`MapView.focusOutlined`), which is the whole of "zoom to what is selected": it covers a chosen stack's destinations, the places a chosen counter can be put, and a chosen build. With nothing outlined it says so and leaves the map alone. The existing "Whole map" button in the header stays.
- **Maths** (`viewport.ts`, pure, unit-tested): `zoomLevel`, `clampBox`, `BUTTON_ZOOM_STEP`; `focus` now holds a fit inside the zoom limits (a fit to one hex would have gone past the largest zoom). The limits are unchanged: 12 times in and 1.2 times out, measured against the whole map just fitting.
- **Pinch** (`pinch.ts` pure, `gestures.ts`): the gap is read when the second finger lands; the middle of the two fingers pans the map; fingers under 4 px apart do not zoom. Added for Safari and not checkable here: `gesturestart/change/end` are cancelled (a trackpad pinch with no touch pointers zooms the map from the gesture's `scale`), a two-finger `touchmove` is cancelled, and `touch-action: none` is on the map's frame as well as the map, `-webkit-` prefixes and `touch-action: manipulation` on buttons.
- **No real bug was found that stops a pinch in the stand-in browser.** The ones fixed are the first-move loss, two fingers moving together zooming, and the zero gap. The likely cause of Frank's report is that nothing on screen offered a zoom, with hexes of 22 to 32 px; the buttons answer that. Whether Safari itself honours the map's touch setting is for the real iPad to say.
- **Double tap**: not built (decision 1). Checked that a double tap changes neither the page zoom nor the map.
- **Tests**: unit `tests/pinch.test.ts` (5), `tests/zoom-controls.test.ts` (13), `tests/map-gestures.test.ts` (6 added); browser `tests/e2e/zoom.spec.ts` (21 cases run with a mouse and again with a touch screen, plus 5 that need real touch): iPad sizes 1024x768, 1180x820, 820x1180, 768x1024 and phones 390x844, 360x640, 844x390, 568x320 for the layout; buttons, target button, tap after zoom, turning the iPad, a real two-finger pinch (raw touch events, page zoom stays 1), two fingers moving together, double tap. Mutation checks: button step 2 to 1.5 (3 unit tests fail); the clamp in `focus` removed (1 fails); the pinch gap read at the first move again (2 unit tests and the browser test fail). Setting `touch-action: auto` on the map by hand zooms the page instead (the reproduction in "What we found"; not kept as a test because it needs an edit of the shipped CSS).
- Gates: lint, typecheck, 1001 unit tests, build, and the browser specs zoom, gestures, wide-layout, phone-layout, resize, smoke and move (124 passed, 6 skipped as touch-only).
- Not changed: the viewport tag in `index.html`, the map frame's height, the engine.
- **Target button, follow-up (found on a PC)**: it did nothing visible with nothing outlined, because its only message went to a screen-reader line. Now, in order: (1) outlined hexes are fitted, as before; (2) else the hex shown on the hex card (`Session.lookedAt`, not during setup) is centred with a few hexes around it, held inside the zoom limits (`MapView.focus`), and the status line says "Zoomed to the hex Warsaw (M35)"; (3) else "Nothing is selected. Choose one of your counters first." is also shown on the map (`#zoomnote`, left of the zoom column, over the map, absolutely placed so nothing shifts, `aria-hidden` because the status line is the one read aloud) for `NOTE_MS` (4 s), then goes by itself; any later press replaces or clears it. The button is now named "Zoom to the selected hex or counter" (still a 44 px button). `zoomToSelection`, `lookedHex`, `bindZoom` in `src/ui/zoomControls.ts`. Tests: `tests/zoom-controls.test.ts` (decision order, message, timeout with injected and with fake timers), `tests/e2e/zoomtarget.spec.ts` (mouse and touch: tap a hex then the button centres it; nothing selected shows the line, no layout shift, gone after 4 s on a paused clock). Mutation checks: decision order swapped (3 unit tests fail); the timeout never clearing the note (3 fail).
