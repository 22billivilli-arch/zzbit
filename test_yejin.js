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
    style: {}, options: [], focus() {}, blur() {},
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
// 시작 잔액은 코드에서 직접 읽는다. 값이 바뀌어도 검사가 따라간다.
const SK = +(/YJ_START_KBANK\s*=\s*(\d+)/.exec(code) || [0,0])[1];
const ST = +(/YJ_START_TOSS\s*=\s*(\d+)/.exec(code) || [0,0])[1];
console.log(`  (시작 잔액 — 케이뱅크 ${SK.toLocaleString()} · 토스뱅크 ${ST.toLocaleString()})
`);

const $ = id => document.getElementById(id);   // els 는 호출돼야 생기므로 항상 이걸로 집는다
const bal = () => ({ k: num($('yjKbank').textContent), t: num($('yjToss').textContent) });

function add(type, cat, amt, date, bank) {
  W.yjSetType(type);
  $('yjCat').value = cat;
  W.yjCatChanged();                 // 통장을 어울리는 쪽으로 맞춘다
  if (bank) W.yjSetBank(bank);      // 직접 고른 경우
  $('yjDate').value = date;
  $('yjAmt').value = String(amt);
  $('yjMemo').value = '';
  W.yjAdd();
}
function move(amt, dir) { W.yjToggleMove(dir || 'kt'); $('yjMoveAmt').value = String(amt); W.yjDoMove(); }

// ── 검사 ────────────────────────────────────────────────────
console.log('① 처음 상태');
W.yjRender();
check('케이뱅크', bal().k, SK);
check('토스뱅크', bal().t, ST);

console.log('\n② 수입 200만 → 케이뱅크에 쌓인다');
add('in', '급여', 2000000, '2026-08-10');
check('케이뱅크', bal().k, SK+2000000);
check('토스뱅크', bal().t, ST);

console.log('\n③ 고정지출(월세 60만) → 케이뱅크에서 빠진다');
add('out', '월세', 600000, '2026-08-10');
check('케이뱅크', bal().k, SK+1400000);
check('토스뱅크', bal().t, ST);

console.log('\n④ 이동 50만 → 케뱅 −, 토스 +');
move(500000);
check('케이뱅크', bal().k, SK+900000);
check('토스뱅크', bal().t, ST+500000);

console.log('\n⑤ 용돈 지출 3만 → 토스뱅크에서만 빠진다');
add('out', '용돈', 30000, '2026-08-10');
check('케이뱅크', bal().k, SK+900000);
check('토스뱅크', bal().t, ST+470000);

console.log('\n⑥ 수입 카테고리 용돈은 지출이 아니라 수입 → 케이뱅크 +');
add('in', '용돈', 100000, '2026-08-11');
check('케이뱅크', bal().k, SK+1000000);
check('토스뱅크', bal().t, ST+470000);

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
check('9월에도 케이뱅크 유지', bal().k, SK+1000000);
W.yjMove(-1);
check('8월 총수입 복귀', num($('yjSumIn').textContent), 2100000);

console.log('\n⑨ 지난달 기록은 이번달 합계에 안 섞인다');
add('out', '공과금', 77000, '2026-07-15');
check('7월로 이동됨', $('yjMonth').textContent, '2026년 7월');
check('7월 고정지출', num($('yjSumFixed').textContent), 77000);
check('케이뱅크 반영', bal().k, SK+923000);
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
check('필드', Object.keys(saved[0]).sort().join(','), 'amt,bank,cat,date,id,memo,type');

console.log('\n⑭ 시작 잔액이 잔액에 반영된다');
store['zzbit_yj_tx'] = '[]';
W.yjRender();
check('기록 없으면 시작 잔액 그대로 (케뱅)', bal().k, SK);
check('기록 없으면 시작 잔액 그대로 (토스)', bal().t, ST);
check('합계는 시작 잔액에 안 섞인다', num($('yjSumIn').textContent), 0);

console.log('\n⑮ 달력');
// 2026년 8월 = 1일이 토요일, 31일까지
store['zzbit_yj_tx'] = JSON.stringify([
  { id: 1, date: '2026-08-01', type: 'in',   cat: '급여', amt: 2400000 },
  { id: 2, date: '2026-08-01', type: 'out',  cat: '월세', amt: 650000  },
  { id: 3, date: '2026-08-15', type: 'out',  cat: '용돈', amt: 23000   },
  { id: 4, date: '2026-08-31', type: 'out',  cat: '휴대폰', amt: 89000 },
  { id: 5, date: '2026-08-20', type: 'move', cat: '',    amt: 300000   },
  { id: 6, date: '2026-09-03', type: 'in',   cat: '기타', amt: 50000   },
]);
while ($('yjMonth').textContent !== '2026년 8월') W.yjMove($('yjMonth').textContent > '2026년 8월' ? -1 : 1);
W.yjRender();
const cal = $('yjCal').innerHTML;
const cells = cal.match(/<div class="cell[^"]*"/g) || [];
const pads = (cal.match(/cell pad/g) || []).length;
// 날짜 칸 하나를 통째로 꺼내 본다
const cell = d => {
  // 칸에 onclick 이 붙기도 하므로 여는 태그 전체를 느슨하게 잡는다
  const m = new RegExp('<div class="cell[^>]*><span>' + d + '</span>(.*?)</div></div>').exec(cal);
  return m ? m[1] : '';
};
const dotIn = d => cell(d).includes('var(--plus)');
const dotFix = d => cell(d).includes('var(--minus)');
const dotPocket = d => cell(d).includes('var(--olive)');

check('칸 수가 7의 배수', cells.length % 7, 0);
check('8월 날짜 31칸', cells.length - pads, 31);
check('1일이 토요일 → 앞 빈칸 6개', (cal.split('<div class="cell pad"></div>').length - 1) >= 6, true);
check('1일에 입금 점', dotIn(1), true);
check('1일에 고정 점', dotFix(1), true);
check('15일에 용돈 점', dotPocket(15), true);
check('31일에 고정 점', dotFix(31), true);
check('이체는 달력에 안 나온다 (20일 점 없음)', cell(20).includes('<i'), false);
check('다음달 기록은 안 섞인다 (3일 점 없음)', cell(3).includes('<i'), false);
check('입금 점 색', /--plus/.test(cal), true);
check('용돈 점 색', /--olive/.test(cal), true);
check('고정 점 색', /--minus/.test(cal), true);

W.yjMove(1);
const cal9 = $('yjCal').innerHTML;
check('9월로 넘기면 30칸', (cal9.match(/<div class="cell[^"]*"/g) || []).length
      - (cal9.match(/cell pad/g) || []).length, 30);
check('9월 3일에 입금 점', /<div class="cell[^>]*><span>3<\/span><div class="dots"><i style="background:var\(--plus\)/.test(cal9), true);
check('9월엔 8월 기록 없음', (cal9.match(/<i /g) || []).length, 1);

W.yjMove(-1);
check('8월로 되돌아옴', $('yjMonth').textContent, '2026년 8월');

console.log('\n⑯ 화살표 → 이체 창');
store['zzbit_yj_tx'] = '[]';
W.yjRender();
$('yjMoveModal').hidden = true;
W.yjToggleMove('kt');
check('누르면 이체 창이 뜬다', $('yjMoveModal').hidden, false);
check('지금 케뱅 잔액을 알려준다', /케이뱅크/.test($('yjMoveBal').textContent), true);
check('금액칸은 비어서 시작', $('yjMoveAmt').value, '');
W.yjMoveClose();
check('취소하면 닫힌다', $('yjMoveModal').hidden, true);

W.yjToggleMove('kt');
$('yjMoveAmt').value = '80000';
W.yjDoMove();
check('이체하면 케뱅에서 빠지고', bal().k, SK - 80000);
check('토스로 들어온다', bal().t, ST + 80000);
check('이체 뒤 창이 닫힌다', $('yjMoveModal').hidden, true);
check('금액칸이 비워진다', $('yjMoveAmt').value, '');

console.log('\n⑰ 잔액은 무슨 일이 있어도 먼저 그려진다');
const order = /window\.yjRender = function\(\)\{([\s\S]*?)yjDrawCal/.exec(html)[1];
check('잔액 그리기가 합계·달력보다 앞', order.indexOf('yjKbank') < order.indexOf('yjSumIn'), true);

console.log('\n⑳ 내용(선택 입력)');
store['zzbit_yj_tx'] = '[]';
while ($('yjMonth').textContent !== '2026년 8월') W.yjMove($('yjMonth').textContent > '2026년 8월' ? -1 : 1);

function addMemo(type, cat, amt, date, memo) {
  W.yjSetType(type);
  $('yjCat').value = cat;
  W.yjCatChanged();
  $('yjDate').value = date;
  $('yjAmt').value = String(amt);
  $('yjMemo').value = memo === undefined ? '' : memo;
  W.yjAdd();
}

addMemo('out', '용돈', 12000, '2026-08-10', '편의점');
let rec = JSON.parse(store['zzbit_yj_tx'])[0];
check('내용이 저장된다', rec.memo, '편의점');
check('내역에 보인다', /· 편의점/.test($('yjList').innerHTML), true);
check('금액도 그대로', rec.amt, 12000);

addMemo('out', '용돈', 5000, '2026-08-11');
rec = JSON.parse(store['zzbit_yj_tx'])[1];
check('안 써도 저장된다', rec.memo, '');
check('빈 내용은 점을 안 붙인다', ($('yjList').innerHTML.match(/· /g) || []).length, 1);

check('추가 뒤 내용칸이 비워진다', $('yjMemo').value, '');

addMemo('in', '급여', 100, '2026-08-12', '  앞뒤 공백  ');
check('앞뒤 공백은 다듬는다', JSON.parse(store['zzbit_yj_tx'])[2].memo, '앞뒤 공백');

addMemo('out', '생필품', 3000, '2026-08-13', '<b>굵게</b> & "따옴표"');
const li = $('yjList').innerHTML;
check('꺾쇠는 그대로 안 들어간다', /<b>굵게<\/b>/.test(li), false);
check('글자로 바뀌어 보인다', /&lt;b&gt;굵게/.test(li), true);
check('따옴표·앰퍼샌드도 처리', /&amp;/.test(li) && /&quot;/.test(li), true);

check('내용은 잔액에 영향 없다', bal().k, SK - 3000 + 100);

console.log('\n㉑ 내용칸이 생기기 전에 넣은 기록도 그대로 열린다');
store['zzbit_yj_tx'] = JSON.stringify([
  { id: 1, date: '2026-08-05', type: 'in',  cat: '급여', amt: 1000000 },   // memo 없음
  { id: 2, date: '2026-08-06', type: 'out', cat: '용돈', amt: 7000 },
]);
W.yjRender();
check('잔액이 계산된다', bal().k, SK + 1000000);
check('토스도 계산된다', bal().t, ST - 7000);
check('내역이 그려진다', ($('yjList').innerHTML.match(/class="row"/g) || []).length >= 2, true);
check('없는 내용 때문에 깨지지 않는다', /undefined/.test($('yjList').innerHTML), false);

console.log('\n㉒ 통장 고르기');
store['zzbit_yj_tx'] = '[]';
W.yjRender();
W.yjSetType('in');
check('입금은 케이뱅크가 기본', $('yjBankK').classList.contains('on'), true);
W.yjSetType('out'); $('yjCat').value = '용돈'; W.yjCatChanged();
check('출금 용돈은 토스뱅크가 기본', $('yjBankT').classList.contains('on'), true);
$('yjCat').value = '월세'; W.yjCatChanged();
check('출금 월세는 케이뱅크가 기본', $('yjBankK').classList.contains('on'), true);

add('out', '용돈', 5000, '2026-08-20', 'k');       // 기본과 다르게 케이뱅크로
check('고른 대로 케이뱅크에서 빠진다', bal().k, SK - 5000);
check('토스는 그대로', bal().t, ST);
check('기록에 통장이 남는다', JSON.parse(store['zzbit_yj_tx'])[0].bank, 'k');

add('in', '급여', 300000, '2026-08-20', 't');      // 입금을 토스뱅크로
check('입금도 고른 통장으로', bal().t, ST + 300000);
check('케뱅은 그대로', bal().k, SK - 5000);

console.log('\n㉓ 양쪽으로 이체');
store['zzbit_yj_tx'] = '[]'; W.yjRender();
move(100000, 'kt');
check('케이 → 토스 : 케뱅', bal().k, SK - 100000);
check('케이 → 토스 : 토스', bal().t, ST + 100000);
move(40000, 'tk');
check('토스 → 케이 : 케뱅', bal().k, SK - 100000 + 40000);
check('토스 → 케이 : 토스', bal().t, ST + 100000 - 40000);
check('방향이 기록된다', JSON.parse(store['zzbit_yj_tx'])[1].dir, 'tk');
check('내역에 방향이 보인다', /토스뱅크 → 케이뱅크/.test($('yjList').innerHTML), true);

console.log('\n㉔ 통장이 안 적힌 예전 기록도 그대로 계산된다');
store['zzbit_yj_tx'] = JSON.stringify([
  { id: 1, date: '2026-08-05', type: 'in',   cat: '급여', amt: 1000000 },  // bank 없음
  { id: 2, date: '2026-08-06', type: 'out',  cat: '용돈', amt: 7000 },     // 예전 규칙 = 토스
  { id: 3, date: '2026-08-07', type: 'out',  cat: '월세', amt: 500000 },   // 예전 규칙 = 케뱅
  { id: 4, date: '2026-08-08', type: 'move', cat: '',    amt: 200000 },    // dir 없음 = 케이→토스
]);
// 데이터가 8월이므로 화면도 8월로 (내역 렌더 확인용)
while ($('yjMonth').textContent !== '2026년 8월') W.yjMove($('yjMonth').textContent > '2026년 8월' ? -1 : 1);
W.yjRender();
check('케이뱅크', bal().k, SK + 1000000 - 500000 - 200000);
check('토스뱅크', bal().t, ST - 7000 + 200000);
check('예전 이체도 케이→토스로 읽힌다', /케이뱅크 → 토스뱅크/.test($('yjList').innerHTML), true);
check('깨진 표시 없음', /undefined/.test($('yjList').innerHTML), false);

console.log('\n㉕ 입금·출금 표기와 카테고리 순서');
check('입금 버튼', /입금/.test(html), true);
check('출금 버튼', /출금/.test(html), true);
check('출금 카테고리 첫째가 용돈',
  /'out':\s*\['용돈'/.test(code), true);

console.log('\n㉖ 달력 날짜를 누르면 그날 내역');
store['zzbit_yj_tx'] = JSON.stringify([
  { id: 1, date: '2026-08-10', type: 'in',  cat: '급여', amt: 2000000, memo: '', bank: 'k' },
  { id: 2, date: '2026-08-10', type: 'out', cat: '용돈', amt: 12000, memo: '점심', bank: 't' },
  { id: 3, date: '2026-08-10', type: 'move', cat: '', amt: 50000, dir: 'kt' },
  { id: 4, date: '2026-08-11', type: 'out', cat: '월세', amt: 650000, memo: '', bank: 'k' },
]);
while ($('yjMonth').textContent !== '2026년 8월') W.yjMove($('yjMonth').textContent > '2026년 8월' ? -1 : 1);
W.yjRender();

check('기록 있는 날은 누를 수 있다', /onclick="yjDayOpen\(10\)"/.test($('yjCal').innerHTML), true);
check('기록 없는 날은 못 누른다', /onclick="yjDayOpen\(12\)"/.test($('yjCal').innerHTML), false);

W.yjDayOpen(10);
check('창이 열린다', $('yjDayModal').hidden, false);
check('날짜가 제목에', $('yjDayTitle').textContent, '8월 10일');
const dl = $('yjDayList').innerHTML;
check('그날 것 3건', (dl.match(/class="row"/g) || []).length, 3);
check('입금이 보인다', /급여/.test(dl), true);
check('출금과 내용이 보인다', /용돈/.test(dl) && /점심/.test(dl), true);
check('이체도 보인다', /케이뱅크 → 토스뱅크/.test(dl), true);
check('다른 날 것은 안 섞인다', /월세/.test(dl), false);
check('합계는 이체를 뺀 값', num($('yjDayTotal').textContent), 2000000 - 12000);
W.yjDayClose();
check('닫힌다', $('yjDayModal').hidden, true);

console.log(`\n${'='.repeat(46)}\n  통과 ${ok} · 실패 ${fail}`);
process.exit(fail ? 1 : 0);
