<script setup>
// =============================================================================
// App.vue — the CONDUCTOR (deliberately thin)
// -----------------------------------------------------------------------------
// Every heavy job lives somewhere else, each in ONE easy-to-read file:
//   • SDK lifecycle, events, ROOM MODE -> composables/useBimfaceViewer.js
//   • Task B read-only panel           -> components/RoomInfoPanel.vue
//   • Task A universal attribute table -> components/AttributeTable.vue
//   • Evidence board                   -> components/TestChecklist.vue
//   • Token backend                    -> server/tokenApi.js
//   • Attribute write backend          -> server/attributesApi.js
//
// App.vue's only jobs: (1) obtain a viewToken, (2) route clicks BY MODE,
// (3) record test results. That's it.
//
// ROOM MODE (Feature 1) — the two demo worlds are deliberately disjoint:
//   ON  -> clicks on rooms are Task B; element clicks are IGNORED.
//   OFF -> clicks on elements feed Task A's table; no room volumes exist.
// =============================================================================
import { onMounted, ref } from 'vue'
import { useBimfaceViewer } from './composables/useBimfaceViewer.js'
import RoomInfoPanel from './components/RoomInfoPanel.vue'
import AttributeTable from './components/AttributeTable.vue'
import TestChecklist from './components/TestChecklist.vue'
import { fetchProperties as fetchBimfaceProperties } from './lib/bimfaceData.js'

// ---------------------------------------------------------------------------
// 1) TOKEN STRATEGY — automatic first, manual fallback for demo day.
// ---------------------------------------------------------------------------
const activeViewToken = ref('') // the token actually handed to the SDK
const tokenError = ref('')      // why the automatic path failed, if it did
const manualToken = ref('')     // the paste-a-token input box
const modelFileId = ref('')     // fileId from the auto flow; rooms need it for writes

// The demo model's id. Not a secret — without a viewToken the file is
// unreachable. Committed in .env so the STATIC site (GitHub Pages) knows it
// too, with a hardcoded fallback so the page never breaks.
const DEFAULT_FILE_ID = import.meta.env.VITE_BIMFACE_FILE_ID || '10001052768212'
const manualFileId = ref(DEFAULT_FILE_ID) // editable next to the token box

// ---------------------------------------------------------------------------
// 2) SELECTION STATE — one unified object for whatever was clicked.
//    { type:'room'|'element', id, fileId, name, properties:[...] }
//    Rooms seed the table too (write-probe), so both panels read from this.
// ---------------------------------------------------------------------------
const selection = ref(null)

// Task B also keeps the read-only display panel alive:
const selectedRoom = ref(null)

// ---------------------------------------------------------------------------
// 3) TEST RESULTS — single source of truth for the evidence board.
// ---------------------------------------------------------------------------
const taskA = ref({ status: 'pending', evidence: '' })
const taskB = ref({ status: 'pending', evidence: '' })

// ---------------------------------------------------------------------------
// The viewer, borrowed from the composable. All BIMFACE knowledge lives there.
// ---------------------------------------------------------------------------
const { domRef, loadError, modelReady, roomById, roomMode, setRoomMode, load, fetchRoomProperty, fetchComponentProperty } =
  useBimfaceViewer()

onMounted(async () => {
  // Default the fileId immediately: rooms carry no fileId in click data, and
  // on a STATIC host (no dev middleware) this default is the only source.
  modelFileId.value = DEFAULT_FILE_ID
  try {
    // --- Automatic path: ask OUR dev server for a token (needs the secrets
    //     in .env.local — which is why this only works locally). On a static
    //     host the URL returns the 404 HTML page, not JSON — detect that and
    //     fall through to the manual paste box with a friendly message.
    const response = await fetch('/api/view-token')
    const text = await response.text()
    let result = null
    try {
      result = JSON.parse(text)
    } catch {
      result = null // not JSON -> no middleware here (static site)
    }
    if (!result) {
      throw new Error('no token server on this host — paste a viewToken below (dev: fix BIMFACE_APP_KEY/SECRET in .env.local)')
    }
    if (!response.ok || !result.viewToken) {
      throw new Error(result.message || 'view token request failed')
    }
    modelFileId.value = result.fileId || DEFAULT_FILE_ID
    startViewer(result.viewToken)
  } catch (error) {
    tokenError.value = String(error.message || error)
  }
})

function startViewer(token) {
  activeViewToken.value = token
  tokenError.value = ''
  load(token, { onReady: () => {}, onClick: routeClick })
}

function useManualToken() {
  const token = manualToken.value.trim()
  // The user may also correct the fileId here (defaults to the demo model).
  if (manualFileId.value.trim()) modelFileId.value = manualFileId.value.trim()
  if (token) startViewer(token)
}

// ---------------------------------------------------------------------------
// ROOM MODE toggle (Feature 1). Toggling also clears the selection so panels
// can never show data from the "other" world.
// ---------------------------------------------------------------------------
function toggleRoomMode() {
  setRoomMode(!roomMode.value)
  selection.value = null
  selectedRoom.value = null
}

// ---------------------------------------------------------------------------
// 4) CLICK ROUTER — one click, meaning decided BY MODE:
//      roomMode ON  -> only clicks on room volumes count (Task B path)
//      roomMode OFF -> only clicks on real elements count (Task A path)
//    This single function is what makes "non-room objects not clickable in
//    room mode" true — one obvious, explainable rule in one obvious place.
// ---------------------------------------------------------------------------
function routeClick(clickData) {
  if (roomMode.value) {
    // ---- TASK B-46 path ----------------------------------------------------
    if (clickData.objectType !== 'Room') return // elements ignored in room mode

    const realRoom = roomById[clickData.elementId] // viewer id -> real room
    if (!realRoom) return

    fetchRoomProperty(realRoom.id, function (room) {
      // GUARANTEED name: roomInfo.name came straight from getAreas(), whereas
      // the shape of getRoomProperty's answer is less predictable — merge the
      // sure thing in so headers/evidence can never show "undefined".
      selectedRoom.value = { ...room, name: realRoom.name }
      // Unified selection ALSO feeds the attribute table (rooms = write probe).
      selection.value = {
        type: 'room',
        id: realRoom.id,
        fileId: modelFileId.value, // rooms carry no fileId in click data
        name: realRoom.name,
        properties: room.properties
      }
      taskB.value = {
        status: 'pass',
        evidence: `"${realRoom.name}" — displayed ${room.properties.length} property groups`
      }
    })
  } else {
    // ---- TASK A-42 path ----------------------------------------------------
    if (!clickData.elementId || clickData.objectType === 'Room') return

    // Card appears immediately; name + properties arrive a moment later.
    selection.value = {
      type: 'element',
      id: clickData.elementId,
      fileId: clickData.fileId,
      name: '',
      properties: []
    }
    fetchElementProperties(clickData.elementId, clickData.fileId)
  }
}

// ---------------------------------------------------------------------------
// Fetch an element's properties the RIGHT way: directly from BIMFACE's data
// API (src/lib/bimfaceData.js — CORS is open, verified live). Why not the
// SDK's getComponentProperty? The SDK TRANSLATES group names for display
// (基本属性 -> "Basic Properties"), and a write addressed to a translated
// name creates a duplicate group instead of editing the real attribute (a
// real bug this demo survived). Reading through the write-API's world means
// names always match — and includeOverrides=true means saved changes are
// visible on the NEXT click.
// ---------------------------------------------------------------------------
function fetchElementProperties(elementId, fileId) {
  fetchBimfaceProperties({
    fileId: String(fileId || modelFileId.value || DEFAULT_FILE_ID),
    elementId: String(elementId),
    viewToken: activeViewToken.value
  })
    .then((result) => {
      // Guard: the user may have clicked something else while we waited.
      if (!selection.value || selection.value.id !== elementId) return
      if (result.ok && result.properties) {
        selection.value = {
          ...selection.value,
          name: result.name || selection.value.name,
          properties: result.properties
        }
      } else {
        // Fallback: SDK data (possibly translated names — saveAttributes'
        // group remap still protects the next write). BIMFACE's message is
        // shown so the failure is never silent.
        seedFromSdk(elementId, result.message)
      }
    })
    .catch(() => seedFromSdk(elementId, 'BIMFACE data API unreachable'))
}

function seedFromSdk(elementId, warning) {
  fetchComponentProperty(elementId, function (property) {
    if (!selection.value || selection.value.id !== elementId) return
    selection.value = {
      ...selection.value,
      name: property.name || selection.value.name,
      properties: property.properties || [],
      warning: warning || ''
    }
  })
}

// AttributeTable emits 'saved' -> record the outcome on the evidence board,
// then refresh BOTH panels from the server's read-back. One update from one
// source of truth — the table's watch rebuilds its rows, the room panel (if
// a room is selected) re-renders. No second rebuild path, no races.
function onTableSaved(result) {
  taskA.value = {
    status: result.ok ? 'pass' : 'fail',
    evidence: result.evidence
  }
  if (result.ok && result.properties && selection.value) {
    selection.value = {
      ...selection.value,
      name: result.name || selection.value.name,
      properties: result.properties
    }
    if (selection.value.type === 'room' && selectedRoom.value) {
      selectedRoom.value = { ...selectedRoom.value, properties: result.properties }
    }
  }
}
</script>

<template>
  <div style="max-width: 1280px; margin: 0 auto; padding: 8px">
    <h1 style="font-size: 18px">HH · BIMFace Test Demo — Charles Lo</h1>

    <div style="display: flex; align-items: flex-start; gap: 16px">
      <!-- The 3D canvas mounts into this div (domRef from the composable). -->
      <div ref="domRef" style="width: 760px; height: 560px; flex: 0 0 760px; border: 1px solid #ddd"></div>

      <div style="flex: 1 1 auto; min-width: 340px">
        <!-- FEATURE 1: the mode switch. One checkbox rules the whole demo. -->
        <div class="toolbar">
          <label>
            <input type="checkbox" :checked="roomMode" @change="toggleRoomMode" />
            <b>🏠 Room Mode</b>
          </label>
          <span class="hint">
            {{ roomMode ? 'ON — only rooms visible · click one to inspect · Task B-46' : 'OFF — full model · click any element to edit attributes · Task A-42' }}
          </span>
        </div>

        <!-- Evidence board: updates live as the two tests pass. -->
        <TestChecklist :task-a="taskA" :task-b="taskB" />

        <!-- Manual token fallback (RECOVERY TOO): visible when there is no
             active token OR when loading failed — otherwise a failed token
             would strand the user with no way to paste another one. -->
        <div v-if="!activeViewToken || loadError" class="token-box">
          <h3 style="font-size: 13px; color: #92400e">⚠ Token needed / retry</h3>
          <p v-if="tokenError" style="font-size: 12px; color: #dc2626">{{ tokenError }}</p>
          <p style="font-size: 12px">
            Paste a viewToken from the BIMFACE console (file → 获取viewToken):
          </p>
          <input v-model="manualToken" placeholder="paste viewToken here" style="width: 100%" />
          <!-- fileId rides along: rooms carry no fileId in click data, and on
               a static site (GitHub Pages) there is no .env.local to read. -->
          <input
            v-model="manualFileId"
            placeholder="fileId (defaults to the demo model)"
            style="width: 100%; margin-top: 4px"
          />
          <button type="button" style="margin-top: 4px" @click="useManualToken">Use this token</button>
        </div>

        <!-- Loading feedback: the engine download can take 30s+ — never let
             the UI go silent between "Use this token" and the model appearing. -->
        <p v-if="activeViewToken && !modelReady && !loadError" style="font-size: 13px; color: #2563eb">
          ⏳ downloading BIMFACE engine & streaming model…
        </p>

        <!-- SDK-level failure (bad/expired token, unreachable SDK CDN). -->
        <p v-if="loadError" style="color: red; font-size: 13px">Load error: {{ loadError }}</p>

        <!-- TASK B panel: read-only room information (room mode only). -->
        <RoomInfoPanel :room="selectedRoom" />

        <!-- TASK A panel: universal add/change table for rooms AND elements. -->
        <AttributeTable
          v-if="selection"
          :selection="selection"
          :view-token="activeViewToken"
          @saved="onTableSaved"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  border: 1px solid #bfdbfe;
  background: #eff6ff;
  border-radius: 8px;
  padding: 6px 12px;
  margin-bottom: 12px;
}
.hint { font-size: 12px; color: #1d4ed8; }
.token-box {
  border: 1px solid #f59e0b;
  background: #fffbeb;
  border-radius: 8px;
  padding: 8px 12px;
  margin-bottom: 12px;
}
</style>
