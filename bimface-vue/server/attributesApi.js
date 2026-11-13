// =============================================================================
// attributesApi.js — REFERENCE IMPLEMENTATION of the "add / change attributes"
// endpoint (superseded but kept on purpose)
// -----------------------------------------------------------------------------
// The browser now talks to BIMFACE's data API DIRECTLY (src/lib/bimfaceData.js)
// because BIMFACE sends "Access-Control-Allow-Origin: *" — verified live. That
// single code path works on the dev server AND on a static host (GitHub Pages).
//
// This file remains as:
//   1. a teaching artifact — the same read/remap/PUT/verify flow, server-side;
//   2. a template for when a server hop IS needed (e.g. hiding viewTokens,
//      audit logging, or writing with app-level credentials).
//
// POST /api/attributes
//   body: { fileId?, elementId, viewToken, writes: [{ group, key, value }] }
//   -> { ok, message, name?, properties?, applied?, remaps?, warnings? }
// =============================================================================

export function attributesApi(env) {
  return {
    name: 'bimface-attributes',
    configureServer(server) {
      server.middlewares.use('/api/attributes', async (req, res) => {
        try {
          if (req.method === 'GET') return await handleGet(req, res)
          if (req.method === 'POST') return await handlePost(req, res, env)
          send(res, 405, { message: 'GET or POST only' })
        } catch (error) {
          send(res, 500, { message: String(error) })
        }
      })
    }
  }
}

// ---------------------------------------------------------------------------
// GET — canonical properties for one object id (includeOverrides=true so a
// saved change is visible on the NEXT click, which is the whole point).
// ---------------------------------------------------------------------------
async function handleGet(req, res) {
  const query = new URL(req.url, 'http://localhost').searchParams
  const fileId = query.get('fileId') || ''
  const elementId = query.get('elementId') || ''
  const viewToken = query.get('viewToken') || ''

  const invalid = validate(fileId, elementId, viewToken)
  if (invalid) {
    send(res, 400, { ok: false, message: invalid })
    return
  }

  const read = await bimface(
    `https://api.bimface.com/data/v2/files/${fileId}/elements/${elementId}?includeOverrides=true&view_token=${viewToken}`
  )
  if (read.code !== 'success') {
    // e.g. rooms -> { code: 'property.not.found' } — BIMFACE's honest answer.
    send(res, 200, { ok: false, message: `${read.code || 'error'}: ${read.message || ''}`.trim() })
    return
  }
  send(res, 200, {
    ok: true,
    name: (read.data && read.data.name) || '',
    properties: (read.data && read.data.properties) || []
  })
}

// ---------------------------------------------------------------------------
// POST — batched write (PUT) + read-back proof.
// ---------------------------------------------------------------------------
async function handlePost(req, res, env) {
  const body = await readBody(req)

  // fileId: element clicks carry it; room clicks may not — then we fall back
  // to the file id configured in .env.local.
  const fileId = String(body.fileId || env.BIMFACE_FILE_ID || '')
  const elementId = String(body.elementId || '')
  const viewToken = String(body.viewToken || '')
  const writes = Array.isArray(body.writes) ? body.writes : []

  const invalid = validate(fileId, elementId, viewToken)
  if (invalid) {
    send(res, 400, { ok: false, message: invalid })
    return
  }
  if (writes.length < 1 || writes.length > 20) {
    send(res, 400, { ok: false, message: 'send between 1 and 20 writes' })
    return
  }
  for (const w of writes) {
    const group = String(w.group || '')
    const key = String(w.key || '')
    const value = String(w.value == null ? '' : w.value)
    if (group.length < 1 || group.length > 50 || key.length < 1 || key.length > 50) {
      send(res, 400, { ok: false, message: 'group and key must be 1-50 characters' })
      return
    }
    if (value.length < 1 || value.length > 80) {
      send(res, 400, { ok: false, message: `value for "${key}" must be 1-80 characters` })
      return
    }
  }

  // ---------------- 1) canonical groups (best effort) -----------------------
  // index: which existing group(s) already contain each key. Used to remap
  // translated group names to the real ones. If this fetch fails (e.g. the
  // id is a ROOM), we simply skip remapping and let the PUT speak for itself.
  const keyToGroups = new Map() // key -> Set(groupName)
  const groupNames = new Set()
  try {
    const current = await bimface(
      `https://api.bimface.com/data/v2/files/${fileId}/elements/${elementId}?includeOverrides=true&view_token=${viewToken}`
    )
    for (const group of (current.data && current.data.properties) || []) {
      groupNames.add(group.group)
      for (const item of group.items || []) {
        if (!keyToGroups.has(item.key)) keyToGroups.set(item.key, new Set())
        keyToGroups.get(item.key).add(group.group)
      }
    }
  } catch {
    /* probe mode: no canonical data, write as-addressed */
  }

  const remaps = []
  const applied = []
  for (const w of writes) {
    let group = String(w.group)
    if (groupNames.size > 0 && !groupNames.has(group)) {
      const homes = keyToGroups.get(String(w.key))
      if (homes && homes.size === 1) {
        const canonical = [...homes][0]
        remaps.push({ from: group, to: canonical, key: String(w.key) })
        group = canonical // write to the group the key actually lives in
      }
    }
    applied.push({ group, key: String(w.key), value: String(w.value) })
  }

  // ---------------- 2) merge rows into groups & WRITE (PUT) ----------------
  const byGroup = new Map()
  for (const w of applied) {
    if (!byGroup.has(w.group)) byGroup.set(w.group, [])
    byGroup.get(w.group).push({ key: w.key, value: w.value, valueType: 3 }) // 3 = string
  }
  const putBody = [...byGroup].map(([group, items]) => ({ group, items }))

  const wrote = await bimface(
    `https://api.bimface.com/data/v2/files/${fileId}/elements/${elementId}/properties?view_token=${viewToken}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(putBody)
    }
  )
  if (wrote.code !== 'success') {
    // BIMFACE refused (e.g. writing to a room id — the documented probe).
    // Report honestly — this IS the probe result for rooms.
    send(res, 200, { ok: false, message: wrote.message || wrote.code || 'PUT failed' })
    return
  }

  // ---------------- 3) PROOF (read back with overrides) --------------------
  const read = await bimface(
    `https://api.bimface.com/data/v2/files/${fileId}/elements/${elementId}?includeOverrides=true&view_token=${viewToken}`
  )
  const properties = (read.data && read.data.properties) || null

  // Verify each write against the read-back, and detect a key existing in
  // MULTIPLE groups (the shadow-group symptom — impossible after remapping,
  // but if it ever shows up again we say so instead of claiming clean PASS).
  const warnings = []
  if (properties) {
    for (const w of applied) {
      const found = properties.filter((g) => (g.items || []).some((i) => i.key === w.key))
      if (found.length > 1) {
        warnings.push(`key "${w.key}" now exists in ${found.length} groups (${found.map((g) => g.group).join(', ')})`)
      }
    }
  }

  let message = properties ? 'saved & verified by read-back' : 'saved (read-back not available for this id)'
  if (remaps.length > 0) {
    message += ` · group name remapped: ${remaps.map((r) => `"${r.from}"→"${r.to}"`).join(', ')}`
  }
  if (warnings.length > 0) message += ` · ⚠ ${warnings.join(' · ')}`

  send(res, 200, {
    ok: true,
    message,
    name: (read.data && read.data.name) || '',
    properties,
    applied,
    remaps,
    warnings
  })
}

// ---- shared validation ------------------------------------------------------
function validate(fileId, elementId, viewToken) {
  if (!/^\d+$/.test(fileId)) {
    return 'fileId missing (element had none, and BIMFACE_FILE_ID is not set in .env.local)'
  }
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(elementId)) {
    // NOTE: deliberately looser than digits-only — room ids may not be pure
    // numbers. Still locked down to safe characters.
    return 'elementId must be 1-64 letters/digits/dashes'
  }
  if (!/^[a-f0-9]{32}$/i.test(viewToken)) {
    return 'viewToken is missing'
  }
  return ''
}

// ---- tiny helpers (same style as tokenApi.js) ------------------------------
function send(res, status, body) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}'))
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

async function bimface(url, options) {
  const response = await fetch(url, options)
  return response.json()
}
