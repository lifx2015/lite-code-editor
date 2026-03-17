# EditLite

A lightweight text editor built with Tauri, focused on simplicity and efficiency.

English | **[中文](./README.md)**

![EditLite Screenshot](./screenshot.png)

## Features

### Editing
- **Multi-tab Editing** - Edit multiple files simultaneously with tab management
- **Syntax Support** - Markdown, JavaScript/TypeScript, JSON, CSS, HTML, Python, SQL, Java
- **Rectangular Selection** - Block selection editing mode
- **Word Wrap** - Toggle word wrap on/off
- **JSON Formatting** - One-click JSON formatting

### File Operations
- **Multi-file Open** - Open multiple files at once
- **Auto Encoding Detection** - Supports UTF-8, GBK, Shift_JIS, EUC-KR, Windows-1252
- **Encoding Conversion** - Save files with selected target encoding
- **File Association** - Open files via system file association
- **File Change Notification** - Notify users when files have been modified outside the editor
- **Window Auto Activation** - Automatically restore and focus window when opening files while minimized
### Markdown Preview
- **Edit Mode** - Pure editing view
- **Split Mode** - Editor on the left, live preview on the right
- **Preview Mode** - Pure preview view
- **GitHub Flavored Markdown** - Supports GFM extended syntax (tables, task lists, etc.)
- **Enhanced Preview Mode** - Supports interactive components like algorithm visualization

### Enhanced Preview (Algorithm Visualization)

EditLite has built-in algorithm visualization functionality, no plugin installation required. Use special directives in Markdown to display dynamic algorithm demonstrations.

#### Usage

1. Enter the directive syntax in a Markdown file
2. Switch to **Split** or **Preview** mode
3. Click the **"Enhanced"** button above the preview area
4. Use control buttons to operate the animation

#### Built-in Components

##### Sorting Visualization Directive

```markdown
:sort{array=[64, 34, 25, 12, 22, 11, 90], algorithm="bubble", speed=400}
```

##### Parameters

| Parameter | Type | Description | Default |
|-----------|------|-------------|---------|
| `array` | `[number]` | Array of numbers to sort | `[5, 2, 8, 1, 9]` |
| `algorithm` | string | Algorithm type | `bubble` |
| `speed` | number | Animation speed (ms) | `300` |
| `showSteps` | boolean | Show step descriptions | `true` |

##### Supported Sorting Algorithms

| Algorithm | Description |
|-----------|-------------|
| `bubble` | Bubble Sort |
| `quick` | Quick Sort |
| `merge` | Merge Sort |
| `insertion` | Insertion Sort |
| `selection` | Selection Sort |

#### External Plugin System

EditLite supports user-developed custom plugins that can be placed in the plugins directory without repackaging the application.

**Example Plugin: Counter**

```markdown
:counter{initialValue=10, step=5, min=0, max=100}
```

For detailed development guide, see [Development Guide](./DEVELOPMENT.md).

#### Complete Example

```markdown
# Sorting Algorithm Demo

## Bubble Sort
:sort{array=[64, 34, 25, 12, 22, 11, 90], algorithm="bubble", speed=400}

## Quick Sort
:sort{array=[9, 7, 5, 11, 12, 2, 14, 3], algorithm="quick", speed=300}
```

### Interface Customization
- **Theme Switching** - Supports system theme, light theme, and dark theme modes
- **Font Selection** - Multiple monospace and CJK fonts available
- **Font Size** - Supports 12-24pt, mouse wheel zoom (Ctrl+Wheel)
- **Status Bar** - Displays file path, encoding, line/column position, zoom level

### Keyboard Shortcuts
| Shortcut | Action |
|----------|--------|
| Ctrl+N | New file |
| Ctrl+S | Save file |
| Ctrl+W | Close current tab |
| Ctrl++ | Increase font size |
| Ctrl+- | Decrease font size |
| Ctrl+Wheel | Zoom font |

## Tech Stack

- **Frontend**: React 19 + TypeScript + Vite 7
- **Backend**: Tauri 2 + Rust
- **Editor**: CodeMirror 6
- **Markdown**: react-markdown + remark-gfm
- **Visualization**: Custom algorithm animation components (lazy loaded)

## Development

### Requirements

- Node.js 18+
- Rust 1.70+
- pnpm / npm / yarn

### Install Dependencies

```bash
npm install
```

### Development Mode

```bash
npm run tauri dev
```

### Build for Release

```bash
npm run tauri build
```

The installer will be generated in `src-tauri/target/release/bundle/`.

## Project Structure

```
edit_lite/
├── src/                          # Frontend source
│   ├── App.tsx                   # Main app component
│   ├── App.css                   # Styles
│   ├── main.tsx                  # Entry point
│   ├── core/types/               # Type definitions
│   │   └── directive.ts          # Directive types
│   ├── plugins/                  # Plugin system
│   │   ├── remark-directive-custom.ts  # Directive parser plugin
│   │   └── component-registry.ts       # Component registry
│   ├── components/               # UI components
│   │   ├── PreviewEngine/        # Dual-mode preview engine
│   │   ├── ExternalPluginLoader/ # External plugin loader
│   │   └── PluginSandbox/        # Plugin sandbox
│   └── visualizers/              # Visualization components
│       └── algorithms/           # Algorithm visualizers
│           └── SortVisualizer.tsx
├── plugins/                      # External plugins directory
│   └── example-counter/          # Counter example plugin
│       ├── plugin.json           # Plugin config
│       └── index.html            # Plugin implementation
├── src-tauri/                    # Tauri backend
│   ├── src/
│   │   ├── main.rs               # Entry
│   │   └── lib.rs                # Core logic
│   ├── Cargo.toml                # Rust dependencies
│   └── tauri.conf.json           # Tauri config
├── package.json
└── README.md
```

## Supported File Types

| Extension | Description |
|-----------|-------------|
| .txt | Plain text |
| .md | Markdown |
| .js | JavaScript |
| .ts | TypeScript |
| .json | JSON |
| .html | HTML |
| .css | CSS |
| .rs | Rust |
| .py | Python |

## Roadmap

- [x] Markdown syntax support
- [x] JavaScript syntax support
- [x] JSON syntax support
- [x] Rectangular selection
- [x] Custom font settings
- [x] Find and replace
- [x] Dark theme
- [x] More syntax highlighting
- [x] Enhanced preview engine (dual mode)
- [x] Sorting algorithm visualization
- [ ] Search algorithm visualization
- [ ] Graph algorithm visualization
- [ ] LaTeX formula support
- [ ] 3D Earth visualization
- [ ] Auto save

## License

MIT License

---

## Documentation

- [Development Guide](./DEVELOPMENT.md) - Detailed usage and development guide for enhanced preview features