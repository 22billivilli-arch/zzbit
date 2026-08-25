# -*- coding: utf-8 -*-
"""index.html 을 서버(atrd.kr/bank)에 올릴 형태로 만든다.

원본 index.html 하나만 고치면 이 스크립트가 나머지를 다 해준다.
  1) 글자로 박힌 그림(base64)을 png 파일로 빼낸다  — 1.3MB → 80KB
  2) 그림·스크립트 주소를 /bank/… 로 못박는다     — 상대경로는 어긋나면 404
  3) 업비트를 서버가 대신 부르게 바꾼다            — 브라우저가 직접 부르면 막힌다(CORS)
  4) 서버와 자료를 맞추는 sync.js 와 로그인 화면을 붙인다

  py deploy.py         만들기만
  py deploy.py --up    만들고 서버에 올리기
"""
import io, re, sys, base64, shutil, subprocess
from pathlib import Path

BASE = Path(__file__).resolve().parent
OUT = BASE / "_deploy"
IMG = OUT / "img"
SERVER = "root@115.68.176.230"
REMOTE = "/srv/bank"

LOGIN_CSS = """
  /* 서버 저장 — 로그인·저장 상태 */
  .bank-login{position:fixed;inset:0;background:var(--bg);z-index:100;
    display:flex;align-items:center;justify-content:center;padding:20px}
  .bank-login-box{background:var(--card);border:3px solid var(--text);border-radius:16px;
    padding:26px 22px;width:100%;max-width:300px;box-shadow:6px 6px 0 var(--text);text-align:center}
  .bank-login-t{font-size:19px;font-weight:700;margin-bottom:16px}
  .bank-login-box input{width:100%;border:2.5px solid var(--text);border-radius:10px;padding:11px;
    font-size:15px;font-family:var(--sans);background:#fff;color:var(--text);text-align:center}
  .bank-login-e{color:var(--red);font-size:12px;min-height:17px;margin:7px 0 3px}
  .bank-login-box button{width:100%;background:var(--accent);color:#fff;border:2.5px solid var(--text);
    border-radius:10px;padding:11px;font-weight:700;font-size:15px;cursor:pointer;
    box-shadow:3px 3px 0 var(--text);font-family:var(--sans)}
  .bank-login-box button:active{transform:translate(3px,3px);box-shadow:none}
  .bank-sync{position:fixed;right:10px;bottom:10px;z-index:40;font-size:11px;
    background:var(--card);border:2px solid var(--text);border-radius:8px;padding:4px 9px;
    font-family:var(--mono);color:var(--sub);opacity:.85}
  .bank-sync.on{color:var(--accent)}
  .bank-sync.bad{color:var(--red);border-color:var(--red)}
</style>"""

BOOT = """
<div class="bank-sync" id="bankSync">저장됨</div>
<script src="/bank/sync.js?v=__VER__"></script>
<script>
// 서버에서 자료를 받아온 뒤 화면을 다시 그린다.
bankBoot().then(function(ok){
  if(!ok) return;
  try{ if(window.lgRender) lgRender(); }catch(e){}
  try{ if(window.yjRender) yjRender(); }catch(e){}
});
</script>
</body>"""


def build():
    if OUT.exists():
        shutil.rmtree(OUT)
    IMG.mkdir(parents=True)
    s = io.open(BASE / "index.html", encoding="utf-8").read()
    n0 = len(s)

    # ① 글자로 박힌 그림을 파일로
    pat = re.compile(r'"([a-z0-9_]+)":\s*"data:image/(png|jpe?g|webp);base64,([A-Za-z0-9+/=]+)"')
    cnt = 0
    for m in pat.finditer(s):
        name, ext, b64 = m.group(1), m.group(2), m.group(3)
        ext = "jpg" if ext.startswith("jpe") else ext
        (IMG / f"a_{name}.{ext}").write_bytes(base64.b64decode(b64))
        cnt += 1
    s = pat.sub(lambda m: '"%s": "/bank/img/a_%s.%s"'
                % (m.group(1), m.group(1),
                   "jpg" if m.group(2).startswith("jpe") else m.group(2)), s)

    # ② 주소 못박기
    gh = len(re.findall(r"raw\.githubusercontent\.com", s))
    s = re.sub(r"https://raw\.githubusercontent\.com/22billivilli-arch/zzbit/main/", "/bank/img/", s)
    s = s.replace('"img/', '"/bank/img/').replace("'img/", "'/bank/img/")

    # ③ 업비트는 서버가 대신 부른다 (브라우저가 직접 부르면 CORS 로 막힌다)
    up = s.count("https://api.upbit.com/v1/ticker?markets=KRW-BTC")
    s = s.replace("https://api.upbit.com/v1/ticker?markets=KRW-BTC", "/bank/api/upbit")
    s = s.replace("fetch('/bank/api/upbit',{headers:",
                  "fetch('/bank/api/upbit',{credentials:'same-origin',headers:")

    # ④ 로그인 화면·동기화 붙이기
    s = s.replace("</style>", LOGIN_CSS, 1)
    ver = str(int(Path(BASE / "index.html").stat().st_mtime))
    s = s.replace("</body>", BOOT.replace("__VER__", ver), 1)

    io.open(OUT / "index.html", "w", encoding="utf-8").write(s)
    for p in BASE.glob("*.png"):
        shutil.copy2(p, IMG / p.name)

    left = len(re.findall(r"data:image/[a-z]+;base64", s))
    print(f"index.html  {n0:,} → {len(s):,}자  ({(1-len(s)/n0)*100:.1f}% 줄어듦)")
    print(f"  그림 빼냄     {cnt}개 · 폴더에 모두 {len(list(IMG.glob('*.png')))}개")
    print(f"  깃허브 주소   {gh}곳 → 0곳")
    print(f"  업비트 중계   {up}곳")
    print(f"  남은 base64   {left}곳")
    for must in ('/bank/img/', '/bank/sync.js', '/bank/api/upbit', 'bank-login'):
        print(f"  {must:<16} {'있음' if must in s else '없음 ✗'}")
    return len(re.findall(r"[\"']img/", s)) == 0 and left == 0


def upload():
    tgz = OUT.parent / "_deploy.tgz"
    subprocess.run(["tar", "czf", str(tgz), "-C", str(OUT.parent), OUT.name], check=True)
    subprocess.run(["scp", "-o", "StrictHostKeyChecking=no", "-o", "BatchMode=yes",
                    str(tgz), f"{SERVER}:/tmp/_deploy.tgz"], check=True)
    cmd = (f"cd /tmp && rm -rf _deploy && tar xzf _deploy.tgz && "
           f"cp _deploy/index.html {REMOTE}/public/index.html && "
           f"rm -rf {REMOTE}/public/img && cp -r _deploy/img {REMOTE}/public/img && "
           f"rm -rf /tmp/_deploy /tmp/_deploy.tgz && "
           f"pm2 restart bank >/dev/null 2>&1 && echo 올림완료")
    subprocess.run(["ssh", "-o", "StrictHostKeyChecking=no", "-o", "BatchMode=yes",
                    SERVER, cmd], check=True)
    tgz.unlink(missing_ok=True)


if __name__ == "__main__":
    for _s in (sys.stdout, sys.stderr):
        try:
            _s.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass
    ok = build()
    if not ok:
        print("\n※ 확인이 필요합니다 — 상대경로나 base64 가 남아 있습니다")
    if "--up" in sys.argv:
        print()
        upload()
