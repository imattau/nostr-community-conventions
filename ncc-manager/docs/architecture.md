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
- **Nostr Integration**: Uses `nostr-tools` to interact with relays. It supports both NIP-07 (browser extensions) and NIP-46 (Nostr Connect) for signing.
- **Validation Worker**: A dedicated Web Worker (`validationWorker.js`) handles complex chain validation logic for NCC revisions to keep the UI thread responsive.
- **Storage fallback**: Uses `localStorage` and `IndexedDB` as fallbacks if the server-side storage is unavailable.

## Backend

The backend is a lightweight **Express.js** server.

- **Draft Storage**: Persists local drafts to an **SQLite** database. This allows users to work on conventions without publishing them immediately to the network.
- **Configuration**: Stores user preferences and default relay lists.
- **Static Asset Serving**: Serves the compiled frontend from the `dist/` directory.

## Data Flow

1. **Drafting**: User creates a new NCC or revision. This is saved via the REST API to the local SQLite database.
2. **Validation**: The validation worker analyzes the known history of the NCC (from local drafts and relay data) to identify forks, authoritative revisions, and potential errors.
3. **Publishing**: When the user clicks "Publish", the event is signed by the user's Nostr key and broadcast to the configured relays.
4. **Synchronization**: The app periodically polls relays for new events related to the tracked NCCs, updating the local view and validation state.
