# HH · BIMFace Test Demo — Charles Lo's 2 Tasks

A local web page that demonstrates and evidences the two test items assigned to
Charles Lo in `HH - BIMFace Testing List_v2_progress.xlsx`.

| Test | Excel row | Section | Requirement | Pass condition |
|------|-----------|---------|-------------|----------------|
| B-46 | 46 | View Management → Event Listener | When a Room is selected, CMP shall display the information of this room | Room Mode ON → clicking a room shows all its property groups |
| A-42 | 42 | View Management → Setting Via API | Add/Change BIM/IoT Attributes | Room Mode OFF → click any object → add/edit attributes in the table → **read-back returns the same values** |

## Run it

**Live (for colleagues):** https://charles-lo-hiphing.github.io/bimface-demo/ —
open it and paste a fresh viewToken (BIMFACE console → file → 获取viewToken).
Every push to `main` redeploys automatically (GitHub Actions → Pages).

**Locally:**

```sh
cd bimface-vue
npm run dev          # -> http://localhost:5173
```

### Token (the only setup step)

The page first tries the automatic flow: `GET /api/view-token` exchanges your
`BIMFACE_APP_KEY` / `BIMFACE_APP_SECRET` (in `.env.local`) for a fresh
viewToken. If that fails, a yellow fallback box appears — paste a viewToken
from the BIMFACE console (open the file → 获取viewToken) and press
**Use this token**. Everything else works identically.

## The two demo worlds (Room Mode)

The toolbar switch **🏠 Room Mode** selects the demo world:

| | Room Mode ON | Room Mode OFF |
|---|---|---|
| Scene | **isolated: only room volumes visible** (all BIM elements hidden) | full model, no volumes |
| Room volumes | translucent (red demo room + steel-blue others), 1 m high | hidden |
| Clicks on rooms | ✔ Task B — info panel + table | ignored (nothing to click) |
| Clicks on elements | not visible / ignored | ✔ Task A — attribute table |

## Demo script (~4 minutes)

1. **Open the page.** Room Mode defaults OFF: you see the full building.
2. **TEST B-46 (~1 min):** click the red Parking Garage room → right panel
   lists the room's name and every property group → evidence card flips
   **✅ PASS**. *Screenshot here.*
3. **TEST A-42 (~2 min):** switch **Room Mode OFF** → click any wall/pipe/door
   → the attribute table opens → press **＋ Sensor Id** (or edit any existing
   value) → **💾 Save changes** → status shows `saved & verified by read-back`
   → table refreshes with the persisted values → evidence card flips
   **✅ PASS**. Save again with a different value to demonstrate **Change**.
4. **Room write probe (bonus evidence):** switch Room Mode ON → click a room →
   edit/add an attribute in the same table → Save. Whether BIMFACE accepts or
   rejects writes on room ids, the status line shows BIMFACE's own answer —
   a documentable result either way.
5. Both cards green → screenshot the whole page = the test report.

## Known trap: SDK group names ≠ data-API group names (fixed)

The SDK's `getComponentProperty` **translates** some group names for display
(`基本属性` → `"Basic Properties"`). The attribute **write** API only knows the
canonical name (`基本属性`). Write a translated name and BIMFACE does NOT edit
your attribute — it silently creates a **duplicate group**, and the original
row keeps its old value (this bug shipped and was caught live).

The fix, in three layers (`server/attributesApi.js` + `App.vue`):

1. **Read through the write-API's world**: the table fetches properties via
   `GET /api/attributes` (data API, `includeOverrides=true`) — canonical names
   *and* saved changes are visible on the next click.
2. **Group remap on write**: if a write's group name doesn't exist but its key
   already lives in exactly one existing group, the server rewrites the group
   name to the canonical one (the status line documents every remap).
3. **Verification reports duplicates**: if a key somehow ends up in two groups,
   the status line warns instead of claiming a clean pass.

### Cleanup of test writes (bonus discovery)

`DELETE /data/v2/files/{fileId}/elements/{id}/properties?view_token=…` with a
PUT-shaped body (`[{"group":"…","items":[{"key":"…"}]}]`) removes overrides:

- **added** attributes (no base value, e.g. `IoT/Sensor Id`) vanish cleanly;
- **changed** attributes: deleting leaves a *tombstone* — reads with
  `includeOverrides=true` hide the item entirely (the base value survives in
  plain reads). To restore cleanly, **re-PUT the original value** instead.

## Where everything lives (one file, one job)

| File | Job |
|------|----|
| `src/App.vue` | Conductor: token, mode routing, test results |
| `src/composables/useBimfaceViewer.js` | SDK lifecycle, events, Room Mode, room volumes (heavily commented) |
| `src/components/RoomInfoPanel.vue` | Task B read-only panel |
| `src/components/AttributeTable.vue` | Task A universal add/change table (rooms + elements) |
| `src/components/TestChecklist.vue` | Evidence board mirroring the Excel rows |
| `server/tokenApi.js` | appKey/appSecret → accessToken → viewToken |
| `server/attributesApi.js` | attribute read (GET, canonical) + batched write (PUT) + group remap + read-back proof |

## Troubleshooting

| Symptom | Cause / fix |
|---------|-------------|
| Yellow box: `authentication.failed` | appKey/appSecret rejected — re-copy from the BIMFACE developer console (click 显示 on the secret first) |
| Yellow box: `BIMFACE did not return a viewToken` | fileId wrong or file not translated — check the console file list |
| `BIMFACE SDK script did not load` | static.bimface.com unreachable from your network (CDN edge/DNS) — retry later or pin a working edge in the hosts file |
| Load error after pasting token | viewToken expired or for another file — generate a fresh one |
| Write fails, read-back empty | viewToken used for PUT must be the same token the viewer loaded with |
| Room write rejected | That IS the probe result — record BIMFACE's message as the test detail |
