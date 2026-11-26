import sys, re, json
from html import unescape
from urllib.parse import urljoin, urlsplit
import requests
from bs4 import BeautifulSoup

import ipaddress
import socket

# Validate the actual addresses returned to the HTTP connection, including redirects.
resolve_addresses = socket.getaddrinfo
def public_addresses(*args, **kwargs):
    addresses = resolve_addresses(*args, **kwargs)
    for address in addresses:
        ip = ipaddress.ip_address(address[4][0])
        if not ip.is_global or ip.is_multicast:
            raise ValueError("目标地址非公开网络")
    return addresses

socket.getaddrinfo = public_addresses
url, sel, kw_raw = sys.argv[1], sys.argv[2].strip(), sys.argv[3].strip()
kws = [k.strip().lower() for k in re.split(r'[,，\s]+', kw_raw) if k.strip()]

s = requests.Session()
s.trust_env = False
s.headers.update({
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9",
})
def fetch_page(url):
    with s.get(url, timeout=(8, 12), stream=True) as resp:
        resp.raise_for_status()
        raw = bytearray()
        for block in resp.iter_content(65536):
            raw.extend(block)
            if len(raw) > 4_000_000:
                raise ValueError("页面过大")
        raw = bytes(raw)
        try:
            return resp.url, raw.decode("utf-8-sig")
        except UnicodeDecodeError:
            resp._content = raw
            return resp.url, raw.decode(resp.apparent_encoding or "gb18030", errors="replace")

listed_url = url
mode = sys.argv[4]
profile = json.loads(sys.argv[5]) if len(sys.argv) > 5 else {}
url, raw_html = fetch_page(url)
soup = BeautifulSoup(raw_html, "lxml")
visible = soup.get_text(" ", strip=True)
if any(marker in visible[:1500] for marker in ("请先通过人机验证", "请完成安全验证", "您的访问过于频繁", "如果您是网站管理员，请登录知道创宇云防御")):
    raise ValueError("验证页面")
ATTACHMENT_PATH = re.compile(r"\.(?:docx?|xlsx?|pdf|zip|rar|7z|dwg|wps|et|csv)$|/(?:module/download/downfile\.jsp|virtual_attach_file\.vsb)$", re.I)
CONTENT_SELECTORS = "#zoom, .TRS_Editor, .v_news_content, .wp_articlecontent, article, #newstext, .ewb-article, .article-content, .contentbox, #UCAP-CONTENT, .detail_texts, .bt-content.zoom"

def detail_fields(soup, url, selector=""):
    for tag in soup.select("script, style, nav, header, footer"):
        tag.decompose()
    node = soup.select_one(selector or CONTENT_SELECTORS)
    if node is None and not selector and (urlsplit(url).hostname or "").endswith(".gov.cn"):
        node = soup.find(id=re.compile(r"^zoom$", re.I))
    body = node.get_text("\n", strip=True) if node else ""
    source_only = bool(re.fullmatch(r"[（(]?\s*(?:来源|信息来源|文章来源)\s*[:：]\s*[^\n。；;]{2,80}\s*[）)]?", body))
    attachments = {}
    attachment_truncated = False
    if node:
        for link in node.select("a[href], iframe[src], embed[src], object[data]"):
            target = urljoin(url, link.get("href") or link.get("src") or link.get("data"))
            parts = urlsplit(target)
            if parts.scheme in ("http", "https") and parts.hostname and not parts.username and (
                ATTACHMENT_PATH.search(parts.path) or link.has_attr("download")
            ):
                if target not in attachments and len(attachments) == 100:
                    attachment_truncated = True
                    break
                attachments[target] = {"url": target, "name": (link.get_text(" ", strip=True) or link.get("title") or parts.path.split("/")[-1])[:200]}
    origin_url = ""
    for link in node.select("a[href]") if node else ():
        if re.fullmatch(r"(?:查看)?(?:原公告链接|原文链接|原始公告|公告原文|原发布公告)", link.get_text(strip=True)):
            origin = urljoin(url, link["href"])
            if urlsplit(origin).scheme in {"http","https"} and origin != url:
                origin_url = origin
                break
    return {
        "body": body[:30_000], "originUrl": origin_url,
        "bodyStatus": "truncated" if len(body) > 30_000 else "summary_only" if source_only else "captured" if body else "unrecognized",
        "attachmentStatus": "truncated" if attachment_truncated else "linked" if attachments else "none_found" if body and not source_only else "not_checked",
        "attachments": list(attachments.values()),
    }

if mode in ("detail", "detail-json"):
    result = detail_fields(soup, url, profile.get("contentSelector", ""))
    print(json.dumps(result, ensure_ascii=False) if mode == "detail-json" else result["body"])
    sys.exit(0)
page_title = (soup.title.get_text(" ", strip=True) if soup.title else "").strip()[:80]

# Extract Jiangsu Hanweb CMS <script type="text/xml"> <![CDATA[ ... ]]> records BEFORE removing <script> tags
datastore = re.search(r"<datastore\b[^>]*>(.*?)</datastore>", raw_html, re.S | re.I)
cdata_frags = re.findall(r"<!\[CDATA\[(.*?)\]\]>", raw_html, re.S)
records = re.findall(r"<record>\s*<!\[CDATA\[(.*?)\]\]>\s*</record>", datastore[1], re.S | re.I) if datastore else []
cdata_anchors = []
if cdata_frags:
    cdata_soup = BeautifulSoup("\n".join(cdata_frags), "lxml")
    cdata_anchors = cdata_soup.find_all("a", href=True)

# Remove obvious header/footer/nav noise when no explicit selector is given
if not sel:
    for noise in soup.select("header, footer, nav, script, style, .header, .footer, .nav, .navbar, .menu"):
        noise.decompose()

anchors = soup.select(sel) if sel else (cdata_anchors + soup.find_all("a", href=True))
TENDER_RE = re.compile(r"(招标|采购|询比|询价|磋商|谈判|竞价|中标|成交|候选人|公示|公告|工程|施工|改造|维修|装修|监理|设计|绿化|项目|标段|招租|比选|发包|征集|入围)")
BAD_TEXT_RE = re.compile(r"^(首页|上一页|下一页|尾页|更多|more|登录|注册|联系我们|关于我们|网站地图|版权|返回|下载|查看详情|详情)$", re.I)
DATE_RE = re.compile(r"(20\d{2}[-/.年]\d{1,2}[-/.月]\d{1,2})")

seen = set()
items = []

# Also check if the URL itself is a single tender announcement article page
h1_el = soup.find("h1")
h1_text = re.sub(r"\s+", " ", h1_el.get_text(" ", strip=True)).strip() if h1_el else ""
self_title = h1_text if (len(h1_text) >= 6 and TENDER_RE.search(h1_text)) else (page_title if TENDER_RE.search(page_title) else "")
is_gov = (urlsplit(url).hostname or "").endswith(".gov.cn")
article_page = bool(re.search(r"/art/\d{4}/|/art_\d+_\d+\.html", urlsplit(url).path))
eligible = 0
if self_title and not sel and (article_page or (h1_text and not is_gov and not cdata_anchors and not profile.get("articlePattern"))):
    detail = detail_fields(soup, url, profile.get("contentSelector", ""))
    full_text = detail["body"]
    dm_self = DATE_RE.search(url) or DATE_RE.search(full_text[:1500])
    self_date = ""
    if dm_self:
        parts = dm_self.group(1).replace(".", "-").replace("/", "-").replace("年", "-").replace("月", "-").split("-")
        if len(parts) == 3:
            self_date = f"{parts[0]}-{parts[1].zfill(2)}-{parts[2].zfill(2)}"
    eligible += 1
    if not kws or any(k in self_title.lower() for k in kws):
        seen.add(url)
        items.append({"title": self_title[:140], "url": url, "published": self_date, "score": 10,
                      "detailChecked": True, **detail})

listing_anchors = BeautifulSoup("\n".join(records), "lxml").find_all("a", href=True) if profile.get("hanwebRecordsOnly") and not sel else anchors
for a in ([] if article_page and not sel else listing_anchors):
    href = (a.get("href") or "").strip()
    if not href or href.startswith(("javascript:", "mailto:", "tel:", "#")):
        continue
    if re.search(r"\.(doc|docx|xls|xlsx|pdf|zip|rar|7z|png|jpg|jpeg|gif)(\?|$)", href, re.I):
        continue
    title = re.sub(r"\s+", " ", (a.get("title") or a.get_text(" ", strip=True) or "")).strip()
    if len(title) < 6 or len(title) > 160 or BAD_TEXT_RE.match(title):
        continue
    full_url = urljoin(url, href)
    parts = urlsplit(full_url)
    if parts.scheme not in ("https", "http") or not parts.hostname:
        continue
    if profile.get("articlePattern") and (parts.hostname != urlsplit(url).hostname or not re.search(profile["articlePattern"], parts.path)):
        continue
    if is_gov and not sel and ("/col/col" in url or "/jpage/dataproxy.jsp" in url) and (parts.hostname != urlsplit(url).hostname or not re.search(r"/art/|/art_\d", parts.path)):
        continue
    if full_url in seen:
        continue
    # Look for nearby date in parent container
    parent_txt = a.parent.get_text(" ", strip=True) if a.parent else ""
    if not DATE_RE.search(parent_txt) and a.parent and a.parent.parent:
        parent_txt = a.parent.parent.get_text(" ", strip=True)[:300]
    dm = DATE_RE.search(parent_txt) or DATE_RE.search(full_url)
    pub_date = dm.group(1).replace(".", "-").replace("/", "-").replace("年", "-").replace("月", "-") if dm else ""
    if pub_date:
        parts = pub_date.split("-")
        if len(parts) == 3:
            pub_date = f"{parts[0]}-{parts[1].zfill(2)}-{parts[2].zfill(2)}"
    webplus_date = re.search(r"/(20\d{2})/(\d{2})(\d{2})/c\d+a\d+/page\.htm$", urlsplit(full_url).path)
    if webplus_date:
        pub_date = "-".join(webplus_date.groups())
    title = re.sub(r"\s*[-\s]*(20\d{2}-\d{2}-\d{2})$", "", title).strip()

    score = 0
    if TENDER_RE.search(title): score += 3
    if pub_date: score += 2
    if len(title) >= 12: score += 1
    if not sel and score < 2:
        continue
    eligible += 1
    if profile.get("requireTenderCue") and not re.search(r"招标|采购|询比|询价|磋商|谈判|竞价|中标|成交|候选人|招租|比选|发包|流标|废标", title):
        continue
    if profile.get("excludeTitle") and re.search(profile["excludeTitle"], title):
        continue
    if urlsplit(url).hostname == "www.dafeng.gov.cn" and re.search(r"物资分配方案|补贴面积的公示", title) and not re.search(r"招标公告|采购公告|成交公告", title):
        continue
    if kws and not any(k in title.lower() for k in kws):
        continue
    seen.add(full_url)
    items.append({"title": title, "url": full_url, "published": pub_date, "score": score})

empty_datastore = bool(datastore and re.search(r"<totalrecord>\s*0\s*</totalrecord>", datastore[1], re.I))
if not eligible and not empty_datastore and not re.search(r"暂无(?:相关)?(?:公告|采购|招标|信息|数据)|没有相关(?:信息|数据)|未查询到相关", visible):
    raise ValueError("暂时无法识别公告列表")

items.sort(key=lambda x: (x["published"] or "0000-00-00", x["score"]), reverse=True)
next_url = ""
terminal = bool(article_page and not sel)
if not article_page:
    if datastore:
        next_group = re.search(r"<nextgroup>(.*?)</nextgroup>", datastore[1], re.S | re.I)
        proxy = re.search(r"""href\s*=\s*["']([^"'<>\s]*dataproxy\.jsp\?[^"'<>\s]+)""", next_group[1]) if next_group else None
        if proxy:
            candidate = urljoin(url, unescape(proxy[1]))
            if urlsplit(candidate).netloc == urlsplit(url).netloc and candidate not in (url, listed_url):
                next_url = candidate
        # A valid datastore's count and explicit nextgroup define its page boundaries.
        total_records = re.search(r"<totalrecord>\s*(\d+)\s*</totalrecord>", datastore[1], re.I)
        terminal = not next_group and bool(total_records and (
            len(records) >= int(total_records[1]) or (records and "/jpage/dataproxy.jsp" in url)
        ))
    for link in soup.select("a[href]"):
        if next_url:
            break
        if re.sub(r"[\s>»›]", "", link.get_text(strip=True)) in ("下一页", "下页") or "next" in link.get("rel", []):
            candidate = urljoin(url, link["href"])
            parts = urlsplit(candidate)
            if parts.scheme in ("https", "http") and parts.netloc == urlsplit(url).netloc and candidate not in (url, listed_url):
                next_url = candidate
                break
print(json.dumps({
    "ok": True,
    "pageTitle": page_title,
    "host": urlsplit(url).hostname or "",
    "totalFound": len(items),
    "eligibleCount": eligible,
    "nextUrl": next_url,
    "terminal": terminal,
    "effectiveUrl": url,
    "oldestDate": min((x["published"] for x in items if x["published"]), default=""),
    "newestDate": max((x["published"] for x in items if x["published"]), default=""),
    "items": items[:1000 if profile.get("collectorRun") else 60],
}, ensure_ascii=False))
