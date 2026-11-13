// =============================================================================
// RoomInfoPanel.vue — TASK B-46 display side
// -----------------------------------------------------------------------------
// EXCEL ROW 46: "When A Bim Element Is Selected — when a Room is selected,
// CMP shall display the information of this room."
//
// This component is a PURE DISPLAY component: it receives the room object and
// renders every property group. It contains zero logic on purpose — easy to
// read, easy to trust. App.vue marks the test "pass" when this data arrives.
// =============================================================================

<script setup>
// defineProps: declare the component's inputs. Parent (App.vue) passes
// :room="selectedRoom". When selectedRoom changes, this panel re-renders.
defineProps({
  // Shape: { name: 'Parking Garage P01', properties: [{ group: '基础', items: [{ key, value, unit }] }] }
  room: { type: Object, default: null }
})
</script>

<template>
  <!-- v-if: panel only exists while a room is selected. Clicking an element
       sets room to null, which makes this panel disappear automatically. -->
  <div v-if="room" class="panel">
    <h3>🏢 {{ room.name }}</h3>

    <!-- Loop over property GROUPS (e.g. "dimensions", "identity data"...).
         :key helps Vue reuse DOM nodes efficiently between renders. -->
    <div v-for="group in room.properties" :key="group.group" class="group">
      <h4>{{ group.group }}</h4>

      <!-- Loop over the key/value pairs inside this group. Unit is optional,
           so we only append it when present (the ternary in {{ }}). -->
      <p v-for="item in group.items" :key="item.key">
        {{ item.key }}: {{ item.value }}{{ item.unit ? ' ' + item.unit : '' }}
      </p>
    </div>
  </div>
</template>

<!-- Scoped styles: these classes cannot leak into other components. -->
<style scoped>
.panel {
  border: 1px solid #ccc;
  border-radius: 8px;
  padding: 8px 12px;
  margin-bottom: 12px;
  max-height: 320px;
  overflow: auto;
}
.group h4 {
  margin: 8px 0 4px;
  color: #2563eb;
}
.group p {
  margin: 2px 0;
  font-size: 13px;
}
</style>
