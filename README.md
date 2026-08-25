# WNP-ARAG Frontend — Minimal Functional Prototype

This folder is a static frontend designed to behave like a GitHub Pages site.
The Hugging Face Space remains the backend.

## Run locally

From this folder:

```bash
python -m http.server 8000
```

Then open:

```text
http://localhost:8000/regulation_explorer.html
```

Do not open the HTML file directly with `file://`, because the browser may block
module imports and JSON loading.

## Backend

The backend Space is configured in:

```text
assets/js/config.js
```

Current Space:

```text
starfriend/WNP-ARAG
```

Expected public endpoints:

```text
/run_rag_agent
/clear_interface
/check_system_status
```

## Current functionality

- Custom question input
- 344 sample questions loaded from JSON
- Sample-question search and pagination
- `top_k` and `max_loops` controls
- Calls the Hugging Face Gradio backend
- Renders answer, search journey, sources, and diagnostics
- Backend readiness indicator
- Local clear behavior


## Fixes in this revision

- Added a global `[hidden]` CSS rule so empty, loading, results, and error
  states cannot appear simultaneously.
- Explicitly hides every state before showing the current state.
- Supporting sources are parsed into separate cards.
- Local file paths are no longer displayed.
- Long excerpts are collapsed with a Show full excerpt control.
- Search Journey is collapsed by default.
- Removed the Show more questions mechanism; the list now uses one scrollbar.


## Backend warm-up behavior

- The Ask button is disabled until the Hugging Face Space is reachable.
- The frontend retries every 15 seconds for up to 10 minutes.
- Startup elapsed time and the expected 5–10 minute wake-up period are shown.
- The first question may still take several minutes because the current backend
  loads the model lazily inside `/run_rag_agent`.
- During that first request, the Ask button and controls remain locked.
- After the first successful response, the badge changes to `Model ready`.

A dedicated backend preload endpoint would be required to load the model before
the first question is submitted.
