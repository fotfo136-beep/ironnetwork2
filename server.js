const express = require('express');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const { v4: uuid } = require('uuid');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// ═══════════════════════════════════════
// JSON FILE DATABASE (No native modules needed)
// ═══════════════════════════════════════
const DB_FILE = path.join(__dirname, 'data.json');

function loadDB() {
  try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
  catch(e) { return { users: {}, locals: {}, posts: {}, props: {}, messages: [], vouches: [], certs: {}, localMembers: {} }; }
}
function saveDB(db) { fs.writeFileSync(DB_FILE, JSON.stringify(db), 'utf8'); }

// Seed locals
function seedDB() {
  const db = loadDB();
  const seeds = [
    { id:'welders', name:'Welders Local', emoji:'🔥', desc:'TIG, MIG, Stick & everything in between' },
    { id:'electricians', name:'Electricians Local', emoji:'⚡', desc:'Code talk, panels, data centers' },
    { id:'ironworkers', name:'Ironworkers Local', emoji:'🔩', desc:'Structural steel, rebar, ornamental' },
    { id:'plumbers', name:'Plumbers Local', emoji:'🔧', desc:'Copper, PEX, cast iron' },
    { id:'carpenters', name:'Carpenters Local', emoji:'🪚', desc:'Framing, finish, cabinetry' },
    { id:'hvac', name:'HVAC Local', emoji:'❄️', desc:'Heating, cooling, ventilation' },
    { id:'operators', name:'Operators Local', emoji:'🏗️', desc:'Cranes, excavators, heavy equipment' },
    { id:'safety', name:'Safety First', emoji:'🛡️', desc:'OSHA updates, toolbox talks, PPE' },
    { id:'general', name:'The Yard — General', emoji:'🏠', desc:'Open talk for all trades' }
  ];
  seeds.forEach(s => { if (!db.locals[s.id]) db.locals[s.id] = s; });
  saveDB(db);
}
seedDB();

const tradeLocal = { 'Welder':'welders','Electrician':'electricians','Ironworker':'ironworkers','Plumber':'plumbers','Carpenter':'carpenters','HVAC':'hvac','Operator':'operators','Mason':'general' };

function getRank(y) {
  if (!y) return 'apprentice';
  const s = y.toLowerCase().replace(/\s/g,'');
  if (s.includes('20+')) return 'legend';
  if (s.includes('10-20')) return 'foreman';
  if (s.includes('5-10')||s.includes('3-5')) return 'journeyman';
  return 'apprentice';
}

// ═══════════════════════════════════════
// MIDDLEWARE
// ═══════════════════════════════════════
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const uploadsDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (r, f, cb) => cb(null, uploadsDir),
  filename: (r, f, cb) => cb(null, uuid() + path.extname(f.originalname))
});
const upload = multer({ storage, limits: { fileSize: 10*1024*1024 } });

function auth(req, res, next) {
  const t = req.headers['x-token'];
  if (!t) return res.status(401).json({ error:'Not logged in' });
  const db = loadDB();
  if (!db.users[t]) return res.status(401).json({ error:'Invalid session' });
  req.user = db.users[t];
  req.userId = t;
  next();
}

function getPublicUser(db, id) {
  const u = db.users[id];
  if (!u) return null;
  const vouches = db.vouches.filter(v => v.to === id);
  const vouchTotal = [...new Set(vouches.map(v => v.from))].length;
  const postCount = Object.values(db.posts).filter(p => p.userId === id).length;
  const userLocals = Object.entries(db.localMembers).filter(([k]) => k.startsWith(id+'|')).map(([k]) => {
    const lid = k.split('|')[1];
    return db.locals[lid];
  }).filter(Boolean);
  const certs = db.certs[id] || [];
  return { id, name:u.name, phone:u.phone, trade:u.trade, location:u.location, years:u.years, bio:u.bio||'', avatar:u.avatar||'', rank:u.rank, available:u.available, created_at:u.created_at, vouches:vouchTotal, posts_count:postCount, locals:userLocals, certs };
}

// ═══════════════════════════════════════
// AUTH
// ═══════════════════════════════════════
app.post('/api/signup', (req, res) => {
  const { phone, name, trade, location, years, password } = req.body;
  if (!phone||!name||!trade||!password) return res.status(400).json({ error:'Missing fields' });
  const db = loadDB();
  const exists = Object.values(db.users).find(u => u.phone === phone);
  if (exists) return res.status(400).json({ error:'Phone already registered' });
  const id = uuid();
  db.users[id] = { phone, name, trade, location:location||'', years:years||'', bio:'', avatar:'', rank:getRank(years), available:1, password:bcrypt.hashSync(password,10), created_at:new Date().toISOString() };
  const lid = tradeLocal[trade]||'general';
  db.localMembers[id+'|'+lid] = { joined: new Date().toISOString() };
  db.localMembers[id+'|general'] = { joined: new Date().toISOString() };
  db.certs[id] = [];
  saveDB(db);
  res.json({ token:id, user:getPublicUser(db,id) });
});

app.post('/api/login', (req, res) => {
  const { phone, password } = req.body;
  if (!phone||!password) return res.status(400).json({ error:'Missing fields' });
  const db = loadDB();
  const entry = Object.entries(db.users).find(([_,u]) => u.phone === phone);
  if (!entry||!bcrypt.compareSync(password, entry[1].password)) return res.status(401).json({ error:'Wrong phone or password' });
  res.json({ token:entry[0], user:getPublicUser(db,entry[0]) });
});

// ═══════════════════════════════════════
// USER
// ═══════════════════════════════════════
app.get('/api/me', auth, (req, res) => { res.json(getPublicUser(loadDB(), req.userId)); });

app.put('/api/me', auth, (req, res) => {
  const db = loadDB();
  const u = db.users[req.userId];
  const { name,trade,location,years,bio,available } = req.body;
  if (name) u.name=name; if (trade) u.trade=trade; if (location!==undefined) u.location=location;
  if (years) { u.years=years; u.rank=getRank(years); } if (bio!==undefined) u.bio=bio;
  if (available!==undefined) u.available=available?1:0;
  saveDB(db);
  res.json(getPublicUser(db, req.userId));
});

app.post('/api/me/avatar', auth, upload.single('avatar'), (req, res) => {
  if (!req.file) return res.status(400).json({ error:'No file' });
  const db = loadDB();
  db.users[req.userId].avatar = '/uploads/'+req.file.filename;
  saveDB(db);
  res.json({ avatar:'/uploads/'+req.file.filename });
});

app.get('/api/users/:id', (req, res) => {
  const u = getPublicUser(loadDB(), req.params.id);
  if (!u) return res.status(404).json({ error:'Not found' });
  res.json(u);
});

app.get('/api/users', auth, (req, res) => {
  const db = loadDB();
  const q = (req.query.q||'').toLowerCase();
  let ids = Object.keys(db.users).filter(id => id !== req.userId);
  if (q) ids = ids.filter(id => db.users[id].name.toLowerCase().includes(q));
  res.json(ids.slice(0,30).map(id => getPublicUser(db,id)));
});

// ═══════════════════════════════════════
// LOCALS
// ═══════════════════════════════════════
app.get('/api/locals', auth, (req, res) => {
  const db = loadDB();
  res.json(Object.entries(db.locals).map(([id,l]) => {
    const members = Object.keys(db.localMembers).filter(k => k.endsWith('|'+id)).length;
    const joined = !!db.localMembers[req.userId+'|'+id];
    return { id, ...l, members, joined };
  }));
});

app.post('/api/locals/:id/join', auth, (req, res) => {
  const db = loadDB();
  db.localMembers[req.userId+'|'+req.params.id] = { joined:new Date().toISOString() };
  saveDB(db);
  res.json({ ok:true });
});

app.delete('/api/locals/:id/leave', auth, (req, res) => {
  const db = loadDB();
  delete db.localMembers[req.userId+'|'+req.params.id];
  saveDB(db);
  res.json({ ok:true });
});

// ═══════════════════════════════════════
// POSTS
// ═══════════════════════════════════════
app.get('/api/posts', auth, (req, res) => {
  const db = loadDB();
  const lid = req.query.local;
  let posts = Object.entries(db.posts).map(([id,p]) => ({ id, ...p }));
  if (lid) {
    posts = posts.filter(p => p.localId === lid);
  } else {
    const myLocals = Object.keys(db.localMembers).filter(k => k.startsWith(req.userId+'|')).map(k => k.split('|')[1]);
    posts = posts.filter(p => myLocals.includes(p.localId) || p.userId === req.userId);
  }
  posts.sort((a,b) => new Date(b.created_at)-new Date(a.created_at));
  posts = posts.slice(0,50).map(p => {
    const u = db.users[p.userId]||{};
    const l = db.locals[p.localId]||{};
    const propsCount = Object.keys(db.props).filter(k => k.endsWith('|'+p.id)).length;
    const userPropped = !!db.props[req.userId+'|'+p.id];
    return { ...p, user_name:u.name, user_trade:u.trade, user_avatar:u.avatar, user_rank:u.rank, local_name:l.name, local_emoji:l.emoji, props_count:propsCount, user_propped:userPropped };
  });
  res.json(posts);
});

app.post('/api/posts', auth, upload.single('image'), (req, res) => {
  const { content, local_id } = req.body;
  if (!content) return res.status(400).json({ error:'Content required' });
  const db = loadDB();
  const id = uuid();
  db.posts[id] = { userId:req.userId, localId:local_id||null, content, image:req.file?'/uploads/'+req.file.filename:'', created_at:new Date().toISOString() };
  saveDB(db);
  res.json({ id });
});

app.post('/api/posts/:id/props', auth, (req, res) => {
  const db = loadDB();
  const key = req.userId+'|'+req.params.id;
  if (db.props[key]) { delete db.props[key]; saveDB(db); res.json({ propped:false }); }
  else { db.props[key] = true; saveDB(db); res.json({ propped:true }); }
});

app.delete('/api/posts/:id', auth, (req, res) => {
  const db = loadDB();
  if (db.posts[req.params.id]?.userId === req.userId) delete db.posts[req.params.id];
  Object.keys(db.props).filter(k => k.endsWith('|'+req.params.id)).forEach(k => delete db.props[k]);
  saveDB(db);
  res.json({ ok:true });
});

// ═══════════════════════════════════════
// MESSAGES
// ═══════════════════════════════════════
app.get('/api/messages/conversations', auth, (req, res) => {
  const db = loadDB();
  const others = new Set();
  db.messages.forEach(m => { if(m.from===req.userId) others.add(m.to); if(m.to===req.userId) others.add(m.from); });
  const convos = [...others].map(oid => {
    const msgs = db.messages.filter(m => (m.from===req.userId&&m.to===oid)||(m.from===oid&&m.to===req.userId));
    const last = msgs[msgs.length-1];
    const unread = msgs.filter(m => m.from===oid&&m.to===req.userId&&!m.read).length;
    return { other:getPublicUser(db,oid), last_message:last, unread };
  }).filter(c => c.other);
  convos.sort((a,b) => new Date(b.last_message?.created_at||0)-new Date(a.last_message?.created_at||0));
  res.json(convos);
});

app.get('/api/messages/:userId', auth, (req, res) => {
  const db = loadDB();
  const msgs = db.messages.filter(m => (m.from===req.userId&&m.to===req.params.userId)||(m.from===req.params.userId&&m.to===req.userId));
  msgs.forEach(m => { if(m.from===req.params.userId&&m.to===req.userId) m.read=1; });
  saveDB(db);
  res.json(msgs);
});

app.post('/api/messages', auth, (req, res) => {
  const { to_id, content } = req.body;
  if (!to_id||!content) return res.status(400).json({ error:'Missing fields' });
  const db = loadDB();
  const id = uuid();
  db.messages.push({ id, from:req.userId, to:to_id, content, read:0, created_at:new Date().toISOString() });
  saveDB(db);
  res.json({ id });
});

// ═══════════════════════════════════════
// VOUCHES
// ═══════════════════════════════════════
app.get('/api/users/:id/vouches', (req, res) => {
  const db = loadDB();
  const vs = db.vouches.filter(v => v.to === req.params.id);
  const cats = {};
  vs.forEach(v => { cats[v.category] = (cats[v.category]||0)+1; });
  const vouches = Object.entries(cats).map(([category,count]) => ({ category, count }));
  const total = [...new Set(vs.map(v => v.from))].length;
  res.json({ vouches, total });
});

app.post('/api/users/:id/vouch', auth, (req, res) => {
  const { category } = req.body;
  if (!category) return res.status(400).json({ error:'Category required' });
  if (req.params.id===req.userId) return res.status(400).json({ error:"Can't vouch for yourself" });
  const db = loadDB();
  const exists = db.vouches.find(v => v.from===req.userId&&v.to===req.params.id&&v.category===category);
  if (!exists) { db.vouches.push({ from:req.userId, to:req.params.id, category, created_at:new Date().toISOString() }); saveDB(db); }
  res.json({ ok:true });
});

// ═══════════════════════════════════════
// CERTS
// ═══════════════════════════════════════
app.get('/api/me/certs', auth, (req, res) => { res.json(loadDB().certs[req.userId]||[]); });

app.post('/api/me/certs', auth, (req, res) => {
  const { name, expires } = req.body;
  if (!name) return res.status(400).json({ error:'Name required' });
  const db = loadDB();
  if (!db.certs[req.userId]) db.certs[req.userId] = [];
  const id = uuid();
  db.certs[req.userId].push({ id, name, expires:expires||'', status:'active' });
  saveDB(db);
  res.json({ id });
});

app.delete('/api/me/certs/:id', auth, (req, res) => {
  const db = loadDB();
  if (db.certs[req.userId]) db.certs[req.userId] = db.certs[req.userId].filter(c => c.id !== req.params.id);
  saveDB(db);
  res.json({ ok:true });
});

// SPA fallback
app.use((req, res) => { res.sendFile(path.join(__dirname, 'public', 'index.html')); });

app.listen(PORT, () => { console.log(`\n⚒️  IRONnetWORK running at http://localhost:${PORT}\n`); });
