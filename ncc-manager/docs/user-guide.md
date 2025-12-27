# User Guide

This guide explains how to use the NCC Manager to create, manage, and verify Nostr Community Conventions.

## Getting Started

### Launching the App
Run `npx ncc-manager` in your terminal. This will start the local server and open the UI in your default browser (usually at `http://127.0.0.1:5179`).

### Signing In
To publish events to the Nostr network, you need to sign in:
1. Click the **Sign In** button in the top right.
2. Choose your preferred method:
   - **Browser Extension (NIP-07)**: Uses extensions like Alby or Nos2x.
   - **QR Code (NIP-46)**: Scan with a compatible mobile wallet.
   - **Bunker Address**: Connect directly to a remote signing service.

## Managing Conventions (NCC)

### Creating a New NCC
1. Click the **+** button in the Explorer header or the **Create New NCC** button on the home screen.
2. Fill in the **Title** and **Content** (Markdown supported).
3. In the **Inspector** (right panel), set the **NCC Number** (e.g., `01`) and other metadata like topics, authors, and license.
4. Click **Save Draft** to persist locally or **Save & Publish** to broadcast to Nostr.

### Creating a Revision
1. Select a published NCC in the Explorer.
2. Click the **Revise** button in the Inspector.
3. A new draft is created with the version number automatically incremented and the `supersedes` tag correctly set.
4. Edit the content and publish. The app will automatically create a **Succession Record (NSR)** to link the new revision.

## Endorsements
Endorsements allow you to signal support for a convention.
1. Right-click on a published NCC in the Explorer tree.
2. Select **+ New Endorsement**.
3. Fill in your **Role** (e.g., implementer, auditor), an optional **Note**, and click **Create Endorsement**.

## Succession Records (NSR)
NSRs are used to point to the authoritative version of a convention.
1. Right-click on a published NCC.
2. Select **~ Create Succession (NSR)**.
3. Select the **Authoritative NCC** from the dropdown (this list includes revisions from you and other authors).
4. Provide a **Reason** for the succession and click **Create NSR**.

## Supporting Documents
Supporting documents (guides, FAQs) can be linked to any NCC.
1. Right-click on an NCC in the Explorer.
2. Select **[ New Supporting Doc**.
3. This creates a Kind 30053 event pre-linked to the selected NCC.

## Navigation and Search

### Explorer Tree
- **Drafts**: Local work-in-progress.
- **Published**: Events found on the network.
- **Withdrawn**: Events that have been revoked by their author.
- Use the **↑ / ↓** buttons in the Explorer header to collapse or expand all branches.

### Command Palette
Press `Ctrl + K` to open the command palette. You can quickly:
- Save current changes.
- Create new NCCs.
- Reload the application.
- Search through available commands.

### Search
The search bar at the top filters the Explorer tree by NCC identifier (`d` tag) or title.
