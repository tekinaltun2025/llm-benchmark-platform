#!/usr/bin/env python3
"""LM Studio Token Sayacı — canlı, model bazlı toplam token sayacı.

Tek sayma kaynağı: LM Studio sunucu log dosyaları
(~/.lmstudio/apps/bionic/server-logs/YYYY-MM/YYYY-MM-DD.N.log).
Dosya tabanlıdır; bağlantı durumu yoktur, zombi bağlantı sorunu yaşayamaz.
Motor seviyesi kayıtlar API trafiğini VE uygulama içi sohbeti kapsar.
`lms log stream` ise TCP bağlantısı kurulu görünürken olay göndermeyi
bırakabildiği için sayma kaynağı olarak KULLANILMAZ (2026-10-18 kararı).

Sunucu:
  http://127.0.0.1:8790/       -> canlı gösterge paneli (HTML)
  http://127.0.0.1:8790/stats  -> JSON (CORS açık, widget'lar okuyabilir)
  POST /reset                  -> sayaçları sıfırla
Durum: state.json'a kaydedilir (daemon yeniden başlasa toplamlar korunur,
log konumları sayesinde çift sayım olmaz).
"""

import json
import os
import re
import signal
import sys
import threading
import time
from datetime import date
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
STATE_FILE = BASE_DIR / "state.json"
PORT = 8790
HOME = Path.home()
SERVER_LOG_DIR = HOME / ".lmstudio/apps/bionic/server-logs"

# ---------------------------------------------------------------- state ----
_lock = threading.Lock()
_state = {
    "totals": {"prompt_tokens": 0, "completion_tokens": 0, "predictions": 0},
    "today": {"date": date.today().isoformat(),
              "prompt_tokens": 0, "completion_tokens": 0, "predictions": 0},
    "days": {},            # tarih -> {completion, prompt, predictions} (son 90 gün)
    "models": {},          # id -> {prompt, completion, predictions, last_ts, label}
    "recent": [],          # son tahminler (en yeni başta, max 50)
    "in_flight_tokens": 0, # şu an üretimde olan (tamamlanmamış) token tahmini
    "last_event_ts": 0,    # son sayılan olayın duvar saati
    "log_tail": {"files_parsed": 0, "last_file": None, "offset": 0,
                 "last_error": None},
}
_dirty = False
_today_ymd = date.today().strftime("%Y-%m-%d")
LOG_OFFSETS = {}  # dosya -> okunan offset (state.json'a kaydedilir)


def _short_label(model_id: str) -> str:
    leaf = model_id.rstrip("/").split("/")[-1]
    leaf = re.sub(r"\.gguf$", "", leaf, flags=re.I)
    return leaf


def _norm_model(tag: str) -> str:
    # ":2" biçimli örnek (instance) ve çok parçalı GGUF soneklerini temizle
    tag = re.sub(r":\d+$", "", tag)
    tag = re.sub(r"-00001-of-\d+$", "", tag)
    return tag


def _today_reset():
    global _today_ymd
    today = date.today().isoformat()
    if _state["today"]["date"] != today:
        _state["today"] = {"date": today,
                           "prompt_tokens": 0, "completion_tokens": 0,
                           "predictions": 0}
        _today_ymd = today
    if _today_ymd not in _state["days"]:
        # gün bazlı geçmiş SÜRESİZ saklanır (kullanıcı talebi: veri silinmesin)
        _state["days"][_today_ymd] = {"completion_tokens": 0,
                                      "prompt_tokens": 0, "predictions": 0}


def _record(model_id: str, prompt: int, completion: int, tps=None, day=None):
    global _dirty
    now = time.time()
    _today_reset()
    with _lock:
        m = _state["models"].setdefault(model_id, {
            "prompt_tokens": 0, "completion_tokens": 0, "predictions": 0,
            "last_ts": 0, "label": _short_label(model_id)})
        m["prompt_tokens"] += prompt
        m["completion_tokens"] += completion
        m["predictions"] += 1
        m["last_ts"] = now
        day = day or _today_ymd
        day_bucket = _state["days"].setdefault(day, {
            "completion_tokens": 0, "prompt_tokens": 0, "predictions": 0,
            "models": {}})
        day_bucket.setdefault("models", {})
        day_bucket["prompt_tokens"] += prompt
        day_bucket["completion_tokens"] += completion
        day_bucket["predictions"] += 1
        dm = day_bucket["models"].setdefault(model_id, {
            "prompt_tokens": 0, "completion_tokens": 0, "predictions": 0})
        dm["prompt_tokens"] += prompt
        dm["completion_tokens"] += completion
        dm["predictions"] += 1
        tb = _state["totals"]
        tb["prompt_tokens"] += prompt
        tb["completion_tokens"] += completion
        tb["predictions"] += 1
        if day == _state["today"]["date"]:
            tb = _state["today"]
            tb["prompt_tokens"] += prompt
            tb["completion_tokens"] += completion
            tb["predictions"] += 1
        _state["recent"].insert(0, {
            "ts": now, "model": model_id,
            "prompt_tokens": prompt, "completion_tokens": completion,
            "tokens_per_second": round(tps, 2) if tps else None})
        del _state["recent"][50:]
        _state["last_event_ts"] = now
        _dirty = True


def _load_state():
    try:
        with open(STATE_FILE, "r", encoding="utf-8") as f:
            saved = json.load(f)
        for k in ("totals", "today", "models", "days"):
            if isinstance(saved.get(k), dict):
                _state[k] = saved[k]
        if isinstance(saved.get("recent"), list):
            _state["recent"] = saved["recent"]
        for k, v in (saved.get("log_offsets") or {}).items():
            LOG_OFFSETS[k] = v
        _today_reset()
    except FileNotFoundError:
        print("[counter] state.json yok — sıfırdan başlıyor (loglar geriye "
              "dönük okunacak)", file=sys.stderr, flush=True)
    except Exception as e:
        print(f"[counter] state.json okunamadı: {e}", file=sys.stderr, flush=True)


def _save_state():
    payload = dict(_state)
    payload["log_offsets"] = dict(LOG_OFFSETS)
    tmp = STATE_FILE.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, STATE_FILE)


def _state_persister():
    global _dirty
    while True:
        time.sleep(5)
        with _lock:
            if _dirty:
                _dirty = False
                _save_state()


# ------------------------------------------------- sunucu log ayrıştırma ----
RE_INFO_MODEL = re.compile(r"\[INFO\]\[([^\]]+)\]")
RE_REQ_MODEL = re.compile(r'"model":\s*"([^"]+)"')
RE_LAUNCH = re.compile(r"launch_slot_\S*:\s*id\s+(\d+)\s*\|\s*task\s+(-?\d+)")
RE_TASKKEY = re.compile(r"id\s+(\d+)\s*\|\s*task\s+(-?\d+)")
RE_PROMPT_EVAL = re.compile(r"prompt eval time =\s*[\d.]+\s*ms\s*/\s*(\d+)\s*tokens")
RE_EVAL = re.compile(r"(?<!prompt )(?<!in )eval time =\s*[\d.]+\s*ms\s*/\s*(\d+)\s*tokens")
RE_TPS = re.compile(r"([\d.]+)\s*tokens per second\s*\)")
RE_NGEN = re.compile(r"n_gen =\s*(\d+)")
RE_RELEASE = re.compile(r"release:\s*id\s+(\d+)\s*\|\s*task\s+(-?\d+)")
RE_TS = re.compile(r"^\[(\d{4}-\d{2}-\d{2})[ \]]")
RE_GEN = re.compile(r"llama_server: initializing|load_model: loading model")
RE_LOAD = re.compile(r"load_model: loading model '([^']+)'")
NON_MODEL_TAGS = {"LM STUDIO SERVER"}


def _key(gen, slot, task):
    return f"{gen}|{slot}|{task}"


def _flush(pstate: dict, record: bool, force: bool = False, only_key=None):
    """Tamamlanan görev kayıtlarını sayaca yaz; force=True ise
    completion'u hiç gelmeyenleri (embedding) prompt-only olarak da yaz."""
    now = time.time()
    keys = [only_key] if only_key else list(pstate["pending_tokens"].keys())
    for key in keys:
        e = pstate["pending_tokens"].get(key)
        if e is None:
            continue
        done = e["p"] is not None and e["c"] is not None
        stale = force or (now - e["seen"] > 120)
        if not (done or (stale and e["p"] is not None)):
            continue
        if record:
            _record(e["model"], e["p"] or 0, e["c"] or 0, e["tps"], day=e["day"])
        pstate["in_flight"].pop(key, None)
        del pstate["pending_tokens"][key]


def parse_log_chunk(pstate: dict, text: str, record: bool, force_flush: bool = False):
    """Log satırlarını ayrıştırır; record=True ise sayaca yazar.

    pstate chunk'lar arasında korunur: pending model bağlamı, task->model
    haritası ve görev başına yarım token kayıtları burada yaşar.
    Bir görevin 'prompt eval time' VE 'eval time' satırları ayrı gelir;
    ikisi de aynı görev anahtarını taşır — ikisi birleştirilir."""
    task_model = pstate["task_model"]
    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            continue
        if RE_GEN.search(line):
            pstate["gen"] += 1  # llama-server yeniden başladı: görev id'leri sıfırlanır
            # eski neslin tamamlanmamış görevleri öldü
            for k in [k for k, (g, _) in pstate["in_flight"].items()
                      if g < pstate["gen"]]:
                del pstate["in_flight"][k]
        m = RE_LOAD.search(line)
        if m:
            # bu neslin modeli (uygulama içi sohbet isteklerinde başka
            # model etiketi yoktur — motor seviyesi kayıt)
            gm = _norm_model(_short_label(m.group(1)))
            pstate["gen_model"][pstate["gen"]] = gm
            if len(pstate["gen_model"]) > 60:
                for k in sorted(pstate["gen_model"])[:-40]:
                    del pstate["gen_model"][k]
        m = RE_TS.match(line)
        if m:
            pstate["day"] = m.group(1)
        m = RE_INFO_MODEL.search(line)
        if m and m.group(1) not in NON_MODEL_TAGS:
            pstate["pending"] = _norm_model(m.group(1))
        else:
            m = RE_REQ_MODEL.search(line)
            if m:
                pstate["pending"] = m.group(1)
        m = RE_LAUNCH.search(line)
        if m and pstate["pending"]:
            task_model[_key(pstate["gen"], *m.groups())] = pstate["pending"]
            if len(task_model) > 4000:
                for k in list(task_model)[:-2000]:
                    del task_model[k]
        mn = RE_NGEN.search(line)
        if mn:
            mk = RE_TASKKEY.search(line)
            if mk:
                # canlı gösterge: tamamlanmamış üretimin token'ı (toplama girmez)
                pstate["in_flight"][_key(pstate["gen"], *mk.groups())] = \
                    (pstate["gen"], int(mn.group(1)))
        m = RE_RELEASE.search(line)
        if m:
            pstate["in_flight"].pop(_key(pstate["gen"], *m.groups()), None)
        tp = RE_PROMPT_EVAL.search(line)
        te = RE_EVAL.search(line)
        if not (tp or te):
            continue
        mk = RE_TASKKEY.search(line)
        if not mk:
            continue  # görev kimliği yoksa atla (embedding vb.)
        key = _key(pstate["gen"], *mk.groups())
        # önce neslin modeli (uygulama içi + API hepsini kapsar),
        # yoksa HTTP katmanı etiketi
        model = pstate["gen_model"].get(pstate["gen"]) or task_model.get(key) \
            or pstate.get("pending")
        e = pstate["pending_tokens"].get(key)
        if e is None:
            e = pstate["pending_tokens"][key] = {
                "model": model, "p": None, "c": None, "tps": None,
                "day": pstate.get("day"), "seen": time.time()}
        # llama.cpp aynı görevde birden çok segment basabilir -> topla
        if tp:
            e["p"] = (e["p"] or 0) + int(tp.group(1))
        if te:
            e["c"] = (e["c"] or 0) + int(te.group(1))
            tps_m = RE_TPS.search(line)
            if tps_m:
                e["tps"] = float(tps_m.group(1))
        if len(pstate["pending_tokens"]) > 6000:
            _flush(pstate, record, force=False)
        elif e["p"] is not None and e["c"] is not None:
            _flush(pstate, record, force=False, only_key=key)
    _flush(pstate, record, force=force_flush)
    # canlı üretim göstergesini duruma yansıt
    with _lock:
        _state["in_flight_tokens"] = sum(
            n for (_, n) in pstate["in_flight"].values())


def _log_files():
    if not SERVER_LOG_DIR.is_dir():
        return []
    return sorted(SERVER_LOG_DIR.glob("*/*.log"),
                  key=lambda p: (p.parent.name, p.name))


def log_tail_loop():
    """Tek sayma kaynağı: sunucu loglarını geriye dönük okur + canlı kuyruk."""
    pstate = {"pending": None, "task_model": {}, "pending_tokens": {},
              "day": None, "gen": 0, "gen_model": {}, "in_flight": {}}
    n_files = 0
    while True:
        try:
            files = _log_files()
            if not files:
                time.sleep(5)
                continue
            for fp in files:
                skey = str(fp)
                off = LOG_OFFSETS.get(skey, 0)
                try:
                    size = fp.stat().st_size
                except FileNotFoundError:
                    continue
                if size < off:
                    off = 0  # rotate
                if size == off:
                    continue
                with open(fp, "r", encoding="utf-8", errors="replace") as f:
                    f.seek(off)
                    chunk = f.read()
                    new_off = f.tell()
                LOG_OFFSETS[skey] = new_off
                backfill = (off == 0)
                parse_log_chunk(pstate, chunk, record=True,
                                force_flush=backfill)
                n_files += 1
                with _lock:
                    lt = _state["log_tail"]
                    lt["files_parsed"] = n_files
                    lt["last_file"] = fp.name
                    lt["offset"] = new_off
        except Exception as e:
            with _lock:
                _state["log_tail"]["last_error"] = str(e)[:200]
            print(f"[counter] log kuyruk hatası: {e}", file=sys.stderr, flush=True)
        time.sleep(1)


# ---------------------------------------------------------------- HTTP ----
DASH_HTML = r"""<!doctype html>
<html lang="tr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>LM Studio Token Sayacı</title>
<style>
:root{color-scheme:dark}
*{box-sizing:border-box;margin:0}
body{background:#101014;color:#e6e6ea;font:15px/1.5 system-ui,Segoe UI,Roboto,sans-serif;padding:28px;max-width:1040px;margin:0 auto}
h1{font-size:20px;font-weight:650;letter-spacing:.2px}
.sub{color:#8a8a94;font-size:13px;margin-top:2px}
.dot{display:inline-block;width:9px;height:9px;border-radius:50%;background:#3ad07a;margin-right:6px;vertical-align:1px}
.dot.off{background:#e05252}
.dot.busy{background:#f5a623;box-shadow:0 0 8px #f5a62388}
.src{font-size:12px;color:#8a8a94;margin-top:6px}
.src b{color:#c9c9d1;font-weight:600}
.cards{display:flex;gap:14px;flex-wrap:wrap;margin:22px 0}
.card{background:#18181f;border:1px solid #26262e;border-radius:12px;padding:14px 20px;min-width:150px}
.card .v{font-size:30px;font-weight:700;font-variant-numeric:tabular-nums}
.card .k{color:#8a8a94;font-size:12px;text-transform:uppercase;letter-spacing:.6px;margin-top:2px}
.card.today .v{color:#7ab8ff}
.card.busy .v{color:#f5a623;font-size:24px}
section{margin:26px 0}
h2{font-size:14px;color:#8a8a94;text-transform:uppercase;letter-spacing:.8px;margin-bottom:10px}
table{width:100%;border-collapse:collapse;background:#18181f;border:1px solid #26262e;border-radius:12px;overflow:hidden}
th,td{text-align:left;padding:10px 14px;font-size:14px;border-bottom:1px solid #22222a}
th{color:#8a8a94;font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.5px}
tr:last-child td{border-bottom:none}
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
.bar{height:6px;border-radius:3px;background:#2f6feb;margin-top:5px}
.muted{color:#8a8a94}
button{background:#2f6feb;color:#fff;border:0;border-radius:8px;padding:8px 16px;font-size:14px;cursor:pointer}
button:hover{background:#3d7bf5}
.footer{color:#6b6b74;font-size:12px;margin-top:30px}
.fbar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:14px 0 2px}
.fbar label{font-size:13px;color:#8a8a94;display:flex;gap:6px;align-items:center}
input[type=date]{background:#18181f;border:1px solid #26262e;color:#e6e6ea;border-radius:8px;padding:6px 10px;font:inherit;color-scheme:dark}
.qbtn{background:#22222a;border:1px solid #2e2e38;color:#c9c9d1;padding:6px 12px;border-radius:8px;font-size:13px;cursor:pointer}
.qbtn:hover{background:#2a2a34}
.rangelabel{font-size:13px;color:#7ab8ff;margin-top:2px}
</style></head><body>
<h1><span class="dot" id="dot"></span>LM Studio Token Sayacı</h1>
<div class="sub">Uygulama içi sohbet + API dahil tüm tahminler, model bazlı canlı toplam</div>
<div class="fbar">
  <label>Başlangıç <input type="date" id="from"></label>
  <label>Bitiş <input type="date" id="to"></label>
  <button class="qbtn" onclick="setToday()">Bugün</button>
  <button class="qbtn" onclick="setYesterday()">Dün</button>
  <button class="qbtn" onclick="set7()">Son 7 gün</button>
  <button class="qbtn" onclick="setAll()">Tümü</button>
</div>
<div class="rangelabel" id="rangelabel">Tüm zamanlar</div>
<div class="src" id="src">—</div>
<div class="cards">
  <div class="card"><div class="v" id="t-completion">0</div><div class="k">üretilen token</div></div>
  <div class="card"><div class="v" id="t-prompt">0</div><div class="k">prompt token</div></div>
  <div class="card"><div class="v" id="t-total">0</div><div class="k">toplam token</div></div>
  <div class="card"><div class="v" id="t-pred">0</div><div class="k">istek</div></div>
  <div class="card today"><div class="v" id="d-completion">0</div><div class="k">bugün üretilen</div></div>
  <div class="card busy" id="busy-card" style="display:none"><div class="v" id="busy">~0</div><div class="k">şu an üretimde</div></div>
</div>
<section><h2>Modeller (toplam, birikimli)</h2>
<table><thead><tr><th>Model</th><th class="num">Üretilen</th><th class="num">Prompt</th><th class="num">İstek</th><th class="num">Son kullanım</th></tr></thead>
<tbody id="models"><tr><td class="muted">Henüz veri yok</td></tr></tbody></table></section>
<section><h2>Son istekler</h2>
<table><thead><tr><th>Saat</th><th>Model</th><th class="num">Üretilen</th><th class="num">Prompt</th><th class="num">tok/s</th></tr></thead>
<tbody id="recent"><tr><td class="muted">—</td></tr></tbody></table></section>
<button onclick="if(confirm('Tüm sayaçlar sıfırlansın mı?'))fetch('/reset',{method:'POST'}).then(load)">Sayaçları sıfırla</button>
<div class="footer">Kaynak: sunucu logları (motor seviyesi, sohbet + API) · 127.0.0.1:8790 · toplamlar kalıcıdır (state.json)</div>
<script>
const nf=new Intl.NumberFormat('tr-TR');
const n=x=>nf.format(x||0);
function ts(unix){if(!unix)return'—';return new Date(unix*1000).toLocaleTimeString('tr-TR');}
let F=null,T=null,Q='';
function localIso(d){const p=x=>String(x).padStart(2,'0');return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate());}
function apply(){document.getElementById('from').value=F||'';document.getElementById('to').value=T||'';
  Q=(F||T)?('?from='+(F||'')+'&to='+(T||'')):'';
  document.getElementById('rangelabel').textContent=(F||T)?('Seçili aralık: '+(F||'…')+' — '+(T||'…')):'Tüm zamanlar';
  load();}
function setRange(f,t){F=f;T=t;apply();}
function setToday(){const d=localIso(new Date());setRange(d,d);}
function setYesterday(){const d=new Date();d.setDate(d.getDate()-1);const s=localIso(d);setRange(s,s);}
function set7(){const d=new Date();d.setDate(d.getDate()-6);setRange(localIso(d),localIso(new Date()));}
function setAll(){setRange(null,null);}
document.getElementById('from').addEventListener('change',e=>{F=e.target.value||null;apply();});
document.getElementById('to').addEventListener('change',e=>{T=e.target.value||null;apply();});
async function load(){try{
  const r=await fetch('/stats'+Q);const s=await r.json();
  document.getElementById('dot').classList.remove('off');
  const age=s.last_event_ts?Math.round(Date.now()/1000-s.last_event_ts):null;
  const busy=s.in_flight_tokens||0;
  document.getElementById('src').innerHTML=
    (age!=null?('son olay: <b>'+age+' sn önce</b>'):'olay bekleniyor')+
    ((s.log_tail&&s.log_tail.last_file)?(' · '+s.log_tail.last_file):'');
  if(busy>0){document.getElementById('busy-card').style.display='';
    document.getElementById('busy').textContent='~'+n(busy);
    document.getElementById('dot').classList.add('busy');}
  else{document.getElementById('busy-card').style.display='none';
    document.getElementById('dot').classList.remove('busy');}
  document.getElementById('t-completion').textContent=n(s.totals.completion_tokens);
  document.getElementById('t-prompt').textContent=n(s.totals.prompt_tokens);
  document.getElementById('t-total').textContent=n(s.totals.completion_tokens+s.totals.prompt_tokens);
  document.getElementById('t-pred').textContent=n(s.totals.predictions);
  document.getElementById('d-completion').textContent=n(s.today.completion_tokens);
  const tb=document.getElementById('models');
  const ms=Object.entries(s.models).map(([id,m])=>({id,...m}))
    .sort((a,b)=>b.completion_tokens-a.completion_tokens);
  const max=Math.max(1,...ms.map(m=>m.completion_tokens));
  tb.innerHTML=ms.length?ms.map(m=>`<tr><td>${m.label}<div class="bar" style="width:${Math.max(4,100*m.completion_tokens/max)}%"></div></td><td class="num">${n(m.completion_tokens)}</td><td class="num">${n(m.prompt_tokens)}</td><td class="num">${n(m.predictions)}</td><td class="num">${ts(m.last_ts)}</td></tr>`).join('')
   :'<tr><td class="muted">Henüz veri yok</td></tr>';
  const rb=document.getElementById('recent');
  rb.innerHTML=(s.recent||[]).slice(0,10).map(e=>`<tr><td>${ts(e.ts)}</td><td>${e.model}</td><td class="num">${n(e.completion_tokens)}</td><td class="num">${n(e.prompt_tokens)}</td><td class="num">${e.tokens_per_second??'—'}</td></tr>`).join('')
   ||'<tr><td class="muted">—</td></tr>';
}catch(e){document.getElementById('dot').classList.add('off')}}
load();setInterval(load,1000);
</script></body></html>"""


def _valid_date(s):
    return isinstance(s, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}", s) is not None


def _filtered_state(frm=None, to=None):
    """Tarih aralığına göre süzülmüş görünüm; parametre yoksa tam durum."""
    frm = frm if _valid_date(frm) else None
    to = to if _valid_date(to) else None
    with _lock:
        base = json.loads(json.dumps(_state))
    if not frm and not to:
        base["range"] = None
        return base
    tot = {"prompt_tokens": 0, "completion_tokens": 0, "predictions": 0}
    models = {}
    days_in = {k: v for k, v in base["days"].items()
               if (not frm or k >= frm) and (not to or k <= to)}
    for v in days_in.values():
        for f in ("prompt_tokens", "completion_tokens", "predictions"):
            tot[f] += v.get(f, 0)
        for mid, mv in (v.get("models") or {}).items():
            mm = models.setdefault(mid, {"prompt_tokens": 0,
                                         "completion_tokens": 0,
                                         "predictions": 0})
            for f in ("prompt_tokens", "completion_tokens", "predictions"):
                mm[f] += mv.get(f, 0)
    t0 = t1 = None
    try:
        if frm:
            y, m, d = map(int, frm.split("-"))
            t0 = time.mktime((y, m, d, 0, 0, 0, 0, 0, -1))
        if to:
            y, m, d = map(int, to.split("-"))
            t1 = time.mktime((y, m, d, 23, 59, 59, 0, 0, -1))
    except Exception:
        pass
    recent = [e for e in base["recent"]
              if (t0 is None or e["ts"] >= t0) and (t1 is None or e["ts"] <= t1)]
    base.update({"totals": tot, "models": models, "days": days_in,
                 "recent": recent,
                 "range": {"from": frm, "to": to}})
    return base


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, body, ctype):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/stats":
            with _lock:
                payload = json.dumps(_state, ensure_ascii=False).encode()
            self._send(200, payload, "application/json; charset=utf-8")
        elif self.path.startswith("/stats"):
            from urllib.parse import urlparse, parse_qs
            q = parse_qs(urlparse(self.path).query)
            payload = json.dumps(
                _filtered_state((q.get("from") or [None])[0],
                                (q.get("to") or [None])[0]),
                ensure_ascii=False).encode()
            self._send(200, payload, "application/json; charset=utf-8")
        elif self.path == "/":
            body = DASH_HTML.encode()
            self._send(200, body, "text/html; charset=utf-8")
        else:
            self._send(404, b'{"error":"not found"}', "application/json")

    def do_POST(self):
        if self.path == "/reset":
            global _dirty
            with _lock:
                _state["totals"] = {"prompt_tokens": 0, "completion_tokens": 0,
                                    "predictions": 0}
                _state["today"] = {"date": date.today().isoformat(),
                                   "prompt_tokens": 0, "completion_tokens": 0,
                                   "predictions": 0}
                _state["days"] = {}
                _state["models"] = {}
                _state["recent"] = []
                _dirty = True
                _save_state()
            self._send(200, b'{"ok":true}', "application/json")
        else:
            self._send(404, b'{"error":"not found"}', "application/json")

    def log_message(self, *a):
        pass


def main():
    _load_state()
    threading.Thread(target=_state_persister, daemon=True).start()
    threading.Thread(target=log_tail_loop, daemon=True).start()
    try:
        srv = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    except OSError as e:
        print(f"[counter] {PORT} portu kullanılamıyor: {e}",
              file=sys.stderr, flush=True)
        sys.exit(1)
    print(f"[counter] gösterge paneli: http://127.0.0.1:{PORT}/",
          file=sys.stderr, flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    signal.signal(signal.SIGTERM, lambda *a: (_save_state(), sys.exit(0)))
    main()
