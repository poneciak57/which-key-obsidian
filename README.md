# Which Key

Neovim-style which-key popup for Obsidian. Hold a modifier key to discover available hotkeys — navigate deeper into modifier combinations, execute commands, or just browse what's bound.

## Usage

Hold any modifier key (`Cmd`, `Ctrl`, `Option`, `Shift`) for the configured delay — a popup appears showing all hotkeys that use that modifier.

### In the popup

| Input | Action |
|-------|--------|
| Hold another modifier (e.g. `Shift`) | Drill into `⌘⇧ + …` |
| Press a key | Execute the matching command |
| `Esc` | Go back one modifier level (or close) |
| Click a sub-group | Drill into it |
| Click a binding | Execute it |
| Click background / `✕` | Close |

### Example flow

```
Hold Cmd  →  popup shows ⌘ + …
             ├─ [⇧ ›]  ⌘⇧ · 15 bindings   ← press Shift to drill in
             ├─ [⌘,]   Open settings
             ├─ [⌘P]   Open quick switcher
             └─ [⌘S]   Save file

Press Shift  →  popup updates to ⌘⇧ + …
                ├─ [⌘⇧F]  Search in all files
                └─ [⌘⇧N]  Create note to the right

Press Esc  →  back to ⌘ + …
```

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| Delay (ms) | `400` | How long to hold a modifier before the popup appears. Lower = faster, but may flash during normal shortcuts. |
| Show in editor | `on` | Whether to intercept keys when a note is open in edit mode. Disable if it interferes with typing. |

## Notes

- Only shows hotkeys registered through Obsidian's command system. System-level shortcuts (e.g. `Cmd+Opt+I` for DevTools) are not visible.
- The popup does not appear if you press a full shortcut quickly (within the delay) — normal Obsidian operation is unaffected.
