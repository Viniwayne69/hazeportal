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
const HAZE_ICON = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"%3E%3Crect width="512" height="512" rx="128" fill="%23171e19"/%3E%3Cpath d="M132 360V132h68v86h112v-86h68v228h-68v-88H200v88z" fill="%23fff"/%3E%3Ccircle cx="419" cy="419" r="42" fill="%23ca0013"/%3E%3C/svg%3E';

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

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow(self.location.origin));
});
