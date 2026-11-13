<script setup>
// =============================================================================
// AttributeTable.vue — the universal add/change attribute editor (TASK A-42)
// -----------------------------------------------------------------------------
// EXCEL ROW 42: "Change attributes — Add/Change BIM/IoT Attributes"
//
// Works for ANY selected object (element OR room — rooms are an honest probe:
// if BIMFACE's API rejects room ids, the status line shows BIMFACE's answer).
//
// DATA FLOW:
//   props.selection (from App.vue) seeds the table rows.
//   User edits cells (rows go "dirty") and/or fills the add-row.
//   Save -> POST /api/attributes (all changes in ONE batched PUT)
//        -> middleware writes to BIMFACE + reads back with includeOverrides
//        -> response refreshes this table AND emits 'saved' for the checklist.
//
// WRITES ARE OVERRIDES: BIMFACE never mutates the translated model. Writing a
// new value for an existing group/key LAYERS an override on top — which is
// exactly what "Change attribute" means here, and what the read-back proves.
// =============================================================================
import { ref, watch } from 'vue'
import { saveAttributes } from '../lib/bimfaceData.js'

const props = defineProps({
  // { type:'room'|'element', id, fileId, name, properties:[{group, items:[{key,value,unit}]}] }
  selection: { type: Object, default: null },
  viewToken: { type: String, default: '' }
})
const emit = defineEmits(['saved'])

// ---------------------------------------------------------------------------
// Rows: one per attribute. `draft` is the editable copy; comparing it with
// `value` (the last confirmed value) tells us whether the row is dirty.
// ---------------------------------------------------------------------------
const rows = ref([])
const newRow = ref({ group: 'IoT', key: '', value: '' }) // prefilled group = the IoT theme
const saving = ref(false)
const status = ref('') // success / failure message from the last save

// When the selection changes, rebuild the table from its properties.
// NOTE the status handling: after a SAVE the parent re-seeds the SAME object
// with fresh read-back properties — that must NOT wipe the "✅ PASS" line.
// So we clear the status only when the TARGET (type:id) actually changed.
watch(
  () => props.selection,
  (sel, oldSel) => {
    const target = sel ? sel.type + ':' + sel.id : ''
    const previous = oldSel ? oldSel.type + ':' + oldSel.id : '__none__'
    if (target !== previous) status.value = ''
    rows.value = []
    if (!sel || !sel.properties) return
    // properties come grouped: [{group, items:[...]}] -> flatten to rows.
    for (const group of sel.properties) {
      for (const item of group.items || []) {
        rows.value.push({
          group: group.group,
          key: item.key,
          value: String(item.value == null ? '' : item.value), // confirmed value
          unit: item.unit || '',
          draft: String(item.value == null ? '' : item.value)  // editable copy
        })
      }
    }
  },
  { immediate: true } // also run once immediately for the first selection
)

// A row is dirty when the draft no longer matches the confirmed value.
function isDirty(row) {
  return row.draft !== row.value
}

// Quick-fill the demo attribute (one click, Task A ready). GUARD: if the row
// already exists (from an earlier write), prefill its draft instead of adding
// a duplicate row — a duplicate group/key in one PUT batch is meaningless.
function quickAddSensor() {
  const existing = rows.value.find((r) => r.group === 'IoT' && r.key === 'Sensor Id')
  if (existing) {
    if (!existing.draft) existing.draft = 'SN-001'
    return
  }
  newRow.value = { group: 'IoT', key: 'Sensor Id', value: 'SN-001' }
}

// ---------------------------------------------------------------------------
// save — batch every dirty row + the add-row into ONE request.
// ---------------------------------------------------------------------------
async function save() {
  const sel = props.selection
  if (!sel) return

  const writes = []
  for (const row of rows.value) {
    if (isDirty(row) && row.draft !== '') {
      writes.push({ group: row.group, key: row.key, value: row.draft })
    }
  }
  if (newRow.value.group && newRow.value.key && newRow.value.value) {
    writes.push({ ...newRow.value }) // ADD = a group/key that didn't exist
  }
  if (writes.length === 0) {
    status.value = 'nothing to save — edit a cell or fill the add row'
    return
  }

  saving.value = true
  status.value = 'saving…'
  try {
    // Direct to BIMFACE (src/lib/bimfaceData.js): canonical read -> group
    // remap -> PUT -> read-back verification. Works identically on the dev
    // server and on a static host, because BIMFACE's API allows browser
    // origins (CORS verified live).
    const result = await saveAttributes({
      fileId: String(sel.fileId || ''),
      elementId: String(sel.id),
      viewToken: props.viewToken,
      writes
    })

    if (!result.ok) {
      // Honest failure: show BIMFACE's own message (e.g. the room probe).
      status.value = `❌ ${result.message}`
      emit('saved', { ok: false, evidence: `write failed: ${result.message}` })
      return
    }

    // The server's message already includes verification + any group remap
    // notes (e.g. "Basic Properties"→基本属性). Show it verbatim — honesty.
    status.value = `✅ ${result.applied ? result.applied.length : writes.length} write(s) ${result.message}`

    // NO internal rebuild here. We hand the read-back properties to the
    // parent (App.vue), which updates the selection ONCE — the watch above
    // rebuilds this table, and every other panel re-renders from the same
    // data. One source of truth beats two racing rebuilds.
    newRow.value = { group: 'IoT', key: '', value: '' } // clear add-row on success

    // Evidence for the checklist: use the server's APPLIED writes — those
    // carry the canonical group names actually written (post-remap).
    const shown = result.applied || writes
    emit('saved', {
      ok: true,
      evidence: `${sel.name || sel.id}: ${shown.map((w) => `${w.group}/${w.key}=${w.value}`).join(', ')} — ${result.message}`,
      properties: result.properties || null,
      name: result.name || ''
    })
  } catch (error) {
    status.value = `❌ ${String(error.message || error)}`
    emit('saved', { ok: false, evidence: `request failed: ${String(error.message || error)}` })
  } finally {
    saving.value = false // runs whether we succeeded or failed
  }
}
</script>

<template>
  <div v-if="selection" class="panel">
    <h3>🔧 {{ selection.name || selection.id }} <small>({{ selection.type }})</small></h3>
    <p class="meta">id: {{ selection.id }}<span v-if="selection.fileId"> · fileId: {{ selection.fileId }}</span></p>

    <!-- Honest-expectation note for ROOMS: BIMFACE's attribute API addresses
         elements. Writing a room id is a deliberate probe — BIMFACE's own
         answer (observed live: property.not.found) IS the test evidence. -->
    <p v-if="selection.type === 'room'" class="probe">
      ℹ BIMFACE's attribute API addresses <b>elements</b>. Saving a room is an
      honest probe — BIMFACE's own reply (expected:
      <code>property.not.found</code>) becomes the evidence.
    </p>
    <p v-if="selection.warning" class="probe">⚠ {{ selection.warning }} — showing SDK data as a fallback</p>

    <table>
      <thead>
        <tr><th>Group</th><th>Key</th><th>Value</th><th></th></tr>
      </thead>
      <tbody>
        <!-- Existing attributes. Editing the draft marks the row dirty; the
             ✏ dot reminds the user which rows will be written on Save.
             Keys CAN repeat across groups (that's legal in BIMFACE), so the
             row key includes the index — never collide in Vue's list diff. -->
        <tr v-for="(row, index) in rows" :key="row.group + '/' + row.key + '#' + index" :class="{ dirty: isDirty(row) }">
          <td>{{ row.group }}</td>
          <td>{{ row.key }}</td>
          <td><input v-model="row.draft" :placeholder="row.value" /></td>
          <td class="flag">{{ isDirty(row) ? '✏' : '' }}{{ row.unit }}</td>
        </tr>

        <!-- The ADD row: group/key/value become a brand-new attribute. -->
        <tr class="add">
          <td><input v-model="newRow.group" placeholder="Group" /></td>
          <td><input v-model="newRow.key" placeholder="Key" /></td>
          <td><input v-model="newRow.value" placeholder="Value" /></td>
          <td class="flag">➕</td>
        </tr>
      </tbody>
    </table>

    <p class="actions">
      <button type="button" :disabled="saving" @click="save">💾 Save changes → verify by read-back</button>
      <button type="button" class="ghost" @click="quickAddSensor">＋ Sensor Id</button>
    </p>

    <p v-if="status" class="status">{{ status }}</p>
  </div>
</template>

<style scoped>
.panel { border: 1px solid #ccc; border-radius: 8px; padding: 8px 12px; }
.meta { font-size: 12px; color: #666; }
table { width: 100%; border-collapse: collapse; font-size: 12px; }
th, td { text-align: left; padding: 2px 4px; border-bottom: 1px solid #eee; vertical-align: top; }
th { color: #555; }
tr.dirty { background: #fffbeb; }        /* edited rows glow amber */
tr.dirty td.flag { color: #d97706; }
tr.add td { background: #f0fdf4; }        /* the add-row is visibly green */
input { width: 100%; box-sizing: border-box; font-size: 12px; }
.actions { margin: 8px 0 0; }
.ghost { margin-left: 8px; color: #2563eb; background: none; border: 1px dashed #93c5fd; }
.status { font-size: 12px; margin: 6px 0 0; }
.probe { font-size: 12px; color: #7c2d12; background: #fff7ed; border: 1px dashed #fdba74; border-radius: 6px; padding: 4px 8px; }
.probe code { background: #ffedd5; padding: 0 3px; border-radius: 3px; }
small { color: #888; font-weight: normal; }
</style>
