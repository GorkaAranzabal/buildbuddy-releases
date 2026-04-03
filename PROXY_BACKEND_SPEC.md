# Backend Proxy Spec — build-buddy.app

Two new API endpoints required. Both live on the existing `build-buddy.app` server.

---

## 1. `POST /api/session`

Issues a signed session token that the Electron app uses to authenticate proxy requests.
Called automatically at login — the Electron client already calls this and stores the result.

**Request:**
```json
{ "email": "user@example.com" }
```

**Response:**
```json
{ "token": "<hmac-hex>", "expiresAt": 1234567890000 }
```

**Token generation (Node.js):**
```js
const crypto = require('crypto');

function issueToken(email) {
  const expiresAt = Date.now() + 24 * 60 * 60 * 1000; // 24 hours
  const hourBucket = Math.floor(expiresAt / 3_600_000);
  const token = crypto
    .createHmac('sha256', process.env.PROXY_SECRET)
    .update(`${email}:${hourBucket}`)
    .digest('hex');
  return { token, expiresAt };
}
```

**Validation (on each proxy request):**
```js
function validateToken(email, token) {
  const now = Date.now();
  // Check current hour bucket and the previous one (handles edge at hour boundary)
  for (const offset of [0, -1]) {
    const bucket = Math.floor(now / 3_600_000) + offset;
    const expected = crypto
      .createHmac('sha256', process.env.PROXY_SECRET)
      .update(`${email}:${bucket}`)
      .digest('hex');
    if (crypto.timingSafeEqual(Buffer.from(token, 'hex'), Buffer.from(expected, 'hex'))) {
      return true;
    }
  }
  return false;
}
```

Add `PROXY_SECRET` (random 32-byte hex string) to your server env vars.

---

## 2. `POST /api/ai/chat`

Validates the session, checks entitlement, then forwards the request to OpenRouter
as a pure SSE byte pipe. No JSON parsing of the stream body — just forward bytes.

**Request headers:**
```
Authorization: Bearer <token>
X-User-Email: user@example.com
Content-Type: application/json
```

**Request body:** Standard OpenAI `/v1/chat/completions` format (passed through unchanged).

**IMPORTANT:** Set body size limit to **20MB** — messages can include base64 screenshots.

### Express implementation:
```js
const crypto = require('crypto');
const express = require('express');
const router = express.Router();

// Apply 20MB limit on this route only
router.use('/ai/chat', express.json({ limit: '20mb' }));

router.post('/ai/chat', async (req, res) => {
  const email = req.headers['x-user-email'];
  const token = req.headers['authorization']?.replace('Bearer ', '');

  // 1. Validate token
  if (!email || !token || !validateToken(email, token)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // 2. Check entitlement (reuse your existing entitlement logic)
  const entitlement = await getEntitlement(email); // your existing function
  if (!entitlement.active) {
    // Free user — check weekly ask count against your DB
    const weeklyCount = await getWeeklyAskCount(email);
    const FREE_LIMIT = 10;
    if (weeklyCount >= FREE_LIMIT) {
      return res.status(429).json({ error: 'Weekly ask limit reached. Upgrade to Pro.' });
    }
    await incrementWeeklyAskCount(email);
  }

  // 3. Forward to OpenRouter — pipe SSE bytes directly, no JSON parsing
  const upstream = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'HTTP-Referer': 'https://build-buddy.app',
      'X-Title': 'Build Buddy',
    },
    body: JSON.stringify(req.body),
  });

  if (!upstream.ok) {
    const errorText = await upstream.text();
    return res.status(upstream.status).send(errorText);
  }

  // 4. Stream response back — pipe bytes directly, no modification
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const reader = upstream.body.getReader();
  req.on('close', () => reader.cancel());

  while (true) {
    const { done, value } = await reader.read();
    if (done) { res.end(); break; }
    res.write(value);
  }
});
```

### Fastify implementation (if you use Fastify):
```js
fastify.post('/api/ai/chat', { config: { rawBody: true } }, async (request, reply) => {
  // Same logic as above. Set bodyLimit: 20 * 1024 * 1024 in Fastify config.
  // Use reply.raw.writeHead / reply.raw.write / reply.raw.end for raw streaming.
});
```

---

## 3. Server-side ask counter (for free user rate limiting)

You need a persistent per-email weekly counter. Simplest approach — a database table:

```sql
CREATE TABLE weekly_ask_counts (
  email TEXT NOT NULL,
  week_start DATE NOT NULL,  -- Monday ISO date, e.g. '2026-03-31'
  count INTEGER DEFAULT 0,
  PRIMARY KEY (email, week_start)
);
```

```js
function getWeekStart() {
  const d = new Date();
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // rewind to Monday
  return new Date(d.getFullYear(), d.getMonth(), diff).toISOString().split('T')[0];
}

async function getWeeklyAskCount(email) {
  const row = await db.query(
    'SELECT count FROM weekly_ask_counts WHERE email=$1 AND week_start=$2',
    [email, getWeekStart()]
  );
  return row?.count ?? 0;
}

async function incrementWeeklyAskCount(email) {
  await db.query(`
    INSERT INTO weekly_ask_counts (email, week_start, count)
    VALUES ($1, $2, 1)
    ON CONFLICT (email, week_start) DO UPDATE SET count = weekly_ask_counts.count + 1
  `, [email, getWeekStart()]);
}
```

This makes the ask counter **server-authoritative** — editing `data.json` locally has no effect.

---

## 4. Environment variables needed on the server

```
OPENROUTER_API_KEY=sk-or-v1-...   # The real key — never in the client
PROXY_SECRET=<random 32-byte hex>  # For HMAC token signing
```

Generate the secret: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

---

## 5. Vercel / deployment notes

If `build-buddy.app` is on **Vercel Hobby**: SSE streaming requires Edge Runtime.
Add this to your API route file:
```js
export const runtime = 'edge';
export const maxDuration = 300; // seconds
```

If on **Vercel Pro** or a regular Node.js server (Railway, Render, VPS): no special config needed.
The `fetch` + `ReadableStream` pipe works natively in Node 18+.
