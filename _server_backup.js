// .env 파일을 읽어 설정을 불러온다 (별도 꾸러미 없이 간단히)
(function () {
  try {
    const fs = require('fs'), path = require('path');
    const f = path.join(__dirname, '.env');
    if (!fs.existsSync(f)) return;
    const lines = fs.readFileSync(f, 'utf8').split(String.fromCharCode(10));
    for (const raw of lines) {
      const line = raw.trim();
      const i = line.indexOf('=');
      if (i < 1 || line.charAt(0) === '#') continue;
      const k = line.slice(0, i).trim(), v = line.slice(i + 1).trim();
      if (k && !process.env[k]) process.env[k] = v;
    }
  } catch (e) {}
})();

// 가계부 저장 서버
//
// 왜 필요한가
//   지금까지는 브라우저 안(localStorage)에만 저장해서 폰과 PC가 따로 놀았다.
//   이 서버가 자료를 한 곳에 두고, 어느 기기에서 열어도 같은 내용을 보게 한다.
//
// 저장 방식
//   자료는 JSON 파일 하나에 통째로 담는다. 쓰는 사람이 둘뿐이고 양도 작아서
//   데이터베이스를 둘 만큼은 아니다. 저장할 때마다 임시 파일에 먼저 쓰고
//   이름을 바꿔치기해서, 쓰다가 멈춰도 파일이 깨지지 않게 한다.
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3008;
const BASE = __dirname;
const DATA = path.join(BASE, 'data', 'store.json');
const BACKUP_DIR = path.join(BASE, 'data', 'backup');
const PASS = process.env.BANK_PASS || '';
const SECRET = process.env.BANK_SECRET || 'zzbit-bank';

fs.mkdirSync(path.dirname(DATA), { recursive: true });
fs.mkdirSync(BACKUP_DIR, { recursive: true });

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '4mb' }));

// ── 자료 읽고 쓰기 ──────────────────────────────────────────
function load() {
  try { return JSON.parse(fs.readFileSync(DATA, 'utf8')); }
  catch (e) { return {}; }
}
function save(obj) {
  const tmp = DATA + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj), 'utf8');
  fs.renameSync(tmp, DATA);                 // 통째로 갈아끼워야 깨지지 않는다
}

// 하루에 한 번 사본을 남긴다. 실수로 지워도 되돌릴 수 있게.
function backupDaily(obj) {
  const d = new Date();
  const day = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')
            + '-' + String(d.getDate()).padStart(2, '0');
  const f = path.join(BACKUP_DIR, 'store-' + day + '.json');
  if (!fs.existsSync(f)) {
    try {
      fs.writeFileSync(f, JSON.stringify(obj), 'utf8');
      // 30일치만 남기고 정리
      const olds = fs.readdirSync(BACKUP_DIR).filter(x => x.startsWith('store-')).sort();
      while (olds.length > 30) fs.unlinkSync(path.join(BACKUP_DIR, olds.shift()));
    } catch (e) {}
  }
}

// ── 로그인 ──────────────────────────────────────────────────
// 가계부는 사적인 자료라 아무나 열면 안 된다. 비밀번호 하나로 막는다.
function makeToken() {
  const exp = Date.now() + 90 * 24 * 3600 * 1000;      // 90일
  const sig = crypto.createHmac('sha256', SECRET).update(String(exp)).digest('hex').slice(0, 32);
  return exp + '.' + sig;
}
function validToken(t) {
  if (!t || t.indexOf('.') < 0) return false;
  const [exp, sig] = t.split('.');
  if (!exp || !sig || Date.now() > +exp) return false;
  const want = crypto.createHmac('sha256', SECRET).update(String(exp)).digest('hex').slice(0, 32);
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want));
}
function readCookie(req, name) {
  const raw = req.headers.cookie || '';
  const hit = raw.split(';').map(s => s.trim()).find(s => s.startsWith(name + '='));
  return hit ? decodeURIComponent(hit.slice(name.length + 1)) : '';
}
function bearer(req) {
  const h = req.headers.authorization || '';
  if (h.startsWith('Bearer ')) return h.slice(7);
  // 창을 닫을 때 보내는 요청(sendBeacon)은 헤더를 붙이지 못해 주소로 넘어온다
  return String((req.query && req.query.t) || '');
}
function needAuth(req, res, next) {
  if (!PASS) return next();                            // 비밀번호를 안 걸었으면 통과
  // 쿠키가 없어도 헤더로 받은 토큰이 맞으면 통과시킨다.
  if (validToken(readCookie(req, 'bank_t')) || validToken(bearer(req))) return next();
  res.status(401).json({ error: 'need_login' });
}

app.post('/api/login', (req, res) => {
  const pw = String((req.body && req.body.pass) || '');
  if (!PASS || pw !== PASS) return res.status(401).json({ ok: false });
  const t = makeToken();
  res.setHeader('Set-Cookie',
    'bank_t=' + t + '; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=' + 90 * 24 * 3600);
  res.json({ ok: true, token: t });     // 쿠키가 날아갈 때를 대비해 함께 준다
});
app.get('/api/me', (req, res) => {
  res.json({ locked: !!PASS,
             ok: !PASS || validToken(readCookie(req, 'bank_t')) || validToken(bearer(req)) });
});

// ── 자료 주고받기 ───────────────────────────────────────────
app.get('/api/data', needAuth, (req, res) => {
  res.json(load());
});

app.post('/api/data', needAuth, (req, res) => {
  const incoming = req.body;
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
    return res.status(400).json({ error: 'bad_body' });
  }
  const cur = load();
  backupDaily(cur);
  // 보낸 항목만 갈아끼운다. 통째로 덮어쓰면 다른 기기가 방금 넣은 게 사라진다.
  for (const k of Object.keys(incoming)) {
    if (!/^zzbit_/.test(k)) continue;                  // 우리 자료만 받는다
    if (incoming[k] === null) delete cur[k];
    else cur[k] = incoming[k];
  }
  save(cur);
  res.json({ ok: true, keys: Object.keys(cur).length });
});

// 화면 파일은 늘 새로 받게 하고, 그림은 오래 담아 둔다.
// 화면을 담아 두면 고쳐도 예전 것이 계속 보인다.
// ── 비트코인 시세 중계 ──────────────────────────────────────
// 화면에서 업비트를 바로 부르면 브라우저가 막는다(CORS).
// 서버가 대신 물어봐서 넘겨주면 그 문제가 사라진다.
// 잠깐 담아 두어 같은 값을 여러 번 묻지 않게 한다.
let tickCache = { at: 0, body: null };
app.get('/api/upbit', needAuth, async (req, res) => {
  const now = Date.now();
  if (tickCache.body && now - tickCache.at < 8000) return res.json(tickCache.body);
  try {
    const r = await fetch('https://api.upbit.com/v1/ticker?markets=KRW-BTC',
                          { headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error('upbit ' + r.status);
    const body = await r.json();
    tickCache = { at: now, body };
    res.json(body);
  } catch (e) {
    if (tickCache.body) return res.json(tickCache.body);   // 잠시 안 되면 마지막 값이라도
    res.status(502).json({ error: 'upbit_failed' });
  }
});

app.use(express.static(path.join(BASE, 'public'), {
  maxAge: '30d',
  setHeaders(res, p) {
    if (p.endsWith('.html') || p.endsWith('sync.js')) {
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    }
  }
}));
app.get('*', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, must-revalidate');
  res.sendFile(path.join(BASE, 'public', 'index.html'));
});

app.listen(PORT, '127.0.0.1', () => console.log('bank on ' + PORT));
