<script setup>
// =============================================================================
// TestChecklist.vue — the EVIDENCE BOARD
// -----------------------------------------------------------------------------
// This panel mirrors the two Excel test rows assigned to Charles Lo, so a
// single screenshot of it can be pasted straight into the test report:
//
//   TEST B-46 (Excel row 46, Event Listener section):
//     "When A Bim Element Is Selected — when a Room is selected, CMP shall
//      display the information of this room."
//     Pass condition: clicking a room makes the room's property groups appear.
//
//   TEST A-42 (Excel row 42, Setting Via API section):
//     "Change attributes — Add/Change BIM/IoT Attributes."
//     Pass condition: writing "IoT / Sensor Id" to a clicked element SUCCEEDS
//     and the READ-BACK returns the same value from BIMFACE's cloud.
//
// Pure display component: no logic, no fetching. It simply renders whatever
// status/evidence App.vue recorded. Dumb components are trustworthy components.
// =============================================================================
defineProps({
  // taskA / taskB shape: { status: 'pending' | 'pass' | 'fail', evidence: string }
  taskA: { type: Object, required: true },
  taskB: { type: Object, required: true }
})

// Small helper used by the template: turns a status into a badge.
// In <script setup>, plain functions like this are callable from the template.
function badge(status) {
  if (status === 'pass') return '✅ PASS'
  if (status === 'fail') return '❌ FAIL'
  return '⏳ PENDING'
}
</script>

<template>
  <div class="checklist">
    <h2>🧪 Test Evidence — HH BIMFace Testing List</h2>

    <div class="card" :class="taskB.status">
      <h3>TEST B-46 · Room selected → information displayed</h3>
      <p class="steps">
        Steps: ① switch <b>Room Mode ON</b> (all other elements hide — only the
        room volumes remain) → ② click a room (red "Parking Garage P01" is the
        demo star) → ③ panel lists the room's property groups.
      </p>
      <!-- The badge flips from ⏳ to ✅ the moment App.vue records a pass. -->
      <p class="status">{{ badge(taskB.status) }} <span v-if="taskB.evidence">— {{ taskB.evidence }}</span></p>
    </div>

    <div class="card" :class="taskA.status">
      <h3>TEST A-42 · Add/Change BIM/IoT attribute</h3>
      <p class="steps">
        Steps: ① switch <b>Room Mode OFF</b> → ② click a BIM element → ③ edit a
        value or add a row (＋ Sensor Id) in the table → ④ Save → read-back from
        BIMFACE must return the same values. Rooms go through the same table —
        BIMFACE's answer to a room write is itself a test result.
      </p>
      <p class="status">{{ badge(taskA.status) }} <span v-if="taskA.evidence">— {{ taskA.evidence }}</span></p>
    </div>
  </div>
</template>

<style scoped>
.checklist h2 { font-size: 16px; margin: 0 0 8px; }
.card {
  border: 2px solid #d1d5db;
  border-radius: 8px;
  padding: 8px 12px;
  margin-bottom: 10px;
}
/* Border color becomes part of the evidence: gray=untested, green=pass, red=fail. */
.card.pass { border-color: #16a34a; background: #f0fdf4; }
.card.fail { border-color: #dc2626; background: #fef2f2; }
.card h3 { font-size: 14px; margin: 0 0 4px; }
.steps { font-size: 12px; color: #555; margin: 0 0 6px; }
.status { font-size: 13px; font-weight: bold; margin: 0; }
</style>
