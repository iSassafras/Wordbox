// Wordbox service worker — makes the app itself load without a connection.
//
// Bump CACHE_VERSION whenever you want to force every cached file to be
// re-fetched. Day to day you don't need to: HTML and JS are network-first,
// so uploading a new index.html shows up on the next online launch.

var CACHE_VERSION = 'wordbox-v1';

// './' matters as well as './index.html' — the home-screen app launches the
// directory URL, and that's a different cache key from the filename.
var SHELL = [
  './',
  './index.html',
  './config.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png'
];

self.addEventListener('install', function(event){
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_VERSION).then(function(cache){
      // Added one at a time on purpose. cache.addAll() rejects the whole
      // install if a single file 404s, and config.js is legitimately
      // optional — a missing one shouldn't leave the app uncached.
      return Promise.all(SHELL.map(function(url){
        return cache.add(url).catch(function(){ /* skip what isn't there */ });
      }));
    })
  );
});

self.addEventListener('activate', function(event){
  event.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(keys.map(function(k){
        return k === CACHE_VERSION ? null : caches.delete(k);
      }));
    }).then(function(){ return self.clients.claim(); })
  );
});

function networkFirst(request){
  return fetch(request).then(function(response){
    if (response && response.ok){
      var copy = response.clone();
      caches.open(CACHE_VERSION).then(function(c){ c.put(request, copy); });
    }
    return response;
  }).catch(function(){
    return caches.match(request).then(function(hit){
      return hit || caches.match('./index.html');
    });
  });
}

function staleWhileRevalidate(request){
  return caches.match(request).then(function(hit){
    var network = fetch(request).then(function(response){
      if (response && (response.ok || response.type === 'opaque')){
        var copy = response.clone();
        caches.open(CACHE_VERSION).then(function(c){ c.put(request, copy); });
      }
      return response;
    }).catch(function(){ return hit; });
    return hit || network;
  });
}

self.addEventListener('fetch', function(event){
  var request = event.request;
  if (request.method !== 'GET') return;

  var url;
  try { url = new URL(request.url); } catch (e) { return; }

  // Firestore and Auth traffic must pass straight through. The Firebase SDK
  // runs its own offline queue and sync; caching those responses here would
  // hand it stale data and corrupt that logic.
  if (url.hostname.indexOf('firestore.googleapis.com') !== -1 ||
      url.hostname.indexOf('identitytoolkit.googleapis.com') !== -1 ||
      url.hostname.indexOf('googleapis.com') !== -1 &&
      url.hostname.indexOf('fonts.googleapis.com') === -1){
    return;
  }

  // The Firebase SDK modules themselves are static files and safe to cache —
  // without them a home-screen launch with no signal fails at the import.
  if (url.hostname === 'www.gstatic.com' && url.pathname.indexOf('/firebasejs/') === 0){
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  // Webfonts, so the app doesn't fall back to system fonts when offline.
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com'){
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  if (url.origin !== self.location.origin) return;

  // Network-first for the app's own code, so an uploaded update is picked up
  // on the next online launch without touching CACHE_VERSION.
  if (request.mode === 'navigate' ||
      url.pathname.endsWith('.html') ||
      url.pathname.endsWith('.js')){
    event.respondWith(networkFirst(request));
    return;
  }

  event.respondWith(staleWhileRevalidate(request));
});
