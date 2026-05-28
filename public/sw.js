const CACHE_NAME = 'payload-pwa-v2'
const PRECACHE = ['/', '/offline.html', '/manifest.json', '/icons/icon-192.svg', '/icons/icon-512.svg']

const isNavigationRequest = (request) => request.mode === 'navigate'
const isStaticAsset = (url) =>
  url.pathname.startsWith('/_next/static/') ||
  url.pathname.startsWith('/icons/') ||
  url.pathname === '/manifest.json'

const shouldBypass = (request) => {
  const url = new URL(request.url)
  if (request.method !== 'GET') return true
  if (url.origin !== self.location.origin) return true
  return url.pathname.startsWith('/admin') || url.pathname.startsWith('/api/')
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  if (shouldBypass(event.request)) return

  const url = new URL(event.request.url)

  if (isStaticAsset(url)) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached

        return fetch(event.request).then((response) => {
          if (response.ok) {
            const clone = response.clone()
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone))
          }
          return response
        })
      }),
    )
    return
  }

  if (isNavigationRequest(event.request)) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone()
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone))
          }
          return response
        })
        .catch(() => caches.match(event.request).then((cached) => cached || caches.match('/offline.html'))),
    )
    return
  }

  event.respondWith(fetch(event.request).catch(() => caches.match(event.request)))
})
