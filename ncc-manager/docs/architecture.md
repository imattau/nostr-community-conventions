# Architecture Overview

The NCC Manager is a full-stack web application designed to manage Nostr Community Conventions (NCC) and related events. It consists of a decoupled frontend and backend, with the backend serving primarily as a local storage and coordination layer.

## Component Diagram

```text
+-------------------+       REST API       +-----------------------+
|                   | <------------------> |                       |
|  Frontend (Lit)   |                      |  Backend (Express)    |
|                   | <------------------+ |                       |
+---------+---------+                      +-----------+-----------+
          |                                            |
          | Nostr Protocol                             | SQLite
          v                                            v
+-------------------+                      +-----------------------+
|                   |                      |                       |
|  Nostr Network    |                      |  ncc_manager.sqlite   |
|  (Relays)         |                      |                       |
+-------------------+                      +-----------------------+
```

## Frontend

The frontend is built using **Lit** for web components and **Vite** for the build pipeline.

- **State Management**: Uses a custom `stateManager` and `eventBus` to coordinate data between the Explorer, Editor, and Inspector panels.
- **Nostr Integration**: Uses a Nostrify relay adapter for bounded, cancellable queries, resilient relay connections, and publishing. It supports both NIP-07 (browser extensions) and NIP-46 (Nostr Connect) signing.
- **Validation Worker**: A dedicated Web Worker (`validationWorker.js`) handles complex chain validation logic for NCC revisions to keep the UI thread responsive.
- **Storage fallback**: Uses `localStorage` and `IndexedDB` as fallbacks if the server-side storage is unavailable.

## Backend

The backend is a lightweight **Express.js** server.

- **Draft Storage**: Persists local drafts to an **SQLite** database. This allows users to work on conventions without publishing them immediately to the network.
- **Configuration**: Stores user preferences and default relay lists.
- **Static Asset Serving**: Serves the compiled frontend from the `dist/` directory.

The Vite output can also be hosted as a static NIP-5A site. In that mode the UI uses IndexedDB for local drafts and configuration, and relay defaults fall back to the bundled list; no Express API is required.

## Data Flow

1. **Drafting**: User creates a new NCC or revision. Drafts use the local REST API and SQLite when available, with browser IndexedDB as the standalone/offline fallback.
2. **Validation**: The validation worker analyzes the known history of the NCC (from local drafts and relay data) to identify forks, authoritative revisions, and potential errors.
3. **Publishing**: When the user clicks "Publish", the event is signed by the user's Nostr key and broadcast to the configured relays.
4. **Synchronization**: The app periodically polls relays for new events related to the tracked NCCs, updating the local view and validation state.
