// 예진 가계부의 돈 흐름을 실제 코드 그대로 돌려서 확인한다.
// 브라우저를 띄울 메모리가 없어서, 가짜 DOM을 붙이고 index.html 의 스크립트를 그대로 실행한다.
const fs = require('fs');
const vm = require('vm');

const html = fs.readFileSync(__dirname + '/index.html', 'utf8');
const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const code = blocks[blocks.length - 1];          // 가계부 로직이 든 마지막 블록
if (!/yjBalance/.test(code)) { console.error('예진 가계부 코드를 못 찾음'); process.exit(1); }

// ── 가짜 DOM ────────────────────────────────────────────────
function El(id) {
  return {
    id, textContent: '', value: '', innerHTML: '',
    style: {}, options: [],
    classList: { _s: new Set(),
      toggle(c, on) { on ? this._s.add(c) : this._s.delete(c); },
      add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
      contains(c) { return this._s.has(c); } },
  };
}
const els = {};
const document = {
  getElementById(id) { return els[id] || (els[id] = El(id)); },
  activeElement: null,
};
const store = {};
const localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; },
};
let confirmAnswer = true;
const alerts = [];
const sandbox = {
  document, localStorage, window: {}, console,
  alert: m => alerts.push(m),
  confirm: () => confirmAnswer,
  Date, JSON, Math, String, Number, parseInt, parseFloat, isNaN, Object, Array,
};
sandbox.window = sandbox;
vm.createContext(sandbox);
try { vm.runInContext(code, sandbox); }
catch (e) { console.error('스크립트 실행 실패:', e.message); process.exit(1); }

const W = sandbox.window;

// ── 도우미 ──────────────────────────────────────────────────
let ok = 0, fail = 0;
const num = s => parseInt(String(s).replace(/[^0-9-]/g, ''), 10) || 0;
function check(label, got, want) {
  const good = got === want;
  console.log(`  ${good ? 'OK  ' : '실패'} ${label}: ${got}${good ? '' : `  (기대 ${want})`}`);
  good ? ok++ : fail++;
}
const $ = id => document.getElementById(id);   // els 는 호출돼야 생기므로 항상 이걸로 집는다
const bal = () => ({ k: num($('yjKbank').textContent), t: num($('yjToss').textContent) });

function add(type, cat, amt, date) {
  W.yjSetType(type);
  $('yjCat').value = cat;
  $('yjDate').value = date;
  $('yjAmt').value = String(amt);
  W.yjAdd();
}
function move(amt) { $('yjMoveAmt').value = String(amt); W.yjDoMove(); }

// ── 검사 ────────────────────────────────────────────────────
console.log('① 처음 상태');
W.yjRender();
check('케이뱅크', bal().k, 0);
check('토스뱅크', bal().t, 0);

console.log('\n② 수입 200만 → 케이뱅크에 쌓인다');
add('in', '급여', 2000000, '2026-08-10');
check('케이뱅크', bal().k, 2000000);
check('토스뱅크', bal().t, 0);

console.log('\n③ 고정지출(월세 60만) → 케이뱅크에서 빠진다');
add('out', '월세', 600000, '2026-08-10');
check('케이뱅크', bal().k, 1400000);
check('토스뱅크', bal().t, 0);

console.log('\n④ 이동 50만 → 케뱅 −, 토스 +');
move(500000);
check('케이뱅크', bal().k, 900000);
check('토스뱅크', bal().t, 500000);

console.log('\n⑤ 용돈 지출 3만 → 토스뱅크에서만 빠진다');
add('out', '용돈', 30000, '2026-08-10');
check('케이뱅크', bal().k, 900000);
check('토스뱅크', bal().t, 470000);

console.log('\n⑥ 수입 카테고리 용돈은 지출이 아니라 수입 → 케이뱅크 +');
add('in', '용돈', 100000, '2026-08-11');
check('케이뱅크', bal().k, 1000000);
check('토스뱅크', bal().t, 470000);

console.log('\n⑦ 이번달 합계');
check('총수입', num($('yjSumIn').textContent), 2100000);
check('용돈 지출', num($('yjSumAllow').textContent), 30000);
check('고정지출', num($('yjSumFixed').textContent), 600000);
check('지출 합계', num($('yjSumOut').textContent), 630000);
check('남은 돈', num($('yjSumNet').textContent), 1470000);

console.log('\n⑧ 다른 달 — 합계는 0, 잔액은 이어진다');
W.yjMove(1);
check('9월 총수입', num($('yjSumIn').textContent), 0);
check('9월 지출합계', num($('yjSumOut').textContent), 0);
check('9월에도 케이뱅크 유지', bal().k, 1000000);
W.yjMove(-1);
check('8월 총수입 복귀', num($('yjSumIn').textContent), 2100000);

console.log('\n⑨ 지난달 기록은 이번달 합계에 안 섞인다');
add('out', '공과금', 77000, '2026-07-15');
check('7월로 이동됨', $('yjMonth').textContent, '2026년 7월');
check('7월 고정지출', num($('yjSumFixed').textContent), 77000);
check('케이뱅크 반영', bal().k, 923000);
W.yjMove(1);
check('8월 고정지출 그대로', num($('yjSumFixed').textContent), 600000);

console.log('\n⑩ 지우면 잔액이 되돌아간다');
const before = bal();
const tx = JSON.parse(store['zzbit_yj_tx']);
const allowTx = tx.find(x => x.type === 'out' && x.cat === '용돈');
W.yjDel(allowTx.id);
check('토스 원복', bal().t, before.t + 30000);
check('케뱅 그대로', bal().k, before.k);

console.log('\n⑪ 잔액보다 큰 이동 — 물어보고, 아니라고 하면 안 옮긴다');
confirmAnswer = false;
const b4 = bal();
move(99999999);
check('취소되어 그대로', bal().k, b4.k);
confirmAnswer = true;

console.log('\n⑫ 금액 없이 추가하면 막힌다');
const n0 = JSON.parse(store['zzbit_yj_tx']).length;
$('yjAmt').value = '';
W.yjAdd();
check('건수 그대로', JSON.parse(store['zzbit_yj_tx']).length, n0);
check('안내 떴다', alerts[alerts.length - 1], '금액을 입력하세요');

console.log('\n⑬ 저장 형식');
const saved = JSON.parse(store['zzbit_yj_tx']);
check('키 이름', Object.keys(store)[0], 'zzbit_yj_tx');
check('필드', Object.keys(saved[0]).sort().join(','), 'amt,cat,date,id,type');

console.log(`\n${'='.repeat(46)}\n  통과 ${ok} · 실패 ${fail}`);
process.exit(fail ? 1 : 0);
