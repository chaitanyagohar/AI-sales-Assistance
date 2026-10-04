#!/usr/bin/env python3
"""
oddlambda_outreach.py

Finds local businesses that need a better website, audits their sites, drafts short
honest cold emails from what the audit actually found, and sends them slowly through
Resend, with follow-ups, an opt-out list and optional reply/bounce tracking.

Single file. Python 3.9+. Standard library only.

CREDENTIALS
  Read automatically from .env.local (or .env). The script looks in the current folder,
  the script's folder, and up to 3 parent folders, so it can live next to your Next.js
  project's .env.local. Real environment variables win over the file. Keys used:
       RESEND_API_KEY          sends the emails (your From domain must be verified in Resend)
       GEMINI_API_KEY          Gemini writes each email (plain templates are used without it)
       GOOGLE_PLACES_API_KEY   optional, better discovery (else free OpenStreetMap data)
       IMAP_USER / IMAP_PASSWORD / IMAP_HOST
                               optional, only for `sync` (reading replies from the mailbox
                               that receives your Reply-To mail)
  Use ENV_FILE=/path/to/file to point at a specific file.

QUICK START
  1. Edit CONFIG below (sender name/email, postal address, niches, cities).
  2. python oddlambda_outreach.py doctor             # checks keys + config, prints no secrets
  3. Run the loop:
       python oddlambda_outreach.py discover              # find businesses
       python oddlambda_outreach.py audit                 # check sites, find emails, score
       python oddlambda_outreach.py draft                 # write step-1 emails
       python oddlambda_outreach.py review                # approve / skip each one
       python oddlambda_outreach.py send                  # dry run
       python oddlambda_outreach.py send --live           # sends, up to the daily cap
  4. Every day:  sync -> followups -> review -> send --live
  Other: status, export, import leads.csv, unsub someone@example.com (or @domain.com),
         replied someone@example.com

NOTES
  * Emails are never sent without you approving them (except follow-ups, if you keep
    auto_approve_followups on, and only for leads you already approved and contacted).
  * Start with a low daily_cap and raise it slowly. Keep bounces and complaints near zero:
    email providers can suspend accounts for high rates. Consider a dedicated sending
    subdomain (e.g. hello@mail.oddlambda.com) to protect your main domain's reputation.
  * Only role/public business emails found on a business's own site (or its own listing)
    are used. Do not point this at EU/UK sole traders without checking PECR/GDPR.
  * Every email carries your identity, postal address and a plain opt-out line.
"""
import argparse, csv, imaplib, json, os, random, re, sqlite3, ssl, sys, time
import email as emaillib
import html as htmllib
import urllib.error, urllib.parse, urllib.request
from datetime import datetime, timedelta
from html.parser import HTMLParser


# ------------------------------ .env loading ------------------------------
def load_env():
    """Load KEY=VALUE pairs from .env.local / .env without overriding real env vars.
    Returns the list of files read. Values are never printed."""
    here = os.path.dirname(os.path.abspath(__file__))
    dirs = []
    for base in (os.getcwd(), here):
        d = base
        for _ in range(4):
            if d not in dirs:
                dirs.append(d)
            parent = os.path.dirname(d)
            if parent == d:
                break
            d = parent
    if os.environ.get("ENV_FILE"):
        files = [os.environ["ENV_FILE"]]
    else:
        files = [os.path.join(d, n) for d in dirs for n in (".env.local", ".env")]
    pair = re.compile(r"""([A-Za-z_][A-Za-z0-9_]*)\s*=\s*("[^"]*"|'[^']*'|[^,\s#]*)""")
    loaded = []
    for path in files:
        if not os.path.isfile(path):
            continue
        with open(path, encoding="utf-8-sig") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                for m in pair.finditer(line):
                    k, v = m.group(1), m.group(2).strip("\"'")
                    if v and k not in os.environ:     # first file found wins; real env wins over files
                        os.environ[k] = v
        loaded.append(path)
    return loaded


ENV_FILES = load_env()

# ============================== CONFIG ==============================
CONFIG = {
    "agency": {
        "name": "Oddlambda",
        "site": "https://oddlambda.com",
        "sender_name": "Chaitanya",
        "sender_email": "hello@oddlambda.com",   # must be on a domain verified in Resend
        "reply_to": "",                          # optional; defaults to sender_email
        "postal_address": "YOUR BUSINESS POSTAL ADDRESS",  # <- fill in (legally required in many places)
        "services": "custom Next.js websites and web apps, fast conversion-focused landing pages and funnels, UI/UX design",
        "offer": "a short, free list of fixes for their current site (or a rough plan if they have none)",
        # Only REAL, checkable facts. Example: "Built the booking site for <real client>". Empty = none cited.
        "proof_points": [],
    },
    "targets": {
        "niches": ["restaurant", "cafe", "dentist", "clinic", "salon", "gym",
                   "real_estate", "hotel", "jewellery", "coaching"],
        "cities": ["Delhi", "Gurugram", "Noida"],
        "max_per_query": 200,
    },
    "audit": {"min_score": 3, "use_pagespeed": False, "max_sites_per_run": 100},
    "sending": {
        "daily_cap": 15,
        "min_delay_s": 60, "max_delay_s": 180,
        "followup_gaps_days": [4, 7],       # step 2 after 4 days, step 3 after 7 more
        "auto_approve_followups": True,
        "imap_host": "imap.gmail.com",      # only used by `sync`; IMAP_HOST in .env.local overrides
    },
    # Tried in order; if one fails (no billing, renamed, rate-limited) the next one is used.
    # The "-latest" aliases follow Google's newest Pro / Flash. Pro needs billing on your API key.
    "llm": {"models": ["gemini-pro-latest", "gemini-flash-latest", "gemini-2.5-flash-lite"],
            "delay_s": 2},   # raise to 7 if you are on the free tier
}
# ====================================================================

A, T, AUDIT, S = CONFIG["agency"], CONFIG["targets"], CONFIG["audit"], CONFIG["sending"]
DB_PATH = os.environ.get("OUTREACH_DB", "outreach.db")
UA = "Mozilla/5.0 (compatible; OddlambdaAudit/1.0; +https://oddlambda.com)"

NICHE_TAGS = {
    "restaurant": ["amenity=restaurant"], "cafe": ["amenity=cafe"],
    "dentist": ["amenity=dentist"], "clinic": ["amenity=clinic", "amenity=doctors"],
    "salon": ["shop=hairdresser", "shop=beauty"], "gym": ["leisure=fitness_centre"],
    "real_estate": ["office=estate_agent"], "hotel": ["tourism=hotel", "tourism=guest_house"],
    "jewellery": ["shop=jewelry"], "lawyer": ["office=lawyer"], "architect": ["office=architect"],
    "school": ["amenity=school"], "coaching": ["amenity=college", "office=educational_institution"],
    "clothes": ["shop=clothes"], "furniture": ["shop=furniture"],
}
SOCIAL = ("facebook.com", "instagram.com", "linktr.ee", "wa.me", "whatsapp.com", "zomato.com",
          "swiggy.com", "justdial.com", "google.com", "goo.gl", "business.site", "twitter.com",
          "x.com", "youtube.com", "linkedin.com", "tripadvisor.com", "tripadvisor.in")
SKIP_SUFFIX = (".gov", ".gov.in", ".nic.in", ".edu", ".ac.in", ".mil")
FREEMAIL = ("gmail.com", "yahoo.com", "yahoo.in", "outlook.com", "hotmail.com", "rediffmail.com")

SCHEMA = """
CREATE TABLE IF NOT EXISTS leads(
 id INTEGER PRIMARY KEY, key TEXT UNIQUE, name TEXT, niche TEXT, city TEXT,
 website TEXT, email TEXT, phone TEXT, source TEXT, status TEXT DEFAULT 'new',
 score INTEGER DEFAULT 0, findings TEXT DEFAULT '[]', step INTEGER DEFAULT 0,
 last_sent TEXT, created TEXT);
CREATE TABLE IF NOT EXISTS messages(
 id INTEGER PRIMARY KEY, lead_id INTEGER, step INTEGER, subject TEXT, body TEXT,
 status TEXT DEFAULT 'draft', created TEXT, sent_at TEXT, error TEXT);
CREATE TABLE IF NOT EXISTS suppress(email TEXT PRIMARY KEY, reason TEXT, added TEXT);
"""


def now():
    return datetime.now().isoformat(timespec="seconds")


def db():
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    con.executescript(SCHEMA)
    return con


# ------------------------------ helpers ------------------------------
def http_json(url, data=None, headers=None, timeout=100):
    req = urllib.request.Request(url, data=data, headers=headers or {})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8", "replace"))


def norm_url(u):
    if not u:
        return None
    u = u.strip().split(";")[0].strip()
    if not u:
        return None
    return u if re.match(r"https?://", u, re.I) else "https://" + u


def domain_of(u):
    try:
        h = urllib.parse.urlparse(u).netloc.lower().split(":")[0]
    except Exception:
        return ""
    return re.sub(r"^www\.", "", h)


def is_social(dom):
    return any(dom == s or dom.endswith("." + s) for s in SOCIAL)


EMAIL_RE = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9\-]+(?:\.[A-Za-z0-9\-]+)*\.[A-Za-z]{2,}")
JUNK = ("sentry", "wixpress", "example.", "domain.com", "yourdomain", "email.com", "godaddy",
        "schema.org", "w3.org")
BAD_LOCAL = ("noreply", "no-reply", "donotreply", "do-not-reply", "privacy", "abuse",
             "webmaster", "postmaster")
ROLE = ("info", "hello", "contact", "enquiry", "enquiries", "inquiry", "sales", "office",
        "admin", "bookings", "booking", "reservations", "care", "support", "reach")


def valid_email(e):
    e = (e or "").lower()
    if not EMAIL_RE.fullmatch(e):
        return False
    if e.endswith((".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".css", ".js")):
        return False
    if any(j in e for j in JUNK):
        return False
    return not e.split("@")[0].startswith(BAD_LOCAL)


def find_emails(raw_html, site_dom):
    text = urllib.parse.unquote(htmllib.unescape(raw_html))
    found = {m.lower() for m in EMAIL_RE.findall(text)}
    keep = []
    for e in found:
        if not valid_email(e):
            continue
        dom = e.split("@")[1]
        # guard against a web designer's email in the footer: same domain or free-mail only
        if dom.endswith(site_dom) or dom in FREEMAIL:
            keep.append(e)

    def rank(e):
        local, dom = e.split("@")
        return (0 if dom.endswith(site_dom) else 1, 0 if local in ROLE else 1, len(e))
    return sorted(keep, key=rank)


def add_lead(con, name, niche, city, website, email, phone, source):
    name = (name or "").strip()
    if not name:
        return False
    website = norm_url(website)
    dom = domain_of(website) if website else ""
    if dom and is_social(dom):
        website, dom = None, ""          # a Facebook page is not a website
    if dom and dom.endswith(SKIP_SUFFIX):
        return False
    key = dom or (re.sub(r"\W+", "-", name.lower()) + "|" + (city or "").lower())
    email = ((email or "").split(";")[0].strip().lower()) or None
    if email and not valid_email(email):
        email = None
    cur = con.execute(
        "INSERT OR IGNORE INTO leads(key,name,niche,city,website,email,phone,source,created) "
        "VALUES(?,?,?,?,?,?,?,?,?)",
        (key, name, niche, city, website, email, phone, source, now()))
    return cur.rowcount > 0


def suppressed(con, em):
    if not em:
        return False
    em = em.lower()
    row = con.execute("SELECT 1 FROM suppress WHERE email IN (?,?)",
                      (em, "@" + em.split("@")[-1])).fetchone()
    return row is not None


def suppress(con, addr, reason):
    addr = addr.lower().strip()
    con.execute("INSERT OR REPLACE INTO suppress VALUES(?,?,?)", (addr, reason, now()))
    pattern = "%" + addr if addr.startswith("@") else addr
    con.execute("UPDATE leads SET status='unsub' WHERE lower(email) LIKE ?", (pattern,))
    con.execute("UPDATE messages SET status='skipped' WHERE status IN ('draft','approved') "
                "AND lead_id IN (SELECT id FROM leads WHERE status='unsub')")
    con.commit()


# ------------------------------ discovery ------------------------------
def discover_osm(con, city, niche):
    parts = []
    for tag in NICHE_TAGS[niche]:
        k, v = tag.split("=")
        for c in ("website", "contact:website", "email", "contact:email"):
            parts.append(f'nwr(area.a)["{k}"="{v}"]["{c}"];')
    union = "".join(parts)
    city = city.replace('"', "")
    q = (f'[out:json][timeout:90];area["name"="{city}"]["boundary"="administrative"]->.a;'
         f'({union});out tags {int(T["max_per_query"])};')
    data = http_json("https://overpass-api.de/api/interpreter",
                     data=urllib.parse.urlencode({"data": q}).encode(),
                     headers={"User-Agent": UA})
    n = 0
    for el in data.get("elements", []):
        t = el.get("tags", {})
        if add_lead(con, t.get("name"), niche, city,
                    t.get("website") or t.get("contact:website"),
                    t.get("email") or t.get("contact:email"),
                    t.get("phone") or t.get("contact:phone"), "osm"):
            n += 1
    return n


def discover_places(con, city, niche, key):
    n, token = 0, None
    for _ in range(3):
        body = {"textQuery": f"{niche.replace('_', ' ')} in {city}", "pageSize": 20}
        if token:
            body["pageToken"] = token
        data = http_json(
            "https://places.googleapis.com/v1/places:searchText",
            data=json.dumps(body).encode(),
            headers={"Content-Type": "application/json", "X-Goog-Api-Key": key,
                     "X-Goog-FieldMask": "places.displayName,places.websiteUri,"
                                         "places.nationalPhoneNumber,nextPageToken"})
        for p in data.get("places", []):
            if add_lead(con, (p.get("displayName") or {}).get("text"), niche, city,
                        p.get("websiteUri"), None, p.get("nationalPhoneNumber"), "places"):
                n += 1
        token = data.get("nextPageToken")
        if not token:
            break
        time.sleep(1)
    return n


def cmd_discover(args):
    con = db()
    gkey = os.environ.get("GOOGLE_PLACES_API_KEY")
    for city in (args.city or T["cities"]):
        for niche in (args.niche or T["niches"]):
            if not gkey and niche not in NICHE_TAGS:
                print(f"{city:12} {niche:12} skipped (unknown niche for OSM; add it to NICHE_TAGS)")
                continue
            try:
                n = discover_places(con, city, niche, gkey) if gkey else discover_osm(con, city, niche)
            except Exception as e:
                print(f"{city:12} {niche:12} failed: {e}")
                n = 0
            con.commit()
            print(f"{city:12} {niche:12} +{n} new")
            if not gkey:
                time.sleep(6)      # be polite to the free Overpass servers


def cmd_import(args):
    con = db()
    n = 0
    with open(args.file, newline="", encoding="utf-8-sig") as f:
        for r in csv.DictReader(f):
            r = {(k or "").strip().lower(): (v or "").strip() for k, v in r.items()}
            if add_lead(con, r.get("name"), r.get("niche"), r.get("city"), r.get("website"),
                        r.get("email"), r.get("phone"), "csv"):
                n += 1
    con.commit()
    print(f"imported {n} new leads (columns used: name, website, email, phone, city, niche)")


# ------------------------------ audit ------------------------------
class Page(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.title, self.meta, self.links, self.text = "", {}, [], []
        self.forms, self.old, self._in_title, self._skip = 0, 0, False, 0

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "title":
            self._in_title = True
        elif tag == "meta":
            k = (a.get("name") or a.get("property") or "").lower()
            if k:
                self.meta[k] = a.get("content") or ""
        elif tag == "a" and a.get("href"):
            self.links.append(a["href"])
        elif tag == "form":
            self.forms += 1
        elif tag in ("font", "marquee", "frameset", "blink"):
            self.old += 1
        elif tag in ("script", "style"):
            self._skip += 1

    def handle_endtag(self, tag):
        if tag == "title":
            self._in_title = False
        elif tag in ("script", "style") and self._skip:
            self._skip -= 1

    def handle_data(self, d):
        if self._in_title:
            self.title += d
        elif not self._skip:
            self.text.append(d)


def fetch(url, verify=True, timeout=12):
    ctx = ssl.create_default_context()
    if not verify:
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/html,application/xhtml+xml"})
    t0 = time.time()
    with urllib.request.urlopen(req, timeout=timeout, context=ctx) as r:
        raw = r.read(1_500_000)
        return {"url": r.geturl(), "secs": time.time() - t0,
                "html": raw.decode(r.headers.get_content_charset() or "utf-8", "replace")}


def get_site(url):
    """Returns (page|None, flags, error). error == 'blocked' means we can't judge the site."""
    flags, last_err = [], None
    tried = [(url, True)]
    if url.startswith("https://"):
        tried += [(url, False), ("http://" + url[8:], True)]
    for u, verify in tried:
        try:
            page = fetch(u, verify)
            if not verify:
                flags.append("ssl_error")
            if page["url"].startswith("http://"):
                flags.append("no_https")
            return page, flags, None
        except urllib.error.HTTPError as e:
            if e.code in (401, 403, 406, 429, 999):
                return None, flags, "blocked"
            last_err = f"HTTP {e.code}"
            break                       # the server answered; other schemes won't help
        except Exception as e:
            last_err = str(e)
    return None, flags, last_err or "unreachable"


def audit_lead(lead):
    """Returns (findings, best_email). Findings are plain-language, verifiable observations."""
    F = []

    def add(code, weight, text):
        F.append({"code": code, "weight": weight, "text": text})

    if not lead["website"]:
        add("no_website", 5, "I couldn't find a website of their own (only listings or social pages)")
        return F, lead["email"]
    page, flags, err = get_site(lead["website"])
    if not page:
        if err == "blocked":
            return [], lead["email"]
        add("unreachable", 5, "the website didn't load when I tried it")
        return F, lead["email"]

    if "ssl_error" in flags:
        add("ssl_error", 4, "browsers show a security warning on the site (SSL certificate problem)")
    if "no_https" in flags:
        add("no_https", 2, "the site isn't served over HTTPS, so browsers label it 'Not secure'")
    p = Page()
    try:
        p.feed(page["html"])
    except Exception:
        pass
    if "viewport" not in p.meta:
        add("no_mobile", 3, "there's no mobile viewport setting, so it probably looks cramped on phones")
    if page["secs"] > 4:
        add("slow", 2, f"the homepage took about {page['secs']:.0f} seconds to respond")
    text = " ".join(p.text)
    years = []
    for m in re.finditer(r"(?:©|copyright)[^0-9]{0,15}((?:19|20)\d{2})(?:\s*[-–]\s*((?:19|20)\d{2}))?", text, re.I):
        years += [int(y) for y in m.groups() if y]
    if years and max(years) <= datetime.now().year - 3:
        add("stale", 2, f"the footer still says © {max(years)}, which makes the site look abandoned")
    if not p.meta.get("description"):
        add("no_meta", 1, "there's no meta description, so it shows poorly in Google results")
    low = page["html"].lower()
    builder = next((n for n, s in (("Wix", "wixstatic.com"), ("Weebly", "weebly.com"),
                                   ("GoDaddy", "godaddysites.com"), ("Blogspot", "blogspot.com"))
                    if s in low), None)
    if builder:
        add("template", 1, f"it's built on a generic {builder} template")
    if p.old >= 3:
        add("legacy_html", 2, "the page uses legacy HTML (font/marquee tags) from an older era of the web")
    links = [h.lower() for h in p.links]
    has_cta = (p.forms > 0
               or any(h.startswith(("tel:", "mailto:")) or "wa.me" in h or "whatsapp" in h for h in links)
               or re.search(r"\b(book|order|enquir|inquir|get a quote|appointment|reserve)", text, re.I))
    if not has_cta:
        add("no_cta", 2, "there's no obvious way to book or enquire (no form, phone or WhatsApp button)")
    if AUDIT["use_pagespeed"]:
        try:
            d = http_json("https://www.googleapis.com/pagespeedonline/v5/runPagespeed?" +
                          urllib.parse.urlencode({"url": page["url"], "strategy": "mobile",
                                                  "category": "performance"}), timeout=90)
            sc = round(d["lighthouseResult"]["categories"]["performance"]["score"] * 100)
            if sc < 50:
                add("psi", 3, f"Google PageSpeed scores the mobile version {sc}/100")
        except Exception:
            pass

    # contact email: homepage first, then up to two contact/about pages on the same domain
    sdom = domain_of(page["url"])
    emails = find_emails(page["html"], sdom)
    if not emails:
        cands = []
        for h in p.links:
            hl = h.lower()
            if hl.startswith(("mailto:", "tel:", "javascript:", "#")) or not re.search(r"contact|about|reach", hl):
                continue
            u = urllib.parse.urljoin(page["url"], h)
            if domain_of(u) == sdom and u not in cands:
                cands.append(u)
        for u in cands[:2]:
            try:
                emails = find_emails(fetch(u)["html"], sdom)
            except Exception:
                continue
            if emails:
                break
    return F, (lead["email"] or (emails[0] if emails else None))


def cmd_audit(args):
    con = db()
    rows = con.execute("SELECT * FROM leads WHERE status='new' LIMIT ?",
                       (AUDIT["max_sites_per_run"],)).fetchall()
    for r in rows:
        try:
            F, em = audit_lead(r)
        except Exception as e:
            print(f"  audit error on {r['name']}: {e}")
            F, em = [], r["email"]
        score = sum(f["weight"] for f in F)
        if suppressed(con, em):
            status = "suppressed"
        elif not em:
            status = "no_email"       # still useful: see `export` for a call / WhatsApp list
        elif score < AUDIT["min_score"]:
            status = "skip_low"
        else:
            status = "ready"
        con.execute("UPDATE leads SET findings=?, score=?, email=?, status=? WHERE id=?",
                    (json.dumps(F), score, em, status, r["id"]))
        con.commit()
        print(f"{r['name'][:38]:38} score={score:<2} {status}")
        time.sleep(1)
    print(f"audited {len(rows)} leads")


# ------------------------------ drafting ------------------------------
SYSTEM = """You write short, honest cold emails for a small web studio. Rules:
- Plain text, 70-110 words, no hype, no emojis, no markdown.
- Open with what was actually observed on their site. Use ONLY the findings provided; never invent problems, numbers, clients, results or familiarity with the owner.
- Mention at most two findings and explain in one sentence why they cost the business customers.
- Offer exactly one small, free, low-commitment next step. No fake urgency, no flattery.
- Start with 'Hi,' and end with the sender's name on its own line. Do NOT add a footer, address or unsubscribe line; those are appended automatically.
- Return ONLY JSON: {"subject": "...", "body": "..."}. Subject under 8 words, plain, not clickbait."""


def llm_draft(lead, findings):
    key = os.environ.get("GEMINI_API_KEY")
    if not key:
        return None
    top = sorted(findings, key=lambda f: -f["weight"])[:3]
    prompt = (f"Studio: {A['name']} ({A['site']}). Services: {A['services']}.\n"
              f"Real proof points you may cite (empty means cite none): {json.dumps(A['proof_points'])}\n"
              f"Free offer: {A['offer']}\n"
              f"Recipient business: {lead['name']} ({lead['niche']}, {lead['city']}); site: {lead['website'] or 'none'}\n"
              f"Observed findings: {json.dumps([f['text'] for f in top])}\n"
              f"Sender name to sign with: {A['sender_name']}\nWrite the email.")
    payload = json.dumps({"systemInstruction": {"parts": [{"text": SYSTEM}]},
                          "contents": [{"role": "user", "parts": [{"text": prompt}]}],
                          "generationConfig": {"maxOutputTokens": 8192,   # Pro models "think" first
                                               "responseMimeType": "application/json"}}).encode()
    for model in CONFIG["llm"]["models"]:
        try:
            d = http_json(f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
                          data=payload, headers={"x-goog-api-key": key, "Content-Type": "application/json"},
                          timeout=120)
            time.sleep(CONFIG["llm"]["delay_s"])
            parts = d["candidates"][0]["content"]["parts"]
            j = json.loads(re.search(r"\{.*\}", "".join(p.get("text", "") for p in parts), re.S).group(0))
            subj, body = j["subject"].strip(), j["body"].strip()
            if subj and len(body.split()) <= 180:
                return subj, body
        except Exception as e:
            print(f"  ({model} failed: {e})")
    print("  (all models failed, using template)")
    return None


def template_draft(lead, findings):
    top = sorted(findings, key=lambda f: -f["weight"])[:2]
    dom = domain_of(lead["website"]) if lead["website"] else ""
    ref = dom or lead["name"]
    if lead["website"]:
        opener = f"I run {A['name']}, a small web studio. I looked at {dom} and noticed that " + \
                 "; and that ".join(f["text"] for f in top) + "."
    else:
        opener = f"I run {A['name']}, a small web studio. I searched for {lead['name']} and {top[0]['text']}."
    body = (f"Hi,\n\n{opener}\n\nMost customers check a business on their phone before they call or "
            f"visit, so this can quietly cost enquiries. I can send {A['offer']}. Want me to?\n\n"
            f"{A['sender_name']}")
    return f"quick note about {ref}", body


def followup_text(lead, step, orig_subject):
    ref = domain_of(lead["website"]) if lead["website"] else lead["name"]
    if step == 2:
        body = (f"Hi,\n\nBumping this in case it got buried. Happy to send the short list for {ref}. "
                f"It's free and there's no obligation.\n\n{A['sender_name']}")
    else:
        body = (f"Hi,\n\nLast note from me. If a website refresh ever moves up your list, "
                f"you can see what we do at {A['site']}. Otherwise no need to reply.\n\n{A['sender_name']}")
    return orig_subject, body


def footer():
    return (f"\n\n--\n{A['sender_name']} | {A['name']} | {A['site']}\n{A['postal_address']}\n"
            f"Not interested? Reply \"no thanks\" and I won't email again.")


def cmd_draft(args):
    con = db()
    rows = con.execute("SELECT * FROM leads WHERE status='ready' ORDER BY score DESC LIMIT ?",
                       (args.limit,)).fetchall()
    for r in rows:
        F = json.loads(r["findings"])
        subject, body = llm_draft(r, F) or template_draft(r, F)
        con.execute("INSERT INTO messages(lead_id,step,subject,body,status,created) "
                    "VALUES(?,?,?,?, 'draft', ?)", (r["id"], 1, subject, body, now()))
        con.execute("UPDATE leads SET status='drafted' WHERE id=?", (r["id"],))
        con.commit()
        print(f"drafted: {r['name']}")
    print(f"{len(rows)} drafts. Run `review` to approve them.")


def cmd_review(args):
    con = db()
    rows = con.execute(
        "SELECT m.*, l.name, l.email, l.score FROM messages m JOIN leads l ON l.id=m.lead_id "
        "WHERE m.status='draft' ORDER BY l.score DESC, m.id").fetchall()
    if not rows:
        print("nothing to review")
    for m in rows:
        print("=" * 72)
        print(f"#{m['id']}  step {m['step']}  |  {m['name']} <{m['email']}>  |  score {m['score']}")
        print(f"Subject: {m['subject']}\n\n{m['body']}")
        ans = input("\n[a]pprove  [s]kip  [q]uit > ").strip().lower()
        if ans == "a":
            con.execute("UPDATE messages SET status='approved' WHERE id=?", (m["id"],))
        elif ans == "s":
            con.execute("UPDATE messages SET status='skipped' WHERE id=?", (m["id"],))
            if m["step"] == 1:
                con.execute("UPDATE leads SET status='skipped' WHERE id=?", (m["lead_id"],))
        elif ans == "q":
            break
        con.commit()


def cmd_approve(args):
    con = db()
    if not args.all:
        sys.exit("use `approve --all` (only after you have read the drafts) or `review`")
    n = con.execute("UPDATE messages SET status='approved' WHERE status='draft'").rowcount
    con.commit()
    print(f"approved {n}")


# ------------------------------ sending (Resend) ------------------------------
def reply_to_addr():
    return A.get("reply_to") or A["sender_email"]


def send_email(to, subject, body, msg_id):
    """Send one plain-text email through the Resend API."""
    payload = {
        "from": f"{A['sender_name']} <{A['sender_email']}>",
        "to": [to],
        "subject": subject,
        "text": body,
        "reply_to": reply_to_addr(),
        "headers": {"List-Unsubscribe": f"<mailto:{reply_to_addr()}?subject=unsubscribe>"},
    }
    req = urllib.request.Request(
        "https://api.resend.com/emails", data=json.dumps(payload).encode(),
        headers={"Authorization": f"Bearer {os.environ['RESEND_API_KEY']}",
                 "Content-Type": "application/json",
                 "User-Agent": "oddlambda-outreach/1.0",          # Resend sits behind Cloudflare; a real UA avoids 403s
                 "Idempotency-Key": f"oddlambda-msg-{msg_id}"})    # a retried run can't double-send
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read().decode("utf-8", "replace"))
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"Resend HTTP {e.code}: {e.read().decode('utf-8', 'replace')[:300]}")


def cmd_send(args):
    con = db()
    if args.live:
        if "YOUR" in A["sender_name"] or "YOUR" in A["postal_address"]:
            sys.exit("Fill in sender_name and postal_address in CONFIG first.")
        if not os.environ.get("RESEND_API_KEY"):
            sys.exit("RESEND_API_KEY not found. Put it in .env.local (run `doctor` to see where the script looks).")
    today = datetime.now().strftime("%Y-%m-%d") + "%"
    sent_today = con.execute("SELECT COUNT(*) FROM messages WHERE status='sent' AND sent_at LIKE ?",
                             (today,)).fetchone()[0]
    room = S["daily_cap"] - sent_today
    rows = con.execute(
        "SELECT m.*, l.email, l.name FROM messages m JOIN leads l ON l.id=m.lead_id "
        "WHERE m.status='approved' ORDER BY m.step DESC, m.id").fetchall()
    print(f"sent today: {sent_today}/{S['daily_cap']}, approved waiting: {len(rows)}")
    n = 0
    for m in rows:
        if n >= room:
            break
        if suppressed(con, m["email"]):
            con.execute("UPDATE messages SET status='skipped' WHERE id=?", (m["id"],))
            con.commit()
            continue
        if not args.live:
            print(f"[dry run] #{m['id']} step {m['step']} -> {m['email']}: {m['subject']}")
            n += 1
            continue
        try:
            send_email(m["email"], m["subject"], m["body"] + footer(), m["id"])
            con.execute("UPDATE messages SET status='sent', sent_at=? WHERE id=?", (now(), m["id"]))
            con.execute("UPDATE leads SET status='contacted', step=?, last_sent=? WHERE id=?",
                        (m["step"], now(), m["lead_id"]))
            print(f"sent #{m['id']} -> {m['email']}")
        except Exception as e:
            con.execute("UPDATE messages SET status='failed', error=? WHERE id=?", (str(e)[:300], m["id"]))
            print(f"FAILED #{m['id']} -> {m['email']}: {e}")
        con.commit()
        n += 1
        if n < room and n < len(rows):
            time.sleep(random.uniform(S["min_delay_s"], S["max_delay_s"]))
    print(f"{'sent' if args.live else 'would send'} {n}")


def cmd_followups(args):
    con = db()
    gaps = S["followup_gaps_days"]
    made = 0
    rows = con.execute("SELECT * FROM leads WHERE status='contacted' AND step<?",
                       (len(gaps) + 1,)).fetchall()
    for r in rows:
        nxt = r["step"] + 1
        if con.execute("SELECT 1 FROM messages WHERE lead_id=? AND step=?", (r["id"], nxt)).fetchone():
            continue
        if datetime.now() < datetime.fromisoformat(r["last_sent"]) + timedelta(days=gaps[nxt - 2]):
            continue
        if suppressed(con, r["email"]):
            continue
        first = con.execute("SELECT subject FROM messages WHERE lead_id=? AND step=1", (r["id"],)).fetchone()
        subject, body = followup_text(r, nxt, first["subject"] if first else "following up")
        con.execute("INSERT INTO messages(lead_id,step,subject,body,status,created) VALUES(?,?,?,?,?,?)",
                    (r["id"], nxt, subject, body,
                     "approved" if S["auto_approve_followups"] else "draft", now()))
        made += 1
    con.commit()
    print(f"created {made} follow-ups")


# ------------------------------ replies / bounces ------------------------------
def msg_text(m):
    out = []
    for p in (m.walk() if m.is_multipart() else [m]):
        if p.get_content_type() == "text/plain":
            try:
                out.append(p.get_payload(decode=True).decode(p.get_content_charset() or "utf-8", "replace"))
            except Exception:
                pass
    return "\n".join(out)


def strip_quoted(text):
    keep = []
    for line in text.splitlines():
        if line.startswith(">") or re.match(r"^\s*On .* wrote:", line) or "Original Message" in line:
            if not line.startswith(">"):
                break
            continue
        keep.append(line)
    return "\n".join(keep)


OPTOUT = re.compile(r"\b(unsubscribe|remove me|stop|no thanks|not interested|do not contact|"
                    r"don'?t contact|don'?t email)\b", re.I)


def cmd_sync(args):
    """Reads the mailbox that receives your Reply-To mail. Resend only sends; it doesn't hold replies."""
    host = os.environ.get("IMAP_HOST") or S["imap_host"]
    user, pw = os.environ.get("IMAP_USER"), os.environ.get("IMAP_PASSWORD")
    if not (user and pw):
        sys.exit("`sync` reads the inbox that receives your replies. Add IMAP_USER and IMAP_PASSWORD "
                 "(and IMAP_HOST if not Gmail) to .env.local. Or handle replies by hand with "
                 "`replied <email>` and `unsub <email>`.")
    con = db()
    M = imaplib.IMAP4_SSL(host)
    M.login(user, pw)
    M.select("INBOX")
    leads = con.execute("SELECT * FROM leads WHERE status='contacted'").fetchall()
    replied = unsub = bounced = 0
    for l in leads:
        _, d = M.search(None, "FROM", f'"{l["email"]}"')
        ids = d[0].split()
        if not ids:
            continue
        _, md = M.fetch(ids[-1], "(RFC822)")
        text = strip_quoted(msg_text(emaillib.message_from_bytes(md[0][1])))[:2000]
        if OPTOUT.search(text):
            suppress(con, l["email"], "reply opt-out")
            unsub += 1
        else:
            mark_replied(con, l["email"])
            replied += 1
    _, d = M.search(None, '(OR FROM "mailer-daemon" FROM "postmaster")')
    for i in d[0].split()[-100:]:
        _, md = M.fetch(i, "(RFC822)")
        body = msg_text(emaillib.message_from_bytes(md[0][1])).lower()
        for l in leads:
            if l["email"] and l["email"] in body:
                suppress(con, l["email"], "bounce")
                con.execute("UPDATE leads SET status='bounced' WHERE id=?", (l["id"],))
                bounced += 1
        con.commit()
    M.logout()
    print(f"replies: {replied}, opt-outs: {unsub}, bounces: {bounced}. Replied leads are yours to answer by hand.")


def mark_replied(con, addr):
    con.execute("UPDATE leads SET status='replied' WHERE lower(email)=?", (addr.lower(),))
    con.execute("UPDATE messages SET status='skipped' WHERE status IN ('draft','approved') "
                "AND lead_id IN (SELECT id FROM leads WHERE status='replied')")
    con.commit()


# ------------------------------ admin ------------------------------
def cmd_doctor(args):
    ok = lambda b: "ok     " if b else "MISSING"
    print("env files read:", ", ".join(ENV_FILES) if ENV_FILES else "none found (put .env.local next to this script or in a parent folder)")
    print(f"  {ok(os.environ.get('RESEND_API_KEY'))} RESEND_API_KEY   (needed to send)")
    print(f"  {ok(os.environ.get('GEMINI_API_KEY'))} GEMINI_API_KEY   (else plain templates are used)")
    print(f"  {ok(os.environ.get('GOOGLE_PLACES_API_KEY'))} GOOGLE_PLACES_API_KEY (optional)")
    print(f"  {ok(os.environ.get('IMAP_USER') and os.environ.get('IMAP_PASSWORD'))} IMAP_USER / IMAP_PASSWORD (optional, only for `sync`)")
    print(f"from: {A['sender_name']} <{A['sender_email']}>  (this domain must be verified in Resend)")
    print(f"reply-to: {reply_to_addr()}")
    print(f"  {ok('YOUR' not in A['postal_address'])} postal_address")
    print(f"  {ok('YOUR' not in A['sender_name'])} sender_name")


def cmd_status(args):
    con = db()
    print("LEADS")
    for st, c in con.execute("SELECT status, COUNT(*) FROM leads GROUP BY status ORDER BY 2 DESC"):
        print(f"  {st:12} {c}")
    print("MESSAGES")
    for st, c in con.execute("SELECT status, COUNT(*) FROM messages GROUP BY status ORDER BY 2 DESC"):
        print(f"  {st:12} {c}")
    today = datetime.now().strftime("%Y-%m-%d") + "%"
    n = con.execute("SELECT COUNT(*) FROM messages WHERE status='sent' AND sent_at LIKE ?", (today,)).fetchone()[0]
    print(f"sent today: {n}/{S['daily_cap']}")


def cmd_export(args):
    con = db()
    rows = con.execute("SELECT name,niche,city,website,email,phone,status,score,findings,step,last_sent "
                       "FROM leads ORDER BY score DESC").fetchall()
    with open("leads_export.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["name", "niche", "city", "website", "email", "phone", "status", "score",
                    "findings", "step", "last_sent"])
        for r in rows:
            fs = "; ".join(x["text"] for x in json.loads(r["findings"] or "[]"))
            w.writerow([r["name"], r["niche"], r["city"], r["website"], r["email"], r["phone"],
                        r["status"], r["score"], fs, r["step"], r["last_sent"]])
    print(f"wrote leads_export.csv ({len(rows)} rows). Filter status=no_email for a call/WhatsApp list.")


def cmd_unsub(args):
    suppress(db(), args.address, "manual")
    print(f"suppressed {args.address}")


def cmd_replied(args):
    mark_replied(db(), args.address)
    print(f"marked {args.address} as replied; follow-ups stopped")


def main():
    ap = argparse.ArgumentParser(description="Oddlambda outreach engine")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("doctor").set_defaults(fn=cmd_doctor)
    d = sub.add_parser("discover"); d.add_argument("--city", action="append"); d.add_argument("--niche", action="append"); d.set_defaults(fn=cmd_discover)
    i = sub.add_parser("import"); i.add_argument("file"); i.set_defaults(fn=cmd_import)
    sub.add_parser("audit").set_defaults(fn=cmd_audit)
    dr = sub.add_parser("draft"); dr.add_argument("--limit", type=int, default=25); dr.set_defaults(fn=cmd_draft)
    sub.add_parser("review").set_defaults(fn=cmd_review)
    ap_ = sub.add_parser("approve"); ap_.add_argument("--all", action="store_true"); ap_.set_defaults(fn=cmd_approve)
    s = sub.add_parser("send"); s.add_argument("--live", action="store_true"); s.set_defaults(fn=cmd_send)
    sub.add_parser("followups").set_defaults(fn=cmd_followups)
    sub.add_parser("sync").set_defaults(fn=cmd_sync)
    sub.add_parser("status").set_defaults(fn=cmd_status)
    sub.add_parser("export").set_defaults(fn=cmd_export)
    u = sub.add_parser("unsub"); u.add_argument("address"); u.set_defaults(fn=cmd_unsub)
    r = sub.add_parser("replied"); r.add_argument("address"); r.set_defaults(fn=cmd_replied)
    args = ap.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()