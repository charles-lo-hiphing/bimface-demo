// =============================================================================
// useBimfaceViewer.js — the BIMFACE SDK lifecycle wrapped as a Vue composable
// -----------------------------------------------------------------------------
// WHAT IS A "COMPOSABLE"? A function that packages reactive state + logic so
// any component can reuse it. We keep ALL BIMFACE SDK knowledge in this one
// file, so App.vue stays small and readable.
//
// THE SDK LIFECYCLE (the 4 steps that happen in every BIMFACE app):
//   STEP 1  BimfaceSDKLoader.load(...)     download the 3D engine from BIMFACE
//   STEP 2  new WebApplication3D(config)   create the 3D application shell
//   STEP 3  app.addView(viewToken)         stream YOUR model into the shell
//   STEP 4  ViewAdded event                model ready -> NOW we may query it
//
// GOLDEN RULE: never call getModel()/getAreas()/getRoomManager() before the
// ViewAdded event fires — the model does not exist yet and calls will fail.
// =============================================================================
import { ref } from 'vue'

export function useBimfaceViewer() {
  // ---------------------------------------------------------------------------
  // Reactive state — only what the UI displays. Vue re-renders when these change.
  // ---------------------------------------------------------------------------
  const domRef = ref(null)   // template ref: the <div> the 3D canvas mounts into
  const loadError = ref('')  // any failure message, shown in red in App.vue
  const modelReady = ref(false) // flips true on ViewAdded — drives the "loading…" line

  // ---------------------------------------------------------------------------
  // Non-reactive SDK handles. The template never renders these, so making them
  // reactive would be pure overhead. Rule: reactive ONLY what the UI needs.
  // ---------------------------------------------------------------------------
  let app = null
  let viewer3D = null

  // Maps "viewer room id" (what clicks return) -> real room info from the model.
  // Filled in prepareRooms() below. Plain object: not displayed, so not reactive.
  const roomById = {}

  // ---------------------------------------------------------------------------
  // ROOM MODE (Feature 1). One toggle, two disjoint demo worlds:
  //   ON  -> room volumes visible;  Task B world (click rooms).
  //   OFF -> volumes hidden;         Task A world (click elements).
  //
  // IMPLEMENTATION FACT (verified live against SDK 3.6.352): RoomManager has
  // hideAllRooms()/showAllRooms() — a pure visibility toggle. Far simpler and
  // safer than destroying/rebuilding Room objects.
  // ---------------------------------------------------------------------------
  const roomMode = ref(false) // default OFF: open with the full model; the
                              // user switches ON deliberately to isolate rooms

  function setRoomMode(on) {
    roomMode.value = on
    if (!viewer3D) return // model not loaded yet: mode applies on ViewAdded
    try {
      const manager = viewer3D.getRoomManager()
      if (on) {
        manager.showAllRooms()          // our room volumes return…
        viewer3D.hideAllComponents()    // …and every BIM element hides: TRUE
        viewer3D.render()               // isolation — "only show rooms"
      } else {
        manager.hideAllRooms()          // volumes vanish…
        viewer3D.showAllComponents()    // …and the full model returns: normal
        viewer3D.render()               // viewing mode for Task A element clicks
      }
    } catch (error) {
      loadError.value = `room mode toggle failed: ${String((error && error.message) || error)}`
    }
  }

  // ---------------------------------------------------------------------------
  // load(viewToken, { onReady, onClick })
  // Kicks off the 4-step lifecycle. onReady fires once the model is queryable;
  // onClick fires on every left-click with data about what was hit.
  // ---------------------------------------------------------------------------
  function load(viewToken, { onReady, onClick } = {}) {
    // GUARD 0 — fail LOUDLY if the SDK engine script never arrived.
    // index.html loads BimfaceSDKLoader from static.bimface.com. If that CDN
    // is unreachable (blocked network / dead DNS edge / proxy), the global
    // simply does not exist and any use of it would throw a bare
    // ReferenceError — the "clicked and nothing happened" bug. We check first
    // so the user sees the actual cause instead of silence.
    if (typeof BimfaceSDKLoader === 'undefined') {
      loadError.value =
        'BIMFACE SDK script did not load: static.bimface.com is unreachable from this network. ' +
        'Fix the network (or pin the domain in the hosts file), then reload the page.'
      return
    }

    // STEP 1 — the loader script is loaded by index.html as a plain <script>,
    // so BimfaceSDKLoader is a global (not an npm import).
    const loaderConfig = new BimfaceSDKLoaderConfig()
    loaderConfig.viewToken = viewToken // the short-lived "visitor pass" (Lesson 5)

    // QUIRK: some SDK failures (e.g. invalid viewToken) are reported ONLY via
    // console.error("[BIMFACE ERROR] ...") — the failure callback below is
    // then called with NO argument. So while loading, we listen to
    // console.error, remember the last BIMFACE line, and restore the original
    // function as soon as the outcome is known. Result: the UI can always
    // show the REAL reason instead of a useless "undefined".
    let lastSdkError = ''
    const originalConsoleError = console.error
    console.error = function (...args) {
      const text = args.map(String).join(' ')
      if (text.includes('BIMFACE ERROR')) lastSdkError = text
      originalConsoleError.apply(console, args) // never swallow other errors
    }
    const stopListening = () => { console.error = originalConsoleError }

    BimfaceSDKLoader.load(loaderConfig, onSuccess, onFailure)

    function onFailure(error) {
      stopListening()
      // Prefer explicit detail; fall back to the intercepted console line;
      // only as a last resort explain the common cause in plain words.
      const detail =
        (error && error.message) ||
        (error ? String(error) : '') ||
        lastSdkError ||
        'no reason given — usually an invalid or expired viewToken'
      loadError.value = `${detail}. Paste a fresh viewToken below and retry.`
    }

    function onSuccess(viewMetaData) {
      stopListening() // engine is in — stop intercepting console.error
      // STEP 2 — application shell. Think of it as an empty browser window
      // that will hold the 3D scene.
      const webAppConfig = new Glodon.Bimface.Application.WebApplication3DConfig()
      webAppConfig.domElement = domRef.value // tells it WHERE to render
      app = new Glodon.Bimface.Application.WebApplication3D(webAppConfig)

      // The viewer is the part we actually talk to: events, rooms, properties.
      viewer3D = app.getViewer()

      // STEP 4 preparation — register lifecycle listeners BEFORE addView, so we
      // cannot possibly miss the ViewAdded moment.
      viewer3D.addEventListener(
        Glodon.Bimface.Viewer.Viewer3DEvent.ViewAdded,
        function () {
          modelReady.value = true // the UI's "loading…" line disappears now
          prepareRooms() // see below: build clickable room volumes
          if (onReady) onReady()
        }
      )

      // Every left-click fires MouseClicked. clickData tells us WHAT was hit:
      //   clickData.objectType === 'Room'  -> we clicked a created room volume
      //   clickData.elementId              -> we clicked a real BIM element
      //   clickData.position               -> 3D world coordinate of the click
      viewer3D.addEventListener(
        Glodon.Bimface.Viewer.Viewer3DEvent.MouseClicked,
        function (clickData) {
          if (onClick) onClick(clickData)
        }
      )

      // STEP 3 — finally start streaming the model into the shell.
      app.addView(viewToken)

      // DEBUG HOOK (dev only): expose the viewer on window so we (and the
      // browser console) can inspect it live: window.__viewer3D.getRoomManager()
      // ... handy for demos, teaching, and automated testing.
      window.__viewer3D = viewer3D
    }
  }

  // ---------------------------------------------------------------------------
  // prepareRooms() — build a clickable, colored "room volume" for every room.
  //
  // WHY? Raw BIM rooms are invisible closed spaces. By extruding each room's
  // boundary into a translucent 3D box we (a) make rooms visible, and more
  // importantly (b) make them CLICKABLE — a click then returns
  // objectType === 'Room', which is exactly what Task B-46 needs to demo.
  //
  // We give "Parking Garage P01" a strong red so the demo has a star room;
  // every other room gets a faint gray so all rooms remain clickable.
  // ---------------------------------------------------------------------------
  function prepareRooms() {
    // NOTE: we deliberately do NOT call viewer3D.showAllRooms() (BIMFACE's
    // native room rendering). In isolation mode our translucent volumes ARE
    // the room layer — mixing both would double-draw every room.
    const roomManager = viewer3D.getRoomManager() // our volume manager

    // getAreas() walks the model's floor tree: floor -> rooms on that floor.
    // It is async (the tree comes from BIMFACE's servers), hence the callback.
    viewer3D.getModel().getAreas(function (floors) {
      floors.forEach(function (floor) {
        if (!floor.rooms) return // some floors have no rooms

        floor.rooms.forEach(function (roomInfo) {
          const isDemoRoom = roomInfo.name === 'Parking Garage P01'

          // RoomConfig describes the volume we want BIMFACE to draw.
          const config = new Glodon.Bimface.Plugins.Rooms.RoomConfig()
          config.viewer = viewer3D

          // Our OWN id for this room. A click on the volume returns exactly
          // this string as clickData.elementId — so we can look it up below.
          const viewerRoomId = 'room-' + roomInfo.id
          config.roomId = viewerRoomId

          // Remember: viewer id -> real room, so a click can be resolved back
          // to the actual room in the model (needed to fetch its properties).
          roomById[viewerRoomId] = {
            floorName: floor.name,
            id: roomInfo.id,     // the real room id understood by getRoomProperty
            name: roomInfo.name
          }

          // "Extrusion" = push the 2D boundary polygon upward, producing a
          // solid volume shaped exactly like the room. 1 m is plenty: enough
          // to catch clicks, low enough not to smother the storey.
          config.geometry = {
            type: 'extrusion',
            boundary: roomInfo.boundary,
            height: 1,
            unit: 'm'
          }

          // TRANSLUCENT fills (alpha < 1) so you can see INTO each room —
          // but not glassy-invisible (0.45 keeps a clear sense of a solid
          // volume). Depth testing (set after addRoom, below) makes walls
          // properly occlude the tint, so it reads as "inside the model"
          // instead of an x-ray overlay.
          if (isDemoRoom) {
            config.roomColor = new Glodon.Web.Graphics.Color(255, 0, 0, 0.45)     // translucent red
            config.frameColor = new Glodon.Web.Graphics.Color(200, 0, 0, 0.9)
          } else {
            config.roomColor = new Glodon.Web.Graphics.Color(70, 130, 180, 0.45)  // translucent steel blue
            config.frameColor = new Glodon.Web.Graphics.Color(45, 95, 135, 0.9)
          }

          // Respect depth: with depth testing ON, nearer geometry properly
          // occludes the volume (no x-ray effect through walls).
          // Per-room try/catch: ONE malformed room must never abort the whole
          // loop — 53 good rooms are better than 0.
          try {
            const room = new Glodon.Bimface.Plugins.Rooms.Room(config)
            roomManager.addRoom(room) // add FIRST (matches verified prototype)…
            if (typeof room.enableDepthTest === 'function') room.enableDepthTest(true) // …then adjust
          } catch (roomError) {
            console.warn('room skipped:', roomInfo.name, roomError)
          }
        })
      })

      // Apply the CURRENT mode after (re)building. Room volumes only exist on
      // screen when roomMode is ON — that is the whole point of the toggle.
      setRoomMode(roomMode.value)

      // The SDK does not redraw by itself after data changes — we must ask.
      viewer3D.render()
    })
  }

  // ---------------------------------------------------------------------------
  // Property fetchers — thin, commented wrappers so components never touch
  // the raw SDK. Both are async; BIMFACE calls back with the data.
  // ---------------------------------------------------------------------------
  function fetchRoomProperty(realRoomId, callback) {
    // Task B-46 engine room: returns { name, properties: [{group, items:[...]}] }
    viewer3D.getRoomProperty(realRoomId, callback)
  }

  function fetchComponentProperty(elementId, callback) {
    // Returns one element's property set, including its human-readable name.
    viewer3D.getComponentProperty(elementId, callback)
  }

  // What the outside world may use. Everything else stays private on purpose.
  return {
    domRef,                 // bind to the container div in the template
    loadError,              // reactive error message
    modelReady,             // true once ViewAdded fired (model queryable)
    roomById,               // viewer room id -> real room info
    roomMode,               // Feature 1: reactive ON/OFF state
    setRoomMode,            // Feature 1: apply the mode to the 3D scene
    load,                   // start the lifecycle
    fetchRoomProperty,      // Task B helper
    fetchComponentProperty  // Task A helper
  }
}
