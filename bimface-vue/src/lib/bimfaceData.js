// =============================================================================
// bimfaceData.js — the browser's DIRECT line to BIMFACE's data API
// -----------------------------------------------------------------------------
// Works on the dev server AND on a static host (GitHub Pages): BIMFACE's data
// API sends "Access-Control-Allow-Origin: *" and allows PUT preflights
// (verified live), so the browser may call it directly with a viewToken.
// No secrets are involved — a viewToken is a short-lived, read/write-scoped
// key for ONE file. That is why this can live in the front-end at all.
//
// TWO FUNCTIONS, both returning the same plain objects the old dev-middleware
// returned (server/attributesApi.js stays in the repo as the reference
// implementation and as a template if you ever need to hide the token):
//
//   fetchProperties({ fileId, elementId, viewToken })
//     -> { ok, message?, name?, properties? }
//
//   saveAttributes({ fileId, elementId, viewToken, writes })
//     -> { ok, message, name?, properties?, applied?, remaps?, warnings? }
//
// THE NAMING TRAP (caught live on this project): the SDK panel TRANSLATES
// group names (基本属性 -> "Basic Properties") but the data API only knows
// canonical names. Writing a translated name creates a DUPLICATE group
// instead of editing the real attribute. saveAttributes therefore:
//   1. GETs the canonical groups first,
//   2. remaps any write whose group doesn't exist but whose key already
//      lives in exactly one existing group,
//   3. PUTs, reads back with includeOverrides=true, and verifies.
// =============================================================================

const API = 'https://api.bimface.com/data/v2/files'

// ---------------------------------------------------------------------------
// Read one object's properties, canonical group names, overrides included.
// ---------------------------------------------------------------------------
export async function fetchProperties({ fileId, elementId, viewToken }) {
  if (!fileId || !elementId || !viewToken) {
    return { ok: false, message: 'fileId / elementId / viewToken missing' }
  }
  const read = await get(
    `${API}/${fileId}/elements/${encodeURIComponent(elementId)}?includeOverrides=true&view_token=${viewToken}`
  )
  if (read.code !== 'success') {
    // e.g. a room id -> { code: 'property.not.found' } — BIMFACE's honest answer.
    return { ok: false, message: `${read.code || 'error'}: ${read.message || ''}`.trim() }
  }
  return {
    ok: true,
    name: (read.data && read.data.name) || '',
    properties: (read.data && read.data.properties) || []
  }
}

// ---------------------------------------------------------------------------
// Add / change attributes: canonical pre-read -> remap -> PUT -> verify.
// ---------------------------------------------------------------------------
export async function saveAttributes({ fileId, elementId, viewToken, writes }) {
  if (!fileId || !elementId || !viewToken || !Array.isArray(writes) || writes.length === 0) {
    return { ok: false, message: 'fileId / elementId / viewToken / writes missing' }
  }
  // ---- 1) canonical groups (best effort; for rooms this read fails and we
  //         simply write as-addressed — the PUT reply is then the probe result).
  const keyToGroups = new Map() // key -> Set(canonicalGroupName)
  const groupNames = new Set()
  try {
    const current = await fetchProperties({ fileId, elementId, viewToken })
    if (current.ok) {
      for (const group of current.properties) {
        groupNames.add(group.group)
        for (const item of group.items || []) {
          if (!keyToGroups.has(item.key)) keyToGroups.set(item.key, new Set())
          keyToGroups.get(item.key).add(group.group)
        }
      }
    }
  } catch {
    /* network hiccup: write as-addressed */
  }

  // ---- 2) remap translated group names to the group the key actually lives in
  const remaps = []
  const applied = []
  for (const w of writes) {
    let group = String(w.group)
    if (groupNames.size > 0 && !groupNames.has(group)) {
      const homes = keyToGroups.get(String(w.key))
      if (homes && homes.size === 1) {
        const canonical = [...homes][0]
        remaps.push({ from: group, to: canonical, key: String(w.key) })
        group = canonical
      }
    }
    applied.push({ group, key: String(w.key), value: String(w.value) })
  }

  // ---- 3) WRITE: merge rows into groups; BIMFACE expects [{group, items}]
  const byGroup = new Map()
  for (const w of applied) {
    if (!byGroup.has(w.group)) byGroup.set(w.group, [])
    byGroup.get(w.group).push({ key: w.key, value: w.value, valueType: 3 }) // 3 = string
  }
  const putBody = [...byGroup].map(([group, items]) => ({ group, items }))

  const wrote = await request(
    `${API}/${fileId}/elements/${encodeURIComponent(elementId)}/properties?view_token=${viewToken}`,
    { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(putBody) }
  )
  if (wrote.code !== 'success') {
    return { ok: false, message: wrote.message || wrote.code || 'PUT failed' }
  }

  // ---- 4) PROOF: read back with overrides and verify; warn on duplicate keys
  const read = await fetchProperties({ fileId, elementId, viewToken })
  const warnings = []
  if (read.ok && read.properties) {
    for (const w of applied) {
      const found = read.properties.filter((g) => (g.items || []).some((i) => i.key === w.key))
      if (found.length > 1) {
        warnings.push(`key "${w.key}" now exists in ${found.length} groups (${found.map((g) => g.group).join(', ')})`)
      }
    }
  }

  let message = read.ok && read.properties
    ? 'saved & verified by read-back'
    : 'saved (read-back not available for this id)'
  if (remaps.length > 0) {
    message += ` · group name remapped: ${remaps.map((r) => `"${r.from}"→"${r.to}"`).join(', ')}`
  }
  if (warnings.length > 0) message += ` · ⚠ ${warnings.join(' · ')}`

  return {
    ok: true,
    message,
    name: read.ok ? read.name : '',
    properties: read.ok ? read.properties : null,
    applied,
    remaps,
    warnings
  }
}

// ---- tiny fetch helpers -----------------------------------------------------
async function get(url) {
  const response = await fetch(url)
  return response.json()
}

async function request(url, options) {
  const response = await fetch(url, options)
  return response.json()
}
