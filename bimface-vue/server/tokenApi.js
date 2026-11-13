// Lesson 5: appKey/appSecret -> accessToken -> viewToken.
// Secrets stay in .env.local (git-ignored). The browser only ever receives
// the short-lived viewToken, fetched fresh from this endpoint on page load.
export function tokenApi(env) {
  // Module-level cache: accessToken is valid for days, so we reuse it
  // instead of asking BIMFACE for a new one on every page load.
  let accessToken = null
  let accessTokenExpiresAt = 0

  return {
    name: 'bimface-token',
    configureServer(server) {
      server.middlewares.use('/api/view-token', async (req, res) => {
        if (req.method !== 'GET') {
          send(res, 405, { message: 'GET only' })
          return
        }
        const appKey = env.BIMFACE_APP_KEY
        const appSecret = env.BIMFACE_APP_SECRET
        const fileId = String(env.BIMFACE_FILE_ID || '')
        if (!appKey || !appSecret || !/^\d+$/.test(fileId)) {
          send(res, 500, {
            message:
              'Fill BIMFACE_APP_KEY, BIMFACE_APP_SECRET and BIMFACE_FILE_ID in bimface-vue/.env.local, then restart the dev server.'
          })
          return
        }
        try {
          const viewToken = await requestViewToken(appKey, appSecret, fileId)
          send(res, 200, { fileId, viewToken })
        } catch (error) {
          send(res, 500, { message: String(error.message || error) })
        }
      })
    }
  }

  async function requestViewToken(appKey, appSecret, fileId) {
    let result = await bimface(
      `https://api.bimface.com/view/token?fileId=${fileId}`,
      { headers: { Authorization: `Bearer ${await getAccessToken(appKey, appSecret)}` } }
    )
    if (result.code !== 'success') {
      // The cached accessToken may have expired on BIMFACE's side:
      // drop the cache, get a fresh one, and retry exactly once.
      accessToken = null
      accessTokenExpiresAt = 0
      result = await bimface(
        `https://api.bimface.com/view/token?fileId=${fileId}`,
        { headers: { Authorization: `Bearer ${await getAccessToken(appKey, appSecret)}` } }
      )
    }
    if (result.code !== 'success' || !result.data) {
      throw new Error(result.message || 'BIMFACE did not return a viewToken (is the fileId translated?)')
    }
    return result.data
  }

  async function getAccessToken(appKey, appSecret) {
    if (accessToken && Date.now() < accessTokenExpiresAt) {
      return accessToken
    }
    const response = await bimface('https://api.bimface.com/authenticity', {
      method: 'POST',
      headers: { Authorization: `Bearer ${appKey}:${appSecret}` }
    })
    if (response.code !== 'success' || !response.data || !response.data.tokenBearer) {
      throw new Error(response.message || 'accessToken request failed (check appKey/appSecret)')
    }
    accessToken = response.data.tokenBearer
    const expires = Date.parse(response.data.expireTime || '')
    // Renew comfortably before expiry; if BIMFACE did not send a date, renew hourly.
    accessTokenExpiresAt = Number.isNaN(expires) ? Date.now() + 60 * 60 * 1000 : expires - 5 * 60 * 1000
    return accessToken
  }
}

function send(res, status, body) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

async function bimface(url, options) {
  const response = await fetch(url, options)
  return response.json()
}
