'use strict';
// backend/server.js  -  MURINZA MOVIES API
require('dotenv').config();

const crypto = require('crypto');
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const Movie = require('./models/Movie');

// ---------------------------------------------------------------- CONFIG
const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI;
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'movie123';
const TOKEN_SECRET = process.env.TOKEN_SECRET || crypto.randomBytes(32).toString('hex');
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

if (!MONGO_URI) {
  console.error('❌ MONGO_URI is not set. Add it to your Render environment variables.');
  process.exit(1);
}
if (!process.env.ADMIN_PASSWORD) {
  console.warn('⚠️  ADMIN_PASSWORD not set - using the default "movie123". Set ADMIN_USERNAME / ADMIN_PASSWORD on Render.');
}
if (!process.env.TOKEN_SECRET) {
  console.warn('⚠️  TOKEN_SECRET not set - admin sessions will reset whenever the server restarts.');
}

// ------------------------------------------------------------------- APP
const app = express();
app.set('trust proxy', 1); // Render sits behind a proxy
app.disable('x-powered-by');

// CORS: set CORS_ORIGINS="https://your-site.vercel.app" to lock it to your frontend.
// Supports exact origins and wildcards such as "*.vercel.app". Empty = allow all.
function originAllowed(origin) {
  if (!origin || ALLOWED_ORIGINS.length === 0) return true;
  return ALLOWED_ORIGINS.some((rule) => {
    if (rule === '*') return true;
    if (rule.startsWith('*.')) {
      try {
        return new URL(origin).hostname.endsWith(rule.slice(1));
      } catch (_) {
        return false;
      }
    }
    return rule.replace(/\/$/, '') === origin;
  });
}

app.use(
  cors({
    origin: (origin, cb) => cb(null, originAllowed(origin)),
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 86400
  })
);
app.use(express.json({ limit: '100kb' }));

// Never let browsers/CDNs cache API responses (so admin edits show instantly).
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

// ------------------------------------------------------------ HELPERS
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

const isHttpUrl = (v) => {
  try {
    const u = new URL(v);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch (_) {
    return false;
  }
};

// Keep only well-formed http(s) links. Blank / invalid entries are dropped,
// so an empty input in the admin form is saved as "no link" (empty array).
function cleanLinks(input) {
  if (!Array.isArray(input)) return [];
  return input
    .slice(0, 20)
    .map((l) => ({ quality: str(l && l.quality, 60), url: str(l && l.url, 2000) }))
    .filter((l) => isHttpUrl(l.url));
}

// Whitelist + validate request bodies (never pass req.body straight to Mongoose).
function buildMovieData(body, partial) {
  const data = {};
  const errors = [];
  const has = (k) => Object.prototype.hasOwnProperty.call(body, k);

  if (!partial || has('title')) {
    data.title = str(body.title, 200);
    if (!data.title) errors.push('Title is required');
  }
  if (!partial || has('category')) {
    data.category = str(body.category, 80);
    if (!data.category) errors.push('Category is required');
  }
  if (!partial || has('posterUrl')) {
    data.posterUrl = str(body.posterUrl, 2000);
    if (!isHttpUrl(data.posterUrl)) errors.push('Poster URL must be a valid http(s) link');
  }
  if (has('genre')) data.genre = str(body.genre, 80);
  if (has('description')) data.description = str(body.description, 5000);
  if (has('watchLinks')) data.watchLinks = cleanLinks(body.watchLinks);
  if (has('downloadLinks')) data.downloadLinks = cleanLinks(body.downloadLinks);
  if (has('isTrending')) data.isTrending = body.isTrending === true || body.isTrending === 'true';
  if (has('isSeason')) data.isSeason = body.isSeason === true || body.isSeason === 'true';

  return { data, errors };
}

const requireBody = (req, res, next) => {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    return res.status(400).json({ error: 'Request body must be a JSON object' });
  }
  next();
};

const requireValidId = (req, res, next) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(404).json({ error: 'Movie not found' });
  }
  next();
};

// ------------------------------------------------------- ADMIN AUTH
// Credentials live ONLY on the server. The frontend sends them once to /api/admin/login
// and receives a signed, expiring token that is required for POST / PUT / DELETE.
const sign = (payload) => crypto.createHmac('sha256', TOKEN_SECRET).update(payload).digest('base64url');

function signToken() {
  const payload = Buffer.from(JSON.stringify({ u: ADMIN_USERNAME, exp: Date.now() + TOKEN_TTL_MS })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

function verifyToken(token) {
  if (typeof token !== 'string') return false;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return false;
  const a = Buffer.from(sig);
  const b = Buffer.from(sign(payload));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString()).exp > Date.now();
  } catch (_) {
    return false;
  }
}

function requireAdmin(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!verifyToken(token)) return res.status(401).json({ error: 'Unauthorized - please log in again' });
  next();
}

const safeEqual = (a, b) =>
  crypto.timingSafeEqual(
    crypto.createHash('sha256').update(String(a)).digest(),
    crypto.createHash('sha256').update(String(b)).digest()
  );

// Simple in-memory brute-force protection: 10 attempts / 15 min / IP.
const attempts = new Map();
function loginLimiter(req, res, next) {
  const now = Date.now();
  const rec = attempts.get(req.ip);
  if (rec && rec.reset > now && rec.count >= 10) {
    return res.status(429).json({ error: 'Too many login attempts. Try again in a few minutes.' });
  }
  next();
}
function recordAttempt(ip, ok) {
  if (ok) return attempts.delete(ip);
  const now = Date.now();
  const rec = attempts.get(ip);
  if (!rec || rec.reset <= now) attempts.set(ip, { count: 1, reset: now + 15 * 60 * 1000 });
  else rec.count += 1;
}

// ------------------------------------------------------------ ROUTES
app.get('/', (req, res) => res.json({ name: 'MURINZA MOVIES API', status: 'ok' }));

app.get('/api/health', (req, res) =>
  res.json({ status: 'ok', db: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected' })
);

app.post(
  '/api/admin/login',
  loginLimiter,
  requireBody,
  wrap(async (req, res) => {
    const ok =
      safeEqual(str(req.body.username, 100), ADMIN_USERNAME) &
      safeEqual(str(req.body.password, 200), ADMIN_PASSWORD);
    recordAttempt(req.ip, !!ok);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
    res.json({ token: signToken(), expiresInMs: TOKEN_TTL_MS });
  })
);

// 1. List movies (optional ?category= & ?isTrending=true), newest first
app.get(
  '/api/movies',
  wrap(async (req, res) => {
    const { category, isTrending } = req.query;
    const query = {};
    if (typeof category === 'string' && category) query.category = category;
    if (typeof isTrending === 'string' && isTrending) query.isTrending = isTrending === 'true';
    const movies = await Movie.find(query).sort({ createdAt: -1 }).lean();
    res.json(movies);
  })
);

// 2. Single movie
app.get(
  '/api/movies/:id',
  requireValidId,
  wrap(async (req, res) => {
    const movie = await Movie.findById(req.params.id).lean();
    if (!movie) return res.status(404).json({ error: 'Movie not found' });
    res.json(movie);
  })
);

// 3. Create (admin)
app.post(
  '/api/movies',
  requireAdmin,
  requireBody,
  wrap(async (req, res) => {
    const { data, errors } = buildMovieData(req.body, false);
    if (errors.length) return res.status(400).json({ error: errors.join('. ') });
    const movie = await Movie.create(data);
    res.status(201).json(movie);
  })
);

// 4. Update (admin) - blank links in the form arrive as [] and CLEAR the saved links
app.put(
  '/api/movies/:id',
  requireAdmin,
  requireValidId,
  requireBody,
  wrap(async (req, res) => {
    const { data, errors } = buildMovieData(req.body, true);
    if (errors.length) return res.status(400).json({ error: errors.join('. ') });
    const movie = await Movie.findByIdAndUpdate(req.params.id, { $set: data }, { new: true, runValidators: true });
    if (!movie) return res.status(404).json({ error: 'Movie not found' });
    res.json(movie);
  })
);

// 5. Delete (admin)
app.delete(
  '/api/movies/:id',
  requireAdmin,
  requireValidId,
  wrap(async (req, res) => {
    const movie = await Movie.findByIdAndDelete(req.params.id);
    if (!movie) return res.status(404).json({ error: 'Movie not found' });
    res.json({ message: 'Movie deleted', id: req.params.id });
  })
);

// ---------------------------------------------------- ERROR HANDLING
app.use('/api', (req, res) => res.status(404).json({ error: 'Route not found' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON body' });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request body too large' });
  if (err.name === 'ValidationError') return res.status(400).json({ error: err.message });
  if (err.name === 'CastError') return res.status(400).json({ error: 'Invalid value for ' + err.path });
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ------------------------------------------------------------ STARTUP
async function start() {
  try {
    await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 15000 });
    console.log('✅ MongoDB connected');
  } catch (err) {
    console.error('❌ MongoDB connection error:', err.message);
    process.exit(1);
  }
  const server = app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));

  const shutdown = () => {
    console.log('Shutting down...');
    server.close(() => mongoose.connection.close(false).then(() => process.exit(0)));
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
start();
