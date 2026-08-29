# Inkflow — Cloud sync (as shipped)

How the "Sign in with Google" backup works in `index.html` today. For the
original design rationale and the decision log, see `CLOUD_SYNC_PLAN.md`.

---

## What it does

- The app opens on a **sign-in gate**. "Continue with Google" backs every
  profile and folder up to the cloud and syncs them across devices; a small
  "use on this device without signing in" link skips it and runs the app
  purely local (exactly as it worked before cloud sync existed).
- Signed in, edits are mirrored to Cloud Firestore and remote edits stream
  back live. Clearing the browser, switching devices, or a dead disk no
  longer loses work.
- The session persists — Firebase keeps you signed in until you press
  **Sign out**. A background sign-out (expired token, revoked elsewhere)
  does *not* kick you back to the gate; it just stops sync and you keep
  working locally.

---

## Firebase project

| | |
|---|---|
| Project | `inkflow-2243a` |
| Auth | Google provider, authorized domain `myinkflow.pages.dev` |
| Database | Cloud Firestore, Native mode |
| Config | inline in the `<script type="module">` at the bottom of `index.html` (`FIREBASE_CONFIG`) — not secret; the rules below are the protection |

### Security rules

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{uid}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
  }
}
```

Each signed-in user can touch only `users/{their-uid}/**` and nothing else.

---

## Architecture

```
        browser (index.html)
        ┌───────────────────────────────────────────────┐
        │  DOM  ⇄  localStorage   (render source of truth)│
        │              │                                 │
        │      window.__inkflowBridge                    │
        │              │                                 │
        │   <script type="module"> sync layer  ──────────┼──► Firebase Auth (Google)
        │      pullAll / push / onSnapshot  ─────────────┼──► Cloud Firestore
        └───────────────────────────────────────────────┘
```

- **localStorage stays authoritative for rendering.** Nothing about
  load/paint changes when signed out.
- The IIFE (the existing ES5 app) exposes `window.__inkflowBridge`; the
  Firebase module is separate and only talks to the app through it.
- The module is inert until `FIREBASE_CONFIG` is filled in — no SDK is even
  fetched without it.

### Bridge surface (`window.__inkflowBridge`)

| method | purpose |
|---|---|
| `getProfiles` / `saveProfiles` | the `inkflow-profiles` list |
| `loadProfileRaw` / `saveProfileRaw` | a profile's `inkflow-data-{id}` blob |
| `loadFolderMtimes` / `saveFolderMtimes` | `inkflow-folder-mtimes-{id}` (folderId → epoch ms) |
| `getActiveProfileId`, `isUnlocked` | state reads |
| `reloadActiveProfile` | re-render the open profile after a merge (see guards below) |
| `renderProfileGrid`, `refreshProfilePill` | UI refresh |
| `onLocalChange(cb)` | fires from `flushSave()` when the serialized blob actually changed |
| `onProfilesChange(cb)` | fires from `saveProfiles()` |
| `unlock(persist)` / `lock()` | open the app past the gate / return to it |

---

## Data model (Firestore)

```
users/{uid}
  meta/state              { profileOrder: [profileId, …], lastProfileId, updatedAt }
  profiles/{profileId}    { name, color, createdAt, order }
  folders/{folderId}      { profileId, name, panX, panY, scale, order,
                            surfaceHTML, updatedAt, deleted }
```

- **Per-folder documents**, so one edit rewrites one small doc.
- `meta` lives at `meta/state` (a 4-segment doc path — `users/{uid}/meta`
  on its own is a *collection* reference and throws "Invalid document
  reference").
- `deleted: true` is a tombstone so deletes propagate across devices.
- Locally the app still keeps **one blob per profile**
  (`inkflow-data-{profileId}` = `{folders:[{id,name,panX,panY,scale,surfaceHTML}]}`);
  the sync layer bridges that to the per-folder docs. Folder `order` is the
  array index; profile `order` is the profiles-list index.

---

## Sync behaviour

### On sign-in (`onAuthStateChanged` → user)
1. `bridge.unlock(true)` — open the app immediately, sync continues in the
   background. Sets `inkflow-auth-hint` so later loads skip the gate flash.
2. `pullAll()`:
   - No `meta/state` doc → **first sign-in** → `migrateUp()` batches every
     local profile + folder up (400 ops/batch), then writes `meta`.
   - Otherwise merge: add cloud-only profiles locally; per folder compare
     cloud `updatedAt` vs the local `inkflow-folder-mtimes-{pid}` entry —
     newer cloud wins (or a newer tombstone deletes locally); push
     local-only folders up.
3. `startFolderListener()` — `onSnapshot(users/{uid}/folders)` for live
   cross-device updates, applying the same per-folder comparison.

### On local edit (`bridge.onLocalChange`, debounced 800 ms)
Diff every folder in the active profile against `cloudMirror` (an in-memory
record of what we believe is in Firestore); `setDoc` only the ones whose
canonical payload changed, tombstone removed ones, then update `meta`.

### Conflict rule
**Last-write-wins per folder**, `updatedAt` (epoch ms) vs local mtime.
Coarse but correct for a single-user tool.

### Image guard
Before a folder write, if `JSON.stringify(payload).length > 900_000` the
folder is kept locally but skipped for the cloud, with a toast
("…too big to back up… still saved on this device").

---

## Loop / blank-screen guards

These exist because the naive version fought itself:

- **`lastPushedAt[folderId]`** — the timestamp we last wrote for a folder.
  The listener ignores any doc whose `updatedAt` is at or under it, so a
  doubled Firestore echo (local-latency then server-confirmed) can't be
  mistaken for a remote edit.
- **`applyingRemote`** — set around `reloadActiveProfile()`; blocks
  `onLocalChange`/the listener from reacting to the DOM churn of a merge.
- **`reloadActiveProfile()` restores the view** — `loadProfileData()`
  rebuilds every board `<section>` with the template's `hidden` attribute,
  so it now re-runs `renderRoute()` afterward. If the user is mid-edit in
  the open board it defers the rebuild until `focusout` (their edit is
  already saved; the merge shows on the next navigation).
- **`hideArrowTip()`** on board teardown / leaving board view, so the
  link-arrow "Delete" tooltip can't be orphaned onto another screen.
- **`manualSignOut` flag** — only the Sign out button re-gates; a
  background `onAuthStateChanged(null)` leaves the app open.

---

## Sign-in gate

- `#auth-screen` is a `.screen` shown first. The IIFE reads
  `inkflow-auth-hint`: if set, it optimistically shows the profile picker
  for a flash-free load and the module corrects back to the gate only if
  the session turns out to be gone.
- Firebase Web SDK default persistence is `local` (IndexedDB) — the session
  survives reloads and tab restarts until an explicit `signOut`.
- The account chip (email + Sign out) lives on the profile picker.

---

## Deploy

`index.html` is a static file on Cloudflare Pages (`myinkflow.pages.dev`),
**auto-deployed on push to `master`**. No build step; the Firebase SDK
loads from `https://www.gstatic.com/firebasejs/10.13.2/` at runtime.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Toast: "Cloud sync is having trouble" | `pullAll()` threw — check console for `[inkflow-sync] initial sync failed` | see the error code below |
| `permission-denied` / "Missing or insufficient permissions" | rules not published, or still default-locked | publish the rules block |
| "Invalid document reference … odd number of segments" | a 3-segment doc path | already fixed (`meta/state`); check any new `doc()` calls have an even segment count |
| `auth/unauthorized-domain` | deploy domain not authorized | Firebase console → Auth → Settings → Authorized domains |
| `auth/operation-not-allowed` | Google provider disabled | Firebase console → Auth → Sign-in method |
| Console spam of `[inkflow-sync] applying remote folder change` | a sync loop | an echo is passing `lastPushedAt`; capture the doc's `updatedAt` vs the logged push time |
| Screen goes blank while editing | a merge rebuilt the board without restoring the view | fixed via `reloadActiveProfile()` → `renderRoute()` + mid-edit defer; console `[inkflow] route -> sign-in gate` instead means an auth-state issue |

Debug breadcrumbs in the console: `[inkflow-sync] …` from the sync module,
`[inkflow] route -> sign-in gate (locked)` when routing hits the gate.

---

## Testing checklist

- [ ] Signed out (skip link): create / edit / delete folders and boxes — identical to before.
- [ ] Sign in on browser A → profile + folders upload; verify in the Firestore console.
- [ ] Sign in on browser B (or a fresh profile) → everything appears.
- [ ] Edit a box in B → within ~1 s it lands in A (listener).
- [ ] Delete a folder in A → disappears in B (tombstone).
- [ ] Clear all site data in A → sign in again → everything returns.
- [ ] Popup-blocked path falls back to redirect and completes.
- [ ] Offline edit → reconnect → change syncs up.
- [ ] Rules: a signed-in user cannot read `users/<otherUid>/…` (Rules Playground).

---

## Phase 2 (not done)

- Move `data:` images out of `surfaceHTML` into Firebase Storage — removes
  the 900 KB guard and shrinks every folder doc.
- "Export all as JSON" / "Import" for a manual, account-independent backup.
- Show a last-synced timestamp on the account chip.
- Custom `authDomain` (needs a domain you own + a Pages Function proxying
  `/__/auth/*`; `*.pages.dev` can't be verified with Google).
