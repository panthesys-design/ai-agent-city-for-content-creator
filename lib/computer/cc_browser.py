#!/usr/bin/env python3
# Creator City browser helper. Installed on each user's cloud computer at ~/.creator-city/cc_browser.py by
# lib/computer/browser.ts and run through the CloudHike exec action, once per agent browser action.
#
# Drives the desktop's Google Chrome over the DevTools protocol with the Python standard library only, so it
# needs no packages. Chrome runs on the visible desktop (DISPLAY :0) with its own profile in
# ~/.creator-city/chrome-profile: sign-ins live in that profile on the computer's disk, survive stops and
# restarts, and never leave the user's computer.
#
# Usage: python3 cc_browser.py <command> '<json args>'   ->   prints one JSON object.
# Keep this file free of backticks and dollar-brace sequences: lib/computer/browser-script.ts embeds it in a
# TypeScript template literal (npm test checks this).

import base64
import fcntl
import json
import os
import shutil
import signal
import socket
import struct
import subprocess
import sys
import time
import urllib.parse
import urllib.request

PORT = 9222
BASE = os.path.join(os.path.expanduser("~"), ".creator-city")
PROFILE = os.path.join(BASE, "chrome-profile")
LOG = os.path.join(BASE, "chrome.log")
DEVTOOLS = "http://127.0.0.1:%d" % PORT
LOCK = os.path.join(BASE, "browser.lock")
# Chrome saves downloads into the agents' workspace (set in the profile's preferences when Chrome starts). A Chrome
# that was started before that keeps its default ~/Downloads, so both folders are watched.
WORKSPACE = os.path.join(os.path.expanduser("~"), "creator-city")
DOWNLOADS = os.path.join(WORKSPACE, "downloads")
DOWNLOAD_DIRS = (DOWNLOADS, os.path.join(os.path.expanduser("~"), "Downloads"))
# Every command finishes within this many seconds (the server's exec timeout is longer), so a stuck page can
# never hold an agent: it gets an error it can act on instead.
HARD_LIMIT = int(os.environ.get("CC_BROWSER_LIMIT") or 75)
# Chrome flags for a small computer with no GPU, also added to the desktop's google-chrome launcher by setup():
# - /dev/shm is only 64 MB in the sandbox; heavy pages (in-browser video rendering) crash a tab that uses it.
# - With no GPU, WebGL is blocklisted, and web video editors that render with WebGL fail. SwiftShader renders it on
#   the CPU instead (slower, but it works).
EXTRA_FLAGS = ["--disable-dev-shm-usage", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--use-angle=swiftshader"]


def http_text(path, method="GET", timeout=3):
    req = urllib.request.Request(DEVTOOLS + path, method=method)
    with urllib.request.urlopen(req, timeout=timeout) as res:
        return res.read().decode("utf-8")


def http_json(path, method="GET", timeout=3):
    return json.loads(http_text(path, method, timeout) or "null")


def chrome_up():
    try:
        http_json("/json/version", timeout=1)
        return True
    except Exception:
        return False


def mark_clean_exit():
    # After a computer stop, Chrome would show "Restore pages?" and could refuse a profile locked by the old
    # hostname. Mark the last exit clean, restore the previous session (keeps session cookies), drop stale locks.
    for name in ("SingletonLock", "SingletonCookie", "SingletonSocket"):
        path = os.path.join(PROFILE, name)
        if os.path.lexists(path):
            try:
                os.remove(path)
            except OSError:
                pass
    prefs_path = os.path.join(PROFILE, "Default", "Preferences")
    try:
        with open(prefs_path, "r", encoding="utf-8") as f:
            prefs = json.load(f)
    except Exception:
        prefs = {}
    prefs.setdefault("profile", {})["exit_type"] = "Normal"
    prefs["profile"]["exited_cleanly"] = True
    prefs.setdefault("session", {})["restore_on_startup"] = 1
    # Downloads go straight into the workspace without a save dialog, and sites may download more than one file.
    os.makedirs(DOWNLOADS, exist_ok=True)
    download = prefs.setdefault("download", {})
    download["default_directory"] = DOWNLOADS
    download["prompt_for_download"] = False
    download["directory_upgrade"] = True
    prefs.setdefault("savefile", {})["default_directory"] = DOWNLOADS
    content = prefs.setdefault("profile", {}).setdefault("default_content_setting_values", {})
    content["automatic_downloads"] = 1
    os.makedirs(os.path.dirname(prefs_path), exist_ok=True)
    with open(prefs_path, "w", encoding="utf-8") as f:
        json.dump(prefs, f)


def ensure_chrome():
    if chrome_up():
        return False
    os.makedirs(PROFILE, exist_ok=True)
    subprocess.run(["pkill", "-f", "user-data-dir=" + PROFILE], check=False)
    time.sleep(0.3)
    mark_clean_exit()
    env = dict(os.environ, DISPLAY=os.environ.get("DISPLAY") or ":0")
    chrome = shutil.which("google-chrome") or shutil.which("chromium") or "google-chrome"
    with open(LOG, "ab") as log:
        subprocess.Popen(
            [chrome, "--user-data-dir=" + PROFILE, "--remote-debugging-port=%d" % PORT, "--remote-allow-origins=*",
             "--start-maximized", "--no-first-run", "--no-default-browser-check", "--disable-session-crashed-bubble",
             # Hides the "unsupported command-line flag: --no-sandbox" bar (the computer's launcher runs Chrome as root).
             "--test-type"] + EXTRA_FLAGS,
            stdout=log, stderr=log, stdin=subprocess.DEVNULL, env=env, start_new_session=True,
        )
    for _ in range(100):
        if chrome_up():
            time.sleep(0.5)
            return True
        time.sleep(0.2)
    raise RuntimeError("Chrome did not start on the cloud computer.")


class WebSocket:
    """Minimal RFC 6455 client: text frames, masking, fragmentation, ping/pong."""

    def __init__(self, url, timeout=10):
        u = urllib.parse.urlparse(url)
        self.deadline = None
        self.sock = socket.create_connection((u.hostname, u.port or 80), timeout=timeout)
        key = base64.b64encode(os.urandom(16)).decode()
        path = u.path + ("?" + u.query if u.query else "")
        request = ("GET %s HTTP/1.1\r\nHost: %s:%s\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                   "Sec-WebSocket-Key: %s\r\nSec-WebSocket-Version: 13\r\n\r\n") % (path, u.hostname, u.port, key)
        self.sock.sendall(request.encode())
        data = b""
        while b"\r\n\r\n" not in data:
            chunk = self.sock.recv(4096)
            if not chunk:
                raise RuntimeError("DevTools closed the connection.")
            data += chunk
        head, self.buf = data.split(b"\r\n\r\n", 1)
        if b" 101 " not in head.split(b"\r\n")[0]:
            raise RuntimeError("DevTools refused the connection.")

    def _read(self, n):
        while len(self.buf) < n:
            if self.deadline is not None:
                left = self.deadline - time.time()
                if left <= 0:
                    raise TimeoutError("DevTools did not answer in time.")
                self.sock.settimeout(left)
            try:
                chunk = self.sock.recv(65536)
            except socket.timeout:
                raise TimeoutError("DevTools did not answer in time.")
            if not chunk:
                raise RuntimeError("DevTools closed the connection.")
            self.buf += chunk
        out, self.buf = self.buf[:n], self.buf[n:]
        return out

    def _send_frame(self, opcode, payload):
        header = bytes([0x80 | opcode])
        n = len(payload)
        if n < 126:
            header += bytes([0x80 | n])
        elif n < 65536:
            header += bytes([0x80 | 126]) + struct.pack(">H", n)
        else:
            header += bytes([0x80 | 127]) + struct.pack(">Q", n)
        mask = os.urandom(4)
        masked = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
        self.sock.sendall(header + mask + masked)

    def send(self, text):
        self._send_frame(0x1, text.encode("utf-8"))

    def recv(self):
        message = b""
        while True:
            b1, b2 = self._read(2)
            opcode = b1 & 0x0F
            n = b2 & 0x7F
            if n == 126:
                n = struct.unpack(">H", self._read(2))[0]
            elif n == 127:
                n = struct.unpack(">Q", self._read(8))[0]
            mask = self._read(4) if b2 & 0x80 else None
            payload = self._read(n)
            if mask:
                payload = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
            if opcode == 0x9:
                self._send_frame(0xA, payload)
                continue
            if opcode == 0x8:
                raise RuntimeError("DevTools closed the connection.")
            if opcode in (0x0, 0x1, 0x2):
                message += payload
                if b1 & 0x80:
                    return message.decode("utf-8", "replace")

    def close(self):
        try:
            self.sock.close()
        except OSError:
            pass


class CallTimeout(RuntimeError):
    pass


class Page:
    def __init__(self, target):
        self.target = target
        self.ws = WebSocket(target["webSocketDebuggerUrl"])
        self.next_id = 0
        self.events = []

    def call(self, method, params=None, timeout=15):
        # The deadline is enforced on every socket read, so a call never waits longer than its timeout (a page
        # that is navigating away, or blocked by a dialog, may never answer).
        self.next_id += 1
        mine = self.next_id
        self.ws.send(json.dumps({"id": mine, "method": method, "params": params or {}}))
        self.ws.deadline = time.time() + timeout
        try:
            while True:
                msg = json.loads(self.ws.recv())
                if msg.get("id") == mine:
                    if "error" in msg:
                        raise RuntimeError(msg["error"].get("message", "DevTools error"))
                    return msg.get("result", {})
                if msg.get("method"):
                    self.events.append(msg)
        except TimeoutError:
            raise CallTimeout("The page did not respond to %s within %ds." % (method, timeout))
        finally:
            self.ws.deadline = None

    def wait_event(self, method, timeout):
        # Returns the params of the first event named method (also one that arrived during an earlier call), or None.
        for i, msg in enumerate(self.events):
            if msg.get("method") == method:
                return self.events.pop(i).get("params", {})
        self.ws.deadline = time.time() + timeout
        try:
            while True:
                msg = json.loads(self.ws.recv())
                if msg.get("method") == method:
                    return msg.get("params", {})
        except TimeoutError:
            return None
        finally:
            self.ws.deadline = None

    def dismiss_dialog(self):
        # An alert/confirm/beforeunload dialog blocks every script on the page; try to accept it so the next call
        # works. Returns True when that worked (Chrome refuses quickly when it can't, so this costs little).
        try:
            self.call("Page.handleJavaScriptDialog", {"accept": True}, timeout=2)
            return True
        except Exception:
            return False

    def stop_loading_and_check(self):
        try:
            self.call("Page.stopLoading", timeout=2)
            self.call("Runtime.evaluate", {"expression": "1", "returnByValue": True}, timeout=3)
            return True
        except Exception:
            return False

    def evaluate(self, expression, timeout=10):
        params = {"expression": expression, "returnByValue": True, "awaitPromise": True}
        try:
            result = self.call("Runtime.evaluate", params, timeout)
        except CallTimeout:
            # A page still navigating (a slow or dead site) holds scripts until it commits: stop it and retry once.
            if not self.dismiss_dialog() and not self.stop_loading_and_check():
                raise CallTimeout("The page did not respond within %ds. It may be showing a dialog (alert, confirm, leave-page) or be frozen: take a computer_screenshot, then close the dialog with computer_action (for example the Enter key) or open another page." % timeout)
            result = self.call("Runtime.evaluate", params, timeout)
        if result.get("exceptionDetails"):
            details = result["exceptionDetails"]
            text = (details.get("exception") or {}).get("description") or details.get("text") or "Script error"
            raise RuntimeError(text[:500])
        return (result.get("result") or {}).get("value")

    def wait_ready(self, seconds=10, selector=None):
        # Returns as soon as the page is usable: the wanted element exists, the page finished loading, or its
        # content is in (readyState "interactive") for a moment. Pages that never finish loading (ads, trackers,
        # live feeds) are read as they are once the time is up.
        start = time.time()
        deadline = start + seconds
        time.sleep(0.3)
        check = "document.readyState + '|' + %s" % ("String(Boolean(document.querySelector(%s)))" % json.dumps(selector) if selector else "''")
        while time.time() < deadline:
            try:
                state, found = (self.evaluate(check, timeout=max(1, min(3, deadline - time.time()))) or "|").split("|", 1)
                if found == "true":
                    time.sleep(0.2)
                    return True
                if state == "complete" and not selector:
                    time.sleep(0.3)
                    return True
                if state in ("interactive", "complete") and time.time() - start > (5 if selector else 2.5):
                    return True
            except Exception:
                pass
            time.sleep(0.25)
        return False

    def navigate(self, url, seconds=12, selector=None):
        # Page.navigate answers once the server starts responding. A site that doesn't answer in time is
        # abandoned (stopLoading puts the tab back on the previous page) so the tab stays usable.
        try:
            result = self.call("Page.navigate", {"url": url}, timeout=max(3, seconds))
        except CallTimeout:
            try:
                self.call("Page.stopLoading", timeout=3)
            except Exception:
                pass
            raise RuntimeError("%s did not respond within %ds; the site may be down or blocking the cloud computer. Try another site." % (urllib.parse.urlparse(url).hostname or url, seconds))
        if result.get("errorText"):
            raise RuntimeError("Couldn't open %s: %s" % (url[:200], result["errorText"]))
        return self.wait_ready(seconds, selector)

    def close(self):
        self.ws.close()


def page_targets():
    return [t for t in http_json("/json/list") if t.get("type") == "page" and not t.get("url", "").startswith(("devtools://", "chrome-extension://"))]


def active_page():
    targets = page_targets()
    if not targets:
        http_json("/json/new?about:blank", method="PUT")
        targets = page_targets()
    return Page(targets[0])


READ_JS = r"""
(() => {
  const MAX = %(max)d, OFFSET = %(offset)d, LIMIT = %(limit)d;
  document.querySelectorAll('[data-cc-id]').forEach(e => e.removeAttribute('data-cc-id'));
  const selector = 'a[href],button,input:not([type=hidden]),select,textarea,summary,[role=button],[role=link],[role=tab],[role=menuitem],[role=checkbox],[role=radio],[role=option],[role=switch],[role=combobox],[contenteditable=""],[contenteditable=true],[onclick]';
  const visible = el => {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.05;
  };
  const clean = v => String(v || '').replace(/\s+/g, ' ').trim();
  const elements = [];
  let n = 0;
  for (const el of document.querySelectorAll(selector)) {
    if (!visible(el)) continue;
    if (n >= LIMIT) break;
    n += 1;
    el.setAttribute('data-cc-id', String(n));
    const tag = el.tagName.toLowerCase();
    const type = clean(el.getAttribute('type'));
    let label = clean(el.getAttribute('aria-label') || el.innerText || el.getAttribute('placeholder') || el.getAttribute('title') || el.getAttribute('alt') || el.getAttribute('name') || el.id);
    if (!label && tag === 'a') label = clean(el.querySelector('img')?.alt);
    const item = { id: n, tag, label: label.slice(0, 90) };
    if (type) item.type = type;
    if (tag === 'a' && el.href) item.href = el.href.slice(0, 160);
    if ((tag === 'input' || tag === 'textarea') && type !== 'password' && el.value) item.value = clean(el.value).slice(0, 60);
    if (tag === 'select') item.value = clean(el.options[el.selectedIndex]?.text).slice(0, 60);
    if (el.disabled) item.disabled = true;
    if (el.checked) item.checked = true;
    const r = el.getBoundingClientRect();
    if (r.bottom < 0 || r.top > innerHeight) item.offscreen = true;
    elements.push(item);
  }
  const text = (document.body && document.body.innerText || '').split('\n').map(clean).filter(Boolean).join('\n');
  const head = text.slice(0, 4000);
  const captcha = Boolean(document.querySelector('iframe[src*="recaptcha"],iframe[src*="hcaptcha"],iframe[src*="challenges.cloudflare"],iframe[title*="captcha" i],.g-recaptcha,.h-captcha,.cf-turnstile,#challenge-form,#captcha'))
    || /verify (that )?you are (a )?human|are you a robot|unusual traffic|press (and|&) hold|complete the security check/i.test(head);
  const loginForm = Boolean(document.querySelector('input[type=password]:not([aria-hidden=true])'))
    || /^(sign in|log ?in)\b/i.test(clean(document.title)) && Boolean(document.querySelector('input[type=email],input[name*=user i],input[name*=email i],input[autocomplete=username]'));
  return {
    url: location.href, title: document.title, text: text.slice(OFFSET, OFFSET + MAX), textLength: text.length, offset: OFFSET,
    elements, signals: { loginForm, captcha },
    scroll: { y: Math.round(scrollY), height: Math.round(document.documentElement.scrollHeight), viewport: innerHeight },
  };
})()
"""

STATUS_JS = r"""
(() => {
  const head = (document.body && document.body.innerText || '').slice(0, 4000);
  const captcha = Boolean(document.querySelector('iframe[src*="recaptcha"],iframe[src*="hcaptcha"],iframe[src*="challenges.cloudflare"],.g-recaptcha,.h-captcha,.cf-turnstile,#challenge-form'))
    || /verify (that )?you are (a )?human|are you a robot|unusual traffic|complete the security check/i.test(head);
  return { url: location.href, title: document.title, signals: { loginForm: Boolean(document.querySelector('input[type=password]')), captcha } };
})()
"""


# Search results as structured data. __ENGINE__ and __MAX__ are filled in by search(). Redirect links of the
# engines (Google /url?q=, Bing /ck/a?u=a1...) are decoded to the real address. Google's cookie-consent page
# (shown in some regions) is accepted automatically and reported as consent so search() reads again.
SEARCH_JS = r"""
(() => {
  const ENGINE = '__ENGINE__', MAX = __MAX__;
  const clean = v => String(v || '').replace(/\s+/g, ' ').trim();
  const head = (document.body && document.body.innerText || '').slice(0, 3000);
  if (location.hostname.startsWith('consent.') || document.querySelector('form[action*="consent.google"]')) {
    const button = Array.from(document.querySelectorAll('button, input[type=submit]')).find(b => /^(accept all|reject all|i agree)$/i.test(clean(b.innerText || b.value)));
    if (button) { button.click(); return { url: location.href, title: document.title, captcha: false, consent: true, results: [] }; }
  }
  const captcha = Boolean(document.querySelector('iframe[src*="recaptcha"],iframe[src*="hcaptcha"],iframe[src*="challenges.cloudflare"],.g-recaptcha,.h-captcha,.cf-turnstile,#challenge-form,.anomaly-modal__modal,#captcha-form'))
    || /unusual traffic|are you a robot|verify (that )?you are (a )?human|solve the (following )?challenge|complete the security check/i.test(head)
    || location.pathname.startsWith('/sorry/');
  const real = href => {
    try {
      const u = new URL(href, location.href);
      if (u.hostname.endsWith('bing.com') && u.pathname.startsWith('/ck/') && u.searchParams.get('u')) {
        const b = u.searchParams.get('u').replace(/^a1/, '').replace(/-/g, '+').replace(/_/g, '/');
        return atob(b + '==='.slice((b.length + 3) % 4));
      }
      if (u.hostname.includes('google.') && u.pathname === '/url') return u.searchParams.get('q') || u.searchParams.get('url');
      return u.href;
    } catch (e) { return null; }
  };
  const own = /(^|\.)(bing\.com|google\.[a-z.]+|gstatic\.com|go\.microsoft\.com|microsofttranslator\.com)$/;
  const results = [], seen = new Set();
  const add = (title, href, snippet) => {
    const url = real(href);
    title = clean(title);
    if (!url || !/^https?:/.test(url) || !title || results.length >= MAX) return;
    let host = '';
    try { host = new URL(url).hostname; } catch (e) { return; }
    if (own.test(host)) return;
    let tidy = url;
    try { const t = new URL(url); ['msockid', 'utm_source', 'utm_medium', 'utm_campaign'].forEach(k => t.searchParams.delete(k)); tidy = t.href; } catch (e) {}
    if (seen.has(tidy)) return;
    seen.add(tidy);
    results.push({ title: title.slice(0, 160), url: tidy.slice(0, 400), snippet: clean(snippet).slice(0, 300) });
  };
  if (ENGINE === 'bing') {
    document.querySelectorAll('li.b_algo').forEach(r => {
      const a = r.querySelector('h2 a');
      if (a) add(a.innerText, a.href, (r.querySelector('.b_caption p, .b_lineclamp2, .b_lineclamp3, .b_algoSlug') || {}).innerText);
    });
  } else {
    document.querySelectorAll('a h3').forEach(h => {
      const a = h.closest('a');
      const box = a.closest('[data-hveid], .g, .MjjYud') || a.parentElement;
      add(h.innerText, a.href, (box && box.querySelector('[data-sncf], .VwiC3b, [style*="-webkit-line-clamp"]') || {}).innerText);
    });
  }
  if (!results.length && !captcha) {
    document.querySelectorAll('a[href]').forEach(a => { if (clean(a.innerText).length > 24) add(a.innerText, a.href, ''); });
  }
  return { url: location.href, title: document.title, captcha, results };
})()
"""

# Recency filters per engine: past day, week, month (Google tbs=qdr:, Bing's freshness filter).
RECENCY = {
    "bing": {"day": "&filters=ex1%3a%22ez1%22", "week": "&filters=ex1%3a%22ez2%22", "month": "&filters=ex1%3a%22ez3%22"},
    "google": {"day": "&tbs=qdr:d", "week": "&tbs=qdr:w", "month": "&tbs=qdr:m"},
}

ENGINES = {
    "google": ("https://www.google.com/search?q=%s&hl=en&gl=us&pws=0", "a h3"),
    "bing": ("https://www.bing.com/search?q=%s&setlang=en", "li.b_algo"),
}


def search(page, args):
    # Tries the preferred engine, then the others when one shows a captcha or returns nothing, and returns the
    # results as data as soon as one engine answers. The tab stays on the last engine's page for the user to see.
    query = str(args.get("query") or "").strip()
    if not query:
        raise RuntimeError("Give a search query.")
    # Google first; Bing is the fallback.
    wanted = str(args.get("engine") or "google")
    if wanted not in ENGINES:
        wanted = "google"
    order = [wanted] + [e for e in ("google", "bing") if e != wanted]
    limit = max(1, min(15, int(args.get("maxResults") or 8)))
    recency = str(args.get("recency") or "")
    budget_end = time.time() + int(args.get("budgetSeconds") or 50)
    tried, blocked, last = [], [], None
    for engine in order:
        left = budget_end - time.time()
        if engine not in ENGINES or left < 4:
            continue
        url, selector = ENGINES[engine]
        tried.append(engine)
        try:
            page.navigate(url % urllib.parse.quote_plus(query) + RECENCY[engine].get(recency, ""), seconds=int(min(12, left)), selector=selector)
        except RuntimeError as error:
            last = {"url": "", "title": "", "captcha": False, "results": [], "error": str(error)[:200]}
            continue
        script = SEARCH_JS.replace("__ENGINE__", engine).replace("__MAX__", str(limit))
        last = None
        # Results often render in batches: read again for a moment while there are only a few.
        for attempt in range(4):
            try:
                last = page.evaluate(script, timeout=8)
            except Exception as error:
                last = {"url": "", "title": "", "captcha": False, "results": [], "error": str(error)[:200]}
            if last.get("consent"):
                page.wait_ready(8, selector)
                continue
            if last.get("captcha") or len(last.get("results") or []) >= min(3, limit) or budget_end - time.time() < 3:
                break
            time.sleep(0.8)
        if last.get("captcha"):
            blocked.append(engine)
            continue
        if last.get("results"):
            return {"engine": engine, "query": query, "recency": recency or None, "url": last["url"], "title": last["title"], "results": last["results"], "tried": tried, "blocked": blocked}
    return {"engine": tried[-1] if tried else wanted, "query": query, "url": (last or {}).get("url", ""), "title": (last or {}).get("title", ""),
            "results": [], "tried": tried, "blocked": blocked, "captcha": bool(blocked) and len(blocked) == len(tried),
            "error": (last or {}).get("error")}


def read(page, args):
    params = {"max": int(args.get("maxChars") or 6000), "offset": int(args.get("offset") or 0), "limit": int(args.get("maxElements") or 120)}
    return page.evaluate(READ_JS % params)


def element_center(page, element_id):
    box = page.evaluate(
        "(() => { const el = document.querySelector('[data-cc-id=\"%d\"]'); if (!el) return null;"
        " el.scrollIntoView({block: 'center', inline: 'center'});"
        " const r = el.getBoundingClientRect(); return {x: r.left + r.width / 2, y: r.top + r.height / 2}; })()" % int(element_id)
    )
    if not box:
        raise RuntimeError("Element %s is not on the page any more. Call browser_read to get fresh element ids." % element_id)
    return box


def mouse_click(page, x, y, clicks=1):
    page.call("Input.dispatchMouseEvent", {"type": "mouseMoved", "x": x, "y": y})
    for count in range(1, clicks + 1):
        page.call("Input.dispatchMouseEvent", {"type": "mousePressed", "x": x, "y": y, "button": "left", "clickCount": count})
        page.call("Input.dispatchMouseEvent", {"type": "mouseReleased", "x": x, "y": y, "button": "left", "clickCount": count})


KEYS = {
    "enter": ("Enter", "Enter", 13, "\r"), "tab": ("Tab", "Tab", 9, ""), "escape": ("Escape", "Escape", 27, ""),
    "backspace": ("Backspace", "Backspace", 8, ""), "arrowdown": ("ArrowDown", "ArrowDown", 40, ""),
    "arrowup": ("ArrowUp", "ArrowUp", 38, ""), "arrowleft": ("ArrowLeft", "ArrowLeft", 37, ""),
    "arrowright": ("ArrowRight", "ArrowRight", 39, ""), "pagedown": ("PageDown", "PageDown", 34, ""),
    "pageup": ("PageUp", "PageUp", 33, ""), "space": (" ", "Space", 32, " "), "home": ("Home", "Home", 36, ""), "end": ("End", "End", 35, ""),
}


def press(page, name, modifiers=0):
    key, code, vk, text = KEYS.get(name.lower().replace(" ", ""), (name, name, 0, ""))
    down = {"type": "keyDown", "key": key, "code": code, "windowsVirtualKeyCode": vk, "nativeVirtualKeyCode": vk, "modifiers": modifiers}
    if text and not modifiers:
        down["text"] = text
    page.call("Input.dispatchKeyEvent", down)
    page.call("Input.dispatchKeyEvent", {"type": "keyUp", "key": key, "code": code, "windowsVirtualKeyCode": vk, "nativeVirtualKeyCode": vk, "modifiers": modifiers})


def after_action(page, args):
    page.wait_ready(min(15, int(args.get("waitSeconds") or 8)))
    summary = read(page, {"maxChars": args.get("maxChars") or 2500})
    return summary


# ---------- Uploads, downloads, and waiting ----------

# Finds the file input for an upload: the element itself, an input inside it, the input its label controls, or
# the page's first file input (sites usually hide the real input behind a styled button). Marks it for DOM lookup.
UPLOAD_JS = r"""
((id, sel) => {
  document.querySelectorAll('[data-cc-upload]').forEach(e => e.removeAttribute('data-cc-upload'));
  const isFile = e => Boolean(e) && e.tagName === 'INPUT' && String(e.type).toLowerCase() === 'file';
  const el = id ? document.querySelector('[data-cc-id="' + id + '"]') : (sel ? document.querySelector(sel) : null);
  let input = null;
  if (isFile(el)) input = el;
  else if (el) {
    const label = el.closest('label');
    input = el.querySelector('input[type=file]') || (label && isFile(label.control) ? label.control : null)
      || (el.closest('form,[role=dialog],section,main') || document).querySelector('input[type=file]');
  }
  if (!input && !id) input = document.querySelector('input[type=file]');
  if (!input) return null;
  input.setAttribute('data-cc-upload', '1');
  return { accept: input.accept || '', multiple: Boolean(input.multiple) };
})(%(id)s, %(sel)s)
"""

# What browser_wait checks on each poll: whether the wanted text is on the page (or gone), and a short excerpt of
# the open dialog (or the page) so the agent can see progress such as "Rendering 33%".
WAIT_JS = r"""
((want, gone) => {
  const clean = v => String(v || '').replace(/\s+/g, ' ').trim();
  const text = clean(document.body && document.body.innerText).toLowerCase();
  const dialogs = [...document.querySelectorAll('[role=dialog],[role=alertdialog],dialog[open],[aria-modal=true]')];
  const dialog = dialogs.length ? clean(dialogs[dialogs.length - 1].innerText) : '';
  const progress = (dialog || text).match(/\d{1,3}(\.\d+)?\s?%%/);
  return {
    url: location.href, title: document.title,
    found: want ? text.includes(want.toLowerCase()) : null,
    present: gone ? text.includes(gone.toLowerCase()) : null,
    progress: progress ? progress[0] : null,
    excerpt: (dialog || clean(document.body && document.body.innerText)).slice(0, 600),
  };
})(%(want)s, %(gone)s)
"""


def memory_status():
    # The computer's memory limit and use (cgroup v2), and how often the kernel killed a process for lack of memory.
    def read(name):
        try:
            with open(os.path.join("/sys/fs/cgroup", name)) as f:
                return f.read().strip()
        except OSError:
            return ""
    events = dict(line.split() for line in read("memory.events").splitlines() if len(line.split()) == 2)
    mb = lambda v: int(v) // (1024 * 1024) if v.isdigit() else None
    return {"limitMb": mb(read("memory.max")), "usedMb": mb(read("memory.current")), "oomKills": int(events.get("oom_kill", 0))}


def list_downloads(since=0.0, exclude=()):
    # Files in the download folders changed after since (computer clock), newest first. Chrome writes a download
    # as "<name>.crdownload" and renames it when it is complete.
    skip = set(exclude or ())
    files = []
    for folder in DOWNLOAD_DIRS:
        try:
            names = os.listdir(folder)
        except OSError:
            continue
        for name in names:
            path = os.path.join(folder, name)
            try:
                st = os.stat(path)
            except OSError:
                continue
            if not os.path.isfile(path) or st.st_mtime < since or path in skip:
                continue
            partial = name.endswith(".crdownload") or name.startswith(".com.google.Chrome.")
            files.append({"path": path, "name": name, "size": st.st_size, "modified": st.st_mtime, "partial": partial})
    files.sort(key=lambda f: f["modified"], reverse=True)
    return files


def upload(page, args):
    paths = [os.path.abspath(os.path.expanduser(str(p))) for p in (args.get("paths") or []) if str(p).strip()]
    if not paths:
        raise RuntimeError("Give the path of the file to upload.")
    for path in paths:
        if not os.path.isfile(path):
            raise RuntimeError("There is no file at %s on the computer. Download or create it first (files_list shows what is there)." % path)
    element_id = int(args["id"]) if args.get("id") is not None else None
    info = page.evaluate(UPLOAD_JS % {"id": json.dumps(element_id), "sel": json.dumps(args.get("selector"))})
    if info:
        doc = page.call("DOM.getDocument", {"depth": 0})
        node = page.call("DOM.querySelector", {"nodeId": doc["root"]["nodeId"], "selector": '[data-cc-upload="1"]'}).get("nodeId")
        if not node:
            raise RuntimeError("The page's file input disappeared. Call browser_read and try again.")
        page.call("DOM.setFileInputFiles", {"files": paths if info.get("multiple") else paths[:1], "nodeId": node})
    elif element_id is not None:
        # No file input yet: the site creates one when its button is clicked. Catch the file chooser instead.
        page.call("Page.enable")
        page.call("Page.setInterceptFileChooserDialog", {"enabled": True})
        try:
            box = element_center(page, element_id)
            mouse_click(page, box["x"], box["y"])
            chooser = page.wait_event("Page.fileChooserOpened", 8)
            if not chooser or not chooser.get("backendNodeId"):
                raise RuntimeError("Clicking element %d didn't open a file chooser. Click the site's upload button or drop area, then call browser_upload with its [id]." % element_id)
            files = paths if chooser.get("mode") == "selectMultiple" else paths[:1]
            page.call("DOM.setFileInputFiles", {"files": files, "backendNodeId": chooser["backendNodeId"]})
        finally:
            try:
                page.call("Page.setInterceptFileChooserDialog", {"enabled": False}, timeout=3)
            except Exception:
                pass
    else:
        raise RuntimeError("This page has no file input. Give the [id] of the site's upload button or drop area.")
    time.sleep(1)
    result = after_action(page, args)
    result["uploaded"] = [os.path.basename(p) for p in paths]
    return result


def wait(page, args):
    # Waits up to "seconds" until the text appears, the "gone" text disappears, or a download finishes. A page
    # that is busy (rendering a video in the browser) can't answer scripts; that counts as "busy", not as an
    # error, and the page is never interrupted (no stopLoading, which would cancel the site's own requests).
    want = str(args.get("text") or "").strip() or None
    gone = str(args.get("gone") or "").strip() or None
    download = bool(args.get("download"))
    seconds = max(1, min(60, int(args.get("seconds") or 30)))
    since = time.time() - float(args.get("sinceSeconds") or 1800)
    exclude = args.get("exclude") or []
    deadline = time.time() + seconds
    state, busy, partial = {}, False, []
    try:
        page.call("Inspector.enable", timeout=3)
    except Exception:
        pass
    while True:
        # A tab killed for lack of memory (or a Chrome that died) never finishes: report it at once.
        if any(e.get("method") == "Inspector.targetCrashed" or (e.get("method") == "Inspector.detached" and "gone" in str((e.get("params") or {}).get("reason", "")).lower()) for e in page.events) or not chrome_up():
            return {"met": False, "reason": "crashed", "partial": partial, "page": state, "memory": memory_status()}
        if download:
            files = list_downloads(since, exclude)
            partial = [f for f in files if f["partial"]]
            done = [f for f in files if not f["partial"]]
            if done and not partial:
                return {"met": True, "reason": "download", "files": done[:5], "page": state}
        if want or gone or not download:
            try:
                result = page.call("Runtime.evaluate", {"expression": WAIT_JS % {"want": json.dumps(want), "gone": json.dumps(gone)}, "returnByValue": True}, timeout=4)
                state = (result.get("result") or {}).get("value") or state
                busy = False
                if want and state.get("found"):
                    return {"met": True, "reason": "text", "page": state}
                if gone and state.get("present") is False:
                    return {"met": True, "reason": "gone", "page": state}
            except CallTimeout:
                busy = True
            except Exception as error:
                if "crash" in str(error).lower():
                    return {"met": False, "reason": "crashed", "partial": partial, "page": state, "memory": memory_status()}
        if time.time() >= deadline:
            return {"met": not (want or gone or download), "reason": "time", "busy": busy, "partial": partial, "page": state}
        time.sleep(2)


def setup():
    # Chrome opened by hand from the desktop should use the same profile as the agents, so a sign-in the user does
    # there is shared with them. Patch the google-chrome wrapper once to add the profile and DevTools flags.
    patched = []
    path = shutil.which("google-chrome")
    if path:
        try:
            with open(path, "r", encoding="utf-8") as f:
                text = f.read()
        except OSError:
            text = ""
        base = "--user-data-dir=%s --remote-debugging-port=%d --remote-allow-origins=* --test-type" % (PROFILE, PORT)
        if "creator-city" in text and EXTRA_FLAGS[0] not in text and base in text:
            # Patched by an older helper: add the flags it didn't have.
            with open(path, "w", encoding="utf-8") as f:
                f.write(text.replace(base, base + " " + " ".join(EXTRA_FLAGS), 1))
            patched.append(path)
        elif text.startswith("#!") and "creator-city" not in text and '"$@"' in text:
            flags = "--user-data-dir=%s --remote-debugging-port=%d --remote-allow-origins=* --test-type %s" % (PROFILE, PORT, " ".join(EXTRA_FLAGS))
            first, rest = text.split("\n", 1)
            text = first + "\n# creator-city: every Chrome window uses the agents' profile, so sign-ins are shared with them.\n" + rest.replace('"$@"', flags + ' "$@"', 1)
            with open(path, "w", encoding="utf-8") as f:
                f.write(text)
            patched.append(path)
    os.makedirs(PROFILE, exist_ok=True)
    return {"patched": patched}


def run(command, args):
    if command == "ping":
        return {"ok": True, "chrome": chrome_up()}
    if command == "setup":
        return setup()
    if command == "downloads":
        return {"folder": DOWNLOADS, "files": list_downloads(time.time() - float(args.get("sinceSeconds") or 86400))[:30]}
    if command == "shutdown":
        if not chrome_up():
            return {"ok": True, "running": False}
        try:
            ws = WebSocket(http_json("/json/version")["webSocketDebuggerUrl"])
            ws.send(json.dumps({"id": 1, "method": "Browser.close"}))
            time.sleep(1.5)
            ws.close()
        except Exception:
            pass
        return {"ok": True, "running": chrome_up()}

    started = ensure_chrome()
    if command == "tabs":
        return {"tabs": [{"index": i, "title": t.get("title", ""), "url": t.get("url", "")} for i, t in enumerate(page_targets())], "started": started}
    if command == "new_tab":
        target = http_json("/json/new?" + urllib.parse.quote(args.get("url") or "about:blank", safe=":/?&=#%"), method="PUT")
        # /json/activate answers with plain text ("Target activated"), not JSON.
        http_text("/json/activate/" + target["id"])
        page = Page(target)
        try:
            return after_action(page, args)
        finally:
            page.close()
    if command == "switch_tab":
        targets = page_targets()
        index = int(args.get("index") or 0)
        if index < 0 or index >= len(targets):
            raise RuntimeError("No tab %d. Call browser_tabs to list tabs." % index)
        http_text("/json/activate/" + targets[index]["id"])
        page = Page(targets[index])
        try:
            return read(page, {"maxChars": 2500})
        finally:
            page.close()
    if command == "close_tab":
        targets = page_targets()
        index = int(args.get("index") or 0)
        if 0 <= index < len(targets):
            http_text("/json/close/" + targets[index]["id"])
        return {"ok": True, "tabs": len(page_targets())}

    page = active_page()
    try:
        return page_command(page, command, args)
    except HardLimit:
        # Leave the tab usable for the next command: stop a navigation that is still hanging.
        try:
            page.call("Page.stopLoading", timeout=2)
        except BaseException:
            pass
        raise
    finally:
        page.close()


def page_command(page, command, args):
    if True:
        page.call("Page.bringToFront")
        if command == "status":
            return page.evaluate(STATUS_JS)
        if command == "open":
            url = str(args.get("url") or "").strip()
            if not url:
                raise RuntimeError("Give a URL.")
            if not url.startswith(("http://", "https://", "about:", "file://")):
                url = "https://" + url
            page.navigate(url, seconds=min(20, int(args.get("waitSeconds") or 15)))
            return read(page, {"maxChars": args.get("maxChars") or 2500})
        if command == "search":
            return search(page, args)
        if command == "read":
            return read(page, args)
        if command == "click":
            if args.get("id") is not None:
                box = element_center(page, args["id"])
                x, y = box["x"], box["y"]
            else:
                x, y = float(args["x"]), float(args["y"])
            mouse_click(page, x, y, 2 if args.get("double") else 1)
            return after_action(page, args)
        if command == "type":
            if args.get("id") is not None:
                box = element_center(page, args["id"])
                mouse_click(page, box["x"], box["y"])
                page.evaluate("(() => { const el = document.querySelector('[data-cc-id=\"%d\"]'); if (el) el.focus(); })()" % int(args["id"]))
            if args.get("clear", True):
                page.evaluate("(() => { const el = document.activeElement; if (!el) return; if ('value' in el) { el.select && el.select(); }"
                              " else if (el.isContentEditable) { document.execCommand('selectAll'); } })()")
                press(page, "backspace")
            page.call("Input.insertText", {"text": str(args.get("text") or "")})
            if args.get("submit"):
                press(page, "enter")
                return after_action(page, args)
            time.sleep(0.3)
            return {"ok": True, "typed": len(str(args.get("text") or ""))}
        if command == "select":
            ok = page.evaluate(
                "((id, wanted) => { const el = document.querySelector('[data-cc-id=\"' + id + '\"]'); if (!el || el.tagName !== 'SELECT') return false;"
                " const opt = [...el.options].find(o => o.value === wanted || o.text.trim().toLowerCase() === wanted.toLowerCase()); if (!opt) return false;"
                " el.value = opt.value; el.dispatchEvent(new Event('input', {bubbles: true})); el.dispatchEvent(new Event('change', {bubbles: true})); return true; })(%d, %s)"
                % (int(args["id"]), json.dumps(str(args.get("value") or "")))
            )
            if not ok:
                raise RuntimeError("Could not select that option. Check the element id and the option text.")
            return after_action(page, args)
        if command == "key":
            press(page, str(args.get("key") or "Enter"))
            return after_action(page, args)
        if command == "scroll":
            direction = str(args.get("direction") or "down")
            amount = float(args.get("amount") or 0.8)
            dy = {"down": 1, "up": -1}.get(direction, 1) * amount
            page.evaluate("window.scrollBy(0, Math.round(innerHeight * %f))" % dy)
            time.sleep(0.6)
            return read(page, {"maxChars": args.get("maxChars") or 2500})
        if command in ("back", "forward", "reload"):
            page.evaluate({"back": "history.back()", "forward": "history.forward()", "reload": "location.reload()"}[command])
            return after_action(page, args)
        if command == "upload":
            return upload(page, args)
        if command == "wait":
            return wait(page, args)
        if command == "eval":
            value = page.evaluate(str(args.get("expression") or "null"))
            text = json.dumps(value, ensure_ascii=False, default=str)
            return {"value": text[: int(args.get("maxChars") or 20000)], "truncated": len(text) > int(args.get("maxChars") or 20000)}
        raise RuntimeError("Unknown browser command: " + command)


class Locked:
    """One browser command at a time on this computer (agents and the server's own calls), waiting up to 40s."""

    def __enter__(self):
        os.makedirs(BASE, exist_ok=True)
        self.f = open(LOCK, "w")
        deadline = time.time() + 40
        while True:
            try:
                fcntl.flock(self.f, fcntl.LOCK_EX | fcntl.LOCK_NB)
                return self
            except BlockingIOError:
                if time.time() > deadline:
                    raise RuntimeError("The browser is busy with another action. Try again in a moment.")
                time.sleep(0.2)

    def __exit__(self, *exc):
        fcntl.flock(self.f, fcntl.LOCK_UN)
        self.f.close()


class HardLimit(BaseException):
    """Raised by the alarm. A BaseException, so the helper's own "except Exception" retries can't swallow it."""


def on_alarm(signum, frame):
    raise HardLimit("The browser action took longer than %ds and was stopped. The page may be slow or stuck: try browser_read, another site, or a simpler step." % HARD_LIMIT)


def main():
    command = sys.argv[1] if len(sys.argv) > 1 else "ping"
    signal.signal(signal.SIGALRM, on_alarm)
    signal.alarm(HARD_LIMIT)
    try:
        raw = sys.argv[2] if len(sys.argv) > 2 else "{}"
        # The server sends arguments base64-encoded ("b64:...") so no shell quoting can break them, or, when they
        # are too long for one command, writes them to a file first ("file:/path", deleted after reading).
        if raw.startswith("file:"):
            with open(raw[5:], "r", encoding="utf-8") as f:
                raw = f.read()
            os.remove(sys.argv[2][5:])
        args = json.loads(base64.b64decode(raw[4:]).decode("utf-8") if raw.startswith("b64:") else raw)
        if command in ("ping", "setup", "shutdown", "downloads"):
            result = run(command, args)
        else:
            with Locked():
                result = run(command, args)
        signal.alarm(0)
        print(json.dumps({"ok": True, "result": result}, ensure_ascii=False))
    except BaseException as error:
        signal.alarm(0)
        print(json.dumps({"ok": False, "error": str(error)[:800] or error.__class__.__name__}, ensure_ascii=False))


if __name__ == "__main__":
    main()
