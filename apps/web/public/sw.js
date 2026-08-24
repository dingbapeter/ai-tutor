/* Service worker: push notifications + minimal offline fallback. */

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open("tutor-v1").then((cache) => cache.addAll(["/", "/manifest.json", "/icon-192.png"])),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

/* Network-first for pages; cache fallback keeps the shell opening offline. */
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        const copy = res.clone();
        caches.open("tutor-v1").then((cache) => cache.put(event.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(event.request).then((hit) => hit ?? caches.match("/"))),
  );
});

self.addEventListener("push", (event) => {
  let data = { title: "Your tutor is ready 📚", body: "A few minutes of practice keeps the streak alive!" };
  try {
    data = { ...data, ...event.data.json() };
  } catch {}
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) if ("focus" in client) return client.focus();
      return self.clients.openWindow("/");
    }),
  );
});
