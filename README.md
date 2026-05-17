# Square

Square is a personal Square-based canvas app.

It uses this hierarchy:

```text
Bookcase > Book > Page/SubPage > Square
```

## Current Version

```text
Square v0.3.0
```

The original v0.1 target was a minimal Book/Page/Square canvas. The current app has moved beyond that baseline, so the official working version is now v0.3.0.

## Implemented Scope

- Book creation and deletion
- Page and SubPage creation/deletion
- Page tree navigation
- Square creation, selection, movement, resizing, deletion
- Multi-select Square movement with Shift/Ctrl/Cmd click
- Text editing
- Image insertion/removal inside a Square
- Basic Square style editing
- Device layout modes: Desktop, Tablet, Mobile
- Per-device layout values for x, y, width, height, visible
- Edit/Run app modes
- Design/Content/Function edit modes
- Basic Square Actions
  - Go to page
  - Show Square
  - Hide Square
  - Toggle Square
  - Open URL
- Function-mode logic overlay for Square-to-Square action lines
- Hidden Squares remain visible while editing
- localStorage autosave
- JSON backup export/import
- GitHub Pages deployment

## Not Implemented Yet

- Formula engine
- Full relation database
- Full Graph View
- Calendar
- Document processing
- Google login / Google Drive sync
- HTML Module
- Backend server
- Smart Squares, Templates, Wizards, Presets

## Version Notes

- v0.1: Core Book/Page/Square canvas engine
- v0.2: Basic Square Actions and interaction model
- v0.3: Device layouts, image content, group movement, logic overlay, current Square terminology

The localStorage key may still include `v0.1` for backward compatibility. Do not rename it casually because existing user data depends on it.

## Tech Stack

```text
React
TypeScript
Vite
CSS
localStorage
JSON export/import
```

## Development Context

Read these files before coding:

```text
DO_NOT_REGRESS.md
SQUARE_CONTEXT.md
DEVELOPMENT_RULES.md
SQUARE_NAMING_AND_TYPES.md
SQUARE_INTERACTION_MODEL.md
SYNC_STRATEGY.md
```
