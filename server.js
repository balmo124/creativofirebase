const express = require("express"), path = require("path"), bcrypt = require("bcryptjs"),
  jwt = require("jsonwebtoken"), Database = require("better-sqlite3");

const PORT = process.env.PORT || 3000;
const SECRET = process.env.JWT_SECRET || "dev-only-secret";
const ADMIN_EMAIL = String(process.env.ADMIN_EMAIL || "").trim().toLowerCase();
if (process.env.NODE_ENV === "production" && !process.env.JWT_SECRET) {
  console.error("JWT_SECRET is required in production"); process.exit(1);
}
const CATS = ["Photography", "Videography", "Events"];

// ---------- Database ----------
const db = new Database(process.env.DB_PATH || path.join(__dirname, "creativo.db"));
db.pragma("journal_mode = WAL"); db.pragma("foreign_keys = ON");
db.exec(`
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, password TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN('consumer','provider')), created TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS providers(
  id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id), name TEXT NOT NULL, cat TEXT NOT NULL,
  city TEXT NOT NULL, rate INTEGER NOT NULL, rating TEXT NOT NULL, tag TEXT NOT NULL, about TEXT NOT NULL, tags TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS bookings(
  id INTEGER PRIMARY KEY, provider_id INTEGER NOT NULL REFERENCES providers(id),
  client_id INTEGER REFERENCES users(id), client_name TEXT NOT NULL, date TEXT NOT NULL, note TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Pending', created TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS admin_messages(
  id INTEGER PRIMARY KEY, sender_id INTEGER NOT NULL REFERENCES users(id),
  subject TEXT NOT NULL, message TEXT NOT NULL, created TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS reviews(
  id INTEGER PRIMARY KEY, booking_id INTEGER NOT NULL UNIQUE REFERENCES bookings(id),
  provider_id INTEGER NOT NULL REFERENCES providers(id), client_id INTEGER NOT NULL REFERENCES users(id),
  rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5), created TEXT DEFAULT CURRENT_TIMESTAMP);
`);

const SEED = [
  ["Lumen Studio", "Photography", "Surigao City", 2500, "4.9", "Portraits, weddings and events in natural light", "A two-person team shooting weddings, graduations and family sessions across Surigao del Norte. Edited gallery delivered within a week.", ["Weddings", "Portraits", "Graduations"]],
  ["Siargao Frames", "Videography", "General Luna", 4000, "4.8", "Surf, travel and resort films", "Short films and social cuts for resorts, surf schools and travelers. Drone footage available on request.", ["Drone", "Travel", "Resorts"]],
  ["Kaya Events Co.", "Events", "Surigao City", 6000, "4.7", "Birthdays, debuts and company gatherings", "Full event planning with venue, catering and host coordination. We handle the day so you can enjoy it.", ["Debuts", "Birthdays", "Corporate"]],
  ["Tidal Reel", "Videography", "Surigao City", 3200, "4.6", "Wedding highlight reels and music videos", "Cinematic same-week highlight reels for weddings, plus music videos for local artists.", ["Weddings", "Music videos"]],
  ["Bisaya Bloom Events", "Events", "Butuan", 5500, "4.9", "Garden weddings and styled receptions", "Floral styling and coordination for intimate weddings and receptions, with a team that speaks Bisaya, Tagalog and English.", ["Weddings", "Styling"]],
  ["Pixel & Pine", "Photography", "Dapa", 1800, "4.5", "Product and food photography for local shops", "Clean product shots and menu photography for cafés, thrift stores and online sellers.", ["Products", "Food"]],
  ["Golden Hour PH", "Photography", "Surigao City", 2200, "4.8", "Couples, engagements and sunset sessions", "Relaxed couple and engagement shoots at the waterfront, in the hills and on the islands.", ["Couples", "Engagements"]],
  ["Frame by Frame", "Videography", "Butuan", 3500, "4.4", "Event coverage and short promos", "Multi-camera event coverage and 30-second promos for local businesses.", ["Events", "Promos"]],
];
if (!db.prepare("SELECT COUNT(*) n FROM providers").get().n) {
  const ins = db.prepare("INSERT INTO providers(name,cat,city,rate,rating,tag,about,tags) VALUES(?,?,?,?,?,?,?,?)");
  SEED.forEach(s => ins.run(...s.slice(0, 7), JSON.stringify(s[7])));
}
// Optional test accounts (password: demo1234). Start with SEED_DEMO=1.
if (process.env.SEED_DEMO === "1" && !db.prepare("SELECT 1 FROM users WHERE email='lumen@demo.ph'").get()) {
  const h = bcrypt.hashSync("demo1234", 10), u = db.prepare("INSERT INTO users(name,email,password,role) VALUES(?,?,?,?)");
  const c = u.run("Alex Reyes", "alex@demo.ph", h, "consumer"), p = u.run("Lumen Studio", "lumen@demo.ph", h, "provider");
  db.prepare("UPDATE providers SET user_id=? WHERE id=1").run(p.lastInsertRowid);
  const b = db.prepare("INSERT INTO bookings(provider_id,client_id,client_name,date,note,status) VALUES(?,?,?,?,?,?)");
  b.run(1, c.lastInsertRowid, "Alex Reyes", "2026-12-14", "Birthday shoot for about 20 guests", "Pending");
  b.run(1, c.lastInsertRowid, "Alex Reyes", "2026-12-21", "Product photos for a coffee shop", "Accepted");
}

// ---------- Helpers ----------
const reviewStats = db.prepare("SELECT COUNT(*) count, AVG(rating) average FROM reviews WHERE provider_id=?");
const pub = r => {
  const stats = reviewStats.get(r.id);
  return {
    id: r.id, name: r.name, cat: r.cat, city: r.city, rate: r.rate,
    rating: stats.count ? stats.average.toFixed(1) : r.rating, reviewCount: stats.count,
    tag: r.tag, about: r.about, tags: JSON.parse(r.tags),
  };
};
const isAdminUser = u => Boolean(ADMIN_EMAIL && u.email.toLowerCase() === ADMIN_EMAIL);
const userOut = u => ({
  id: u.id, name: u.name, email: u.email, role: u.role,
  isAdmin: isAdminUser(u),
  providerId: u.role === "provider" ? (db.prepare("SELECT id FROM providers WHERE user_id=?").get(u.id) || {}).id || null : null,
});
const BQ = "SELECT b.*, p.name pname, client.email client_email, provider.email provider_email, r.rating review_rating " +
  "FROM bookings b JOIN providers p ON p.id=b.provider_id " +
  "LEFT JOIN users client ON client.id=b.client_id " +
  "LEFT JOIN reviews r ON r.booking_id=b.id " +
  "LEFT JOIN users provider ON provider.id=p.user_id";
const bk = r => ({
  id: r.id, providerId: r.provider_id, providerName: r.pname, clientName: r.client_name,
  date: r.date, note: r.note, status: r.status, rating: r.review_rating || null,
});
const sign = u => jwt.sign({ id: u.id }, SECRET, { expiresIn: "7d" });
const bad = (res, code, msg) => res.status(code).json({ error: msg });

function auth(req, res, next) {
  try {
    const { id } = jwt.verify((req.headers.authorization || "").replace("Bearer ", ""), SECRET);
    const u = db.prepare("SELECT * FROM users WHERE id=?").get(id);
    if (!u) throw new Error("no user");
    req.user = u; next();
  } catch (e) { bad(res, 401, "Please sign in again."); }
}
function adminOnly(req, res, next) {
  if (!ADMIN_EMAIL) return bad(res, 503, "Admin access is not configured.");
  if (req.user.email.toLowerCase() !== ADMIN_EMAIL) return bad(res, 403, "Admin access required.");
  next();
}
const hits = new Map();
function limit(req, res, next) { // 10 auth attempts per minute per IP
  const now = Date.now(), a = (hits.get(req.ip) || []).filter(t => now - t < 60000);
  if (a.length >= 10) return bad(res, 429, "Too many attempts. Try again in a minute.");
  a.push(now); hits.set(req.ip, a); next();
}

// ---------- App ----------
const app = express();
app.disable("x-powered-by"); app.set("trust proxy", 1); app.use(express.json({ limit: "50kb" }));

app.get("/api/health", (q, r) => r.json({ ok: true }));

app.post("/api/signup", limit, (req, res) => {
  const { name, email, password, role, category } = req.body || {};
  const n = String(name || "").trim().slice(0, 80), e = String(email || "").trim().toLowerCase();
  if (!n) return bad(res, 400, "Enter your name.");
  if (!/^\S+@\S+\.\S+$/.test(e)) return bad(res, 400, "Enter a valid email address.");
  if (String(password || "").length < 6) return bad(res, 400, "Password must be at least 6 characters.");
  if (db.prepare("SELECT 1 FROM users WHERE email=?").get(e)) return bad(res, 409, "That email already has an account. Sign in instead.");
  const r = role === "provider" ? "provider" : "consumer";
  const user = db.transaction(() => {
    const i = db.prepare("INSERT INTO users(name,email,password,role) VALUES(?,?,?,?)").run(n, e, bcrypt.hashSync(String(password), 10), r);
    if (r === "provider") {
      db.prepare("INSERT INTO providers(user_id,name,cat,city,rate,rating,tag,about,tags) VALUES(?,?,?,?,?,?,?,?,?)").run(
        i.lastInsertRowid, n, CATS.includes(category) ? category : "Photography", "Surigao City", 2000, "New", "New on Creativo",
        "Say hello to your new profile. Add your story, packages and portfolio.", JSON.stringify(["New"]));
    }
    return db.prepare("SELECT * FROM users WHERE id=?").get(i.lastInsertRowid);
  })();
  res.json({ token: sign(user), user: userOut(user) });
});

app.post("/api/login", limit, (req, res) => {
  const { email, password } = req.body || {};
  const u = db.prepare("SELECT * FROM users WHERE email=?").get(String(email || "").trim().toLowerCase());
  if (!u || !bcrypt.compareSync(String(password || ""), u.password)) return bad(res, 401, "Incorrect email or password.");
  res.json({ token: sign(u), user: userOut(u) });
});

app.get("/api/me", auth, (req, res) => res.json({ user: userOut(req.user) }));

app.get("/api/admin/overview", auth, adminOnly, (req, res) => {
  const counts = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM users) totalUsers,
      (SELECT COUNT(*) FROM users WHERE role='consumer' AND lower(email)<>?) totalClients,
      (SELECT COUNT(*) FROM providers) totalProviders,
      (SELECT COUNT(*) FROM bookings) totalBookings,
      (SELECT COUNT(*) FROM bookings WHERE status='Pending') pendingBookings,
      (SELECT COUNT(*) FROM admin_messages) totalMessages
  `).get(ADMIN_EMAIL);
  const recentUsers = db.prepare(
    "SELECT id,name,email,role,created FROM users ORDER BY id DESC LIMIT 6"
  ).all().map(u => ({ ...u, isAdmin: isAdminUser(u) }));
  const recentBookings = db.prepare(
    "SELECT b.id,b.client_name clientName,b.date,b.status,b.created,p.name providerName " +
    "FROM bookings b JOIN providers p ON p.id=b.provider_id ORDER BY b.created DESC LIMIT 6"
  ).all();
  res.json({ counts, recentUsers, recentBookings });
});

app.get("/api/admin/:section", auth, adminOnly, (req, res) => {
  if (req.params.section === "users") {
    return res.json(db.prepare(
      "SELECT id,name,email,role,created FROM users ORDER BY id DESC"
    ).all().map(u => ({ ...u, isAdmin: isAdminUser(u) })));
  }
  if (req.params.section === "providers") {
    return res.json(db.prepare(
      "SELECT p.id,p.name,p.cat,p.city,p.rate,p.rating,u.email accountEmail " +
      "FROM providers p LEFT JOIN users u ON u.id=p.user_id ORDER BY p.id DESC"
    ).all());
  }
  if (req.params.section === "bookings") {
    return res.json(db.prepare(
      "SELECT b.id,b.client_name clientName,b.date,b.note,b.status,b.created," +
      "p.name providerName,u.email clientEmail " +
      "FROM bookings b JOIN providers p ON p.id=b.provider_id " +
      "LEFT JOIN users u ON u.id=b.client_id ORDER BY b.created DESC"
    ).all());
  }
  if (req.params.section === "messages") {
    return res.json(db.prepare(
      "SELECT m.id,m.subject,m.message,m.created,u.name senderName,u.email senderEmail,u.role senderRole " +
      "FROM admin_messages m JOIN users u ON u.id=m.sender_id ORDER BY m.created DESC,m.id DESC"
    ).all());
  }
  return bad(res, 404, "Admin section not found.");
});

app.post("/api/messages", auth, (req, res) => {
  if (ADMIN_EMAIL && req.user.email.toLowerCase() === ADMIN_EMAIL) {
    return bad(res, 403, "Admin accounts cannot submit support messages.");
  }
  const { subject, message } = req.body || {};
  const s = String(subject || "").trim(), m = String(message || "").trim();
  if (!s || s.length > 100) return bad(res, 400, "Enter a subject of 1 to 100 characters.");
  if (!m || m.length > 2000) return bad(res, 400, "Enter a message of 1 to 2000 characters.");
  const result = db.prepare(
    "INSERT INTO admin_messages(sender_id,subject,message) VALUES(?,?,?)"
  ).run(req.user.id, s, m);
  res.status(201).json({ id: result.lastInsertRowid, ok: true });
});

app.get("/api/providers", (req, res) => res.json(db.prepare("SELECT * FROM providers ORDER BY id").all().map(pub)));
app.get("/api/providers/:id", (req, res) => {
  const p = db.prepare("SELECT * FROM providers WHERE id=?").get(req.params.id);
  p ? res.json(pub(p)) : bad(res, 404, "Provider not found.");
});

app.patch("/api/provider/profile", auth, (req, res) => {
  if (req.user.role !== "provider") return bad(res, 403, "Only providers can edit a listing.");
  const provider = db.prepare("SELECT * FROM providers WHERE user_id=?").get(req.user.id);
  if (!provider) return bad(res, 404, "Provider listing not found.");
  const { name, cat, city, rate, tag, about, tags } = req.body || {};
  const n = String(name || "").trim().slice(0, 80), c = String(city || "").trim().slice(0, 100);
  const r = Number(rate), t = String(tag || "").trim().slice(0, 160), a = String(about || "").trim().slice(0, 1000);
  const ts = Array.isArray(tags) ? [...new Set(tags.map(x => String(x).trim().slice(0, 40)).filter(Boolean))].slice(0, 10) : [];
  if (!n) return bad(res, 400, "Enter a listing name.");
  if (!CATS.includes(cat)) return bad(res, 400, "Choose a valid category.");
  if (!c) return bad(res, 400, "Enter a city.");
  if (!Number.isInteger(r) || r < 0 || r > 10000000) return bad(res, 400, "Enter a valid starting rate.");
  if (!t) return bad(res, 400, "Add a short service description.");
  if (!a) return bad(res, 400, "Add an about description.");
  if (!ts.length) return bad(res, 400, "Add at least one specialty.");
  db.prepare("UPDATE providers SET name=?,cat=?,city=?,rate=?,tag=?,about=?,tags=? WHERE id=?")
    .run(n, cat, c, r, t, a, JSON.stringify(ts), provider.id);
  res.json(pub(db.prepare("SELECT * FROM providers WHERE id=?").get(provider.id)));
});

app.get("/api/bookings", auth, (req, res) => {
  const me = userOut(req.user);
  const rows = me.role === "provider"
    ? db.prepare(BQ + " WHERE b.provider_id=? ORDER BY b.date").all(me.providerId)
    : db.prepare(BQ + " WHERE b.client_id=? ORDER BY b.created DESC").all(me.id);
  res.json(rows.map(row => ({
    ...bk(row),
    contactEmail: row.status === "Accepted"
      ? (me.role === "provider" ? row.client_email : row.provider_email) || null
      : null,
  })));
});

app.post("/api/bookings/:id/review", auth, (req, res) => {
  if (req.user.role !== "consumer") return bad(res, 403, "Only clients can rate creatives.");
  const rating = Number((req.body || {}).rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return bad(res, 400, "Choose a rating from 1 to 5 stars.");
  const result = db.transaction(() => {
    const booking = db.prepare("SELECT id,provider_id,client_id,status FROM bookings WHERE id=?").get(req.params.id);
    if (!booking) return { error: [404, "Booking not found."] };
    if (booking.client_id !== req.user.id) return { error: [403, "You can only rate your own bookings."] };
    if (booking.status !== "Accepted") return { error: [400, "You can rate a creative after the booking is accepted."] };
    if (db.prepare("SELECT 1 FROM reviews WHERE booking_id=?").get(booking.id)) {
      return { error: [409, "You have already rated this booking."] };
    }
    db.prepare("INSERT INTO reviews(booking_id,provider_id,client_id,rating) VALUES(?,?,?,?)")
      .run(booking.id, booking.provider_id, req.user.id, rating);
    return { ok: true };
  }).immediate();
  if (result.error) return bad(res, result.error[0], result.error[1]);
  res.status(201).json(result);
});

app.post("/api/bookings", auth, (req, res) => {
  if (req.user.role !== "consumer") return bad(res, 403, "Sign in with a client account to book.");
  const { providerId, date, note } = req.body || {}, nt = String(note || "").trim().slice(0, 500);
  if (!db.prepare("SELECT 1 FROM providers WHERE id=?").get(providerId)) return bad(res, 404, "Provider not found.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date)) || date < new Date().toISOString().slice(0, 10)) return bad(res, 400, "Choose a date that is today or later.");
  if (!nt) return bad(res, 400, "Describe what you need.");
  const i = db.prepare("INSERT INTO bookings(provider_id,client_id,client_name,date,note) VALUES(?,?,?,?,?)").run(providerId, req.user.id, req.user.name, date, nt);
  res.status(201).json(bk(db.prepare(BQ + " WHERE b.id=?").get(i.lastInsertRowid)));
});

app.patch("/api/bookings/:id", auth, (req, res) => {
  const b = db.prepare(BQ + " WHERE b.id=?").get(req.params.id);
  if (!b) return bad(res, 404, "Booking not found.");
  const s = (req.body || {}).status;
  const owner = db.prepare("SELECT 1 FROM providers WHERE id=? AND user_id=?").get(b.provider_id, req.user.id);
  const ok = b.status === "Pending" && ((owner && ["Accepted", "Declined"].includes(s)) || (b.client_id === req.user.id && s === "Cancelled"));
  if (!ok) return bad(res, 403, "You can’t make that change.");
  db.prepare("UPDATE bookings SET status=? WHERE id=?").run(s, b.id);
  res.json({ ok: true });
});

app.use("/api", (q, r) => bad(r, 404, "Not found."));
app.use(express.static(path.join(__dirname, "public")));
app.use((err, req, res, next) => bad(res, 400, "Invalid request."));

app.listen(PORT, () => console.log("Creativo running on http://localhost:" + PORT));
