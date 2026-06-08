const crypto = require("crypto");

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "hazeportal-5022e";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const FIRESTORE_SCOPE = "https://www.googleapis.com/auth/datastore";
const MESSAGING_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const WEB_PUSH_PUBLIC_KEY = process.env.WEB_PUSH_PUBLIC_KEY || "BLzHPEszdUSRfVVkg7AnUK70mftzvxsUuZ8tB7NG9r6MAqhCWGUyWhPs-Aq6-0egmEFUwnQvR5c62jNsgTEoLms";
const WEB_PUSH_PRIVATE_KEY = process.env.WEB_PUSH_PRIVATE_KEY || "";
const WEB_PUSH_SUBJECT = process.env.WEB_PUSH_SUBJECT || "mailto:contato@hazeportal.com";

module.exports = async function handler(req, res) {
  if (req.method === "GET") {
    const mode = String(req.query?.debug || "");
    try {
      if (mode === "auth") {
        const accessToken = await getAccessToken();
        res.status(200).json({ ok: true, auth: true, tokenPrefix: accessToken.slice(0, 12) });
        return;
      }

      if (mode === "account") {
        const account = getServiceAccount();
        res.status(200).json({
          ok: true,
          hasClientEmail: Boolean(account.client_email),
          clientEmailDomain: String(account.client_email || "").split("@")[1] || "",
          hasPrivateKey: Boolean(account.private_key),
          privateKeyStart: String(account.private_key || "").slice(0, 28),
          privateKeyLength: String(account.private_key || "").length
        });
        return;
      }

      if (mode === "sign") {
        const assertion = createGoogleAssertion();
        res.status(200).json({ ok: true, assertionParts: assertion.split(".").length, assertionLength: assertion.length });
        return;
      }

      if (mode === "tokens") {
        const accessToken = await getAccessToken();
        const targets = await loadTokens(accessToken, "escola-haze", "Todas as turmas");
        res.status(200).json({ ok: true, tokens: targets.length, types: countTargetTypes(targets) });
        return;
      }

      res.status(200).json({
        ok: true,
        projectId: PROJECT_ID,
        hasServiceAccountJson: Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_JSON),
        hasWebPushPrivateKey: Boolean(WEB_PUSH_PRIVATE_KEY),
        webPushPackage: canLoadWebPush()
      });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message || "Erro no diagnostico" });
    }
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Metodo nao permitido" });
    return;
  }

  try {
    const payload = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const title = String(payload.title || "Novo aviso da escola").slice(0, 120);
    const body = String(payload.body || "A escola publicou uma nova informacao.").slice(0, 240);
    const targetClass = String(payload.targetClass || "Todas as turmas");
    const schoolId = String(payload.schoolId || "escola-haze");
    const accessToken = await getAccessToken();
    const targets = await loadTokens(accessToken, schoolId, targetClass);

    const messagePayload = {
      title,
      body,
      targetClass,
      schoolId,
      announcementId: String(payload.announcementId || ""),
      origin: String(payload.origin || "")
    };

    const results = await Promise.all(targets.map((target) => (
      target.type === "webpush"
        ? sendWebPush(target.subscription, messagePayload)
        : sendMessage(accessToken, target.token, messagePayload)
    )));

    res.status(200).json({
      ok: true,
      targetClass,
      tokens: targets.length,
      sent: results.filter(Boolean).length
    });
  } catch (error) {
    console.error("Erro ao enviar notificacao.", error);
    res.status(500).json({ error: error.message || "Erro ao enviar notificacao" });
  }
};

async function getAccessToken() {
  const assertion = createGoogleAssertion();

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    })
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data.error_description || data.error || "Falha ao autenticar no Google Cloud");
  return data.access_token;
}

function createGoogleAssertion() {
  const account = getServiceAccount();
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: account.client_email,
    scope: `${FIRESTORE_SCOPE} ${MESSAGING_SCOPE}`,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600
  };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claim))}`;
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const signature = signer.sign(account.private_key);
  return `${unsigned}.${base64url(signature)}`;
}

function getServiceAccount() {
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    const parsed = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    parsed.private_key = parsed.private_key.replace(/\\n/g, "\n");
    return parsed;
  }

  if (!process.env.FIREBASE_CLIENT_EMAIL || !process.env.FIREBASE_PRIVATE_KEY) {
    throw new Error("Configure FIREBASE_CLIENT_EMAIL e FIREBASE_PRIVATE_KEY na Vercel");
  }

  return {
    client_email: process.env.FIREBASE_CLIENT_EMAIL,
    private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n")
  };
}

async function loadTokens(accessToken, schoolId, targetClass) {
  const response = await fetch(`https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents:runQuery`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: "notificationTokens", allDescendants: true }]
      }
    })
  });

  const responseText = await response.text();
  let rows = null;

  try {
    rows = responseText ? JSON.parse(responseText) : null;
  } catch {
    rows = null;
  }

  if (!response.ok) {
    const detail = rows?.error?.message || responseText || response.statusText || "sem detalhe retornado";
    throw new Error(`Falha ao buscar tokens no Firestore (${response.status}): ${String(detail).slice(0, 500)}`);
  }

  if (!Array.isArray(rows)) {
    throw new Error(`Resposta inesperada do Firestore ao buscar tokens: ${String(responseText || "").slice(0, 500)}`);
  }

  return rows
    .map((row) => row.document?.fields || null)
    .filter(Boolean)
    .filter((fields) => fields.active?.booleanValue !== false)
    .filter((fields) => fields.schoolId?.stringValue === schoolId)
    .filter((fields) => targetClass === "Todas as turmas" || fields.targetClass?.stringValue === targetClass)
    .map((fields) => {
      const type = fields.type?.stringValue || "fcm";
      if (type === "webpush") {
        return {
          type,
          subscription: parseSubscription(fields)
        };
      }

      return {
        type: "fcm",
        token: fields.token?.stringValue || ""
      };
    })
    .filter((target) => target.type === "webpush" ? Boolean(target.subscription) : Boolean(target.token));
}

function parseSubscription(fields) {
  if (fields.subscriptionJson?.stringValue) {
    try {
      return JSON.parse(fields.subscriptionJson.stringValue);
    } catch (error) {
      console.error("Assinatura Web Push invalida.", error);
    }
  }

  return firestoreValueToJs(fields.subscription);
}

function firestoreValueToJs(value) {
  if (!value) return null;
  if ("stringValue" in value) return value.stringValue;
  if ("booleanValue" in value) return value.booleanValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return Number(value.doubleValue);
  if ("arrayValue" in value) return (value.arrayValue.values || []).map(firestoreValueToJs);
  if ("mapValue" in value) {
    return Object.entries(value.mapValue.fields || {}).reduce((result, [key, child]) => {
      result[key] = firestoreValueToJs(child);
      return result;
    }, {});
  }
  return null;
}

async function sendMessage(accessToken, token, payload) {
  const response = await fetch(`https://fcm.googleapis.com/v1/projects/${PROJECT_ID}/messages:send`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      message: {
        token,
        notification: {
          title: payload.title,
          body: payload.body
        },
        webpush: {
          fcmOptions: {
            link: payload.origin || undefined
          },
          notification: {
            icon: "/favicon.ico",
            badge: "/favicon.ico"
          }
        },
        data: {
          schoolId: payload.schoolId,
          targetClass: payload.targetClass,
          announcementId: payload.announcementId
        }
      }
    })
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    console.error("Falha em um token FCM.", data.error?.message || response.statusText);
    return false;
  }

  return true;
}

async function sendWebPush(subscription, payload) {
  if (!WEB_PUSH_PRIVATE_KEY) {
    console.error("WEB_PUSH_PRIVATE_KEY nao configurada na Vercel.");
    return false;
  }

  try {
    const webpush = loadWebPush();
    webpush.setVapidDetails(WEB_PUSH_SUBJECT, WEB_PUSH_PUBLIC_KEY, WEB_PUSH_PRIVATE_KEY);
    await webpush.sendNotification(subscription, JSON.stringify({
      source: "haze-web-push",
      title: payload.title,
      body: payload.body,
      schoolId: payload.schoolId,
      targetClass: payload.targetClass,
      announcementId: payload.announcementId,
      origin: payload.origin
    }));
    return true;
  } catch (error) {
    console.error("Falha em uma assinatura Web Push.", error.statusCode || "", error.body || error.message);
    return false;
  }
}

function loadWebPush() {
  try {
    return require("web-push");
  } catch (error) {
    throw new Error(`Pacote web-push nao instalado na Vercel: ${error.message}`);
  }
}

function canLoadWebPush() {
  try {
    require("web-push");
    return true;
  } catch {
    return false;
  }
}

function countTargetTypes(targets) {
  return targets.reduce((result, target) => {
    result[target.type] = (result[target.type] || 0) + 1;
    return result;
  }, {});
}

function base64url(value) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}
