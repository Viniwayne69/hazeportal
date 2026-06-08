const HAZE_ICON = "/haze-icon.svg";

self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload = {};
  try {
    payload = event.data.json();
  } catch {
    payload = { body: event.data.text() };
  }

  if (payload.source !== "haze-web-push") return;

  const title = payload.title || "Novo aviso da escola";
  const options = {
    body: payload.body || "A escola publicou uma nova informacao.",
    icon: HAZE_ICON,
    badge: HAZE_ICON,
    data: payload
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

try {
  importScripts("https://www.gstatic.com/firebasejs/10.12.5/firebase-app-compat.js");
  importScripts("https://www.gstatic.com/firebasejs/10.12.5/firebase-messaging-compat.js");

  const firebaseConfig = {
    apiKey: "AIzaSyCgPBuGNwiF8Bju_UR37N55vc775Ctc7uM",
    authDomain: "hazeportal-5022e.firebaseapp.com",
    projectId: "hazeportal-5022e",
    storageBucket: "hazeportal-5022e.firebasestorage.app",
    messagingSenderId: "757529850374",
    appId: "1:757529850374:web:5df94b236a122e19768987"
  };

  firebase.initializeApp(firebaseConfig);

  const messaging = firebase.messaging();

  messaging.onBackgroundMessage((payload) => {
    const notification = payload.notification || {};
    const title = notification.title || "Novo aviso da escola";
    const options = {
      body: notification.body || "A escola publicou uma nova informacao.",
      icon: HAZE_ICON,
      badge: HAZE_ICON,
      data: payload.data || {}
    };

    self.registration.showNotification(title, options);
  });
} catch (error) {
  console.warn("Firebase Messaging indisponivel no service worker.", error);
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow(self.location.origin));
});
