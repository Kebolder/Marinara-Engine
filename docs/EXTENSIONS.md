# Extension Packages

Marinara Engine extensions are add-ons for changing how the client looks and behaves. An extension can include JavaScript or other code that runs in the Marinara page, observes or edits the DOM, adds controls, registers hotkeys, calls allowed Marinara API routes, and cleans itself up when disabled. This is intentionally close to the SillyTavern extension model: folders can contain a manifest plus code and supporting files, and Marinara imports the whole package instead of only a single style snippet.

Extensions are imported from **Settings -> Extensions** as a `.json`, `.css`, `.js`, `.zip`, or a folder. Only install extensions from people you trust. Extension JavaScript runs in the Marinara Engine page with the same browser privileges as the app UI, so it can affect your local session and call non-sensitive app APIs. It is not executed by the server, and it does not directly patch Marinara's source code on disk.

## Quick Example

Copy the example package in [`docs/examples/extensions/minimal`](examples/extensions/minimal):

```text
minimal/
  manifest.json
  extension.css
  extension.js
```

The manifest uses file paths that are resolved relative to the folder containing `manifest.json`:

```json
{
  "kind": "marinara.extension",
  "version": 1,
  "config": {
    "name": "Example Accent Glow",
    "description": "Example extension package for Marinara Engine.",
    "enabled": true,
    "cssPath": "extension.css",
    "jsPath": "extension.js"
  }
}
```

## Single Extension Folder

A single extension folder should include a `manifest.json` file. Optional CSS and JavaScript can live in separate files:

```text
My Extension/
  manifest.json
  extension.css
  extension.js
```

Use `cssPath` and `jsPath` for anything non-trivial:

```json
{
  "kind": "marinara.extension",
  "version": 1,
  "config": {
    "name": "My Extension",
    "description": "Adds custom UI behavior and styling.",
    "enabled": true,
    "cssPath": "extension.css",
    "jsPath": "extension.js"
  }
}
```

Inline content is also accepted:

```json
{
  "kind": "marinara.extension",
  "version": 1,
  "config": {
    "name": "Inline Example",
    "description": "Small inline extension.",
    "enabled": true,
    "css": ".my-class { color: var(--primary); }",
    "js": "window.dispatchEvent(new CustomEvent('marinara-extension-ready'));"
  }
}
```

If both file paths and inline content are present, Marinara Engine uses the file contents.

## What JavaScript Extensions Can Do

Extension JavaScript is wrapped and executed as a browser module. The wrapper passes a `marinara` helper object into your code:

```js
marinara.addStyle(`
  .my-extension-button {
    border-color: var(--primary);
  }
`);

const button = marinara.addElement(document.body, "button", {
  class: "my-extension-button",
  textContent: "Extension action",
});

if (button) {
  marinara.on(button, "click", () => {
    window.dispatchEvent(new CustomEvent("my-extension-action"));
  });
}
```

Available helpers:

| Helper | Description |
| --- | --- |
| `marinara.extensionId` | Installed extension ID. |
| `marinara.extensionName` | Installed extension name. |
| `marinara.addStyle(css)` | Inject CSS and automatically remove it when the extension unloads. |
| `marinara.addElement(parent, tag, attrs)` | Append a DOM element and automatically remove it when the extension unloads. |
| `marinara.apiFetch(path, options)` | Fetch from `/api/...` for non-sensitive app routes. Extension-management and admin routes are denied. |
| `marinara.on(target, event, handler)` | Add an event listener with automatic cleanup. |
| `marinara.setInterval(fn, ms)` | Start an interval with automatic cleanup. |
| `marinara.setTimeout(fn, ms)` | Start a timeout with automatic cleanup. |
| `marinara.observe(target, callback, options)` | Create a `MutationObserver` with automatic cleanup. |
| `marinara.onCleanup(fn)` | Register custom cleanup logic for anything you create yourself. |

Plain browser APIs are also available. For shared packages, prefer the `marinara` helpers where possible so disabling or updating the extension cleans up its DOM, timers, listeners, and observers.

## Multi-Extension Folder

For a package containing multiple extensions, add a root `marinara-extensions.json` file. The importer also accepts `marinara-extension.json`.

```text
My Extension Pack/
  marinara-extensions.json
  Extensions/
    Accent Glow/
      manifest.json
      extension.css
    Hotkeys/
      manifest.json
      extension.js
```

The root package file should list each extension entry with its manifest:

```json
{
  "kind": "marinara.extension-folder",
  "version": 1,
  "exportedAt": "2026-06-23T00:00:00.000Z",
  "folderName": "Extensions",
  "extensions": [
    {
      "path": "Extensions/Accent Glow/manifest.json",
      "manifest": {
        "kind": "marinara.extension",
        "version": 1,
        "config": {
          "name": "Accent Glow",
          "description": "Adds a small accent glow.",
          "enabled": true,
          "cssPath": "extension.css"
        }
      }
    },
    {
      "path": "Extensions/Hotkeys/manifest.json",
      "manifest": {
        "kind": "marinara.extension",
        "version": 1,
        "config": {
          "name": "Hotkeys",
          "description": "Adds custom browser-side hotkeys.",
          "enabled": true,
          "jsPath": "extension.js"
        }
      }
    }
  ]
}
```

If there is no root package file, folder import scans for every `manifest.json` it can find.

## Manifest Fields

| Field | Required | Description |
| --- | --- | --- |
| `kind` | Yes | Use `marinara.extension` for a single extension manifest. |
| `version` | Yes | Use `1`. |
| `config.name` | Yes | Display name, 1-200 characters. |
| `config.description` | No | Description, up to 2000 characters. |
| `config.enabled` | No | Whether the extension is enabled after import. Defaults to `true`. |
| `config.cssPath` | No | Path or array of paths to CSS files, relative to the manifest folder. |
| `config.jsPath` | No | Path or array of paths to JS files, relative to the manifest folder. |
| `config.css` | No | Inline CSS. Maximum 256 KiB after UTF-8 encoding. |
| `config.js` | No | Inline JavaScript. Maximum 1 MiB after UTF-8 encoding. |

## Import Notes

- Folder import reads `.json`, `.js`, `.mjs`, `.cjs`, `.css`, `.md`, `.txt`, `.ts`, and `.tsx` text files.
- `cssPath` and `jsPath` can point to one file or an array of files. Multiple files are joined in listed order.
- Paths are resolved relative to the manifest first, then against the package root.
- A folder with only loose `.css` or `.js` files and no manifest can still import as one extension named after the folder, but manifests are recommended for shared packages and SillyTavern-style extension folders.
- CSS is injected as a style block when the extension is enabled.
- JavaScript is loaded by the browser client when the extension is enabled. It can change client behavior at runtime, but it is not run by the server.
- TypeScript files can be included in imported folders as package text, but Marinara does not compile TypeScript for extension execution. Point `jsPath` at JavaScript that the browser can run.
