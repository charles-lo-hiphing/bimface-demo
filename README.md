# HH · BIMFace Test Demo

A small Vue 3 + Vite page that demonstrates and evidences two test items from
the HH BIMFace testing list, live against a real BIMFACE model:

- **TEST B-46** — Room Mode: isolate the model to room volumes; clicking a
  room displays all of its property groups.
- **TEST A-42** — Add/Change BIM/IoT Attributes: click any BIM element, edit
  or add attributes, save, and the read-back from BIMFACE returns the same
  values (verified proof, not a hopeful status line).

## Live demo

**https://charles-lo-hiphing.github.io/bimface-demo/**

Open the page and paste a fresh **viewToken** (BIMFACE console → open the file
→ 获取viewToken). Tokens expire, so generate one when you present. No other
setup: the page talks to BIMFACE's data API directly from the browser.

## Run locally

```sh
cd bimface-vue
npm install
npm run dev        # -> http://localhost:5173
```

Optional (removes the manual token paste during development): put your
`BIMFACE_APP_KEY` / `BIMFACE_APP_SECRET` in `bimface-vue/.env.local`
(git-ignored). The dev server then exchanges them for a viewToken
automatically via `server/tokenApi.js`.

## How it fits together (one file, one job)

| File | Job |
|------|----|
| `bimface-vue/src/App.vue` | Conductor: token, mode routing, test results |
| `bimface-vue/src/composables/useBimfaceViewer.js` | SDK lifecycle, events, Room Mode, room volumes |
| `bimface-vue/src/lib/bimfaceData.js` | Direct browser → BIMFACE data API (read + write + group remap) |
| `bimface-vue/src/components/AttributeTable.vue` | Task A universal add/change table (elements + room probe) |
| `bimface-vue/src/components/RoomInfoPanel.vue` | Task B read-only room panel |
| `bimface-vue/src/components/TestChecklist.vue` | Evidence board mirroring the Excel rows |
| `bimface-vue/server/tokenApi.js` | dev-only: appKey/appSecret → accessToken → viewToken |
| `bimface-vue/server/attributesApi.js` | reference implementation of the write proxy (superseded by the lib) |

See `bimface-vue/DEMO.md` for the demo script, the design notes, and the
war stories (SDK group-name translation, override tombstones, CDN flakiness).

## Deploy

Pushing to `main` triggers `.github/workflows/deploy.yml` (build + GitHub
Pages). Nothing secret is published: `.env.local` is git-ignored, and the
live page uses manually pasted, short-lived viewTokens.
