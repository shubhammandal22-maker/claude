# Inkflow — Cloud sync & Google login (implementation plan)

## Why

Today every folder/box lives only in `localStorage` for `myinkflow.pages.dev`.
Clearing browser data (or a corrupted profile, a dead disk, a different device)
loses everything — that is exactly what happened on 2026-08-29 and was only
recovered from a Windows "Previous Versions" copy of Brave's LevelDB.

Goal: an **optional** "Sign in with Google" that mirrors data to the cloud, so
losing the browser no longer loses the work. Logged out, the app keeps working
exactly as it does now.

## Decisions (locked)

| Question | Choice |
|---|---|
| Backend | **Firebase** — Auth (Google) + Cloud Firestore |
| Auth model | **Optional.** Local profiles keep working offline; signing in adds cloud backup + cross-device sync |
| Project setup | Owner creates the Firebase project from the steps below and pastes the web config into `index.html` |

---

## Architecture

```
        ┌─────────────── browser (index.html) ───────────────┐
        │  DOM  ⇄  localStorage  (unchanged, offline cache)   │
        │                 │                                   │
        │                 │  when signed in (debounced)       │
        │                 ▼                                   │
        │        Firestore sync layer  ── signInWithPopup ──► Google
        └─────────────────┼───────────────────────────────────┘
                          ▼
             Cloud Firestore:  users/{uid}/...
```

- **localStorage stays the rendering source of truth.** Nothing about load/render
  changes when logged out.
- Firestore is a **mirror**. Writes are pushed on the same trigger as
  `flushSave()`; reads happen once at sign-in and via a live listener.
- Conflict rule: **last-write-wins per folder**, compared on `updatedAt`
  (epoch ms). Coarse but correct for a single-user tool.

---

## Firestore data model

Per-folder documents (not one big blob) so each write is small and stays well
under Firestore's 1 MiB/doc limit:

```
users/{uid}
  meta                       (doc)  { profileOrder: [profileId, …], lastProfileId }
  profiles/{profileId}       (doc)  { name, color, createdAt, order }
  folders/{folderId}         (doc)  {
                                      profileId,
                                      name,
                                      panX, panY, scale,       // strings, as stored today
                                      order,                   // position in the grid
                                      surfaceHTML,             // the innerHTML of .canvas-surface
                                      updatedAt,               // Date.now() at write
                                      deleted: false           // tombstone, for cross-device deletes
                                    }
```

Why per-folder:
- Current image pipeline (`fileToCompressedDataURL`) already downscales to 680 px
  / JPEG q0.78 ≈ 30–80 KB per image. A folder would need ~15+ images to approach
  1 MiB — rare. Add a soft guard (see below).
- Editing one folder only rewrites that one doc.

### Image size guard
Before a Firestore write, if `JSON.stringify(folderDoc).length > 900_000`:
- still save locally,
- surface a non-blocking toast: *"This flow is too big to back up to the cloud
  (too many images). It's still saved on this device."*
- (Phase 2 removes this by moving `data:` images to Firebase Storage.)

---

## Security rules

```
rules_version = '2';
service cloud.firestore {
  match /databases/{db}/documents {
    match /users/{uid}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
  }
}
```

Each user can touch only their own subtree. No other access.

---

## Firebase project setup (owner does this once)

1. https://console.firebase.google.com → **Add project** → name it `inkflow`
   (disable Google Analytics unless wanted).
2. **Build → Authentication → Get started → Sign-in method → Google → Enable.**
   Set the support email. Save.
3. **Authentication → Settings → Authorized domains → Add domain:**
   `myinkflow.pages.dev` (localhost is there by default for dev).
4. **Build → Firestore Database → Create database → Production mode →**
   pick the region closest to you (e.g. `asia-south1`). Create.
5. **Firestore → Rules** → paste the rules block above → **Publish.**
6. **Project settings (gear) → General → Your apps → Web app (`</>`)** → register
   app nickname `inkflow-web` (no Hosting). Copy the `firebaseConfig` object.
7. Paste that object into `index.html` at the marked `FIREBASE_CONFIG` spot.
   (These keys are **not secrets** — they identify the project; the security
   rules above are what protect the data.)

---

## Code changes in `index.html`

All additive. One new `<script type="module">` block + small hooks into existing
functions. Existing code is `var`/IIFE ES5 — the sync layer is a separate module
that talks to it through a tiny bridge (`window.__inkflowSync`).

### 1. Load SDK + config (new module script, before `</body>` or after the IIFE)

```html
<script type="module">
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect,
         onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { getFirestore, doc, collection, getDocs, setDoc, deleteDoc,
         writeBatch, onSnapshot } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

const FIREBASE_CONFIG = { /* paste from console step 6 */ };
// … see sections below …
</script>
```

Fallback: if `signInWithPopup` throws `auth/popup-blocked` or
`auth/cancelled-popup-request`, retry with `signInWithRedirect`.

### 2. Bridge exposed from the existing IIFE

Add near the top of the IIFE, expose what the sync layer needs:

```js
window.__inkflowBridge = {
  getProfiles: loadProfiles,
  saveProfiles: saveProfiles,
  loadProfileRaw: loadProfileRaw,       // (id) -> JSON string
  saveProfileRaw: saveProfileRaw,       // (id, json)  — must also refresh UI if active
  getActiveProfileId: () => activeProfileId,
  reloadActiveProfile: () => { if (activeProfileId) loadProfileData(activeProfileId); },
  renderProfileGrid: renderProfileGrid,
  onLocalChange: (cb) => { localChangeSubscribers.push(cb); }   // called from flushSave()
};
```

- Add a `localChangeSubscribers` array and call them at the end of `flushSave()`
  with `(activeProfileId, serializeActiveProfile())`.

### 3. Sign-in UI

- Add a button to the **profile picker header** (`.profile-head`) and a small
  account chip when signed in: `Signed in as <email>  ·  Sign out`.
- Also add "Sign in to back up" hint text under `.profile-sub`.

### 4. Sync layer behaviour

**On `onAuthStateChanged(user)` → signed in:**
1. `pullAll()` — `getDocs(users/{uid}/profiles)` and `.../folders`.
2. **Merge into local:**
   - profile missing locally → add it (`saveProfiles`).
   - folder: compare cloud `updatedAt` vs local. Build the local folder's
     `updatedAt` from a new `localStorage` key `inkflow-folder-mtimes-{profileId}`
     (map folderId → ms), written whenever `flushSave()` runs.
   - cloud newer → replace local folder's entry in that profile's blob.
   - cloud `deleted:true` and newer → remove locally.
   - local-only folder (no cloud doc) → `pushFolder()` it up.
3. If the active profile changed, `bridge.reloadActiveProfile()`.
4. Start `onSnapshot(users/{uid}/folders)` for live cross-device updates
   (apply same merge, skip docs we just wrote — track by a `pendingWrites` set).

**On local change (`bridge.onLocalChange`)** — debounce 800 ms, then for the
active profile diff folder-by-folder against last-pushed snapshot and
`setDoc()` only the changed ones (`updatedAt: Date.now()`), `deleteDoc()`/tombstone
removed ones, and update `meta`.

**On sign out:** stop the listener. Local data stays untouched — app is back to
pure offline mode.

### 5. First-sign-in migration

If `users/{uid}/meta` doesn't exist: this is a new cloud account → upload every
local profile and every folder as-is (`writeBatch`, chunked at 400 ops). Then
write `meta`. This is how the just-recovered `SHUBHAM` profile gets pushed up.

---

## Edge cases to handle

- **Two profiles, same person**: profiles are per-`uid`; all local profiles map
  into the one signed-in account's `profiles` collection. Keep local `profileId`
  as the Firestore doc id so they line up.
- **Popup blocked** → redirect fallback (section 1).
- **Offline / Firestore unreachable**: all writes are already local-first; queue
  is just "diff again next time". Firestore SDK also retries automatically.
- **Big image folder** → soft guard, section "Image size guard".
- **Signed in on a fresh browser** → `pullAll()` seeds everything; the boot flow
  still shows the profile picker first (unchanged).
- **Clearing browser data while signed in** → next sign-in re-pulls. This is the
  whole point.

---

## Testing checklist

- [ ] Logged out: create/edit/delete folders and boxes — identical to today.
- [ ] Sign in on browser A → `SHUBHAM` + 12 folders upload; verify in console.
- [ ] Sign in on browser B (or a fresh profile) → all 12 folders appear.
- [ ] Edit a box in B → within ~1 s the change lands in A (listener).
- [ ] Delete a folder in A → disappears in B (tombstone).
- [ ] Clear all site data in A → sign in again → everything returns.
- [ ] Popup-blocked path falls back to redirect and still completes.
- [ ] Offline edit → reconnect → change syncs up.
- [ ] Firestore rules: signed-in user cannot read `users/<otherUid>/…`
      (test in Rules Playground).

---

## Rollout

1. Ship the sync layer **dormant** (no `FIREBASE_CONFIG`) — zero behaviour change.
2. Owner completes Firebase setup, pastes config, deploys.
3. Sign in once to migrate the recovered data up.
4. Verify cross-device, then rely on it.

## Phase 2 (later, optional)

- Move `data:` images out of `surfaceHTML` into **Firebase Storage**
  (`users/{uid}/img/{hash}.jpg`), store URLs in the HTML. Removes the 1 MiB
  guard and shrinks every folder doc.
- "Export all as JSON" / "Import" buttons as a belt-and-braces manual backup,
  independent of any account.
- Show last-synced timestamp in the account chip.

---

## Files

- `index.html` — all changes land here (single-file app).
- `wrangler.jsonc` — unchanged (still a static Pages deploy).
- No build step, no new dependencies beyond the Firebase CDN modules.

---

## Implementation status (2026-08-29)

The sync layer is **built and shipped dormant** in `index.html`.

**What landed:**
- IIFE now exposes `window.__inkflowBridge` (profiles + per-profile blob
  accessors, `getActiveProfileId`, `reloadActiveProfile`, `renderProfileGrid`,
  folder-mtime accessors, `onLocalChange`, `onProfilesChange`).
- `flushSave()` maintains `inkflow-folder-mtimes-{profileId}` (folderId → epoch
  ms, per-folder + tombstones) and fires the local-change subscribers only when
  the serialized blob actually changed.
- New `<script type="module">` at the end of the file: Google auth (popup →
  redirect fallback + `getRedirectResult`), `pullAll()` merge, first-sign-in
  `migrateUp()` (batched at 400 ops), debounced folder push diffed against an
  in-memory `cloudMirror`, `onSnapshot` folder listener with a `pendingWrites`
  echo-guard and an `applyingRemote` re-entrancy guard, profile upsert/delete
  sync, the 900 KB image soft-guard toast, and the sign-in UI in `.profile-head`
  (`#cloud-auth`, hidden until a config is present).

**Data-model note / deviation from the draft above:** locally the app still
stores **one JSON blob per profile** (`inkflow-data-{profileId}` =
`{folders:[{id,name,panX,panY,scale,surfaceHTML}]}`), not per-folder local
records — that was left untouched to keep load/render identical. The sync layer
bridges between that blob and the per-folder Firestore docs in the plan; folder
`order` is the array index, profile `order` is the profiles-array index.

**Update (live):** `FIREBASE_CONFIG` is filled in (project `inkflow-2243a`) and
the feature is live. The app now opens on a **sign-in gate** (`#auth-screen`):
"Continue with Google" or a small "use without signing in" link. A successful
sign-in sets `inkflow-auth-hint` in localStorage so subsequent loads skip
straight to the profile picker (Firebase's own `local` persistence keeps the
session until manual sign-out). The account chip + Sign out live on the profile
picker.

**Not yet done:** the Testing checklist above (needs a live Firebase project).
