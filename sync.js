// 서버와 자료를 맞추는 층
//
// 기존 화면은 이 기기 안(localStorage)에 저장하도록 만들어져 있다.
// 그 코드를 다 뜯어고치는 대신, 저장하는 길목만 가로챈다.
//   · 열 때  : 서버에서 받아 채운 뒤 화면을 그린다
//   · 저장 때: 이 기기에 넣고, 곧바로 서버로도 보낸다
// 그래서 폰에서 적은 것이 PC 에서도 보인다.
//
// 폰 브라우저(특히 앱 안에서 열리는 브라우저)는 저장 공간을 막아 두는 일이 있다.
// 예전에는 이 기기 저장이 실패하면 그 자리에서 멈춰 서버로도 안 보냈다.
// 화면에는 멀쩡히 보이지만 아무 데도 남지 않아, 껐다 켜면 사라진 것처럼 보였다.
// 지금은 이 기기 저장이 막혀도 서버로는 반드시 보낸다.
(function () {
  var API = '/bank';          // 주소를 못박는다. 계산하면 /bank 와 /bank/ 에서 달라진다.
  var TKEY = 'bank_token';    // 쿠키가 사라져도 로그인이 유지되도록 토큰을 따로 보관한다
  var PREFIX = /^zzbit_/;
  var pending = {}, timer = null;
  var snap = {};              // 마지막으로 서버에 보낸 값 — 훑어볼 때 견준다
  var lastSaved = null, lastErr = '';

  // ── 이 기기 저장 (막혀 있을 수 있다) ──────────────────────
  var mem = {};                                   // 저장이 막힌 기기를 위한 대체
  var origSet = localStorage.setItem.bind(localStorage);
  var origDel = localStorage.removeItem.bind(localStorage);
  var origGet = localStorage.getItem.bind(localStorage);

  function safeSet(k, v) {
    mem[k] = String(v);
    try { origSet(k, v); } catch (e) { lastErr = '이 기기 저장 막힘'; }
  }
  function safeGet(k) {
    try {
      var v = origGet(k);
      if (v !== null && v !== undefined) return v;
    } catch (e) {}
    return (k in mem) ? mem[k] : null;
  }
  function canStore() {
    try { origSet('_probe', '1'); origDel('_probe'); return true; } catch (e) { return false; }
  }

  function token() { return safeGet(TKEY) || ''; }
  function headers(extra) {
    var h = extra || {};
    var t = token();
    if (t) h['Authorization'] = 'Bearer ' + t;
    return h;
  }

  // ── 서버로 보내기 ─────────────────────────────────────────
  function post(body) {
    return fetch(API + '/api/data', {
      method: 'POST', credentials: 'same-origin',
      headers: headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body)
    });
  }

  function flush() {
    timer = null;
    var send = pending; pending = {};
    if (!Object.keys(send).length) return;
    post(send)
      .then(function (r) {
        if (r.status === 401) {
          // 로그인이 풀렸다. 조용히 넘어가면 적은 것이 사라진 것처럼 보인다.
          for (var k in send) if (!(k in pending)) pending[k] = send[k];
          mark('login');
          showLogin();
          return;
        }
        if (!r.ok) throw new Error('서버 ' + r.status);
        lastSaved = new Date().toLocaleTimeString('ko-KR');
        mark('saved');
      })
      .catch(function (e) {
        // 실패하면 되돌려 담아 다음에 다시 보낸다. 적은 내용이 사라지면 안 된다.
        for (var k in send) if (!(k in pending)) pending[k] = send[k];
        lastErr = String(e && e.message ? e.message : e).slice(0, 60);
        mark('offline');
        schedule(5000);
      });
  }

  function schedule(ms) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, ms || 400);
  }

  function mark(state) {
    var el = document.getElementById('bankSync');
    if (!el) return;
    el.onclick = window.bankStatus;
    el.style.cursor = 'pointer';
    if (state === 'saving') { el.textContent = '저장 중…'; el.className = 'bank-sync on'; }
    else if (state === 'offline') { el.textContent = '저장 안 됨 · 다시 시도합니다'; el.className = 'bank-sync bad'; }
    else if (state === 'login') { el.textContent = '로그인이 풀렸어요'; el.className = 'bank-sync bad'; }
    else { el.textContent = '저장됨'; el.className = 'bank-sync'; }
  }

  // ── 저장하는 길목을 가로챈다 ──────────────────────────────
  // 브라우저에 따라 localStorage 의 함수를 바꿔치기하는 것이 막혀 있다.
  // (사파리에서 그런 일이 있었고, 그러면 저장을 알아채지 못해 서버로 아무것도 안 갔다)
  // 그래서 두 겹으로 잡는다.
  //   ① 함수 바꿔치기 — 되면 저장하는 즉시 알아챈다
  //   ② 이따금 훑어보기 — 바꿔치기가 막혀도 바뀐 것을 찾아낸다
  function onChanged(k, v) {
    if (!PREFIX.test(k)) return;
    pending[k] = (v === null) ? null : tryParse(v);
    snap[k] = v;                       // 훑어보기가 또 잡지 않도록
    mark('saving');
    schedule();
  }

  try {
    // 인스턴스가 막혀 있으면 프로토타입 쪽을 고친다
    var target = localStorage;
    var proto = Object.getPrototypeOf(localStorage) || Storage.prototype;
    var wrapSet = function (k, v) {
      safeSet(k, v);
      onChanged(k, String(v));
    };
    var wrapDel = function (k) {
      delete mem[k];
      try { origDel(k); } catch (e) {}
      onChanged(k, null);
    };
    target.setItem = wrapSet;
    target.removeItem = wrapDel;
    target.getItem = function (k) { return safeGet(k); };
    if (target.setItem !== wrapSet && proto) {      // 인스턴스에 못 붙었으면
      proto.setItem = wrapSet;
      proto.removeItem = wrapDel;
    }
  } catch (e) {
    lastErr = '가로채기 막힘';
  }
  function tryParse(v) { try { return JSON.parse(v); } catch (e) { return v; } }

  // ② 이따금 훑어본다 — 가로채기가 막혀도 이쪽이 잡아낸다
  function scanAll() {
    var seen = {};
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (!k || !PREFIX.test(k)) continue;
        seen[k] = true;
        var v = origGet(k);
        if (snap[k] !== v) { snap[k] = v; pending[k] = tryParse(v); }
      }
    } catch (e) {}
    for (var k2 in mem) {                          // 저장이 막힌 기기 몫
      if (!PREFIX.test(k2) || seen[k2]) continue;
      if (snap[k2] !== mem[k2]) { snap[k2] = mem[k2]; pending[k2] = tryParse(mem[k2]); }
    }
    if (Object.keys(pending).length) { mark('saving'); schedule(200); }
  }

  // 창을 닫기 전에 남은 것을 마저 보낸다
  window.addEventListener('beforeunload', function () {
    if (!Object.keys(pending).length) return;
    try {
      var t = token();
      navigator.sendBeacon(API + '/api/data' + (t ? '?t=' + encodeURIComponent(t) : ''),
        new Blob([JSON.stringify(pending)], { type: 'application/json' }));
    } catch (e) {}
  });
  // 폰은 앱을 내려도 창이 닫히지 않는다. 그래서 화면을 덮고 켤 때를 붙잡는다.
  //   덮을 때 : 아직 못 보낸 것을 마저 보낸다
  //   켤 때   : 서버에서 새로 받아온다 (그 사이 다른 기기에서 적은 것이 있을 수 있다)
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') {
      if (Object.keys(pending).length) flush();
    } else {
      bankPull().then(redraw);
    }
  });

  // 다른 기기에서 적은 것을 놓치지 않게 이따금 확인한다
  setInterval(function () {
    if (document.visibilityState === 'visible' && !Object.keys(pending).length) {
      bankPull().then(redraw);
    }
  }, 30000);

  function redraw() {
    try { if (window.lgRender) window.lgRender(); } catch (e) {}
    try { if (window.yjRender) window.yjRender(); } catch (e) {}
  }

  // ── 예전 주소에서 넘어온 기록 받기 ────────────────────────
  // move.html 이 주소 뒤에 #import=... 로 실어 보낸다.
  // 주소의 # 뒤는 서버로 가지 않으므로 이 기기 안에서만 처리된다.
  function takeImport() {
    var h = location.hash || "";
    if (h.indexOf("#import=") !== 0) return Promise.resolve(false);
    var data;
    try { data = JSON.parse(decodeURIComponent(h.slice(8))); }
    catch (e) { alert("옮겨온 기록을 읽지 못했어요."); return Promise.resolve(false); }

    var keys = Object.keys(data).filter(function (k) { return PREFIX.test(k); });
    if (!keys.length) { history.replaceState(null, "", API + "/"); return Promise.resolve(false); }
    if (!confirm('예전 가계부에서 ' + keys.length + '개를 가져옵니다.\n같은 달 기록이 있으면 덮어씁니다.')) {
      history.replaceState(null, "", API + "/");
      return Promise.resolve(false);
    }

    var body = {};
    keys.forEach(function (k) { body[k] = tryParse(data[k]); safeSet(k, data[k]); });
    mark("saving");
    return post(body)
      .then(function (r) {
        if (!r.ok) throw new Error("서버 " + r.status);
        lastSaved = new Date().toLocaleTimeString("ko-KR");
        mark("saved");
        history.replaceState(null, "", API + "/");
        alert(keys.length + "개를 가져왔어요.");
        return true;
      })
      .catch(function (e) {
        keys.forEach(function (k) { pending[k] = tryParse(data[k]); });
        schedule(1000);
        alert('가져오긴 했는데 서버에 올리지 못했어요. 잠시 뒤 다시 보냅니다.\n(' + e + ')');
        history.replaceState(null, "", API + "/");
        return true;
      });
  }

  // ── 열 때 ─────────────────────────────────────────────────
  window.bankBoot = function () {
    return fetch(API + '/api/me', { credentials: 'same-origin', headers: headers() })
      .then(function (r) { return r.ok ? r.json() : { locked: true, ok: false }; })
      .catch(function () { return { locked: false, ok: true }; })   // 서버가 안 되면 일단 진행
      .then(function (me) {
        if (me.locked && !me.ok) { showLogin(); return null; }
        return takeImport().then(function (imported) {
          return imported ? true : bankPull();
        });
      });
  };

  function bankPull() {
    return fetch(API + '/api/data', { credentials: 'same-origin', headers: headers() })
      .then(function (r) {
        if (r.status === 401) { showLogin(); return null; }
        if (!r.ok) throw new Error(r.status);
        return r.json();
      })
      .then(function (data) {
        if (!data) return false;
        Object.keys(data).forEach(function (k) {
          if (k in pending) return;      // 방금 내가 고친 것은 그대로 둔다
          var v = data[k];
          safeSet(k, (typeof v === 'string') ? v : JSON.stringify(v));
        });
        mark('saved');
        startScan();
        return true;
      })
      .catch(function (e) {
        startScan();
        // 서버가 안 되면 이 기기에 남아 있는 것으로라도 보여준다
        lastErr = String(e && e.message ? e.message : e).slice(0, 60);
        mark('offline');
        return true;
      });
  }

  // 서버 것을 받은 뒤부터 훑어본다. 그 전에 돌면 옛 값을 올려버릴 수 있다.
  var scanning = false;
  function startScan() {
    if (scanning) return;
    scanning = true;
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && PREFIX.test(k)) snap[k] = origGet(k);
      }
    } catch (e) {}
    for (var k2 in mem) if (PREFIX.test(k2)) snap[k2] = mem[k2];
    setInterval(scanAll, 1500);
  }

  // ── 지금 어떤 상태인지 (저장 표시를 누르면 뜬다) ──────────
  window.bankStatus = function () {
    var store = canStore() ? '됨' : '막힘 (서버로만 저장)';
    fetch(API + '/api/data', { credentials: 'same-origin', headers: headers() })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        var tx = d && d.zzbit_yj_tx;
        var lines = [
          '가계부 상태', '',
          '이 기기 저장 : ' + store,
          '서버 연결    : ' + (d ? '됨' : '안 됨'),
          '서버 기록    : ' + (tx ? tx.length + '건' : '없음'),
          '못 보낸 것   : ' + Object.keys(pending).length + '건',
          '마지막 저장  : ' + (lastSaved || '아직 없음')
        ];
        if (lastErr) lines.push('마지막 문제  : ' + lastErr);
        alert(lines.join('\n'));
      })
      .catch(function (e) {
        alert(['가계부 상태', '', '이 기기 저장 : ' + store,
               '서버 연결    : 안 됨', String(e)].join('\n'));
      });
  };

  // ── 로그인 (비밀번호를 걸었을 때만) ───────────────────────
  var loginShown = false;
  function showLogin() {
    if (loginShown || document.querySelector('.bank-login')) return;
    loginShown = true;
    var d = document.createElement('div');
    d.className = 'bank-login';
    d.innerHTML =
      '<div class="bank-login-box">' +
      '<div class="bank-login-t">🔒 가계부</div>' +
      '<input type="password" id="bankPw" placeholder="비밀번호" autocomplete="current-password">' +
      '<div class="bank-login-e" id="bankErr"></div>' +
      '<button id="bankGo">들어가기</button></div>';
    document.body.appendChild(d);
    var pw = d.querySelector('#bankPw');
    var go = function () {
      fetch(API + '/api/login', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pass: pw.value })
      }).then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) {
          if (j) {
            if (j.token) safeSet(TKEY, j.token);
            location.reload();
          } else {
            d.querySelector('#bankErr').textContent = '비밀번호가 달라요';
            pw.value = ''; pw.focus();
          }
        });
    };
    d.querySelector('#bankGo').onclick = go;
    pw.onkeydown = function (e) { if (e.key === 'Enter') go(); };
    pw.focus();
  }
})();
