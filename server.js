require("dotenv").config();

const express = require("express"), path = require("path"), bcrypt = require("bcryptjs"),
  jwt = require("jsonwebtoken"), crypto = require("crypto");
const { applicationDefault, cert, getApps, initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

const PORT = process.env.PORT || 3000;
const SECRET = process.env.JWT_SECRET || "dev-only-secret";
const ADMIN_EMAIL = String(process.env.ADMIN_EMAIL || "").trim().toLowerCase();
const ADMIN_SIGNUP_CODE = String(process.env.ADMIN_SIGNUP_CODE || "").trim();
if (ADMIN_SIGNUP_CODE && !/^\d{6}$/.test(ADMIN_SIGNUP_CODE)) {
  console.error("ADMIN_SIGNUP_CODE must be exactly 6 digits."); process.exit(1);
}
if (process.env.NODE_ENV === "production" && !process.env.JWT_SECRET) {
  console.error("JWT_SECRET is required in production"); process.exit(1);
}
const CATS = ["Photography", "Videography", "Events"];
const SEED = [
  ["Lumen Studio", "Photography", "Surigao City", 2500, "4.9", "Portraits, weddings and events in natural light", "A two-person team shooting weddings, graduations and family sessions across Surigao del Norte. Edited gallery delivered within a week.", ["Weddings", "Portraits", "Graduations"]],
  ["Siargao Frames", "Videography", "General Luna", 4000, "4.8", "Surf, travel and resort films", "Short films and social cuts for resorts, surf schools and travelers. Drone footage available on request.", ["Drone", "Travel", "Resorts"]],
  ["Kaya Events Co.", "Events", "Surigao City", 6000, "4.7", "Birthdays, debuts and company gatherings", "Full event planning with venue, catering and host coordination. We handle the day so you can enjoy it.", ["Debuts", "Birthdays", "Corporate"]],
  ["Tidal Reel", "Videography", "Surigao City", 3200, "4.6", "Wedding highlight reels and music videos", "Cinematic same-week highlight reels for weddings, plus music videos for local artists.", ["Weddings", "Music videos"]],
  ["Bisaya Bloom Events", "Events", "Butuan", 5500, "4.9", "Garden weddings and styled receptions", "Floral styling and coordination for intimate weddings and receptions, with a team that speaks Bisaya, Tagalog and English.", ["Weddings", "Styling"]],
  ["Pixel & Pine", "Photography", "Dapa", 1800, "4.5", "Product and food photography for local shops", "Clean product shots and menu photography for cafés, thrift stores and online sellers.", ["Products", "Food"]],
  ["Golden Hour PH", "Photography", "Surigao City", 2200, "4.8", "Couples, engagements and sunset sessions", "Relaxed couple and engagement shoots at the waterfront, in the hills and on the islands.", ["Couples", "Engagement"]],
  ["Frame by Frame", "Videography", "Butuan", 3500, "4.4", "Event coverage and short promos", "Multi-camera event coverage and 30-second promos for local businesses.", ["Events", "Promos"]],
];

function initFirestore() {
  let credential = applicationDefault();
  const rawServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const usingEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
  if (rawServiceAccount) {
    let serviceAccount;
    try { serviceAccount = JSON.parse(rawServiceAccount); }
    catch (error) {
      console.error("FIREBASE_SERVICE_ACCOUNT_JSON must contain valid service-account JSON.", error);
      process.exit(1);
    }
    if (serviceAccount.private_key) serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, "\n");
    credential = cert(serviceAccount);
  }
  const projectId = process.env.FIREBASE_PROJECT_ID || (rawServiceAccount && JSON.parse(rawServiceAccount).project_id);
  if (!rawServiceAccount && !process.env.GOOGLE_APPLICATION_CREDENTIALS && !usingEmulator) {
    console.error("Set FIREBASE_SERVICE_ACCOUNT_JSON or GOOGLE_APPLICATION_CREDENTIALS before starting Creativo.");
    process.exit(1);
  }
  if (!projectId && !process.env.GOOGLE_APPLICATION_CREDENTIALS && !usingEmulator) {
    console.error("Set FIREBASE_PROJECT_ID before starting Creativo.");
    process.exit(1);
  }
  if (!getApps().length) {
    initializeApp({ credential, ...(projectId ? { projectId } : {}) });
  }
  return getFirestore();
}

const db = initFirestore();
const users = db.collection("users"), emailIndex = db.collection("emailIndex");
const providers = db.collection("providers"), bookings = db.collection("bookings");
const messages = db.collection("admin_messages"), reviews = db.collection("reviews");
const profileReports = db.collection("profile_reports");
const now = () => new Date().toISOString();
const emailKey = email => crypto.createHash("sha256").update(email).digest("hex");
const dataOf = snap => snap.exists ? { id: snap.id, ...snap.data() } : null;
const list = async collection => (await collection.get()).docs.map(dataOf);
const SOCIAL_LINKS = ["instagram", "facebook", "tiktok", "youtube", "website"];
const isAdminUser = u => Boolean(ADMIN_EMAIL && u.email.toLowerCase() === ADMIN_EMAIL);
const bad = (res, code, msg) => res.status(code).json({ error: msg });
const sign = u => jwt.sign({ id: u.id }, SECRET, { expiresIn: "7d" });
const userOut = async u => {
  const provider = u.role === "provider" ? await getProviderByUserId(u.id) : null;
  return {
    id: u.id, name: u.name, email: u.email, role: u.role,
    isAdmin: isAdminUser(u), providerId: provider ? provider.id : null,
  };
};
async function getProviderByUserId(userId) {
  const snap = await providers.where("userId", "==", userId).limit(1).get();
  return snap.empty ? null : dataOf(snap.docs[0]);
}
async function providerOut(provider) {
  const snap = await reviews.where("providerId", "==", provider.id).get();
  const ratings = snap.docs.map(doc => doc.data().rating);
  const average = ratings.length ? ratings.reduce((sum, value) => sum + value, 0) / ratings.length : null;
  return {
    id: provider.id, name: provider.name, cat: provider.cat, city: provider.city,
    rate: provider.rate, rating: average === null ? provider.rating : average.toFixed(1),
    reviewCount: ratings.length, tag: provider.tag, about: provider.about, tags: provider.tags,
    created: provider.created || "",
    socialLinks: Object.fromEntries(SOCIAL_LINKS
      .filter(key => typeof provider.socialLinks?.[key] === "string" && provider.socialLinks[key])
      .map(key => [key, provider.socialLinks[key]])),
  };
}
function parseSocialLinks(value) {
  const links = {};
  const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  for (const key of SOCIAL_LINKS) {
    const raw = String(input[key] || "").trim();
    if (!raw) continue;
    if (raw.length > 500) return { error: "Each social link must be 500 characters or fewer." };
    let url;
    try { url = new URL(raw); }
    catch { return { error: `Enter a complete URL for ${key}.` }; }
    if (!["http:", "https:"].includes(url.protocol) || !url.hostname || url.username || url.password) {
      return { error: `Enter a valid http or https URL for ${key}.` };
    }
    links[key] = url.toString();
  }
  return { links };
}
async function bookingOut(booking, viewer) {
  const [providerSnap, reviewSnap] = await Promise.all([
    providers.doc(booking.providerId).get(), reviews.doc(booking.id).get(),
  ]);
  const provider = dataOf(providerSnap);
  if (!provider) throw new Error(`Provider ${booking.providerId} for booking ${booking.id} was not found.`);
  let contactEmail = null;
  let clientName = booking.clientName;
  if (viewer.role === "provider" && booking.clientId) {
    const clientSnap = await users.doc(booking.clientId).get();
    if (clientSnap.exists) {
      clientName = clientSnap.data().name || clientName;
      if (booking.status === "Accepted") contactEmail = clientSnap.data().email;
    }
  } else if (viewer.id === booking.clientId) {
    clientName = viewer.name;
    if (booking.status === "Accepted") {
      const providerUser = provider.userId ? await users.doc(provider.userId).get() : null;
      contactEmail = providerUser && providerUser.exists ? providerUser.data().email : null;
    }
  }
  return {
    id: booking.id, providerId: booking.providerId, providerName: provider.name,
    clientName, date: booking.date, note: booking.note,
    status: booking.status, rating: reviewSnap.exists ? reviewSnap.data().rating : null,
    contactEmail,
  };
}
async function seedData() {
  const providerSnapshot = await providers.limit(1).get();
  if (providerSnapshot.empty) {
    const batch = db.batch();
    SEED.forEach((s, index) => {
      const ref = providers.doc(String(index + 1));
      batch.set(ref, {
        name: s[0], cat: s[1], city: s[2], rate: s[3], rating: s[4],
        tag: s[5], about: s[6], tags: s[7], userId: null, created: now(),
      });
    });
    await batch.commit();
  }
  if (process.env.SEED_DEMO === "1") {
    const demoEmail = "alex@demo.ph";
    const indexRef = emailIndex.doc(emailKey(demoEmail));
    const indexSnap = await indexRef.get();
    if (!indexSnap.exists) {
      const clientId = users.doc().id, providerId = users.doc().id;
      const providerListing = await providers.doc("1").get();
      const batch = db.batch();
      batch.set(users.doc(clientId), {
        name: "Alex Reyes", email: demoEmail, password: bcrypt.hashSync("demo1234", 10),
        role: "consumer", created: now(),
      });
      batch.set(indexRef, { userId: clientId });
      batch.set(users.doc(providerId), {
        name: "Lumen Studio", email: "lumen@demo.ph", password: bcrypt.hashSync("demo1234", 10),
        role: "provider", created: now(),
      });
      batch.set(emailIndex.doc(emailKey("lumen@demo.ph")), { userId: providerId });
      if (providerListing.exists) batch.update(providerListing.ref, { userId: providerId });
      const pendingRef = bookings.doc();
      const acceptedRef = bookings.doc();
      batch.set(pendingRef, {
        providerId: "1", clientId, clientName: "Alex Reyes", date: "2026-12-14",
        note: "Birthday shoot for about 20 guests", status: "Pending", created: now(),
      });
      batch.set(acceptedRef, {
        providerId: "1", clientId, clientName: "Alex Reyes", date: "2026-12-21",
        note: "Product photos for a coffee shop", status: "Accepted", created: now(),
      });
      await batch.commit();
    }
  }
  const existingProviders = await providers.get();
  await Promise.all(existingProviders.docs.map(async providerSnap => {
    const provider = providerSnap.data();
    if (provider.created) return;
    const account = provider.userId ? dataOf(await users.doc(provider.userId).get()) : null;
    await providerSnap.ref.update({ created: account?.created || "2000-01-01T00:00:00.000Z" });
  }));
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}
async function auth(req, res, next) {
  try {
    const { id } = jwt.verify((req.headers.authorization || "").replace("Bearer ", ""), SECRET);
    const userSnap = await users.doc(String(id)).get();
    const user = dataOf(userSnap);
    if (!user) return bad(res, 401, "Please sign in again.");
    req.user = user;
    next();
  } catch (error) {
    if (error.name === "JsonWebTokenError" || error.name === "TokenExpiredError") {
      return bad(res, 401, "Please sign in again.");
    }
    next(error);
  }
}
function adminOnly(req, res, next) {
  if (!ADMIN_EMAIL) return bad(res, 503, "Admin access is not configured.");
  if (req.user.email.toLowerCase() !== ADMIN_EMAIL) return bad(res, 403, "Admin access required.");
  next();
}
const hits = new Map();
function limit(req, res, next) {
  const current = Date.now(), attempts = (hits.get(req.ip) || []).filter(t => current - t < 60000);
  if (attempts.length >= 10) return bad(res, 429, "Too many attempts. Try again in a minute.");
  attempts.push(current); hits.set(req.ip, attempts); next();
}

const app = express();
app.disable("x-powered-by"); app.set("trust proxy", 1); app.use(express.json({ limit: "50kb" }));
app.get("/api/health", (req, res) => res.json({ ok: true }));

app.post("/api/signup", limit, asyncRoute(async (req, res) => {
  const { name, email, password, role, category, adminCode } = req.body || {};
  const n = String(name || "").trim().slice(0, 80), e = String(email || "").trim().toLowerCase();
  if (!n) return bad(res, 400, "Enter your name.");
  if (!/^\S+@\S+\.\S+$/.test(e)) return bad(res, 400, "Enter a valid email address.");
  if (String(password || "").length < 6) return bad(res, 400, "Password must be at least 6 characters.");
  if (role === "admin" && (!ADMIN_EMAIL || e !== ADMIN_EMAIL)) {
    return bad(res, 403, "Admin signup is restricted to the configured admin email.");
  }
  if (role === "admin" && !ADMIN_SIGNUP_CODE) {
    return bad(res, 503, "Admin signup code is not configured.");
  }
  if (role === "admin" && String(adminCode || "") !== ADMIN_SIGNUP_CODE) {
    return bad(res, 403, "Incorrect admin signup code.");
  }
  if (ADMIN_EMAIL && e === ADMIN_EMAIL && role !== "admin") {
    return bad(res, 403, "Choose Admin for this email address.");
  }
  const accountRole = role === "provider" ? "provider" : "consumer";
  const userRef = users.doc(), indexRef = emailIndex.doc(emailKey(e));
  const providerRef = accountRole === "provider" ? providers.doc() : null;
  const user = {
    id: userRef.id, name: n, email: e, password: bcrypt.hashSync(String(password), 10),
    role: accountRole, created: now(),
  };
  try {
    await db.runTransaction(async transaction => {
      if ((await transaction.get(indexRef)).exists) {
        const error = new Error("That email already has an account. Sign in instead.");
        error.status = 409; throw error;
      }
      transaction.create(userRef, {
        name: user.name, email: user.email, password: user.password, role: user.role, created: user.created,
      });
      transaction.create(indexRef, { userId: userRef.id });
      if (providerRef) transaction.create(providerRef, {
        userId: userRef.id, name: n, cat: CATS.includes(category) ? category : "Photography",
        city: "Surigao City", rate: 2000, rating: "New", tag: "New on Creativo",
        about: "Say hello to your new profile. Add your story, packages and portfolio.",
        tags: ["New"], created: user.created,
      });
    });
  } catch (error) {
    if (error.status === 409) return bad(res, error.status, error.message);
    throw error;
  }
  res.json({ token: sign(user), user: await userOut(user) });
}));

app.post("/api/login", limit, asyncRoute(async (req, res) => {
  const { email, password } = req.body || {};
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const indexSnap = await emailIndex.doc(emailKey(normalizedEmail)).get();
  const userSnap = indexSnap.exists ? await users.doc(indexSnap.data().userId).get() : null;
  const user = userSnap ? dataOf(userSnap) : null;
  if (!user || !bcrypt.compareSync(String(password || ""), user.password)) {
    return bad(res, 401, "Incorrect email or password.");
  }
  res.json({ token: sign(user), user: await userOut(user) });
}));

app.get("/api/me", auth, asyncRoute(async (req, res) => res.json({ user: await userOut(req.user) })));

app.patch("/api/profile", auth, asyncRoute(async (req, res) => {
  const { name, email, currentPassword, password } = req.body || {};
  const n = String(name || "").trim();
  const e = String(email || "").trim().toLowerCase();
  const nextPassword = String(password || "");
  const emailChanged = e !== req.user.email;
  if (!n || n.length > 80) return bad(res, 400, "Enter a name of 1 to 80 characters.");
  if (!/^\S+@\S+\.\S+$/.test(e)) return bad(res, 400, "Enter a valid email address.");
  if (nextPassword && nextPassword.length < 6) return bad(res, 400, "New password must be at least 6 characters.");
  if (emailChanged && isAdminUser(req.user)) return bad(res, 403, "The admin email is managed by the server configuration.");
  if ((emailChanged || nextPassword) &&
      (!currentPassword || !bcrypt.compareSync(String(currentPassword), req.user.password))) {
    return bad(res, 403, "Enter your current password to change your email or password.");
  }
  const userRef = users.doc(req.user.id);
  const oldIndexRef = emailIndex.doc(emailKey(req.user.email));
  const newIndexRef = emailIndex.doc(emailKey(e));
  const updates = { name: n };
  if (emailChanged) updates.email = e;
  if (nextPassword) updates.password = bcrypt.hashSync(nextPassword, 10);
  try {
    await db.runTransaction(async transaction => {
      const currentUserSnap = await transaction.get(userRef);
      if (!currentUserSnap.exists) {
        const error = new Error("Please sign in again.");
        error.status = 401; throw error;
      }
      if (emailChanged) {
        const newIndexSnap = await transaction.get(newIndexRef);
        if (newIndexSnap.exists) {
          const error = new Error("That email already has an account.");
          error.status = 409; throw error;
        }
      }
      transaction.update(userRef, updates);
      if (emailChanged) {
        transaction.delete(oldIndexRef);
        transaction.create(newIndexRef, { userId: req.user.id });
      }
    });
  } catch (error) {
    if (error.status) return bad(res, error.status, error.message);
    throw error;
  }
  res.json({ user: await userOut({ ...req.user, ...updates }) });
}));

app.get("/api/admin/overview", auth, adminOnly, asyncRoute(async (req, res) => {
  const [allUsers, allProviders, allBookings, allMessages, allReports] = await Promise.all([
    list(users), list(providers), list(bookings), list(messages), list(profileReports),
  ]);
  const recentUsers = allUsers.sort((a, b) => b.created.localeCompare(a.created)).slice(0, 6)
    .map(user => ({ id: user.id, name: user.name, email: user.email, role: user.role, created: user.created, isAdmin: isAdminUser(user) }));
  const recentBookings = await Promise.all(allBookings
    .sort((a, b) => b.created.localeCompare(a.created)).slice(0, 6)
    .map(async booking => {
      const providerSnap = await providers.doc(booking.providerId).get();
      return {
        id: booking.id, clientName: booking.clientName, date: booking.date,
        status: booking.status, created: booking.created,
        providerName: providerSnap.exists ? providerSnap.data().name : "Unknown provider",
      };
    }));
  res.json({
    counts: {
      totalUsers: allUsers.length,
      totalClients: allUsers.filter(user => user.role === "consumer" && !isAdminUser(user)).length,
      totalProviders: allProviders.length, totalBookings: allBookings.length,
      pendingBookings: allBookings.filter(booking => booking.status === "Pending").length,
      totalMessages: allMessages.length,
      openReports: allReports.filter(report => report.status === "Open").length,
    },
    recentUsers, recentBookings,
  });
}));

app.get("/api/admin/:section", auth, adminOnly, asyncRoute(async (req, res) => {
  const section = req.params.section;
  if (section === "users") {
    const rows = await list(users);
    return res.json(rows.map(user => ({
      id: user.id, name: user.name, email: user.email, role: user.role,
      created: user.created, isAdmin: isAdminUser(user),
    })));
  }
  if (section === "providers") {
    const rows = await list(providers);
    return res.json(await Promise.all(rows.map(async provider => {
      const providerUser = provider.userId ? await users.doc(provider.userId).get() : null;
      const publicProfile = await providerOut(provider);
      return { ...publicProfile, accountEmail: providerUser && providerUser.exists ? providerUser.data().email : null };
    })));
  }
  if (section === "bookings") {
    const rows = await list(bookings);
    return res.json(await Promise.all(rows.map(async booking => {
      const [providerSnap, clientSnap] = await Promise.all([
        providers.doc(booking.providerId).get(),
        booking.clientId ? users.doc(booking.clientId).get() : null,
      ]);
      const provider = dataOf(providerSnap);
      const client = clientSnap ? dataOf(clientSnap) : null;
      return {
        id: booking.id, clientName: booking.clientName, clientEmail: client ? client.email : null,
        providerName: provider ? provider.name : "Unknown provider", date: booking.date,
        note: booking.note, status: booking.status, created: booking.created,
      };
    })));
  }
  if (section === "messages") {
    const rows = await list(messages);
    return res.json(await Promise.all(rows.map(async message => {
      const senderSnap = await users.doc(message.senderId).get();
      const sender = dataOf(senderSnap);
      return {
        id: message.id, subject: message.subject, message: message.message, created: message.created,
        senderName: sender ? sender.name : "Unknown sender",
        senderEmail: sender ? sender.email : "", senderRole: sender ? sender.role : "",
      };
    })));
  }
  if (section === "reports") {
    const rows = await list(profileReports);
    rows.sort((a, b) => String(b.created || "").localeCompare(String(a.created || "")));
    return res.json(await Promise.all(rows.map(async report => {
      const [providerSnap, reporterSnap] = await Promise.all([
        providers.doc(report.providerId).get(), users.doc(report.reporterId).get(),
      ]);
      const provider = dataOf(providerSnap), reporter = dataOf(reporterSnap);
      return {
        id: report.id, providerId: report.providerId,
        providerName: provider ? provider.name : "Deleted profile",
        reporterName: reporter ? reporter.name : "Deleted account",
        reporterEmail: reporter ? reporter.email : "",
        reason: report.reason, details: report.details, status: report.status, created: report.created,
      };
    })));
  }
  return bad(res, 404, "Admin section not found.");
}));

app.patch("/api/admin/reports/:id", auth, adminOnly, asyncRoute(async (req, res) => {
  const status = String((req.body || {}).status || "");
  if (!["Reviewed", "Dismissed"].includes(status)) return bad(res, 400, "Choose Reviewed or Dismissed.");
  const reportRef = profileReports.doc(req.params.id);
  const reportSnap = await reportRef.get();
  if (!reportSnap.exists) return bad(res, 404, "Profile report not found.");
  await reportRef.update({ status, reviewed: now() });
  res.json({ ok: true });
}));

app.post("/api/messages", auth, asyncRoute(async (req, res) => {
  if (isAdminUser(req.user)) return bad(res, 403, "Admin accounts cannot submit support messages.");
  const { subject, message } = req.body || {};
  const s = String(subject || "").trim(), m = String(message || "").trim();
  if (!s || s.length > 100) return bad(res, 400, "Enter a subject of 1 to 100 characters.");
  if (!m || m.length > 2000) return bad(res, 400, "Enter a message of 1 to 2000 characters.");
  const ref = await messages.add({ senderId: req.user.id, subject: s, message: m, created: now() });
  res.status(201).json({ id: ref.id, ok: true });
}));

app.get("/api/providers", asyncRoute(async (req, res) => {
  const [providerRows, bookingRows] = await Promise.all([list(providers), list(bookings)]);
  const bookingCounts = new Map();
  for (const booking of bookingRows) bookingCounts.set(booking.providerId, (bookingCounts.get(booking.providerId) || 0) + 1);
  const result = await Promise.all(providerRows.map(async provider => {
    const account = !provider.created && provider.userId ? dataOf(await users.doc(provider.userId).get()) : null;
    return {
      ...await providerOut(provider),
      created: provider.created || account?.created || "",
      bookingCount: bookingCounts.get(provider.id) || 0,
    };
  }));
  res.json(result);
}));
app.get("/api/providers/:id", asyncRoute(async (req, res) => {
  const provider = dataOf(await providers.doc(req.params.id).get());
  if (!provider) return bad(res, 404, "Provider not found.");
  res.json(await providerOut(provider));
}));

app.post("/api/providers/:id/report", auth, limit, asyncRoute(async (req, res) => {
  const providerRef = providers.doc(req.params.id), providerSnap = await providerRef.get();
  if (!providerSnap.exists) return bad(res, 404, "Provider profile not found.");
  const provider = dataOf(providerSnap);
  if (provider.userId === req.user.id) return bad(res, 403, "You cannot report your own profile.");
  const { reason, details } = req.body || {};
  const allowedReasons = ["Fake or misleading profile", "Inappropriate content", "Scam or suspicious behavior", "Other"];
  const reportReason = String(reason || "").trim();
  const reportDetails = String(details || "").trim();
  if (!allowedReasons.includes(reportReason)) return bad(res, 400, "Choose a report reason.");
  if (reportDetails.length > 1000) return bad(res, 400, "Additional details must be 1000 characters or fewer.");
  const reportId = crypto.createHash("sha256").update(`${provider.id}:${req.user.id}`).digest("hex");
  const reportRef = profileReports.doc(reportId);
  const result = await db.runTransaction(async transaction => {
    const existing = await transaction.get(reportRef);
    if (existing.exists) return { error: [409, "You have already reported this profile."] };
    transaction.create(reportRef, {
      providerId: provider.id, reporterId: req.user.id,
      reason: reportReason, details: reportDetails, status: "Open", created: now(),
    });
    return { ok: true };
  });
  if (result.error) return bad(res, result.error[0], result.error[1]);
  res.status(201).json({ ok: true });
}));

app.patch("/api/provider/profile", auth, asyncRoute(async (req, res) => {
  if (req.user.role !== "provider") return bad(res, 403, "Only providers can edit a listing.");
  const provider = await getProviderByUserId(req.user.id);
  if (!provider) return bad(res, 404, "Provider listing not found.");
  const { name, cat, city, rate, tag, about, tags, socialLinks } = req.body || {};
  const n = String(name || "").trim().slice(0, 80), c = String(city || "").trim().slice(0, 100);
  const r = Number(rate), t = String(tag || "").trim().slice(0, 160), a = String(about || "").trim().slice(0, 1000);
  const ts = Array.isArray(tags) ? [...new Set(tags.map(x => String(x).trim().slice(0, 40)).filter(Boolean))].slice(0, 10) : [];
  const parsedLinks = parseSocialLinks(socialLinks);
  if (parsedLinks.error) return bad(res, 400, parsedLinks.error);
  if (!n) return bad(res, 400, "Enter a listing name.");
  if (!CATS.includes(cat)) return bad(res, 400, "Choose a valid category.");
  if (!c) return bad(res, 400, "Enter a city.");
  if (!Number.isInteger(r) || r < 0 || r > 10000000) return bad(res, 400, "Enter a valid starting rate.");
  if (!t) return bad(res, 400, "Add a short service description.");
  if (!a) return bad(res, 400, "Add an about description.");
  if (!ts.length) return bad(res, 400, "Add at least one specialty.");
  await providers.doc(provider.id).update({ name: n, cat, city: c, rate: r, tag: t, about: a, tags: ts, socialLinks: parsedLinks.links });
  res.json(await providerOut({ ...provider, name: n, cat, city: c, rate: r, tag: t, about: a, tags: ts, socialLinks: parsedLinks.links }));
}));

app.get("/api/bookings", auth, asyncRoute(async (req, res) => {
  const provider = req.user.role === "provider" ? await getProviderByUserId(req.user.id) : null;
  if (req.user.role === "provider" && !provider) return res.json([]);
  const query = req.user.role === "provider"
    ? bookings.where("providerId", "==", provider.id)
    : bookings.where("clientId", "==", req.user.id);
  const rows = (await query.get()).docs.map(dataOf);
  rows.sort((a, b) => req.user.role === "provider"
    ? a.date.localeCompare(b.date) : b.created.localeCompare(a.created));
  res.json(await Promise.all(rows.map(booking => bookingOut(booking, req.user))));
}));

app.post("/api/bookings/:id/review", auth, asyncRoute(async (req, res) => {
  if (req.user.role !== "consumer") return bad(res, 403, "Only clients can rate creatives.");
  const rating = Number((req.body || {}).rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return bad(res, 400, "Choose a rating from 1 to 5 stars.");
  const bookingRef = bookings.doc(req.params.id), reviewRef = reviews.doc(req.params.id);
  const result = await db.runTransaction(async transaction => {
    const bookingSnap = await transaction.get(bookingRef);
    if (!bookingSnap.exists) return { error: [404, "Booking not found."] };
    const booking = dataOf(bookingSnap);
    if (booking.clientId !== req.user.id) return { error: [403, "You can only rate your own bookings."] };
    if (booking.status !== "Accepted") return { error: [400, "You can rate a creative after the booking is accepted."] };
    if ((await transaction.get(reviewRef)).exists) return { error: [409, "You have already rated this booking."] };
    transaction.create(reviewRef, {
      bookingId: booking.id, providerId: booking.providerId, clientId: req.user.id, rating, created: now(),
    });
    return { ok: true };
  });
  if (result.error) return bad(res, result.error[0], result.error[1]);
  res.status(201).json(result);
}));

app.post("/api/bookings", auth, asyncRoute(async (req, res) => {
  if (req.user.role !== "consumer") return bad(res, 403, "Sign in with a client account to book.");
  const { providerId, date, note } = req.body || {}, nt = String(note || "").trim().slice(0, 500);
  const provider = dataOf(await providers.doc(String(providerId || "")).get());
  if (!provider) return bad(res, 404, "Provider not found.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date)) || date < now().slice(0, 10)) return bad(res, 400, "Choose a date that is today or later.");
  if (!nt) return bad(res, 400, "Describe what you need.");
  const ref = await bookings.add({
    providerId: provider.id, clientId: req.user.id, clientName: req.user.name,
    date, note: nt, status: "Pending", created: now(),
  });
  res.status(201).json(await bookingOut({ id: ref.id, providerId: provider.id, clientId: req.user.id, clientName: req.user.name, date, note: nt, status: "Pending", created: now() }, req.user));
}));

app.patch("/api/bookings/:id", auth, asyncRoute(async (req, res) => {
  const bookingRef = bookings.doc(req.params.id);
  const bookingSnap = await bookingRef.get();
  if (!bookingSnap.exists) return bad(res, 404, "Booking not found.");
  const booking = dataOf(bookingSnap), status = (req.body || {}).status;
  const provider = req.user.role === "provider" ? await getProviderByUserId(req.user.id) : null;
  const isOwner = provider && provider.id === booking.providerId;
  const allowed = booking.status === "Pending" &&
    ((isOwner && ["Accepted", "Declined"].includes(status)) ||
     (booking.clientId === req.user.id && status === "Cancelled"));
  if (!allowed) return bad(res, 403, "You can’t make that change.");
  await bookingRef.update({ status });
  res.json({ ok: true });
}));

app.use("/api", (req, res) => bad(res, 404, "Not found."));
app.use(express.static(path.join(__dirname, "public")));
app.use((err, req, res, next) => {
  console.error("Request failed:", err);
  if (res.headersSent) return next(err);
  bad(res, err.status || 500, err.status ? err.message : "The request could not be completed. Please try again.");
});

seedData().then(() => {
  app.listen(PORT, () => console.log("Creativo running on http://localhost:" + PORT));
}).catch(error => {
  console.error("Could not initialize Firestore data:", error);
  process.exit(1);
});
