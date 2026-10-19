// Simplified Chinese display helpers. These never modify stored messages,
// provider input, user messages, agent replies, API fields or permission values.
function zhUiLabel(value) {
  const labels = {
    'Minimal': '最低', 'Low': '低', 'Medium': '中', 'High': '高',
    'Extra High': '很高', 'Very High': '很高', 'Max': '最高', 'Ultra': '极高',
    'None': '无', 'Default': '默认', 'Claude Code CLI': 'Claude Code 命令行',
    'OpenAI Codex CLI': 'OpenAI Codex 命令行', 'Codex CLI': 'Codex 命令行',
    'Gemini CLI': 'Gemini 命令行',
  };
  return labels[value] || value;
}
function zhActivityText(value) {
  return String(value || '')
    .replace(/^(✏️?\s*)Write\s+/, '$1写入 ')
    .replace(/^(✏️?\s*)Edit\s+/, '$1编辑 ')
    .replace(/^(📖\s*)Read\s+/, '$1读取 ')
    .replace(/^(🔎\s*)Search\s+/, '$1搜索 ')
    .replace(/^(⚠\s*)exited\s+/, '$1退出代码 ');
}
function zhSystemText(value) {
  let s = String(value || '');
  if(s.startsWith('🔨 Switched to work mode —'))return '🔨 已切换至工作模式：智能体可以在工作区编辑文件、运行命令。权限变更从新会话生效，原始记录保留。';
  const exact = {
    'Failed to fetch': '连接失败，请确认 Maple 正在运行，然后刷新页面。',
    'NetworkError when attempting to fetch resource.': '网络连接失败，请重新启动 Maple 后刷新页面。',
    'Network request failed': '网络请求失败，请检查连接。',
    'Room names: letters, numbers, dashes, underscores (max 40).': '聊天室名称只能使用字母、数字、短横线和下划线，最长 40 个字符。',
    'Pick two seats with different names.': '请为两位智能体使用不同名称。',
    'Nothing to send.': '请输入消息后再发送。',
    'No message text.': '消息内容不能为空。',
    'default room cannot be deleted': '默认聊天室不能删除。',
    'not found': '未找到', 'Not Found': '未找到',
  };
  if (exact[s]) return exact[s];
  const pieces = [
    ['Not enabled yet; use Codex first.', '暂未启用，先使用 Codex。'],
    ['Nothing will be launched for it — no message, ', '唤醒前不会启动它：普通消息、'],
    ['no direct call from ', '来自以下智能体的直接请求也不例外：'],
    [', no lurk — until you wake it.', '，旁听也已暂停。'],
    [' is asleep — held until wake. Silence here is not agreement.', ' 休眠中，唤醒后才会送达；未回应不代表同意。'],
    [' is asleep — it did not overhear this exchange.', ' 休眠中，未旁听本轮讨论。'],
    [' is asleep — that message was not delivered to it.', ' 休眠中，该消息未向其送达。'],
    [' is asleep', ' 已休眠'],
    [' is awake', ' 已唤醒'],
    ['Nothing was replayed', '没有重新发送历史请求'],
    ['nothing was replayed', '没有重新发送历史请求'],
    ['Nothing is replayed', '不会重新发送历史请求'],
    ['its next turn carries them as ordinary context.', '下次执行时，它们只作为普通上下文读取。'],
    ['is now lurking', '已开始旁听'], ['stopped lurking', '已停止旁听'],
    ['failed while listening:', '旁听时失败：'],
    ['Project folder not found (or not a directory):', '项目文件夹不存在或不是目录：'],
    ['No such room:', '聊天室不存在：'],
    ['Failed to start:', '启动失败：'],
    ['is not installed or not on PATH', '未安装，或不在终端路径中'],
    ['not authenticated', '尚未登录'], ['not logged in', '尚未登录'],
    ['rate limit', '使用频率限制'], ['Rate limit', '使用频率限制'],
    ['Usage limit', '使用额度限制'], ['usage limit', '使用额度限制'],
    ['timed out', '已超时'], ['Timed out', '已超时'],
    ['Queue paused', '队列已暂停'], ['Queue resumed', '队列已恢复'],
    ['Pair mode ended', '配对模式已结束'], ['Pair mode started', '配对模式已开始'],
    ['Room note cleared', '聊天室备注已清除'], ['Room note set', '聊天室备注已设置'],
    ['Session lost', '会话已失效'], ['session not found', '未找到会话'],
    ['No such file or directory', '文件或目录不存在'],
    ['Permission denied', '没有访问权限'], ['Access is denied', '访问被拒绝'],
  ];
  for (const [en, zh] of pieces) s = s.split(en).join(zh);
  return s;
}

"use strict";
// ------------------------------------------------------------ state
const $ = (id) => document.getElementById(id);
const INITIAL_ROOM = new URLSearchParams(location.search).get("room") || "default";
const hopChoiceStorageKey = (room) => `parley.hopChoice:${room}`;
function storedHopChoice(room) {
  try {
    const choice = sessionStorage.getItem(hopChoiceStorageKey(room));
    if (choice === "default" || choice === "solo" || /^(?:-1|[0-8])$/.test(choice || "")) return choice;
  } catch { /* storage may be unavailable; keep the in-memory shortcut */ }
  return "default";
}
function rememberHopChoice(room, choice) {
  try { sessionStorage.setItem(hopChoiceStorageKey(room), choice); }
  catch { /* storage may be unavailable; the current page still stays sticky */ }
}
const state = {
  room: INITIAL_ROOM,
  entries: [],
  receipts: [],
  summary: null,
  providers: {},     // provider catalog (label/avatar/color/fields) from the server
  chip: "auto",
  chipRevision: 0,   // manual changes fence off older in-flight send responses
  sendVersion: 0,    // only the newest send may synchronize the selected chip
  hopChoice: storedHopChoice(INITIAL_ROOM), // per-room browser-session shortcut: default | solo | -1..8
  draftImages: [],   // native image attachments waiting for the next successful send
  draftFiles: [],    // other files waiting for the next successful send
  sending: false,
  attachmentUrls: new Map(), // room/id -> fetched blob URL
  attachmentRevision: 0,    // retires fetches that finish after a reset/room switch
  es: null,
  live: {},          // agent -> { el, mode:"think"|"stream", startedAt, text }
  streamTimer: {},   // agent -> throttle timer
  statusSeq: {},     // agent -> count of status events heard (resync staleness check)
  queue: [],         // queue snapshot rows: one per still-pending delivery
  // agent -> is its live bubble considered on screen. Undefined until the
  // observer has measured it; only an explicit false shows the composer strip.
  liveVisible: {},
  renderFromN: null, // first entry shown by the windowed transcript render
  expandedMessages: new Set(),
  expandedActivity: new Set(),
  doctor: {},        // seat -> first-run health, from /api/doctor
  eventVersion: 0,   // any newer SSE event makes a reconnect snapshot stale for live UI state
  resyncVersion: 0,
};

// ------------------------------------------------------------ helpers
function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function toast(msg, isErr) {
  const t = $("toast");
  t.textContent = zhSystemText(msg);
  t.className = isErr ? "err show" : "show";
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove("show"), 3500);
}
// The server hands this page a session token and refuses API calls without it.
// This blocks blind/cross-origin requests; it is not a secret from local
// processes, which can fetch the public page and read the embedded token.
const TOKEN = (document.querySelector('meta[name="parley-token"]') || {}).content || "";
const REQUIRED_RUNTIME_PROTOCOL = "12";
const PAGE_RUNTIME_PROTOCOL = (document.querySelector('meta[name="parley-runtime-protocol"]') || {}).content || "";
const withToken = (url) => url + (url.includes("?") ? "&" : "?") +
  "token=" + encodeURIComponent(TOKEN) + "&protocol=" + encodeURIComponent(REQUIRED_RUNTIME_PROTOCOL);

let runtimeMismatch = false;
function showRuntimeMismatch() {
  if (runtimeMismatch) return;
  runtimeMismatch = true;
  const message = "Maple 已更新，但旧服务仍在运行。请重新启动 Maple，然后刷新页面。";
  const banner = $("runtimeBanner");
  banner.innerHTML = `⚠ <b>重新启动 Maple</b> — ${esc(message)}`;
  banner.style.display = "block";
  document.querySelectorAll("button,input,textarea,select").forEach((el) => { el.disabled = true; });
  document.querySelectorAll("a").forEach((el) => {
    el.style.pointerEvents = "none";
    el.setAttribute("aria-disabled", "true");
  });
}
if (PAGE_RUNTIME_PROTOCOL !== REQUIRED_RUNTIME_PROTOCOL) showRuntimeMismatch();

async function api(path, body) {
  if (runtimeMismatch) throw new Error("请重新启动 Maple 以完成更新。");
  const res = await fetch(path, body === undefined
    ? { headers: { "X-Parley-Token": TOKEN, "X-Parley-Runtime-Protocol": REQUIRED_RUNTIME_PROTOCOL } }
    : {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Parley-Token": TOKEN,
        "X-Parley-Runtime-Protocol": REQUIRED_RUNTIME_PROTOCOL,
      },
      body: JSON.stringify(body),
    });
  if (res.headers.get("x-parley-runtime-protocol") !== REQUIRED_RUNTIME_PROTOCOL) {
    showRuntimeMismatch();
    throw new Error("请重新启动 Maple 以完成更新。");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(zhSystemText(data.error || res.statusText));
  return data;
}

function clearAttachmentUrls() {
  state.attachmentRevision++;
  for (const value of state.attachmentUrls.values()) {
    if (typeof value === "string") URL.revokeObjectURL(value);
  }
  state.attachmentUrls.clear();
}

async function attachmentBlobUrl(room, ref) {
  const key = room + ":" + ref.id;
  const revision = state.attachmentRevision;
  const cached = state.attachmentUrls.get(key);
  if (typeof cached === "string") return cached;
  if (cached) return cached;
  let pending;
  pending = fetch("/api/attachment?room=" + encodeURIComponent(room) + "&id=" + encodeURIComponent(ref.id), {
    headers: { "X-Parley-Token": TOKEN, "X-Parley-Runtime-Protocol": REQUIRED_RUNTIME_PROTOCOL },
  }).then(async (res) => {
    if (res.headers.get("x-parley-runtime-protocol") !== REQUIRED_RUNTIME_PROTOCOL) {
      showRuntimeMismatch();
      throw new Error("界面与服务版本不一致");
    }
    if (!res.ok) throw new Error("附件不可用");
    const objectUrl = URL.createObjectURL(await res.blob());
    if (revision !== state.attachmentRevision) {
      URL.revokeObjectURL(objectUrl);
      throw new Error("附件请求已过期");
    }
    state.attachmentUrls.set(key, objectUrl);
    return objectUrl;
  }).catch((e) => {
    if (state.attachmentUrls.get(key) === pending) state.attachmentUrls.delete(key);
    throw e;
  });
  state.attachmentUrls.set(key, pending);
  return pending;
}

function formatBytes(value) {
  const bytes = Number(value) || 0;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
}

function imageAttachment(ref) {
  return ref && (ref.kind === "image" || (!ref.kind && /^image\//i.test(ref.mime || "")));
}

function renderEntryAttachments(entry, bubble) {
  const refs = entry && entry.meta && Array.isArray(entry.meta.attachments)
    ? entry.meta.attachments : [];
  if (!refs.length) return;
  const room = state.room;
  const gallery = document.createElement("div");
  gallery.className = "attachments";
  for (const ref of refs) {
    if (!imageAttachment(ref)) {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "attachment attachment-file";
      card.title = `下载 ${ref.name || "附件"}`;
      const icon = document.createElement("span");
      icon.className = "attachment-file-icon";
      icon.textContent = "📄";
      const copy = document.createElement("span");
      copy.className = "attachment-file-copy";
      const name = document.createElement("span");
      name.className = "attachment-name";
      name.textContent = ref.name || "附件";
      const size = document.createElement("span");
      size.className = "attachment-file-size";
      size.textContent = `${formatBytes(ref.size)} · 点击下载`;
      copy.append(name, size);
      card.append(icon, copy);
      card.onclick = async () => {
        if (card.disabled) return;
        card.disabled = true;
        const old = size.textContent;
        size.textContent = "正在准备下载…";
        try {
          const url = await attachmentBlobUrl(room, ref);
          if (state.room !== room || ("isConnected" in card && !card.isConnected)) return;
          const download = document.createElement("a");
          download.href = url;
          download.download = ref.name || "attachment";
          document.body.appendChild(download);
          download.click();
          download.remove();
          size.textContent = `${formatBytes(ref.size)} · 已下载`;
        } catch {
          size.textContent = `${formatBytes(ref.size)} · 不可用`;
          toast(`${ref.name || "附件"} 暂时不可用。`, true);
        } finally {
          card.disabled = false;
          if (size.textContent.endsWith("已下载")) setTimeout(() => { size.textContent = old; }, 1500);
        }
      };
      gallery.appendChild(card);
      continue;
    }
    const link = document.createElement("a");
    link.className = "attachment";
    link.target = "_blank";
    link.rel = "noopener";
    link.title = ref.name || "粘贴的图片";
    const img = document.createElement("img");
    img.alt = ref.name || "粘贴的图片";
    img.loading = "lazy";
    const label = document.createElement("span");
    label.className = "attachment-name";
    label.textContent = ref.name || "粘贴的图片";
    link.append(img, label);
    gallery.appendChild(link);
    attachmentBlobUrl(room, ref).then((url) => {
      if (state.room !== room || ("isConnected" in img && !img.isConnected)) return;
      img.src = url;
      link.href = url;
    }).catch(() => { label.textContent = `${ref.name || "粘贴的图片"}（不可用）`; });
  }
  bubble.appendChild(gallery);
}
$("dlTranscript").onclick = async (ev) => {
  ev.preventDefault();
  try {
    const res = await fetch("/api/transcript?room=" + encodeURIComponent(state.room), {
      headers: { "X-Parley-Token": TOKEN, "X-Parley-Runtime-Protocol": REQUIRED_RUNTIME_PROTOCOL },
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(zhSystemText(data.error || res.statusText));
    }
    const url = URL.createObjectURL(await res.blob());
    const link = document.createElement("a");
    link.href = url;
    link.download = `parley-${state.room.replace(/[^a-zA-Z0-9._-]+/g, "-") || "room"}-transcript.md`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (e) { toast(e.message, true); }
};
function hhmm(ts) { return (ts || "").slice(11, 16); }
function dayOf(ts) { return (ts || "").slice(0, 10); }
// A room that spans days showed a column of indistinguishable "14:02"s, with
// nothing saying which day any of them belonged to.
function dayLabel(ts) {
  const day = dayOf(ts);
  if (!day) return "";
  const today = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const asDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  if (day === asDay(today)) return "今天";
  const yesterday = new Date(today.getTime() - 86400000);
  if (day === asDay(yesterday)) return "昨天";
  return day;
}
function secs(ms) { return (ms / 1000).toFixed(1) + "s"; }

// ---- syntax highlighting ----
// For an app whose whole point is watching two coding agents exchange code,
// monochrome blocks were the most visible gap. This is deliberately a small
// tokenizer rather than a vendored library: Maple ships two files and no
// dependencies, and a hundred kilobytes of highlighter inlined into the page
// would cost more than it is worth.
//
// SAFETY: this runs on text that esc() has ALREADY escaped, and it only ever
// wraps existing characters in <span class="tok-…">. It never unescapes, never
// interpolates, and never emits an attribute value — so it cannot reintroduce
// markup that escaping removed. Everything it matches is bounded by the entity
// forms &lt; &gt; &amp; &quot; that escaping produces, which is why the patterns
// below look for those rather than for raw angle brackets.
const HL_LANGS = {
  js: {
    keywords: /\b(?:async|await|break|case|catch|class|const|continue|default|delete|do|else|export|extends|finally|for|from|function|if|import|in|instanceof|let|new|of|return|static|super|switch|this|throw|try|typeof|var|void|while|yield)\b/g,
    literals: /\b(?:true|false|null|undefined|NaN|Infinity)\b/g,
    line: /\/\/[^\n]*/g,
    block: /\/\*[\s\S]*?\*\//g,
  },
  py: {
    keywords: /\b(?:and|as|assert|async|await|break|class|continue|def|del|elif|else|except|finally|for|from|global|if|import|in|is|lambda|nonlocal|not|or|pass|raise|return|try|while|with|yield)\b/g,
    literals: /\b(?:True|False|None|self)\b/g,
    line: /#[^\n]*/g,
  },
  sh: {
    keywords: /\b(?:case|do|done|elif|else|esac|export|fi|for|function|if|in|local|return|set|then|until|while)\b/g,
    literals: /\b(?:true|false)\b/g,
    line: /#[^\n]*/g,
  },
  css: {
    keywords: /@[a-z-]+/g,
    literals: /#[0-9a-fA-F]{3,8}\b/g,
    line: null,
    block: /\/\*[\s\S]*?\*\//g,
  },
  json: { literals: /\b(?:true|false|null)\b/g },
  html: { block: /&lt;!--[\s\S]*?--&gt;/g, keywords: /&lt;\/?[a-zA-Z][\w:-]*|\/?&gt;/g },
};
const HL_ALIAS = {
  javascript: "js", jsx: "js", ts: "js", typescript: "js", tsx: "js", mjs: "js", cjs: "js",
  python: "py", py3: "py", bash: "sh", shell: "sh", zsh: "sh", console: "sh", sh: "sh",
  yaml: "json", yml: "json", jsonc: "json", scss: "css", less: "css",
  xml: "html", svg: "html", vue: "html", markup: "html",
};
// Strings and comments are matched first and set aside, so a keyword inside a
// string is never highlighted as one.
// Strings and comments are matched first in the alternation below, so a keyword
// inside a string is never highlighted as one.
const HL_STRINGS = /&quot;(?:[^&\\\n]|\\.|&(?!quot;))*&quot;|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/;
const HL_NUMBERS = /\b(?:0[xX][0-9a-fA-F]+|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\b/;

// One left-to-right scan with a single alternation, rather than a sequence of
// passes over placeholders: a placeholder scheme has to survive every later
// pattern, and the number rule cheerfully matched the digits inside its own
// placeholders. First alternative that matches at a position wins, and anything
// unmatched is copied through untouched — so the output always reduces back to
// the input with the spans removed.
const hlCache = new Map();
function hlPattern(rules) {
  if (hlCache.has(rules)) return hlCache.get(rules);
  const parts = [];
  const order = [];
  const add = (cls, re) => { if (re) { parts.push(`(${re.source})`); order.push(cls); } };
  add("com", rules.block);
  add("com", rules.line);
  add("str", HL_STRINGS);
  add("kw", rules.keywords);
  add("lit", rules.literals);
  add("num", HL_NUMBERS);
  const compiled = { re: new RegExp(parts.join("|"), "g"), order };
  hlCache.set(rules, compiled);
  return compiled;
}

function highlightCode(escaped, lang) {
  const key = HL_ALIAS[String(lang || "").toLowerCase()] || String(lang || "").toLowerCase();
  const rules = HL_LANGS[key];
  if (!rules) return escaped; // an unknown language stays plain rather than guessed at
  const { re, order } = hlPattern(rules);
  re.lastIndex = 0;
  let out = "", at = 0, m;
  while ((m = re.exec(escaped)) !== null) {
    // Which alternative matched tells us what to call it.
    let cls = null;
    for (let g = 1; g < m.length; g++) if (m[g] !== undefined) { cls = order[g - 1]; break; }
    out += escaped.slice(at, m.index) + `<span class="tok-${cls}">${m[0]}</span>`;
    at = m.index + m[0].length;
    if (m[0] === "") re.lastIndex++; // a zero-width match would loop forever
  }
  return out + escaped.slice(at);
}

// ------------------------------------------------------------ markdown (safe: escape first, then transform)
// Code blocks are pulled out first and stashed behind private-use-area
// sentinels so no other rule can touch their contents.
const SENT_A = "", SENT_B = "";
const SENT_LINE = new RegExp("^" + SENT_A + "(\\d+)" + SENT_B + "$");
const SENT_ANY = new RegExp(SENT_A + "(\\d+)" + SENT_B, "g");
function splitTableRow(line) {
  let text = line.trim();
  if (!text.includes("|")) return null;
  let foundDivider = text.startsWith("|") || (text.endsWith("|") && !text.endsWith("\\|"));
  if (text.startsWith("|")) text = text.slice(1);
  if (text.endsWith("|") && !text.endsWith("\\|")) text = text.slice(0, -1);

  const cells = [];
  let cell = "", inCode = false;
  for (let i = 0; i < text.length; i++) {
    if (text.startsWith("<code>", i)) {
      inCode = true; cell += "<code>"; i += 5; continue;
    }
    if (text.startsWith("</code>", i)) {
      inCode = false; cell += "</code>"; i += 6; continue;
    }
    if (text[i] === "\\" && text[i + 1] === "|") {
      cell += "|"; i++; continue;
    }
    if (text[i] === "|" && !inCode) {
      cells.push(cell.trim()); cell = ""; foundDivider = true; continue;
    }
    cell += text[i];
  }
  cells.push(cell.trim());
  return foundDivider ? cells : null;
}
function tableAlignments(line, columns) {
  const cells = splitTableRow(line);
  if (!cells || cells.length !== columns || !cells.every((cell) => /^:?-{3,}:?$/.test(cell))) return null;
  return cells.map((cell) => cell.startsWith(":") && cell.endsWith(":") ? "center" : cell.endsWith(":") ? "right" : "left");
}
function renderMD(src) {
  const blocks = [];
  src = String(src).replace(/```([\w+-]*)\r?\n([\s\S]*?)```/g, (m, lang, code) => {
    blocks.push({ lang, code });
    return SENT_A + (blocks.length - 1) + SENT_B;
  });
  let t = esc(src);
  t = t.replace(/`([^`\n]+)`/g, "<code>$1</code>");
  t = t.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  t = t.replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s.,;:!?)]|$)/g, "$1<em>$2</em>");
  t = t.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

  const lines = t.split(/\r?\n/);
  let html = "", para = [], list = null, listGap = false; // list: {type, start, items}
  const flushPara = () => { if (para.length) { html += "<p>" + para.join("<br>") + "</p>"; para = []; } };
  const flushList = () => {
    if (list) {
      const open = list.type === "ol" && list.start !== 1 ? `<ol start="${list.start}">` : `<${list.type}>`;
      html += open + list.items.map((i) => "<li>" + i + "</li>").join("") + `</${list.type}>`;
      list = null;
    }
    listGap = false;
  };
  // A blank line inside a list is a loose list, not a new one — closing here is
  // what makes every item restart the numbering at 1.
  const addItem = (type, text, start) => {
    flushPara();
    if (!list || list.type !== type) { flushList(); list = { type, start: start || 1, items: [] }; }
    list.items.push(text); listGap = false;
  };
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const raw = lines[lineIndex];
    const line = raw.trimEnd();
    let m;
    if (SENT_LINE.test(line.trim())) { flushPara(); flushList(); html += line.trim(); continue; }
    if (!line.trim()) { flushPara(); if (list) listGap = true; else flushList(); continue; }
    const header = splitTableRow(line);
    const alignments = header && lineIndex + 1 < lines.length
      ? tableAlignments(lines[lineIndex + 1].trim(), header.length)
      : null;
    if (header && alignments) {
      flushPara(); flushList();
      const cellHTML = (tag, cells) => cells.map((cell, i) =>
        `<${tag} class="align-${alignments[i]}">${cell}</${tag}>`).join("");
      const rows = [];
      let next = lineIndex + 2;
      while (next < lines.length && lines[next].trim()) {
        const cells = splitTableRow(lines[next]);
        if (!cells) break;
        while (cells.length < header.length) cells.push("");
        rows.push(cells.slice(0, header.length));
        next++;
      }
      html += `<div class="md-table-wrap"><table><thead><tr>${cellHTML("th", header)}</tr></thead>` +
        `<tbody>${rows.map((cells) => `<tr>${cellHTML("td", cells)}</tr>`).join("")}</tbody></table></div>`;
      lineIndex = next - 1;
      continue;
    }
    if ((m = /^(#{1,4})\s+(.*)$/.exec(line))) { flushPara(); flushList(); html += `<h${m[1].length}>${m[2]}</h${m[1].length}>`; continue; }
    if (/^(---|\*\*\*|___)$/.test(line.trim())) { flushPara(); flushList(); html += "<hr>"; continue; }
    if ((m = /^\s*[-*+]\s+(.*)$/.exec(line))) { addItem("ul", m[1]); continue; }
    if ((m = /^\s*(\d+)[.)]\s+(.*)$/.exec(line))) { addItem("ol", m[2], Number(m[1])); continue; }
    if ((m = /^&gt;\s?(.*)$/.exec(line))) { flushPara(); flushList(); html += "<blockquote>" + m[1] + "</blockquote>"; continue; }
    // Wrapped or indented text belongs to the item above it; only an
    // unindented line after a blank one starts something new.
    if (list && list.items.length && (!listGap || /^\s{2,}\S/.test(raw))) {
      list.items[list.items.length - 1] += (listGap ? "<br><br>" : "<br>") + line.trim();
      listGap = false; continue;
    }
    flushList(); para.push(line);
  }
  flushPara(); flushList();

  html = html.replace(SENT_ANY, (m, i) => {
    const b = blocks[+i];
    if (!b) return m;
    return `<div class="codeblock"><div class="cb-head"><span>${esc(b.lang || "code")}</span>` +
      `<button class="cb-copy">复制</button></div><pre><code>` +
      `${highlightCode(esc(b.code.replace(/\n$/, "")), b.lang)}</code></pre></div>`;
  });
  return html;
}
document.addEventListener("click", (e) => {
  const btn = e.target.closest(".cb-copy");
  if (btn) {
    const code = btn.closest(".codeblock").querySelector("code");
    navigator.clipboard.writeText(code.innerText).then(() => {
      btn.textContent = "已复制 ✓"; setTimeout(() => (btn.textContent = "复制"), 1500);
    });
  }
  const cpy = e.target.closest(".cpy");
  if (cpy) {
    const bub = cpy.closest(".msg").querySelector(".bubble");
    navigator.clipboard.writeText(bub.innerText).then(() => {
      cpy.textContent = "✓"; setTimeout(() => (cpy.textContent = "📋"), 1200);
    });
  }
  // Delegated, not a per-node onclick: any arriving activity entry re-renders
  // the transcript and would take a bound handler with it.
  const ask = e.target.closest(".ask");
  if (ask) {
    const host = ask.closest("[data-n]");
    if (host) { e.stopPropagation(); openAskMenu(ask, Number(host.dataset.n)); }
  }
  if (!e.target.closest("#stopWrap")) closeStopMenu();
  if (!e.target.closest("#hopWrap")) closeHopMenu();
  if (!e.target.closest("#queueWrap")) closeQueuePop();
});
window.addEventListener("focus", () => { document.title = "Maple"; refreshGitId(); });

// ------------------------------------------------------------ chat rendering
const chatWrap = $("chatWrap"), chat = $("chat");
function nearBottom() { return chatWrap.scrollHeight - chatWrap.scrollTop - chatWrap.clientHeight < 120; }
function scrollBottom(force) {
  if (force || nearBottom()) { chatWrap.scrollTop = chatWrap.scrollHeight; $("jump").style.display = "none"; }
  else $("jump").style.display = "block";
}
// One page per frame. Scroll fires far faster than a render, and a page of
// collapsed activity adds little height — so without this guard a single flick
// at the top stacks up several whole re-renders inside one frame.
let historyPaging = false;
chatWrap.addEventListener("scroll", () => {
  if (nearBottom()) $("jump").style.display = "none";
  // Scrolling to the top is the second path into "Show earlier ▸"; the button
  // stays as the discoverable one.
  if (chatWrap.scrollTop < 80 && !historyPaging && state.renderFromN !== null) {
    historyPaging = true;
    requestAnimationFrame(() => { expandHistory(); historyPaging = false; });
  }
});
$("jump").onclick = () => scrollBottom(true);

// Receipt dots: for each participant other than the author, show whether they
// heard this message live, lurked it, caught up later, or haven't seen it.
// Withheld beats every other signal. A later high-water receipt spans a
// withdrawn entry, and the seat's cursor moves past it too, so asking about
// receipts or cursors first would report that the agent caught up on a message
// it was never shown. Retry clears the record, and the dot goes back to normal.
function withheldFrom(a, n) {
  const map = (state.summary && state.summary.cancelledDeliveries) || {};
  const seats = map[String(n)];
  return Array.isArray(seats) && seats.includes(a);
}
// The amber sibling: the seat did receive this, and its answer was stopped.
function interruptedFrom(a, n) {
  const map = (state.summary && state.summary.interruptedResponses) || {};
  const seats = map[String(n)];
  return Array.isArray(seats) && seats.includes(a);
}
// ---- receipt & relay-cap indexes ----
// computeHeard used to scan all of state.receipts per dot and cappedFrom all of
// state.entries per unresolved dot, on every SSE room event, for every rendered
// row — a multi-second sweep in a fully revealed 10k room. Both lookups are now
// O(1) against indexes that rebuild lazily whenever the backing array is
// REPLACED (identity check covers loads, reconnect merges and resets in one
// rule) and extend incrementally when it is appended to in place.
//
// First-match-wins matters: overlapping receipt ranges must resolve to the
// receipt that arrived first, exactly as the old linear .find did. Filling
// only-still-uncovered slots in arrival order reproduces that, including for
// closure/attention receipts that span ranges live receipts already cover.
let receiptIndexSource = null;
const receiptCover = new Map(); // agent -> Map(n -> receipt)
function indexReceipt(r) {
  if (!r || !Number.isFinite(r.from) || !Number.isFinite(r.upTo)) return;
  let m = receiptCover.get(r.agent);
  if (!m) { m = new Map(); receiptCover.set(r.agent, m); }
  for (let n = r.from + 1; n <= r.upTo; n++) if (!m.has(n)) m.set(n, r);
}
function receiptFor(a, n) {
  if (receiptIndexSource !== state.receipts) {
    receiptCover.clear();
    for (const r of state.receipts) indexReceipt(r);
    receiptIndexSource = state.receipts;
  }
  const m = receiptCover.get(a);
  return (m && m.get(n)) || null;
}

let capIndexSource = null;
const capIndex = new Map(); // `${target}:${n}` -> the relayCap system entry
function indexCapEntry(entry) {
  if (!(entry && entry.kind === "system" && entry.meta && entry.meta.relayCap &&
      Array.isArray(entry.meta.relayCap.dropped))) return;
  for (const item of entry.meta.relayCap.dropped) {
    const key = `${item.target}:${Number(item.n)}`;
    if (!capIndex.has(key)) capIndex.set(key, entry);
  }
}
function cappedFrom(a, n) {
  if (capIndexSource !== state.entries) {
    capIndex.clear();
    for (const entry of state.entries) indexCapEntry(entry);
    capIndexSource = state.entries;
  }
  return capIndex.get(`${a}:${Number(n)}`) || null;
}
function computeHeard(a, e) {
  if (withheldFrom(a, e.n)) {
    return { cls: "withheld", title: `${a} · 你在送达前取消了这条消息，未发送给 ${a}` };
  }
  // Amber, and above receipts, cursor, busy state and terminal outcomes on
  // purpose: the seat received this and the user stopped its answer. Every
  // later turn carries the message in context, so anything that read a receipt
  // first would resolve amber on the next completed turn, whatever it was
  // about. Only the server supersedes it — by removing the record when that
  // seat completes a run rooted here.
  if (interruptedFrom(a, e.n)) {
    return { cls: "interrupted",
      title: `${a} · 已收到消息，但你停止了它的回复；不会自动重试` };
  }
  const r = receiptFor(a, e.n);
  if (r) {
    const label = seatLabel(a);
    if (r.relayLaunch) {
      const launch = r.relayLaunch;
      const outcome = r.outcome === "empty" ? "未返回内容"
        : r.outcome === "pass" ? "没有补充内容（[pass]）" : r.spoke ? "replied" : "消息已送达，未回复";
      return { cls: r.spoke ? "live" : "passed", title: `${label} · 已计入额度的自动接续 ${launch.index}/${launch.limit ?? "?"} delivered — ${outcome}; ${policySourceLabel(launch.source)}` };
    }
    if (r.catchUp && Array.isArray(r.catchUp.rootNs)) {
      return { cls: r.spoke ? "late" : "passed", title: `${label} · ${catchUpLabel(r.catchUp)} — ${r.outcome === "empty" ? "未返回内容" : r.spoke ? "replied" : "没有补充内容"}; ${catchUpDetail(r.catchUp)}` };
    }
    if (r.outcome === "empty") return { cls: "passed", title: `${label} · 已送达，未返回内容` };
    if (r.mode === "closure") return r.spoke
      ? { cls: "late", title: `${a} · 关联回答已送达，已回复` }
      : { cls: "passed", title: `${a} · 关联回答已送达，没有补充内容` };
    if (r.mode === "attention") return r.spoke
      ? { cls: "late", title: `${a} · 关联消息已送达，已回复` }
      : { cls: "passed", title: `${a} · 关联消息已送达，没有补充内容` };
    if (r.mode === "lurk-catchup") return r.spoke
      ? { cls: "late", title: `${a} · 已在旁听时补读，并作出补充` }
      : { cls: "passed", title: `${a} · 已在旁听时补读，没有补充内容` };
    const live = e.n >= r.turn; // heard as part of the exchange that delivered it
    if (live && r.mode === "lurk") return r.spoke
      ? { cls: "live", title: `${a} · 正在旁听，已作出补充` }
      : { cls: "passed", title: `${a} · 已旁听，没有补充内容` };
    if (live && r.mode === "hop") return r.spoke
      ? { cls: "live", title: `${a} · 已加入本轮讨论并回复` }
      : { cls: "passed", title: `${a} · 已加入本轮讨论，没有补充内容` };
    if (live) return { cls: "live", title: `${a} · 已被指定为接收方，已实时收到` };
    return { cls: "late", title: `${a} · 后续已补读（第 ${r.turn})` };
  }
  const agent = state.summary && state.summary.agents && state.summary.agents[a];
  const cur = agent ? agent.cursor : 0;
  if (cur >= e.n) return { cls: "late", title: `${a} · 已读` };
  const capped = cappedFrom(a, e.n);
  if (capped) {
    const cap = capped.meta.relayCap;
    const safety = cap.budget < 0 || (Number.isFinite(cap.limit) && cap.limit < cap.budget);
    return { cls: "unheard", title: `${seatLabel(a)} · 因达到${safety ? "safety" : "continuation"}上限，未启动新的发送；已安排的其他发送仍可能完成` };
  }
  const attention = e.meta && (e.meta.causalAttention || e.meta.lurkClosure);
  if (e.kind === "agent" && attention && attention.terminal) {
    return { cls: "unheard", title: `${a} · 本轮讨论在此结束；这条最终回复可供后续参考` };
  }
  // Terminal delivery outcomes outrank a seat's unrelated current busy state.
  // Receipts/cursor above still supersede this history after a later turn heals
  // the gap, so the record remains truthful without destructive invalidation.
  const outcomes = ((state.summary && state.summary.lurkOutcomes) || [])
    .filter((x) => x.agent === a && x.fromN <= e.n && e.n <= x.throughN);
  const outcome = outcomes.length ? outcomes[outcomes.length - 1] : null;
  if (outcome) {
    if (outcome.reason === "closed-by-delivery") {
      return { cls: "late", title: `${a} · 结束通知已通过另一条发送送达` };
    }
    if (String(outcome.reason || "").startsWith("closure-")) {
      const why = outcome.reason === "closure-stopped" ? "已被停止"
        : outcome.reason === "closure-asleep" ? "处于休眠状态"
          : outcome.reason === "closure-wait-aborted" ? "无法取得可用的智能体" : "failed";
      return { cls: "unheard", title: `${a} · 关联讨论结束流程${why}；不会自动重试` };
    }
    if (String(outcome.reason || "").startsWith("request-")) {
      const why = outcome.reason === "request-stopped" ? "已被停止"
        : outcome.reason === "request-asleep" ? "智能体处于休眠状态"
          : outcome.reason === "request-wait-aborted" ? "无法取得可用的智能体" : "failed";
      return { cls: "unheard", title: `${a} · 关联请求${why}；不会自动重试` };
    }
    const why = outcome.reason === "stopped" ? "已被停止"
      : outcome.reason === "disabled" ? "已被禁用"
        : outcome.reason === "asleep" ? "已进入休眠"
          : outcome.reason === "cancelled" ? "已被取消" : "failed";
    return { cls: "unheard", title: `${a} · lurk ${why}，此前尚未收到消息` };
  }
  if (state.summary && (state.summary.busy || []).includes(a)) return { cls: "pending " + a, title: `${a} · 正在接收…` };
  // Still unheard, but for a reason the user chose — and one that will not
  // resolve on its own, unlike an ordinary seat that simply hasn't caught up.
  if (seatAsleep(a)) return { cls: "unheard", title: `${a} · 休眠中；尚未收到这条消息，唤醒后才会接收` };
  const catchUp = agent && agent.catchUp;
  if (catchUp && catchUp.sinceN <= e.n && e.n <= catchUp.throughN) {
    return { cls: "pending " + a, title: `${a} · 已安排在当前用户任务完成后补读` };
  }
  if (e.kind === "user" && e.meta && e.meta.relay && e.meta.relay.solo &&
      !(((e.meta.audience || {}).addressed || []).includes(a))) {
    return { cls: "unheard", title: `${a} · 单人模式：不参与回复，后续仍可作为上下文阅读` };
  }
  return { cls: "unheard", title: `${a} · 尚未读到这条消息` };
}
function heardHTML(e) {
  if (e.kind === "system" || e.kind === "activity") return "";
  const others = ((state.summary && state.summary.seats) || []).filter((a) => a !== e.author);
  if (!others.length) return "";
  return `<div class="heard">` + others.map((a) => {
    const h = computeHeard(a, e);
    return `<span class="hdot ${a} ${h.cls}" title="${esc(h.title)}"></span>`;
  }).join("") + `</div>`;
}

// The record model: the message is permanent, its delivery state is changeable.
// A cancelled or interrupted message keeps its bubble in chronological position
// — still the quote/jump target — and carries its own per-seat status, instead
// of vanishing behind a pill floating further down the timeline.
const STATUS_CHIP = {
  cancelled: { all: "送达前已撤回", one: (s) => `已撤回发给以下智能体的消息：${s}` },
  interrupted: { all: "回复尚未完成就已被停止", one: (s) => `已停止以下智能体的回复：${s}` },
};
function receivedBy(a, e) {
  if (receiptFor(a, e.n)) return true;
  const agent = state.summary && state.summary.agents && state.summary.agents[a];
  return !!agent && agent.cursor >= e.n;
}
// User messages only: an agent reply has no audience the user chose, so a
// per-seat delivery chip on one would be inventing an addressee. A stopped hop
// or answer return is carried by the amber dot alone.
function deliveryStatus(e) {
  if (e.kind !== "user") return [];
  const aud = (e.meta && e.meta.audience) || {};
  const pair = e.meta && e.meta.pair;
  const named = pair && typeof pair === "object" ? [...new Set([pair.worker, pair.reviewer].filter(Boolean))]
    : [...new Set([...(aud.addressed || []), ...(aud.asleep || [])])];
  const seats = named.length ? named
    : ((state.summary && state.summary.seats) || []).filter((a) => e.target === "both" || e.target === a);
  return seats.map((seat) => ({
    seat,
    kind: withheldFrom(seat, e.n) ? "cancelled"
      : interruptedFrom(seat, e.n) ? "interrupted"
        : receivedBy(seat, e) ? "delivered" : "pending",
  }));
}
function statusDimmed(e, parts = deliveryStatus(e)) {
  return parts.some((s) => s.kind === "cancelled" || s.kind === "interrupted");
}
function statusChipHTML(e, parts = deliveryStatus(e)) {
  if (!statusDimmed(e, parts)) return ""; // an ordinary message stays clean
  if (e.meta && e.meta.pair) {
    const cancelled = parts.some((s) => s.kind === "cancelled");
    return `<div class="dstatus"><span class="dchip ${cancelled ? "cancelled" : "interrupted"}">` +
      `${cancelled ? "配对任务在送达前已撤回" : "配对任务已停止"} · ${parts.map((s) => esc(seatLabel(s.seat))).join(" + ")}</span>` +
      (cancelled ? `<button class="dretry" data-retry-pair="${esc(String(e.n))}" title="使用当前配对设置重试整个任务">重试配对任务</button>` : "") + `</div>`;
  }
  const kinds = new Set(parts.map((s) => s.kind));
  // Every addressed seat shared one outcome: say it once, without naming them.
  const chips = kinds.size === 1 && STATUS_CHIP[parts[0].kind]
    ? [{ kind: parts[0].kind, text: STATUS_CHIP[parts[0].kind].all }]
    // A seat still waiting in the queue contributes nothing — the ⏳ badge and
    // its own dot already say that, and it is not part of what went wrong.
    : parts.filter((s) => s.kind !== "pending").map((s) => ({
      kind: s.kind,
      text: s.kind === "delivered"
        ? `已送达：${seatLabel(s.seat)}`
        : STATUS_CHIP[s.kind].one(seatLabel(s.seat)),
    }));
  // The undo lives with the fact it undoes. Per seat, because a split @both can
  // be discarded for one half and delivered to the other — and the retry joins
  // the tail of that seat's own lane, so it cannot overtake newer work.
  const discarded = parts.filter((s) => s.kind === "cancelled").map((s) => s.seat);
  const one = discarded.length === 1;
  const retry = discarded.map((a) =>
    `<button class="dretry" data-retry-discarded="${esc(String(e.n))}" data-retry-seats="${esc(a)}" ` +
    `title="在已有队列之后将这条消息发送给 ${esc(seatLabel(a))}（排在已有队列之后）">` +
    `${one ? "重试" : `重试 → ${esc(seatLabel(a))}`}</button>`).join("");
  return `<div class="dstatus">` +
    chips.map((c) => `<span class="dchip ${c.kind}">${esc(c.text)}</span>`).join("") + retry + `</div>`;
}
// The cancellation notice is a durable record for agents and for auditing — it
// stays in events.jsonl, in transcript.md and in the seat's delta — but it is no
// longer timeline furniture: the message it is about now says it itself, in
// chronological place. The sleep variant is NOT hidden; it is the only thing
// that explains why a seat went quiet with work still owed.
function hiddenEntry(e) {
  return e.kind === "system" && !!(e.meta && e.meta.cancelledQueue) && !(e.meta && e.meta.asleepSeat);
}
// Every status event asks for a full refresh, so this has to be cheap and it
// has to leave untouched rows alone: replacing one restarts the pulse on a
// pending dot, inside a message the reader may be part-way through.
const heardSig = new Map();
// n -> the entry's row element, maintained where rows are created and cleared
// where they are all destroyed. Purely a lookup cache for refreshHeard.
const rowByN = new Map();
function refreshHeard(fromN, upToN) {
  for (const e of state.entries) {
    if (e.n <= fromN || e.n > upToN) continue;
    if (state.renderFromN !== null && e.n < state.renderFromN) continue; // not rendered
    const html = heardHTML(e);
    // One fact read three ways — the chip, the dim and the retry footer all
    // derive from deliveryStatus, so it is computed once per row, not three
    // times. The chip and the dots share a signature so they can never
    // disagree on screen.
    const parts = deliveryStatus(e);
    const chip = statusChipHTML(e, parts);
    const sig = `${chip}${html}`;
    if (!html || heardSig.get(e.n) === sig) continue;
    // rowByN replaces a per-row querySelector that was O(children) — O(rows²)
    // across a cold sweep of a fully revealed window.
    const row = rowByN.get(e.n) || chat.querySelector(`[data-n="${e.n}"]`);
    const el = row && row.querySelector(".heard");
    if (!el) continue;
    const cur = row.querySelector(".dstatus"); // before el.outerHTML invalidates el
    if (chip) { if (cur) cur.outerHTML = chip; else el.insertAdjacentHTML("beforebegin", chip); }
    else if (cur) cur.remove();
    const bub = row.querySelector(".bubble");
    if (bub) bub.classList.toggle("dimmed", statusDimmed(e, parts));
    el.outerHTML = html;
    heardSig.set(e.n, sig);
  }
}

function policySourceLabel(source) {
  return ({ message: "你为本条消息指定的设置", room: "接收消息时的聊天室设置", solo: "你选择的单人模式",
    "catch-up": "合并补读规则", structural: "附带发送规则" })[source] || "历史记录中未记录的来源";
}
function catchUpLabel(catchUp) {
  const count = new Set((catchUp && catchUp.rootNs) || []).size;
  return `已补读${count > 1 ? ` · ${count} messages` : ""}`;
}
function catchUpDetail(catchUp) {
  const roots = [...new Set(catchUp.rootNs || [])];
  return `涵盖用户消息${roots.length === 1 ? "" : ""} ${roots.map((n) => `#${n}`).join(", ")}` +
    (Number.isFinite(catchUp.fromN) && Number.isFinite(catchUp.throughN) ? `, entries ${catchUp.fromN}–${catchUp.throughN}` : "") +
    (Number.isFinite(catchUp.ownerRootN) ? `。调度来源：你的消息 #${catchUp.ownerRootN}；其他涵盖的消息仅作为上下文，不额外计次。` : ".");
}
function provenanceBadges(meta = {}) {
  let html = "";
  const launch = meta && meta.relayLaunch;
  if (launch) {
    const safety = launch.budget < 0 || (Number.isFinite(launch.limit) && launch.limit < launch.budget);
    const automatic = launch.accounting === "automatic";
    const detail = `${automatic ? "自动轮次" : "已计次的接续"} ${launch.index} of ${launch.limit ?? "上限未知"}. Source: ${policySourceLabel(launch.source)}.`;
    html += ` <span style="opacity:.7" title="${esc(detail)}">· ${automatic ? "自动 · " : "⛓ "}${esc(String(launch.index))}/${esc(String(launch.limit ?? "?"))}${safety ? " · 安全上限" : ""}</span>`;
  }
  if (meta && meta.catchUp) html += ` <span style="opacity:.7" title="${esc(catchUpDetail(meta.catchUp))}">· 👂 ${esc(catchUpLabel(meta.catchUp))}</span>`;
  else if (meta && (meta.lurkCatchUp || meta.catchUpReturn)) html += " <span style=\"opacity:.7\" title=\"延迟补读；这条旧记录未保存所有涵盖的原始消息编号\">· 👂 已补读</span>";
  return html;
}
const DELIVERY_LABEL = {
  root: "对你消息的首次回复", start: "对你消息的首次回复", explicit: "另一位智能体的明确请求",
  continuation: "收到回答后继续", sibling: "附带发送给另一位智能体", lurk: "已启用的旁听者",
  "lurk-return": "附带回复旁听者", "answer-return": "附带返回回答", closure: "附带返回回答",
  "catching-up": "延迟补读", "catch-up": "延迟补读", "lurk-catchup": "延迟补读",
  review: "配对审查", fix: "配对修正", listening: "已启用的旁听者", attention: "发送给另一位智能体", hop: "另一位智能体继续跟进",
  retry: "自动重试会话", automatic: "自动回复",
};
function whyRunHTML(e) {
  const meta = e.meta || {};
  if (e.kind === "user") {
    const policy = meta.relay;
    if (!policy || meta.pair) return "";
    const text = policy.solo ? "单人模式：只有指定的智能体回复，另一位不会自动回应。"
      : policy.accounting === "automatic" ? `${hopBudgetLabel(policy.hopBudget)} 个自动轮次${policy.hopBudget < 0 ? `；安全上限 ${policy.safetyLimit}` : ""}。每次额外自动启动都计次，首次指定的回复不计入。`
      : `${hopBudgetLabel(policy.hopBudget)} 次额外接续（旧计次方式）。附带发送及回答返回不计入额度。`;
    return `<details class="why-run"><summary>本条消息的规则</summary><p>${esc(text)} ${esc(policySourceLabel(policy.source))}。接收时确定的规则会一直适用于这条消息。</p></details>`;
  }
  if (meta.relayCap) {
    const cap = meta.relayCap;
    const unit = cap.accounting === "automatic" ? "自动轮次" : "continuations";
    const blocked = (cap.dropped || []).map((edge) => `${seatLabel(edge.target)} receiving #${edge.n}`).join(", ");
    return `<details class="why-run"><summary>为什么会执行这一步？</summary><p>${esc(
      `未启动任何智能体。已阻止：${blocked}. Policy: ${policySourceLabel(cap.source)}; ` +
      `${cap.used}/${cap.limit} ${unit} 次已用于你的消息 #${cap.rootN}. ` +
      "结果：达到上限，未启动。本提示不计次，也不表示同意或已成功送达。"
    )}</p></details>`;
  }
  if (e.kind !== "agent" && !(meta.delivery || meta.relayLaunch)) return "";
  const delivery = meta.delivery || {};
  const sourceN = delivery.triggerEntryN ?? meta.replyTo ?? meta.relayLaunch?.triggerEntryN;
  const source = refFromN(sourceN);
  const rootN = delivery.rootN ?? meta.replyRoot ?? meta.rootN ?? meta.relayLaunch?.rootN ?? (source && source.kind === "user" ? source.n : null);
  const root = rootN == null ? null : entryByN(rootN);
  const policy = root && root.meta && root.meta.relay;
  const kind = delivery.kind || (typeof meta.pair === "string" ? meta.pair
    : meta.catchUp || meta.lurkCatchUp || meta.catchUpReturn ? "catch-up"
      : meta.causalAttention || meta.lurkClosure ? "answer-return" : meta.causalRequest ? meta.causalRequest.kind
        : meta.lurk ? "lurk" : meta.hop ? "hop" : source && source.kind === "user" ? "root" : "");
  const trigger = source ? `${source.kind === "user" ? "你的消息" : seatLabel(source.author)} #${source.n}`
    : sourceN == null ? "未记录" : `entry #${sourceN}`;
  const launch = meta.relayLaunch;
  const automatic = (launch?.accounting || delivery.accounting || policy?.accounting) === "automatic";
  const unit = automatic ? "自动轮次" : "continuation";
  const allowance = launch ? `已消耗 ${unit} ${launch.index}/${launch.limit ?? "?"}；失败、停止、跳过或空回复均不会退还。`
    : delivery.counted === false || kind === "root" || meta.pair || meta.catchUp || meta.lurk
      ? `未消耗 ${automatic ? "一个自动轮次" : "一次接续"}.` : delivery.counted ? "本次尝试没有记录到计次启动。" : "这条历史消息未记录额度使用情况。";
  const sourcePolicy = launch?.source || delivery.source || policy?.source;
  const receipt = (state.receipts || []).find((r) => r.outputEntryN === e.n && r.agent === e.author);
  const received = receipt ? (state.entries || []).filter((item) => item.n > receipt.from && item.n <= receipt.upTo &&
    item.n !== sourceN && item.author !== e.author && ["user", "agent"].includes(item.kind)).map((item) => `#${item.n}`) : [];
  const later = meta.error && sourceN != null ? (state.receipts || []).find((r) =>
    r.agent === meta.agent && r.from < sourceN && r.upTo >= sourceN &&
    Number.isSafeInteger(r.recordedAfterN) && r.recordedAfterN >= e.n) : null;
  const outcome = meta.outcome || (meta.error ? "failed" : meta.stopped ? "stopped" : meta.relayCap ? "capped" : "replied");
  const detail = [
    `触发来源：${trigger}. Reason: ${(DELIVERY_LABEL[kind] || kind || "未记录").replace(automatic ? /^included / : /$^/, "")}.`,
    received.length ? `同时作为上下文读取：${received.join(", ")}。已撤回的消息可能仅显示占位内容。` : "",
    `Policy: ${meta.pair ? "配对审查轮次" : policySourceLabel(sourcePolicy)}. ${allowance}`,
    `Outcome: ${outcome === "text" ? "replied" : outcome === "capped" ? "达到上限，未启动" : outcome}.`,
    meta.catchUp ? catchUpDetail(meta.catchUp) : rootN != null && rootN !== sourceN ? `由你的消息 # 发起：${rootN}.` : "",
    later ? (Number.isSafeInteger(later.outputEntryN)
      ? `这条消息后来已作为以下回复的上下文：#${later.outputEntryN}.`
      : "这条消息已在后续成功送达，但未记录回复链接。") : "",
  ].filter(Boolean).join(" ");
  const link = later?.outputEntryN && entryByN(later.outputEntryN)
    ? ` <button class="quote-ref" data-jump-n="${later.outputEntryN}">前往回复 #${later.outputEntryN}</button>` : "";
  return `<details class="why-run"><summary>为什么会执行这一步？</summary><p>${esc(detail)}${link}</p></details>` +
    (meta.technicalError ? `<details><summary>技术详情</summary><pre>${esc(meta.technicalError)}</pre></details>` : "");
}
function recoveryForEntry(e) {
  const recovery = e.meta && e.meta.recovery;
  if (!recovery || !Number.isSafeInteger(recovery.rootN) || recovery.rootN <= 0) return null;
  if (recovery.kind === "pair-retry") return recovery;
  if (recovery.kind === "retry" && typeof recovery.agent === "string" && recovery.agent) return recovery;
  return null;
}
function updateErrorRecovery(row, e) {
  const button = row.querySelector("[data-error-retry]");
  if (!button) return;
  const resolved = state.summary && state.summary.resolvedErrors && state.summary.resolvedErrors[String(e.n)];
  row.classList.toggle("resolved", !!resolved);
  button.disabled = !!resolved;
  const marker = row.querySelector(".recovery-state");
  if (marker) marker.textContent = resolved ? `已解决${resolved.entryN ? `，见回复 #${resolved.entryN}` : "，已通过后续尝试解决"}` : "";
}
function refreshErrorRecovery() {
  for (const e of state.entries) {
    if (!(e.meta && e.meta.error && e.meta.recovery)) continue;
    const row = rowByN.get(e.n);
    if (row) updateErrorRecovery(row, e);
  }
}
function entryEl(e) {
  const div = document.createElement("div");
  if (e.n !== undefined && e.n !== null) div.dataset.n = e.n;
  if (e.kind === "activity") {
    div.className = "activity " + e.author;
    div.innerHTML = `<span class="adot"></span><span>${esc(zhActivityText(e.text))}</span>`;
    return div;
  }
  if (e.kind === "system") {
    div.className = "sysmsg" + (e.meta && e.meta.error ? " err" : "");
    div.innerHTML = esc(zhSystemText(e.text));
    const recovery = e.meta && e.meta.error && recoveryForEntry(e);
    if (recovery) {
      const b = document.createElement("button");
      b.className = "retry"; b.textContent = recovery.kind === "pair-retry" ? "重试配对任务" : "重试";
      b.dataset.errorRetry = String(e.n);
      b.title = recovery.kind === "pair-retry" ? `从消息 # 开始重试整个配对任务：${recovery.rootN}`
        : `重试 ${seatLabel(recovery.agent)}，基于原始消息 #${recovery.rootN}`;
      b.onclick = async () => {
        if (b.disabled) return;
        b.disabled = true;
        try {
          await api("/api/retry", { room: state.room, rootN: recovery.rootN,
            ...(recovery.kind === "retry" ? { agents: [recovery.agent] } : {}) });
        } catch (err) { b.disabled = false; toast(err.message, true); }
      };
      div.appendChild(b);
      const marker = document.createElement("span");
      marker.className = "recovery-state";
      div.appendChild(marker);
      updateErrorRecovery(div, e);
    }
    if (e.meta && e.meta.pairContinue) {
      const b = document.createElement("button");
      b.className = "retry"; b.textContent = "继续 →";
      b.title = "让执行者根据审查意见修改，再次接受检查";
      b.onclick = () => {
        b.disabled = true; b.textContent = "正在继续…";
        api("/api/pair/continue", { room: state.room, capN: e.n })
          .catch((err) => { toast(err.message, true); b.disabled = false; b.textContent = "继续 →"; });
      };
      div.appendChild(b);
    }
    if (e.meta && (e.meta.delivery || e.meta.relayLaunch)) div.insertAdjacentHTML("beforeend", whyRunHTML(e));
    return div;
  }
  div.className = "msg " + (e.kind === "user" ? "user" : "agent " + e.author);
  const dur = e.meta && e.meta.durationMs ? ` · ${secs(e.meta.durationMs)}` : "";
  const t = e.meta && e.meta.tokens;
  const tok = t && t.out ? ` · <span title="输出 token${t.reasoning ? ` (${t.reasoning} reasoning)` : ""}">${t.out}t${t.reasoning ? ` <span style="opacity:.7">(${t.reasoning}r)</span>` : ""}</span>` : "";
  // a pair turn is a review or a fix, never a generic "follow-up"
  const pairTag = e.meta && e.meta.pair && typeof e.meta.pair === "string"
    ? ` <span style="opacity:.6">· 🔁 ${e.meta.pair} r${e.meta.round}</span>` : "";
  // Only what `deferred` actually records: this seat was busy when the message
  // arrived, so its half ran later. Whether it had read the other seat's answer
  // by then depends on which seat freed first, so the badge doesn't claim it.
  const deferTag = e.meta && e.meta.deferred
    ? " <span style=\"opacity:.6\" title=\"你发送消息时，此智能体正在忙碌，因此延后处理\">· ⏳ 延迟处理</span>" : "";
  const attentionMeta = e.meta && (e.meta.causalAttention || e.meta.lurkClosure);
  const requestMeta = e.meta && e.meta.causalRequest;
  const lurkTag = pairTag || (e.meta?.delivery?.accounting === "automatic" ? "" : (attentionMeta && attentionMeta.terminal
    ? " <span style=\"opacity:.6\" title=\"本轮讨论的最终发送，不会再触发其他自动回复\">· 🔒 本轮结束</span>"
    : attentionMeta
      ? " <span style=\"opacity:.6\" title=\"附带返回回答；后续接续将使用本轮共享额度\">· ↩ 返回回答</span>"
    : requestMeta
      ? " <span style=\"opacity:.6\" title=\"附带发送，此次送达不消耗接续额度\">· ↪ 已送达</span>"
    : e.meta && e.meta.lurk ? " <span style=\"opacity:.6\">· 👂 补充发言</span>"
    : e.meta && e.meta.hop && !(e.meta && e.meta.pair) ? " <span style=\"opacity:.6\">· ⛓ 继续跟进</span>" : deferTag));
  const userPair = e.meta && e.meta.pair && typeof e.meta.pair === "object"
    ? ` · 🔁 pair ×${e.meta.pair.rounds} (${e.meta.pair.worker} works, ${e.meta.pair.reviewer} reviews)` : "";
  // An auto-composed "Continue responding to this message." must never read as
  // something the user typed; the quote header above says what it is about, and
  // this says how it got here.
  const askTag = e.kind === "user" && e.meta && e.meta.askFrom
    ? (e.meta.askFrom.redirect
      ? " <span style=\"opacity:.6\" title=\"通过“停止当前回复并立即追问”发送\">· ↪ 转向新问题</span>"
      : " <span style=\"opacity:.6\" title=\"对之前的消息再次追问\">· ↪ 再次追问</span>")
    : "";
  const label = e.kind === "user"
    ? `你 <span style="opacity:.65">→ @${esc(e.target)}${e.meta && e.meta.discussion ? " · 💬 discussion" : ""}${userPair}</span>${askTag}`
    : esc(seatLabel(e.author)) + lurkTag + provenanceBadges(e.meta);
  const av = e.kind === "user" ? "" : `<span class="avatar">${esc(seatAvatar(e.author))}</span>`;
  div.innerHTML = `<div class="meta">${av}<span class="who">${label}</span><span title="${esc(String(e.ts || "").replace("T", " "))}">${hhmm(e.ts)}${dur}${tok}</span>` +
    `<button class="ask" title="追问这条消息">↪</button>` +
    `<button class="cpy" title="复制消息">📋</button></div>` +
    entryQuoteHTML(e) +
    `<div class="bubble${statusDimmed(e) ? " dimmed" : ""}">${renderMD(e.text)}</div>` +
    statusChipHTML(e) + heardHTML(e) + whyRunHTML(e);
  renderEntryAttachments(e, div.querySelector(".bubble"));
  if ((e.text || "").length > 2500) {
    const bub = div.querySelector(".bubble");
    const key = e.n === undefined || e.n === null ? null : String(e.n);
    const expanded = key !== null && state.expandedMessages.has(key);
    bub.classList.toggle("collapsed", !expanded);
    const btn = document.createElement("button");
    btn.className = "showmore";
    btn.textContent = expanded ? "收起 ▴" : "展开 ▾";
    btn.onclick = () => {
      const c = bub.classList.toggle("collapsed");
      if (key !== null) {
        if (c) state.expandedMessages.delete(key);
        else state.expandedMessages.add(key);
      }
      btn.textContent = c ? "展开 ▾" : "收起 ▴";
    };
    bub.insertAdjacentElement("afterend", btn);
  }
  return div;
}

const INITIAL_ENTRY_LIMIT = 150;
// Scrollback is revealed a page at a time. Revealing all of it at once tied the
// cost of every later renderAll — and one runs for every activity entry — to how
// long the room has run rather than to how much of it is on screen.
const HISTORY_PAGE = 150;
// Entries kept above a jump target, so it lands in context rather than flush
// against the "Show earlier" button.
const HISTORY_CONTEXT = 20;
const ACTIVITY_INLINE_LIMIT = 8;

// A run is identified by its first entry, and the identity survives the run
// growing. That is what lets an arriving action extend what is already rendered
// instead of forcing a rebuild — and the run's own nodes carry the same id, so
// the extension can find them without holding any of them in a closure.
function activityRunKey(author, startN) { return `${author}:${startN}`; }

function activityNode(e, startN, overflow) {
  const node = entryEl(e);
  node.dataset.runStart = startN;
  if (overflow) node.dataset.runOverflow = "1";
  return node;
}

function activityRunEntries(startN) {
  const i = entryIndexOf(startN);
  if (i < 0) return [];
  const author = state.entries[i].author;
  let end = i + 1;
  while (end < state.entries.length
    && state.entries[end].kind === "activity" && state.entries[end].author === author) end++;
  return state.entries.slice(i, end);
}

function overflowNodesOf(toggle) {
  const parent = toggle.parentNode;
  if (!parent || !parent.querySelectorAll) return [];
  return [...parent.querySelectorAll(
    `[data-run-start="${toggle.dataset.runStart}"][data-run-overflow="1"]`)];
}

function setToggleLabel(toggle, count, expanded) {
  // The label is the only part that changes as a run grows; rewriting the whole
  // button would restart the dot beside it.
  if (!toggle.firstElementChild) toggle.innerHTML = `<span class="adot"></span><span></span>`;
  toggle.lastElementChild.textContent = expanded
    ? `▾ 收起 ${count} action${count === 1 ? "" : ""}`
    : `▸ ${count} 项其他操作${count === 1 ? "" : ""}`;
}

// Bring a rendered toggle back in step with state.entries: the count it shows,
// and — while expanded — the overflow nodes it hides.
function syncActivityToggle(toggle) {
  const startN = Number(toggle.dataset.runStart);
  const run = activityRunEntries(startN);
  const expanded = state.expandedActivity.has(toggle.dataset.activityRun);
  if (expanded) {
    const have = overflowNodesOf(toggle).length;
    for (const e of run.slice(ACTIVITY_INLINE_LIMIT + have)) toggle.before(activityNode(e, startN, true));
  }
  setToggleLabel(toggle, Math.max(0, run.length - ACTIVITY_INLINE_LIMIT), expanded);
}

function activityToggle(author, startN) {
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "activity activity-more " + author;
  toggle.dataset.runStart = startN;
  toggle.dataset.activityRun = activityRunKey(author, startN);
  toggle.onclick = () => {
    const key = toggle.dataset.activityRun;
    if (state.expandedActivity.has(key)) {
      state.expandedActivity.delete(key);
      for (const node of overflowNodesOf(toggle)) node.remove();
    } else state.expandedActivity.add(key);
    syncActivityToggle(toggle);
  };
  return toggle;
}

function appendActivityRun(parent, run) {
  const startN = run[0].n;
  for (const e of run.slice(0, ACTIVITY_INLINE_LIMIT)) parent.appendChild(activityNode(e, startN, false));
  if (run.length <= ACTIVITY_INLINE_LIMIT) return;
  const key = activityRunKey(run[0].author, startN);
  if (state.expandedActivity.has(key)) {
    for (const e of run.slice(ACTIVITY_INLINE_LIMIT)) parent.appendChild(activityNode(e, startN, true));
  }
  const toggle = activityToggle(run[0].author, startN);
  parent.appendChild(toggle);
  setToggleLabel(toggle, run.length - ACTIVITY_INLINE_LIMIT, state.expandedActivity.has(key));
}

// The durable transcript sits above the live bubbles and any transient note.
// Appending past them and then moving them back would replay their entrance
// animation, which is the flicker this whole path exists to avoid.
function appendDurable(node) {
  const tail = [...chat.children].find((el) => el.dataset.liveAgent
    || (!el.dataset.n && (el.classList.contains("whisper") || el.classList.contains("sysmsg"))));
  if (tail) chat.insertBefore(node, tail); else chat.appendChild(node);
}

// Extend the run an arriving action belongs to, in place. Rebuilding the whole
// transcript for every tool line is what made a message being read flash and
// shift, and a working agent emits several of them a minute.
function appendActivityEntry(e) {
  const i = entryIndexOf(e.n);
  if (i < 0) return false;
  const start = renderedStartIndex();
  let s = i;
  while (s > start
    && state.entries[s - 1].kind === "activity" && state.entries[s - 1].author === e.author) s--;
  const startN = state.entries[s].n;
  if (s === i) { appendDurable(activityNode(e, startN, false)); return true; }

  const nodes = chat.querySelectorAll(`[data-run-start="${startN}"]`);
  const last = nodes[nodes.length - 1];
  if (!last) return false; // the run was never rendered; let the caller rebuild
  const toggle = last.dataset.activityRun ? last : null;
  if (i - s < ACTIVITY_INLINE_LIMIT) {
    const node = activityNode(e, startN, false);
    if (toggle) toggle.before(node); else last.after(node);
    return true;
  }
  if (toggle) { syncActivityToggle(toggle); return true; }
  const fresh = activityToggle(e.author, startN);
  last.after(fresh);
  syncActivityToggle(fresh);
  return true;
}

function appendEntryRange(parent, entries) {
  let lastDay = null;
  const dayDivider = (e) => {
    const day = dayOf(e.ts);
    if (!day || day === lastDay) return;
    // Not before the very first rendered entry when it opens the window: a
    // divider there is a label with nothing above it to separate from.
    if (lastDay !== null) {
      const sep = document.createElement("div");
      sep.className = "daysep";
      sep.setAttribute("role", "separator");
      sep.innerHTML = `<span>${esc(dayLabel(e.ts))}</span>`;
      parent.appendChild(sep);
    }
    lastDay = day;
  };
  for (let i = 0; i < entries.length;) {
    const e = entries[i];
    if (e.kind !== "activity") {
      // Filtered at render time only — never removed from state.entries, which
      // every index, jump and quote lookup walks.
      if (!hiddenEntry(e)) {
        dayDivider(e);
        const rowEl = entryEl(e);
        if (e.n !== undefined && e.n !== null) rowByN.set(e.n, rowEl);
        parent.appendChild(rowEl);
      }
      i++;
      continue;
    }
    let end = i + 1;
    while (end < entries.length && entries[end].kind === "activity" && entries[end].author === e.author) end++;
    appendActivityRun(parent, entries.slice(i, end));
    i = end;
  }
}

function renderedStartIndex() {
  if (state.renderFromN === null) return 0;
  const exact = state.entries.findIndex((e) => e.n === state.renderFromN);
  if (exact >= 0) return exact;
  const after = state.entries.findIndex((e) => e.n > state.renderFromN);
  return after >= 0 ? after : state.entries.length;
}

// Widen the rendered window, keeping the reader on the entry they were looking
// at. The anchor correction must be instant: #chatWrap scrolls smoothly, and
// animating it fights an in-flight scroll and reads as a lurch.
// Widening used to be a full renderAll: every rendered row rebuilt from
// scratch, so each successive "Show earlier" cost more than the last (322ms at
// a 600-row window, seconds for a quote-jump deep into a 10k room) — and the
// rebuild cleared heardSig, so the NEXT room event paid a cold full sweep too.
// Newly revealed history is now prepended; the rows already on screen stay put.
function renderPreservingAnchor(nextFromN) {
  const prevStart = renderedStartIndex();
  const kids = chat.children || [];
  const btn = chat.firstElementChild !== undefined ? chat.firstElementChild : kids[0];
  // The seam cases fall back to the full rebuild rather than being hand-stitched:
  // no button to anchor the prepend on, nothing actually revealed, or the old
  // window opening mid-activity-run (the prepended chunk would end with a run
  // that must merge into the run element already on screen).
  const seamRun = state.entries[prevStart] && state.entries[prevStart].kind === "activity" &&
    state.entries[prevStart - 1] && state.entries[prevStart - 1].kind === "activity" &&
    state.entries[prevStart - 1].author === state.entries[prevStart].author;
  const canPrepend = btn && btn.classList && btn.classList.contains &&
    btn.classList.contains("history-more") && prevStart > 0 && !seamRun &&
    typeof btn.after === "function";
  const beforeHeight = chatWrap.scrollHeight;
  const beforeTop = chatWrap.scrollTop;
  const behavior = chatWrap.style.scrollBehavior;
  chatWrap.style.scrollBehavior = "auto";
  state.renderFromN = nextFromN;
  const newStart = renderedStartIndex();
  if (!canPrepend || newStart >= prevStart) {
    renderAll({ stickToBottom: false });
    chatWrap.scrollTop = beforeTop + chatWrap.scrollHeight - beforeHeight;
    chatWrap.style.scrollBehavior = behavior;
    return;
  }
  const revealed = state.entries.slice(newStart, prevStart);
  const frag = document.createDocumentFragment();
  appendEntryRange(frag, revealed);
  // appendEntryRange suppresses a leading divider and knows nothing about what
  // follows the chunk, so the one divider it cannot place is the seam: when the
  // day changes between the chunk's last visible entry and the old first row.
  const lastNew = [...revealed].reverse().find((x) => !hiddenEntry(x));
  const firstOld = state.entries[prevStart];
  if (lastNew && firstOld && dayOf(lastNew.ts) && dayOf(firstOld.ts) &&
      dayOf(lastNew.ts) !== dayOf(firstOld.ts)) {
    const sep = document.createElement("div");
    sep.className = "daysep";
    sep.setAttribute("role", "separator");
    sep.innerHTML = `<span>${esc(dayLabel(firstOld.ts))}</span>`;
    frag.appendChild(sep);
  }
  // Nothing here is new to the reader in the animated sense — it is scrollback.
  for (const el of frag.children) el.classList.add("norise");
  btn.after(frag);
  if (newStart <= 0) btn.remove();
  else {
    btn.title = newStart > HISTORY_PAGE
      ? `${newStart} 条更早的记录，本次显示 ${HISTORY_PAGE} more`
      : `${newStart} 条更早的记录${newStart === 1 ? "y" : "ies"}`;
  }
  chatWrap.scrollTop = beforeTop + chatWrap.scrollHeight - beforeHeight;
  chatWrap.style.scrollBehavior = behavior;
}

// Reveal one more page of scrollback. Reaching the first entry drops the window
// entirely, so renderedStartIndex stops paying for a lookup once there is
// nothing left to reveal.
function expandHistory(count = HISTORY_PAGE) {
  if (state.renderFromN === null) return;
  const start = renderedStartIndex();
  if (start <= 0) { state.renderFromN = null; return; }
  const next = Math.max(0, start - Math.max(1, count));
  renderPreservingAnchor(next === 0 ? null : state.entries[next].n);
}

// Widen just far enough to include one entry. A jump used to reveal everything
// above its target, which made a single quote click cost the whole transcript.
function revealEntry(n) {
  if (state.renderFromN === null || n >= state.renderFromN) return;
  const i = entryIndexOf(n);
  if (i < 0) return; // not in this conversation; jumpToEntry reports the miss
  const next = Math.max(0, i - HISTORY_CONTEXT);
  renderPreservingAnchor(next === 0 ? null : state.entries[next].n);
}

// ------------------------------------------------------- provenance + jumping
// state.entries is kept sorted by turn number, so the lookup a quote header
// needs on every render is a binary search rather than a scan.
function entryIndexOf(n) {
  let lo = 0, hi = state.entries.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const v = state.entries[mid].n;
    if (v === n) return mid;
    if (v < n) lo = mid + 1; else hi = mid - 1;
  }
  return -1;
}
function entryByN(n) {
  const i = entryIndexOf(n);
  return i < 0 ? null : state.entries[i];
}
function snippet(text, max = 160) {
  const s = String(text || "").replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
// The same shape the server sends in busyInfo, rebuilt from a local entry so
// live bubbles and finished ones render through one code path.
function refFromN(n) {
  const e = entryByN(n);
  if (!e) return null;
  return { n: e.n, kind: e.kind, author: e.author, target: e.target || null, ts: e.ts, text: snippet(e.text) };
}
function refWho(src) {
  return src.kind === "user" ? "you" : seatLabel(src.author);
}

function quoteRefHTML(src, label = "↩ 回复", title = "跳转到这条消息") {
  if (!src || src.n === undefined || src.n === null) return "";
  const heading = label === "由你的消息触发" ? label : `${label} ${refWho(src)}`;
  return `<button class="quote-ref" data-jump-n="${esc(String(src.n))}" title="${esc(title)}">` +
    `<span class="qr-bar"></span><span class="qr-body">` +
    `<span class="qr-head"><span>${esc(heading)}</span><span>${esc(hhmm(src.ts))}</span></span>` +
    `<span class="qr-text">${esc(src.text || "")}</span>` +
    `</span></button>`;
}

// A finished reply keeps the reference its live bubble showed, always — that
// is the whole point of putting the quote in the bubble rather than in a
// transient strip, and it is what makes an old exchange readable months later.
function entryQuoteHTML(e) {
  // What makes an ask bubble auditable rather than looking like something the
  // user typed — especially "Continue responding to this message."
  if (e.kind === "user" && e.meta && e.meta.askFrom &&
      e.meta.askFrom.sourceN !== undefined && e.meta.askFrom.sourceN !== null) {
    return quoteRefHTML(refFromN(e.meta.askFrom.sourceN), "↪ 追问");
  }
  if (e.kind !== "agent" || !e.meta || e.meta.replyTo === undefined || e.meta.replyTo === null) return "";
  const src = refFromN(e.meta.replyTo);
  const root = src && src.kind === "user" && !(e.meta.hop || e.meta.lurk || e.meta.causalAttention || e.meta.causalRequest);
  if (e.meta.delivery?.accounting === "automatic") return quoteRefHTML(src, "触发来源", "跳转到触发消息；其他消息也可能已送达");
  return quoteRefHTML(src, root ? "由你的消息触发" : "↩ 回复",
    root ? "生成提示时尚未包含后续并发回复。点击跳转到触发本次回复的消息。" : "跳转到本次回复的直接触发消息");
}

// Revealing the target first is not an optimisation. A target sitting in
// scrollback has no element to find, and that is exactly when someone clicks a
// quote — so without this the jump silently does nothing in the one case it
// was built for.
function jumpToEntry(n) {
  revealEntry(n);
  const el = chat.querySelector(`[data-n="${String(n).replace(/"/g, "")}"]`);
  if (!el) return toast("这条消息已不在当前对话中。", true);
  el.scrollIntoView({ block: "center", behavior: "smooth" });
  el.classList.remove("jump-flash");
  void el.offsetWidth; // restart the highlight when the same entry is re-targeted
  el.classList.add("jump-flash");
  setTimeout(() => el.classList.remove("jump-flash"), 1800);
  setTimeout(() => { $("jump").style.display = nearBottom() ? "none" : "block"; }, 400);
}
document.addEventListener("click", (e) => {
  const target = e.target.closest("[data-jump-n]");
  if (!target) return;
  closeQueuePop();
  jumpToEntry(Number(target.dataset.jumpN));
});
// Re-deliver a message that was discarded before it reached a seat. Delegated,
// because the button lives on a message that any rebuild may replace.
document.addEventListener("click", async (e) => {
  const pairButton = e.target.closest("[data-retry-pair]");
  if (pairButton) {
    if (pairButton.disabled) return;
    pairButton.disabled = true;
    try {
      await api("/api/retry", { room: state.room, rootN: Number(pairButton.dataset.retryPair) });
      toast("正在重试整个配对任务。");
    } catch (err) { pairButton.disabled = false; toast(err.message, true); }
    return;
  }
  const btn = e.target.closest("[data-retry-discarded]");
  if (!btn || btn.disabled) return;
  const n = Number(btn.dataset.retryDiscarded);
  const agents = (btn.dataset.retrySeats || "").split(",").filter(Boolean);
  btn.disabled = true; // the summary that follows removes the row entirely
  try {
    await api("/api/queue/retry", { room: state.room, n, ...(agents.length ? { agents } : {}) });
    toast(`已重新加入以下智能体的队列：${agents.map(seatLabel).join(" and ")}.`);
  } catch (err) {
    btn.disabled = false;
    toast(err.message, true);
  }
});

// The reader's place, as a message and an offset rather than a scroll position.
// Restoring scrollTop alone only works when nothing above the viewport changed
// height, which is exactly what a rebuild cannot promise.
function readAnchor() {
  const root = chatWrap.getBoundingClientRect();
  for (const el of chat.children) {
    if (!el.dataset.n) continue;
    const r = el.getBoundingClientRect();
    if (r.bottom > root.top + 1) return { n: el.dataset.n, offset: r.top - root.top };
  }
  return null;
}
function applyAnchor(a) {
  if (!a) return false;
  const el = chat.querySelector(`[data-n="${a.n.replace(/"/g, "")}"]`);
  if (!el) return false;
  // Instant: #chatWrap scrolls smoothly, and animating a correction reads as
  // the lurch it is meant to prevent.
  const behavior = chatWrap.style.scrollBehavior;
  chatWrap.style.scrollBehavior = "auto";
  chatWrap.scrollTop += el.getBoundingClientRect().top - chatWrap.getBoundingClientRect().top - a.offset;
  chatWrap.style.scrollBehavior = behavior;
  return true;
}

function renderAll({ stickToBottom = true, preserveTransient = true, anchor = false } = {}) {
  const oldTop = chatWrap.scrollTop;
  const keep = anchor && !stickToBottom ? readAnchor() : null;
  // Re-rendering the durable transcript must not erase a whisper or a local
  // slash-command note that arrived while a reconnect fetch was in flight.
  const transient = preserveTransient
    ? [...chat.children].filter((el) =>
      !el.dataset.n && (el.classList.contains("whisper") || el.classList.contains("sysmsg")))
    : [];
  chat.innerHTML = "";
  heardSig.clear(); // the rebuild below re-reads them, so nothing cached survives it
  rowByN.clear();
  const start = renderedStartIndex();
  const frag = document.createDocumentFragment();
  if (start > 0) {
    const earlier = document.createElement("button");
    earlier.type = "button";
    earlier.className = "history-more";
    earlier.textContent = "查看更早消息 ▸";
    earlier.title = start > HISTORY_PAGE
      ? `${start} 条更早的记录，本次显示 ${HISTORY_PAGE} more`
      : `${start} 条更早的记录${start === 1 ? "y" : "ies"}`;
    // Wrapped, not passed directly: a handler receives the MouseEvent, which
    // would arrive as the page size.
    earlier.onclick = () => expandHistory();
    frag.appendChild(earlier);
  }
  appendEntryRange(frag, state.entries.slice(start));
  for (const live of Object.values(state.live)) frag.appendChild(live.el);
  for (const el of transient) frag.appendChild(el);
  // Nothing here is new to the reader — it was all on screen a moment ago.
  for (const el of frag.children) el.classList.add("norise");
  chat.appendChild(frag);
  $("empty").style.display = state.entries.length ? "none" : "";
  if (stickToBottom) scrollBottom(true);
  else {
    if (!applyAnchor(keep)) chatWrap.scrollTop = oldTop;
    $("jump").style.display = nearBottom() ? "none" : "block";
  }
}

function mergeEntries(snapshot, current) {
  const byN = new Map();
  for (const e of [...(snapshot || []), ...(current || [])]) {
    if (e && e.n !== undefined && e.n !== null) byN.set(String(e.n), e);
  }
  return [...byN.values()].sort((a, b) => a.n - b.n);
}

function receiptKey(r) {
  return [r.agent, r.from, r.upTo, r.turn, r.mode, r.spoke, r.ts, r.outputEntryN, r.relayLaunch?.index, r.outcome].join("\u0001");
}
function mergeReceipts(snapshot, current) {
  const byKey = new Map();
  for (const r of [...(snapshot || []), ...(current || [])]) byKey.set(receiptKey(r), r);
  return [...byKey.values()];
}
function addReceipt(receipt) {
  const key = receiptKey(receipt);
  if (state.receipts.some((r) => receiptKey(r) === key)) return;
  state.receipts.push(receipt);
  // In-place append: extend the coverage index rather than invalidating it.
  if (receiptIndexSource === state.receipts) indexReceipt(receipt);
  for (const e of state.entries) {
    if (!(e.meta?.error || e.n === receipt.outputEntryN)) continue;
    const row = rowByN.get(e.n);
    const panel = row?.querySelector(".why-run");
    if (panel) {
      const opened = panel.open;
      // Only replace this explanation, preserving the error and its controls.
      const holder = document.createElement("div");
      holder.innerHTML = whyRunHTML(e);
      const next = holder.querySelector(".why-run");
      if (next) { next.open = opened; panel.replaceWith(next); }
    }
  }
  refreshHeard(receipt.from, receipt.upTo);
}

function addEntry(e) {
  // The array is sorted by construction, so dedup is a binary search, and an
  // in-order arrival — the overwhelmingly common case — is a push rather than
  // the full Map-rebuild-and-sort mergeEntries does. That rebuild allocated a
  // 10k-element array plus a 10k-key Map per arriving entry in a long room,
  // several times a second during an active work turn.
  if (entryIndexOf(e.n) >= 0) return;
  const wasAtBottom = nearBottom();
  const last = state.entries[state.entries.length - 1];
  const inOrder = !last || e.n > last.n;
  if (inOrder) {
    state.entries.push(e);
    if (capIndexSource === state.entries) indexCapEntry(e);
  } else {
    state.entries = mergeEntries(state.entries, [e]);
  }
  // Kept in state (it is real history and the transcript replays it) but never
  // drawn: the message it is about now carries its own status, and the room
  // summary that follows this entry repaints that chip.
  if (hiddenEntry(e)) return;
  // an arriving entry replaces any live bubble for that agent
  if (e.kind === "agent" && state.live[e.author]) removeLive(e.author);
  if (e.kind === "system" && e.meta && e.meta.agent && state.live[e.meta.agent]) removeLive(e.meta.agent);
  $("empty").style.display = "none";

  // An entry that lands above the end changes heights the reader is sitting on,
  // so the rebuild has to put them back where they were.
  if (!inOrder) {
    renderAll({ stickToBottom: wasAtBottom, anchor: true });
    if (document.hidden && e.kind !== "activity") { document.title = "● Maple"; notifyForEntry(e); }
    return;
  }
  if (state.renderFromN !== null && e.n < state.renderFromN) return;
  // A new action extends the run it belongs to in place. It used to rebuild the
  // transcript, which meant every visible message replayed its entrance
  // animation while it was being read.
  if (e.kind === "activity") {
    if (appendActivityEntry(e)) scrollBottom(wasAtBottom);
    else renderAll({ stickToBottom: wasAtBottom, anchor: true });
    return;
  }
  const rowEl = entryEl(e);
  if (e.n !== undefined && e.n !== null) rowByN.set(e.n, rowEl);
  chat.appendChild(rowEl);
  // Keep any live bubbles after the durable transcript entry.
  for (const live of Object.values(state.live)) chat.appendChild(live.el);
  if (document.hidden && e.kind !== "activity") { document.title = "● Maple"; notifyForEntry(e); }
  scrollBottom(e.kind === "user" || wasAtBottom);
}

// ---- away-from-tab notifications ----
// A work-mode turn can run for fifteen minutes and a pair cycle can pause
// waiting for a decision, so the interesting moment usually arrives while the
// user is in their editor. A dot on the tab title was the only signal. This is
// opt-in, per browser, and never asks unprompted — the toggle lives in Settings.
const NOTIFY_KEY = "parley.notify";
function notifyEnabled() {
  try { return localStorage.getItem(NOTIFY_KEY) === "1"; } catch { return false; }
}
function setNotifyEnabled(on) {
  try { localStorage.setItem(NOTIFY_KEY, on ? "1" : "0"); } catch { /* private mode */ }
}
async function requestNotifyPermission() {
  if (!("通知" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  try { return (await Notification.requestPermission()) === "granted"; } catch { return false; }
}
// Only while the tab is hidden: a notification for something already on screen
// is noise, and this feature exists for the moments the user is elsewhere.
function notifyAway(title, body) {
  if (!document.hidden || !notifyEnabled()) return;
  if (!("通知" in window) || Notification.permission !== "granted") return;
  try {
    const n = new Notification(title, { body: String(body || "").slice(0, 180), tag: "parley-" + state.room });
    n.onclick = () => { window.focus(); n.close(); };
  } catch { /* the browser refused; the tab title still carries the dot */ }
}
// The three moments worth interrupting someone for: an answer landed, the room
// is waiting on a decision it cannot make, or something failed.
function notifyForEntry(e) {
  if (e.kind === "agent") {
    notifyAway(`${seatLabel(e.author)} replied`, e.text);
  } else if (e.kind === "system" && e.meta) {
    if (e.meta.pairPause || /needs your decision|needs-user/i.test(e.text || "")) {
      notifyAway("Maple 正在等你决定", e.text);
    } else if (e.meta.error) {
      notifyAway("某一轮执行失败", e.text);
    }
  }
}

// live (thinking / streaming) bubbles
// What a run's phase reads as while it is live. Shared by the status stream
// and the summary path, so a tab that loads mid-run gets the same words a tab
// that watched the run start did.
function liveLabelFor(phase) {
  return ({
    listening: "正在旁听 👂",
    "catching-up": "正在补读 👂",
    review: "正在审查 🔁",
    fix: "正在修正 🔁",
    attention: "正在接收回答 ↩",
    closure: "正在结束本轮讨论 🔒",
    hop: "正在跟进 ⛓",
    retrying: "正在恢复会话",
  })[phase];
}
function elapsedLabel(l) {
  return "· " + Math.floor((Date.now() - l.startedAt) / 1000) + "s";
}
function ensureLive(agent, startedAt, label) {
  if (state.live[agent]) return state.live[agent];
  const div = document.createElement("div");
  div.className = "msg agent " + agent;
  div.dataset.liveAgent = agent;
  div.innerHTML = `<div class="meta"><span class="avatar">${esc(seatAvatar(agent))}</span>` +
    `<span class="who">${agent.charAt(0).toUpperCase() + agent.slice(1)}</span>` +
    `<span class="live-label">${label || "正在思考"} <span class="elapsed"></span></span></div>` +
    `<div class="quote-slot"></div>` +
    `<div class="bubble"><span class="thinking-dots"><i></i><i></i><i></i></span></div>`;
  chat.appendChild(div);
  state.live[agent] = { el: div, mode: "think", startedAt: startedAt || Date.now(), text: "" };
  liveObserver.observe(div);
  applyLiveRef(agent);
  scrollBottom();
  scheduleVisibility();
  return state.live[agent];
}
function removeLive(agent) {
  const l = state.live[agent];
  if (l) { liveObserver.unobserve(l.el); l.el.remove(); delete state.live[agent]; }
  delete state.liveVisible[agent];
  if (state.streamTimer[agent]) { clearTimeout(state.streamTimer[agent]); delete state.streamTimer[agent]; }
  renderBusyStrip();
}

// ---- provenance while busy ----
// One source of truth for both surfaces: the quote header inside the live
// bubble (primary, and it becomes scrollback once the reply lands) and the
// composer strip (fallback, only while that bubble is off-screen).
function busyInfoFor(agent) {
  const list = (state.summary && state.summary.busyInfo) || [];
  return list.find((b) => b.agent === agent) || null;
}
function applyLiveRef(agent) {
  const l = state.live[agent];
  if (!l) return;
  const slot = l.el.querySelector(".quote-slot");
  if (!slot) return;
  const info = busyInfoFor(agent);
  const src = info && info.source ? info.source : null;
  const root = info && (info.deliveryKind === "root" || info.deliveryKind === "start");
  const html = src ? quoteRefHTML(src, info?.delivery?.accounting === "automatic" ? "触发来源" : root ? "由你的消息触发" : "↩ 回复") +
    (info?.relayLaunch?.accounting === "automatic" ? `<div class="meta">${provenanceBadges(info)}</div>` : "") +
    liveWhyRunHTML(info) : "";
  if (slot.innerHTML !== html) slot.innerHTML = html;
}
function applyLiveRefs() {
  for (const agent of Object.keys(state.live)) applyLiveRef(agent);
}
function liveWhyRunHTML(info) {
  if (!info) return "";
  return whyRunHTML({ kind: "agent", author: info.agent, meta: { outcome: "running",
    delivery: { kind: info.deliveryKind, rootN: info.rootN, triggerEntryN: info.sourceN, ...info.delivery },
    relayLaunch: info.relayLaunch, catchUp: info.catchUp } });
}

const PHASE_VERB = {
  start: "由以下消息触发", hop: "回复", retrying: "正在恢复会话以处理",
  listening: "正在旁听", "catching-up": "正在补读", review: "reviewing", fix: "正在根据意见修正",
};
const RUNNING_VERB = {
  start: "正在回复", hop: "正在回复", retrying: "正在恢复会话",
  listening: "正在旁听", "catching-up": "正在补读", review: "正在审查", fix: "正在修正",
};

// Hysteresis, not a boolean. Showing the strip the instant the bubble's last
// pixel leaves and hiding it the instant the first returns makes it blink
// while you scroll past the boundary; fully-gone to show, half-back to hide.
//
// "Half back" is measured against whichever is smaller, the bubble or the
// viewport. An observer threshold cannot express that: thresholds are ratios
// of the *target*, so a reply three viewports tall tops out around 0.33 and
// would never cross 0.5 — the strip would sit there covering a bubble that
// fills the screen. So the observer is only the nudge; the rects decide.
function measureLiveVisibility() {
  const root = chatWrap.getBoundingClientRect();
  for (const [agent, l] of Object.entries(state.live)) {
    const r = l.el.getBoundingClientRect();
    const shown = Math.max(0, Math.min(r.bottom, root.bottom) - Math.max(r.top, root.top));
    const half = Math.min(r.height, root.height) * 0.5;
    if (shown <= 0) state.liveVisible[agent] = false;
    else if (half > 0 && shown >= half) state.liveVisible[agent] = true;
    else if (state.liveVisible[agent] === undefined) state.liveVisible[agent] = true;
    // Anything between the two edges keeps whatever it already was — that gap
    // is the hysteresis.
  }
}
let visibilityFrame = 0;
function scheduleVisibility() {
  if (visibilityFrame) return;
  const run = () => {
    visibilityFrame = 0;
    measureLiveVisibility();
    renderBusyStrip();
  };
  visibilityFrame = typeof requestAnimationFrame === "function"
    ? requestAnimationFrame(run) : setTimeout(run, 16);
}
// The observer catches what scrolling does not: the bubble growing as a reply
// streams in, the composer resizing, the window changing shape.
const liveObserver = typeof IntersectionObserver === "function"
  ? new IntersectionObserver(scheduleVisibility, { root: chatWrap, threshold: [0, 0.25, 0.5, 0.75, 1] })
  // Without it the scroll handler still measures; only layout changes that
  // move nothing would be missed. One optional surface must not be able to
  // take the whole page down.
  : { observe() {}, unobserve() {} };
chatWrap.addEventListener("scroll", scheduleVisibility);

function stripRowHTML(b) {
  const src = b.source;
  const direct = b.deliveryKind === "root" || b.deliveryKind === "start";
  const verb = direct ? "由你的消息触发" : PHASE_VERB[b.phase] || "回复";
  return `<span class="bs-dot" style="background:${esc(seatColor(b.agent))}"></span>` +
    `<span class="bs-agent">${esc(seatLabel(b.agent))}</span>` +
    `<span class="bs-verb">→ ${esc(verb)}${src && !direct ? ` ${esc(refWho(src))}` : ""}</span>` +
    (src ? `<span class="bs-time">· ${esc(hhmm(src.ts))}</span>` +
      `<span class="bs-snip">· “${esc(src.text || "")}”</span>` : "");
}

// Exactly one row, for the whole working period. A row that comes and goes —
// per seat, per scroll boundary, or per hop — resizes the composer and reflows
// the transcript under whoever is reading it, and a seat joining late is
// precisely when someone is scrolled up. So the strip summarises rather than
// grows: the first off-screen reply, plus a count of the others.
let stripRowEl = null;
function renderBusyStrip() {
  const strip = $("busyStrip");
  if (!strip) return;
  const s = state.summary || {};
  const info = s.busyInfo || [];
  if (!info.length && !s.working && !Object.keys(state.live).length) {
    strip.style.display = "none";
    strip.replaceChildren();
    stripRowEl = null;
    return;
  }
  strip.style.display = "flex";
  if (!stripRowEl) {
    stripRowEl = document.createElement("button");
    stripRowEl.type = "button";
    stripRowEl.className = "bs-row";
    strip.appendChild(stripRowEl);
  }
  const row = stripRowEl;
  // Fallback only: while a bubble is on screen its own quote header is already
  // saying this, and two copies of one line is worse than none.
  const off = info.filter((b) => state.liveVisible[b.agent] === false);
  row.classList.toggle("bs-hidden", !off.length);
  if (!off.length) return; // hidden, so its contents cannot be read or clicked
  const b = off[0];
  const rest = off.length - 1;
  const html = stripRowHTML(b) + (rest > 0
    ? `<span class="bs-other" data-scroll-live="1" title="查看正在生成的回复">· +${rest} other</span>`
    : "");
  // Rewritten only when it actually changed: replacing the row's markup on
  // every status event restarted the pulse on its dot.
  if (row.dataset.sig !== html) { row.innerHTML = html; row.dataset.sig = html; }
  const src = b.source;
  if (src) { row.dataset.jumpN = String(src.n); row.title = "跳转到这条消息"; }
  else { delete row.dataset.jumpN; row.title = ""; }
}
$("busyStrip").addEventListener("click", (e) => {
  if (!e.target.closest("[data-scroll-live]")) return;
  e.stopPropagation(); // the row is a jump target; the count inside it is not
  const first = Object.values(state.live)[0];
  if (first) first.el.scrollIntoView({ block: "center", behavior: "smooth" });
});
function clearLive() {
  for (const agent of Object.keys(state.live)) removeLive(agent);
}
// The server sends increments, not the whole reply each time: `text` is a full
// keyframe, `{from, delta}` extends what we already hold. An increment that
// does not start exactly where our text ends means we missed one, so hold the
// bubble as-is and wait for the next keyframe (at most two seconds) rather than
// splicing text at the wrong offset. The finished entry is authoritative either
// way, so the worst case is a briefly stale bubble.
function liveStream(agent, msg) {
  const l = ensureLive(agent, (busyInfoFor(agent) || {}).startedAt);
  if (typeof msg.text === "string") l.text = msg.text;
  else if (msg.from === l.text.length) l.text += msg.delta;
  else return;
  if (state.streamTimer[agent]) return;
  // The repaint cost is not the markdown (0.26ms at 20KB) — it is the layout of
  // the destroyed-and-recreated bubble subtree, which grows with reply length:
  // ~20ms per flush at 20KB, every 90ms, ~22% of the main thread for the whole
  // tail of a long reply, felt as keystroke stalls while composing. Text
  // accumulation happens above, outside the timer, so coalescing more per
  // repaint loses nothing — the flush interval simply grows with the reply.
  const flushDelay = l.text.length < 4096 ? 90 : l.text.length < 16384 ? 250 : 500;
  state.streamTimer[agent] = setTimeout(() => {
    delete state.streamTimer[agent];
    const cur = state.live[agent];
    if (!cur) return;
    // The label is written once, on the think→stream transition. Rewriting it
    // every flush recreated an empty .elapsed span, so the "· 12s" counter was
    // blank ~90% of the time during streaming — exactly when it matters.
    if (cur.mode !== "stream") {
      cur.mode = "stream";
      cur.el.querySelector(".live-label").innerHTML = `正在回复 <span class="elapsed">${elapsedLabel(cur)}</span>`;
    }
    cur.el.querySelector(".bubble").innerHTML = renderMD(cur.text) + '<span class="caret"></span>';
    scrollBottom();
  }, flushDelay);
}
function whisper(agent, error, hop, skipped, asleep, held, queued, attention) {
  const d = document.createElement("div");
  d.className = "whisper";
  // A sleeping seat is not a busy one: there is no later turn to catch up on
  // until the user wakes it, which is why this skip also lands in the thread.
  // Held is the opposite case and must not read as a drop — the message was
  // accepted and is waiting for the seat, not lost.
  d.textContent = queued
    ? `👂 ${agent} 忙碌中，已安排在当前用户任务完成后合并补读`
    : held
    ? `📥 ${agent} 休眠中；唤醒后才会送达`
    : skipped
    ? (asleep
      ? `😴 ${agent} 休眠中，未向其发送任何内容`
      : `⏭ ${agent} 正在处理另一轮讨论，下次执行时会补读`)
    : error
      ? `👂 ${agent} 旁听时遇到错误：${error}`
      : attention
        ? `↩ ${agent} 已收到关联消息，没有补充内容`
      : hop
        ? `⛓ ${agent} 已读到提及内容，没有补充`
        : `👂 ${agent} 已旁听，没有补充内容`;
  chat.appendChild(d);
  scrollBottom();
  setTimeout(() => { d.style.opacity = "0"; setTimeout(() => d.remove(), 900); }, 4500);
}
setInterval(() => {
  for (const a of Object.keys(state.live)) {
    const l = state.live[a];
    const el = l.el.querySelector(".elapsed");
    if (el) el.textContent = elapsedLabel(l);
  }
}, 1000);

// ------------------------------------------------------------ header / pills / busy
// Seats are data: colors, avatars and controls all render from the summary's
// seat list + provider catalog, so any provider pair just works.
// A seat's look and settings come from its provider, which its id no longer has
// to match. `seatInfo` carries that per seat; a summary from before it existed
// (or a seat missing from it) falls back to the provider-keyed catalog, which
// is correct whenever the id is the provider name.
function seatMeta(a) {
  const info = state.summary && state.summary.seatInfo && state.summary.seatInfo[a];
  return info || (state.providers && state.providers[a]) || {};
}
const titleCaseSeat = (a) => String(a).charAt(0).toUpperCase() + String(a).slice(1);
function seatAvatar(a) {
  return seatMeta(a).avatar || String(a)[0].toUpperCase();
}
// What this room has actually spent, per seat. The numbers are already on every
// reply (ground truth from the CLI, not model self-reporting); nothing summed
// them, so the only cost signal was one bubble at a time — in an app whose Sleep
// feature exists because people hit rate limits.
function seatUsage(a) {
  let out = 0, reasoning = 0, replies = 0;
  for (const e of state.entries) {
    if (e.kind !== "agent" || e.author !== a) continue;
    const t = e.meta && e.meta.tokens;
    if (!t) continue;
    replies++;
    if (typeof t.out === "number") out += t.out;
    if (typeof t.reasoning === "number") reasoning += t.reasoning;
  }
  return { out, reasoning, replies };
}
function usageSummaryText(a) {
  const u = seatUsage(a);
  if (!u.replies) return "";
  const parts = [`${u.out.toLocaleString()} 个输出 token`];
  if (u.reasoning) parts.push(`${u.reasoning.toLocaleString()} 个思考 token`);
  return `${parts.join(" · ")} over ${u.replies} repl${u.replies === 1 ? "y" : "ies"}（本次对话）`;
}

function seatColor(a) {
  return (seatMeta(a).color) || "#7aa2f7";
}
function seatLabel(a) {
  const meta = seatMeta(a);
  // A seat's own name wins over its provider's label whenever they differ:
  // that name is what you @mention, and in a room with two seats on one
  // provider "Claude" and "Claude" would be indistinguishable.
  if (meta.provider && meta.provider !== a) return titleCaseSeat(a);
  return meta.label || titleCaseSeat(a);
}
function injectSeatStyles() {
  let css = "";
  for (const [id, p] of Object.entries(state.providers)) {
    const c = p.color || "#7aa2f7";
    css += `.msg.${id} .who{color:${c}} .msg.${id} .avatar{background:${c}} ` +
      `.msg.${id} .bubble{border-left:2px solid ${c}88} .activity.${id} .adot{background:${c}} ` +
      `.hdot.${id}{--hc:${c}} .chip.active[data-t="${id}"]{background:${c};border-color:${c}}\n`;
  }
  let el = $("seatStyles");
  if (!el) { el = document.createElement("style"); el.id = "seatStyles"; document.head.appendChild(el); }
  el.textContent = css;
}
function renderSeatsUI(s) {
  const seats = s.seats;
  $("pills").innerHTML = seats.map((a) =>
    `<div class="pill" data-seat="${esc(a)}" id="pill_${esc(a)}"><span class="st"></span>` +
    `<b style="color:${seatColor(a)}">${esc(seatLabel(a))}</b><span class="pinfo"></span>` +
    `<button class="ear" data-seat="${esc(a)}">👂</button>` +
    `<button class="moon" data-seat="${esc(a)}">😴</button></div>`).join("");
  $("seatChips").innerHTML = seats.map((a) => `<button class="chip" data-t="${esc(a)}">@${esc(a)}</button>`).join("");
  document.querySelectorAll(".chip").forEach((c) => c.classList.toggle("active", c.dataset.t === state.chip));
  $("tagline").textContent = `你 · ${seats.join(" · ")}`;
  input.placeholder = `发送消息…  (@${seats.join(", @")}, @both)`;
  $("starters").innerHTML =
    `<button class="starter" data-fill="@both 请各用一句话介绍自己。"><b class="c3">@both</b> 请各用一句话介绍自己。</button>` +
    seats.map((a, i) => `<button class="starter" data-fill="@${esc(a)} "><b class="${i ? "c2" : "c1"}">@${esc(a)}</b> 向 ${esc(seatLabel(a))} 提问，开始聊天…</button>`).join("") +
    `<button class="starter" data-fill="/pair start @${esc(seats[0])} "><b class="c1">/pair start</b> 一位执行，另一位审查…</button>`;
}
function syncChipUI() {
  document.querySelectorAll(".chip").forEach((c) => c.classList.toggle("active", c.dataset.t === state.chip));
}
function pairRoundsLabel(rounds) {
  const n = Math.max(0, Number(rounds) || 0);
  return n > 0 ? `最多 ${n} round${n === 1 ? "" : ""}（每条消息）` : "直到审查通过";
}
function configArgValue(args, option) {
  const wanted = option.toLowerCase();
  let found = 0;
  let value = null;
  for (let i = 0; i < (args || []).length; i++) {
    const raw = String(args[i]);
    if (raw.split("=", 1)[0].toLowerCase() !== wanted) continue;
    found++;
    value = raw.includes("=") ? raw.slice(raw.indexOf("=") + 1) : String(args[i + 1] || "");
    if (!value.trim() || value.startsWith("-")) value = "无效的覆盖设置";
  }
  return found > 1 ? "无效的覆盖设置" : value;
}
function effectiveSeatPermission(a, cfg, roomMode) {
  if ("permissionMode" in cfg) {
    const override = configArgValue(cfg.extraArgs || [], "--permission-mode");
    if (override !== null) return override || "无效的覆盖设置";
    const configured = cfg.permissionMode || "auto";
    if(configured==='smart')return 'smart';
    return configured === "auto" ? (roomMode === "work" ? "acceptEdits" : "default") : configured;
  }
  if ("sandbox" in cfg) {
    const configured = cfg.sandbox || "read-only";
    return roomMode === "work" && configured === "read-only" ? "workspace-write" : configured;
  }
  return "提供方默认设置";
}
function permissionLabel(mode) {
  const labels = {
    default: "CLI 默认设置",
    manual: "manual",
    plan: "计划模式：只读",
    acceptEdits: "允许编辑",
    smart: "自动批准常规操作",
    bypassPermissions: "完全访问",
    "read-only": "只读",
    "workspace-write": "可写工作区",
    "danger-full-access": "完全访问",
  };
  return labels[mode] || mode;
}
function isFullAccess(mode) {
  return String(mode).toLowerCase() === "bypasspermissions" || mode === "danger-full-access";
}
function isConservative(mode) {
  return ["default", "manual", "plan", "read-only"].includes(mode);
}
// Which branch/worktree the room's folder is actually in. The server reports
// null for anything it could not read with certainty, and then this shows
// nothing at all rather than a stale or guessed branch.
function renderGitId(git) {
  const el = $("gitId");
  const where = git && (git.detached ? (git.head ? `${git.head} (detached)` : "") : (git.branch || ""));
  // The worktree's name is only worth the space when it is a *linked* worktree.
  // For an ordinary checkout it just repeats the folder name the workspace
  // button above already shows.
  const label = where ? `⑂ ${where}${git.linked && git.worktree ? ` · ${git.worktree}` : ""}` : "";
  el.textContent = label;
  el.title = label
    ? (git.detached ? "游离 HEAD：当前文件夹不在任何分支上" : `当前分支：${git.branch}`) +
      (git.linked && git.worktree ? ` · 关联的工作树：${git.worktree}` : "")
    : "";
  el.style.display = label ? "" : "none";
}

// A checkout in another window changes this with no event to announce it, so
// re-read on focus. One fetch per focus, never a poll.
async function refreshGitId() {
  const room = state.room;
  if (!room) return;
  try {
    // The summary endpoint, not /api/room: this needs one field, and the full
    // snapshot grows with the room's whole history.
    const data = await api("/api/room/summary?name=" + encodeURIComponent(room));
    if (state.room !== room) return;
    if (state.summary) state.summary.git = data.room.git;
    renderGitId(data.room.git);
  } catch { /* keep the last line rather than blanking on a transport hiccup */ }
}

function applySummary(s) {
  s.busy = s.busy || [];
  s.busyInfo = s.busyInfo || [];
  for (const agent of Object.keys(state.live)) {
    if (!s.busy.includes(agent)) removeLive(agent);
  }
  state.summary = s;
  window.dispatchEvent(new Event('parley-summary'));
  state.providers = s.providers || state.providers;
  injectSeatStyles();
  if (!$("pill_" + s.seats[0]) || !$("pill_" + s.seats[1])) renderSeatsUI(s);
  syncChipUI();
  $("roomTitle").textContent = s.name;
  for (const a of s.seats) {
    const pill = $("pill_" + a);
    if (!pill) continue;
    const ag = s.agents[a];
    const asleep = !!ag.asleep;
    pill.classList.toggle("linked", ag.linked);
    pill.classList.toggle("busy", s.busy.includes(a));
    pill.classList.toggle("bad", !ag.command.ok);
    pill.classList.toggle("asleep", asleep);
    // The pill's tooltip is where someone looks when they want to know what a
    // seat has cost them so far.
    const spent = usageSummaryText(a);
    const health = (state.doctor && state.doctor[a]) || null;
    pill.title = [
      ag.command.ok ? `${seatLabel(a)} · ${ag.command.detail}` : `${seatLabel(a)}: ${ag.command.detail}`,
      health && !health.ok && health.stage === "auth" ? `${health.detail} — ${health.how}` : "",
      spent,
    ].filter(Boolean).join("\n");
    let txt = "";
    if (!ag.command.ok) txt = "未找到";
    else if (health && !health.ok && health.stage === "auth") txt = "未登录";
    else {
      // A seat can be both: sleep stops the *next* launch, so a response
      // already running still says so.
      const bits = [];
      if (s.busy.includes(a)) bits.push("正在输入…");
      if (ag.catchUp && !s.busy.includes(a)) bits.push("等待补读");
      // Held is a subset of pending, never an addend — "3 held · 14 pending"
      // means 3 of those 14 are messages the user addressed to this seat.
      // It outlives sleep: after Wake only the seat is awake and they are still
      // undelivered, so the count stays until a turn moves the cursor.
      if (asleep) bits.push(ag.pending ? `休眠中 · ${ag.pending} 条待处理` : "休眠中");
      if (ag.held) bits.push(`${ag.held} 条暂存`);
      if (!bits.length && s.cfg.agents[a].model) bits.push(s.cfg.agents[a].model);
      txt = bits.join(" · ");
    }
    pill.querySelector(".pinfo").textContent = txt ? " · " + txt : "";
    pill.title = ag.command.ok
      ? (ag.linked ? `已关联会话（${ag.sessionRef}…），已读到第 ${ag.cursor}` : "新会话")
      : ag.command.detail;
    const moon = pill.querySelector(".moon");
    const reason = (ag.sleep && ag.sleep.reason) || "";
    moon.classList.toggle("on", asleep);
    moon.textContent = asleep ? "☀" : "😴";
    // The pending count is context, not a token estimate — but this is the one
    // moment the size of the next turn is knowable before it runs, and that
    // turn arrives right after whatever quota event caused the sleep.
    moon.title = asleep
      ? `唤醒 ${seatLabel(a)}${ag.pending ? ` — ${ag.pending} 条待处理记录` : ''}` +
        `${reason ? `；休眠原因：${zhSystemText(reason)}` : ''}。` +
        (ag.held
          ? `其中 ${ag.held} 条是你发送的请求，可选择唤醒后立即处理，或仅作为上下文读取。`
          : '不会重新执行历史请求；下次执行时，它们只作为普通上下文读取。')
      : `让 ${seatLabel(a)} 休眠：唤醒前不会因消息、@提及或旁听而启动；已经开始的回复仍会完成。`;
    const ear = pill.querySelector('.ear');
    const lurking = !!s.cfg.agents[a].lurk;
    ear.classList.toggle("on", lurking);
    ear.title = lurking
      ? `${a} 正在旁听：会读到每轮交流，并可能补充发言（每条消息额外调用一次 ${a}）。点击关闭。`
      : `让 ${a} 旁听：它会读到每轮交流，并可能补充发言（每条消息额外调用一次 ${a}）。点击开启。`;
  }
  const mode = s.cfg.mode || "talk";
  document.querySelectorAll(".mbtn").forEach((b) => b.classList.toggle("active", b.dataset.m === mode));
  const access = s.seats.map((a) => ({
    agent: a,
    mode: effectiveSeatPermission(a, s.cfg.agents[a], mode),
  }));
  const how = access.map(({ agent, mode: permission }) =>
    `${esc(agent)}: ${esc(permissionLabel(permission))}`).join(" · ");
  const full = access.filter(({ mode: permission }) => isFullAccess(permission)).map(({ agent }) => agent);
  const talkOverride = mode === "talk" && access.some(({ mode: permission }) => !isConservative(permission));
  $("workBanner").style.display = full.length || talkOverride ? "block" : "none";
  if (full.length) {
    $("workBanner").innerHTML = `⚠ <b>已启用完全访问权限</b> — ${full.map(esc).join(" + ")} 的操作范围可能超出 ` +
      (s.cfg.projectDir ? `<b>${esc(s.cfg.projectDir)}</b>` : "聊天室工作区") +
      `，范围受当前系统账户权限限制（${how}).`;
  } else if (mode === "work") {
    $("workBanner").innerHTML = `🔨 <b>工作模式</b> — 智能体可以写文件、运行命令，位置：` +
      (s.cfg.projectDir ? `<b>${esc(s.cfg.projectDir)}</b>` : "共享工作区") +
      ` (${how}）。操作会显示在聊天中的活动记录里。`;
  } else if (talkOverride) {
    $("workBanner").innerHTML = `⚠ <b>对话模式启用了额外权限</b> — 已配置的智能体仍可能修改内容（${how}).`;
  }
  const pair = s.pair;
  $("pairBanner").style.display = pair ? "block" : "none";
  if (pair) {
    $("pairBannerText").innerHTML = `🔁 <b>配对模式</b> — <b>${esc(pair.worker)}</b> works, <b>${esc(pair.reviewer)}</b> 审查 ` +
      `(${pairRoundsLabel(pair.rounds)}）。你发送的每条消息都会按此方式处理。`;
    const source = pair.roundsSource === "command" ? "命令指定的设置" : "聊天室设置";
    const limited = Number(pair.rounds) > 0;
    const sourceTitle = pair.roundsSource === "command"
      ? (limited
        ? "当前轮数上限来自 /pair start，独立于聊天室设置。"
        : "当前“直到审查通过”的规则来自 /pair start，独立于聊天室设置。")
      : (limited
        ? "当前轮数上限遵循聊天室的配对审查轮次设置。"
        : "当前“直到审查通过”的规则遵循聊天室的配对审查轮次设置。");
    $("pairBannerText").insertAdjacentHTML("beforeend",
      ` <span title="${esc(sourceTitle)}" style="opacity:.62">· ${source}</span>`);
  }
  // say what this room actually works in, rather than a vague "workspace"
  const wsBtn = $("openWs");
  $("openWsLabel").textContent = s.cfg.projectDir
    ? s.cfg.projectDir.split(/[\\/]/).filter(Boolean).pop()
    : "独立工作区";
  wsBtn.title = s.cfg.projectDir
    ? `已关联项目，点击打开：${s.cfg.projectDir}`
    : `本聊天室的独立工作文件夹，点击打开：${s.workspace}`;
  renderGitId(s.git);
  // A tab that loads mid-run knows each run's phase and start time from
  // busyInfo; without them every bubble read "is thinking · 0s" — for a
  // four-minute work turn, or a lurker that had been deciding for a while.
  for (const b of s.busyInfo || []) ensureLive(b.agent, b.startedAt, liveLabelFor(b.phase));
  for (const a of s.busy) ensureLive(a);
  applyLiveRefs();
  renderBusyStrip();
  setQueue(s.queued || 0, s.queue, s.queuedDispatches, s.queuePaused);
  refreshHeard(0, Infinity); // busy/cursor changes can flip pending/unheard dots
  refreshErrorRecovery();
  updateBusyUI();
  renderHopControl();
  updateRouteHint();
}
// Waking a seat that is holding messages asks a question with three answers,
// so it gets a real menu; a plain toggle stays a plain toggle when there is
// nothing held to decide about.
function closeWakeMenu() {
  $("wakeMenu").classList.remove("open");
  $("wakeMenu").innerHTML = "";
}
function openWakeMenu(moon, agent, held) {
  const menu = $("wakeMenu");
  menu.innerHTML =
    `<button role="menuitem" data-wake="deliver" data-seat="${esc(agent)}">` +
    `☀ 唤醒并处理<span class="sm-sub">在一轮内回复 ${held} 条待处理消息${held === 1 ? "" : ""}</span></button>` +
    `<button role="menuitem" data-wake="only" data-seat="${esc(agent)}">` +
    `☀ 仅唤醒<span class="sm-sub">待处理消息${held === 1 ? " becomes" : "条消息将作为"}普通上下文</span></button>`;
  menu.classList.add("open");
  // Fixed positioning against the button: the pill row it lives in is rebuilt
  // on every room update, so an anchored child would be thrown away mid-choice.
  const r = moon.getBoundingClientRect();
  const w = menu.offsetWidth;
  menu.style.left = `${Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8))}px`;
  menu.style.top = `${r.bottom + 7}px`;
}
async function wakeSeatFromMenu(agent, deliver) {
  closeWakeMenu();
  try {
    const res = await api("/api/seat/sleep",
      { room: state.room, agent, asleep: false, ...(deliver ? { deliver: true } : {}) });
    toast(deliver && res.delivered
      ? `☀ ${agent} 已唤醒，正在回复 ${res.held} 条待处理消息${res.held === 1 ? "" : ""}`
      : `☀ ${agent} 已唤醒，没有重新发送历史请求`);
  } catch (err) { toast(err.message, true); }
}
$("wakeMenu").addEventListener("click", (e) => {
  const choice = e.target.closest("[data-wake]");
  if (choice) wakeSeatFromMenu(choice.dataset.seat, choice.dataset.wake === "deliver");
});
// Anywhere else, including Escape, means "not now" — which is why this cannot
// be a confirm(): its Cancel would have to double as one of the two wakes.
document.addEventListener("click", (e) => {
  if (!e.target.closest("#wakeMenu") && !e.target.closest(".moon")) closeWakeMenu();
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeWakeMenu(); });

// ↪ Ask on any user or agent message. Idle target: one action. Busy target: the
// two that are genuinely different — queue behind the current response, or stop
// it and ask now. The stop-and-ask is ONE server request pinned to the runId the
// browser is showing; never a Stop click followed by a Send, which leaves a
// window for the old run to finish and the queue to start something else.
let askDraft = null; // { sourceN, target } while the menu is open
function closeAskMenu() {
  $("askMenu").classList.remove("open");
  $("askMenu").innerHTML = "";
  askDraft = null;
}
function askDefaultTarget(src) {
  if (!src) return null;
  return src.kind === "agent" ? src.author
    : (src.target === "both" ? "both" : src.target);
}
function askPins(seats) {
  const s = state.summary || {};
  const info = (s.busyInfo || []).filter((b) => b.runId);
  // A pair cycle is one unit: redirecting during one ends it, so its runs all
  // go. Otherwise pin only the seats this ask is aimed at — killing an unrelated
  // seat's response is not what "stop the current response" means.
  const wanted = s.workingPair ? info : info.filter((b) => seats.includes(b.agent));
  return wanted.map((b) => ({ agent: b.agent, runId: b.runId }));
}
function askSeatsFor(target) {
  return target === "both" ? ((state.summary && state.summary.seats) || []) : [target];
}
function renderAskMenu(btn) {
  if (!askDraft || !state.summary) return;
  const menu = $("askMenu");
  const seats = (state.summary.seats || []);
  const busy = state.summary.busy || [];
  const aimed = askSeatsFor(askDraft.target);
  const contested = state.summary.workingPair || aimed.some((a) => busy.includes(a));
  const chips = [...seats, ...(seats.length > 1 ? ["both"] : [])].map((t) =>
    `<button data-ask-seat="${esc(t)}" class="${t === askDraft.target ? "active" : ""}">` +
    `${esc(t === "both" ? "两者" : seatLabel(t))}</button>`).join("");
  const draft = ($("askText") || {}).value || "";
  const actions = !contested
    ? `<button role="menuitem" data-ask-mode="now">↪ 立即追问<span class="sm-sub">此智能体当前空闲</span></button>`
    : `<button role="menuitem" data-ask-mode="queue">⏳ 排在当前任务之后` +
      `<span class="sm-sub">已有排队任务保持原顺序</span></button>` +
      `<button role="menuitem" data-ask-mode="stop">■ 停止当前回复并立即追问` +
      `<span class="sm-sub">停止屏幕上的当前回复，排队任务在本次追问之后处理</span></button>`;
  menu.innerHTML = `<div class="ask-seats">${chips}</div>` +
    `<input id="askText" placeholder="补充说明（可选）" value="${esc(draft)}">` + actions;
  menu.classList.add("open");
  // Only measure against the button on first open; a seat-chip re-render must
  // not make the menu jump out from under the cursor.
  if (btn) {
    const r = btn.getBoundingClientRect();
    const w = menu.offsetWidth;
    menu.style.left = `${Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8))}px`;
    menu.style.top = `${r.bottom + 7}px`;
  }
}
function openAskMenu(btn, sourceN) {
  const src = entryByN(sourceN);
  if (!src || !state.summary) return;
  askDraft = { sourceN, target: askDefaultTarget(src) || (state.summary.seats || [])[0] };
  if (!askDraft.target) { askDraft = null; return; }
  renderAskMenu(btn);
}
async function askFromMenu(mode) {
  if (!askDraft) return;
  const seats = askSeatsFor(askDraft.target);
  const body = {
    room: state.room, sourceN: askDraft.sourceN, mode,
    target: askDraft.target, text: ($("askText") || {}).value || "",
    ...(mode === "stop" ? { runs: askPins(seats) } : {}),
  };
  // Nothing on screen to stop: asking for a pinned stop with no pins would be
  // refused, and downgrading is what the user meant anyway.
  if (mode === "stop" && !body.runs.length) { body.mode = "queue"; delete body.runs; }
  closeAskMenu();
  try {
    const r = await api("/api/ask", body);
    if (r.held && r.held.length) toast(`😴 暂存给 ${r.held.join(" and ")}，等待唤醒`);
    else if (r.stop && r.stop.stale) toast("上一条回复已经完成，你的消息排在下一位。");
    else if (r.deferred && r.deferred.length) toast(`⏳ 排在以下智能体的下一位：${r.deferred.join(" and ")}的队列`);
  } catch (err) { toast(err.message, true); }
}
$("askMenu").addEventListener("click", (e) => {
  const seat = e.target.closest("[data-ask-seat]");
  if (seat && askDraft) { askDraft.target = seat.dataset.askSeat; renderAskMenu(null); return; }
  const choice = e.target.closest("[data-ask-mode]");
  if (choice) askFromMenu(choice.dataset.askMode);
});
document.addEventListener("click", (e) => {
  if (!e.target.closest("#askMenu") && !e.target.closest(".ask")) closeAskMenu();
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeAskMenu(); });

// ---- narrow-width room navigation ----
// Below 760px the sidebar slides over the chat instead of vanishing. Without
// this, rooms, the workspace, the transcript and settings were all unreachable
// and the only way to another room was editing ?room= by hand.
function setNavOpen(open) {
  document.body.classList.toggle("nav-open", open);
  $("navToggle").setAttribute("aria-expanded", String(open));
  $("navScrim").hidden = !open;
}
$("navToggle").onclick = () => setNavOpen(!document.body.classList.contains("nav-open"));
$("navScrim").onclick = () => setNavOpen(false);
document.addEventListener("keydown", (e) => { if (e.key === "Escape") setNavOpen(false); });

// ---- keyboard-navigable menus ----
// These surfaces declare role="menu" but had no arrow keys, no focus move on
// open and, for the stop menu, no Escape. Declaring the semantics without
// honouring them is worse than not declaring them.
function menuItems(menu) {
  return [...menu.querySelectorAll("button")].filter((b) => !b.disabled);
}
function focusMenuItem(menu, index) {
  const items = menuItems(menu);
  if (!items.length) return;
  const i = (index + items.length) % items.length;
  items[i].focus();
}
// Called after a menu's contents are written, so the first item takes focus and
// the arrow keys have somewhere to start.
function focusMenu(menu) {
  const items = menuItems(menu);
  if (items.length) items[0].focus();
}
function wireMenuKeys(id, close) {
  const menu = $(id);
  if (!menu) return;
  menu.addEventListener("keydown", (e) => {
    const items = menuItems(menu);
    if (!items.length) return;
    const at = items.indexOf(document.activeElement);
    if (e.key === "ArrowDown") { e.preventDefault(); focusMenuItem(menu, at + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); focusMenuItem(menu, at - 1); }
    else if (e.key === "Home") { e.preventDefault(); focusMenuItem(menu, 0); }
    else if (e.key === "End") { e.preventDefault(); focusMenuItem(menu, items.length - 1); }
    else if (e.key === "Escape") { e.preventDefault(); close(); }
  });
}
wireMenuKeys("stopMenu", () => closeStopMenu());
wireMenuKeys("wakeMenu", () => closeWakeMenu());
wireMenuKeys("hopMenu", () => closeHopMenu());
wireMenuKeys("askMenu", () => closeAskMenu());

// ---- modal focus ----
// Tab used to walk straight out of the settings dialog and through the page
// behind it, and closing left focus on nothing.
let settingsOpener = null;
function trapSettingsTab(e) {
  if (e.key !== "Tab" || $("overlay").style.display === "none") return;
  const focusable = [...$("overlay").querySelectorAll(
    'button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])')]
    .filter((el) => !el.disabled && el.offsetParent !== null);
  if (!focusable.length) return;
  const first = focusable[0], last = focusable[focusable.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}
document.addEventListener("keydown", trapSettingsTab);

$("pills").addEventListener("click", async (e) => {
  const moon = e.target.closest(".moon");
  if (moon && state.summary) {
    const a = moon.dataset.seat;
    const ag = state.summary.agents[a] || {};
    const asleep = !!ag.asleep;
    if (asleep && ag.held > 0) {
      if ($("wakeMenu").classList.contains("open")) closeWakeMenu();
      else openWakeMenu(moon, a, ag.held);
      return;
    }
    closeWakeMenu();
    // Sleeping cancels what the lanes still owe this seat, so say so before it
    // happens rather than in a note afterwards.
    const owed = ((state.summary.queue) || []).filter((it) => (it.agents || []).includes(a)).length;
    if (!asleep && owed && !confirm(
      `${a} has ${owed} 条排队消息${owed === 1 ? "y" : "ies"}.\n\n` +
      `休眠将立即取消 ${owed === 1 ? "that" : "those"}；消息不会继续等待处于休眠的智能体。是否继续？`)) return;
    try {
      await api("/api/seat/sleep", { room: state.room, agent: a, asleep: !asleep });
      toast(asleep
        ? `☀ ${a} 已唤醒，没有重新发送历史请求`
        : `😴 ${a} 已休眠；唤醒前不会启动它`);
    } catch (err) { toast(err.message, true); }
    return;
  }
  const ear = e.target.closest(".ear");
  if (!ear || !state.summary) return;
  const a = ear.dataset.seat;
  const cur = !!state.summary.cfg.agents[a].lurk;
  try {
    await api("/api/config", { room: state.room, config: { agents: { [a]: { lurk: !cur } } } });
    toast(!cur ? `👂 ${a} 已开启旁听，会读到每轮交流并可能发言` : `${a} 已停止旁听`);
  } catch (err) { toast(err.message, true); }
});
document.querySelectorAll(".mbtn").forEach((b) => {
  b.onclick = async () => {
    const mode = b.dataset.m;
    if (!state.summary || (state.summary.cfg.mode || "talk") === mode) return;
    const pd = state.summary.cfg.projectDir;
    if (mode === "work" && pd &&
        !confirm(`⚠ 此聊天室关联了真实项目：\n${pd}\n\n工作模式允许已配置的智能体编辑该项目文件并运行命令。是否继续？`)) return;
    const anyLinked = state.summary.seats.some((a) => state.summary.agents[a].linked);
    if (!(mode === "work" && pd) && anyLinked &&
        !confirm(`是否切换到 ${mode === "work" ? "工作" : "对话"}模式？相关智能体将新建会话以应用权限变更，对话历史保留在记录中。`)) return;
    try { await api("/api/config", { room: state.room, config: { mode } }); refreshRooms(); }
    catch (e) { toast(e.message, true); }
  };
});
// Two different questions, and only one of them is about the button's blast
// radius. `working` — any chain mid-flight, including the gaps between its
// turns — decides whether Stop is offered at all, so the button doesn't blink
// out between an agent's reply and the follow-up it triggers. It is
// deliberately *absent* from the chooser test: `working` is true for every
// ordinary exchange, so ORing it in turned the commonest action in the room —
// one seat replying — into two clicks, and made the blast radius of a single
// click flip on sub-second timing the user cannot see. The chooser is for the
// questions a single click genuinely cannot answer: two seats running, work
// still queued, or a pair cycle larger than the turn on screen.
const stopIsChoice = (s) => (s.busy || []).length > 1 || (s.queued || 0) > 0 ||
  !!s.workingPair || !!s.queuePaused;

// The open menu is a snapshot of the moment it was opened. Status events land
// several times a second while agents work, and rebuilding the list under an
// aiming cursor moves the row out from under the click. So while it is open the
// row set and its order are frozen: work that ends goes disabled in place, work
// that starts waits for the next open.
let stopMenuShown = null;

// Five explicit intentions instead of one button and a guess: each seat on its
// own, the actives without the queue, the queue without the actives, and the
// blunt everything. Each entry says what survives it. The key is stable so an
// open menu can be reconciled instead of rebuilt.
function stopMenuRows(summary) {
  const active = summary.busy || [];
  const queued = summary.queued || 0;
  // Deliveries are what the lanes owe; messages are what the user sent. One
  // @both held for both seats is two deliveries and one message — so labels
  // count dispatches, never rows.
  const queuedMessages = summary.queuedDispatches === undefined ? queued : summary.queuedDispatches;
  const rows = active.map((a) => ({
    key: `seat:${a}`, cls: "stop-scope",
    attrs: `data-stop-scope="seat" data-stop-agent="${esc(a)}"`,
    html: `■ 停止 ${esc(seatLabel(a))}的当前回复`,
  }));
  if (active.length) rows.push({
    key: "active", cls: "stop-scope", attrs: `data-stop-scope="active"`,
    html: `■ Stop current responses<span class="sm-sub">保留排队任务</span>`,
  });
  const held = !!summary.queuePaused;
  // Not a stop scope: this row must never reach /api/stop.
  if (queued > 0 || held) rows.push({
    key: "hold", cls: "stop-scope", attrs: `data-queue-pause="${held ? "0" : "1"}"`,
    html: `${held ? "▶ 恢复队列" : "⏸ 暂停队列"}` +
      `<span class="sm-sub">${held
        ? "按顺序继续处理排队消息"
        : "不启动新任务，正在进行的回复会完成"}</span>`,
  });
  if (queued > 0) rows.push({
    key: "queue", cls: "stop-scope", attrs: `data-stop-scope="queue"`,
    html: `✕ 撤回 ${queuedMessages} 条排队消息${queuedMessages === 1 ? "" : ""}` +
      `<span class="sm-sub">保留正在进行的回复</span>`,
  });
  rows.push({
    key: "all", cls: "stop-all", attrs: `data-stop-scope="all"`,
    html: `■ Stop everything<span class="sm-sub">包括回复、配对任务、自动接续、旁听和队列</span>`,
  });
  return rows;
}

function stopMenuHTML(rows) {
  return rows.map((r) =>
    `<button role="menuitem" class="${r.cls}${r.gone ? " stop-gone" : ""}"` +
    `${r.gone ? " disabled" : ""} data-stop-key="${esc(r.key)}" ${r.attrs}>${r.html}</button>`).join("");
}

function renderStopMenu(s) {
  const live = stopMenuRows(s);
  if (stopMenuShown && $("stopWrap").classList.contains("open")) {
    const byKey = new Map(live.map((r) => [r.key, r]));
    // Order and membership are frozen. Only the label of a row already on
    // screen may change, and a row whose work ended is marked, never dropped.
    stopMenuShown = stopMenuShown.map((row) => {
      const next = byKey.get(row.key);
      return next ? { ...next, gone: false } : { ...row, gone: true };
    });
  } else {
    stopMenuShown = live;
  }
  const html = stopMenuHTML(stopMenuShown);
  const menu = $("stopMenu");
  // Most status events change nothing here. Writing innerHTML anyway restarted
  // hover and could interrupt a click already in flight.
  if (menu.dataset.sig === html) return;
  menu.dataset.sig = html;
  menu.innerHTML = html;
}

function closeStopMenu() {
  $("stopWrap").classList.remove("open");
  $("stopMore").setAttribute("aria-expanded", "false");
  stopMenuShown = null; // the snapshot dies with the menu
}
function openStopMenu() {
  stopMenuShown = null; // every open takes a fresh snapshot
  $("stopWrap").classList.add("open");
  $("stopMore").setAttribute("aria-expanded", "true");
  if (state.summary) renderStopMenu(state.summary);
  focusMenu($("stopMenu"));
}
function toggleStopMenu() {
  if ($("stopWrap").classList.contains("open")) closeStopMenu();
  else openStopMenu();
}

function updateBusyUI() {
  const summary = state.summary;
  const active = summary ? summary.busy : [];
  // Queued-but-idle counts: the queue is work the user asked for, and the menu
  // is where they cancel it without touching anything that is running.
  const visible = !!summary &&
    (active.length > 0 || summary.working || (summary.queued || 0) > 0 || !!summary.queuePaused);
  const wrap = $("stopWrap");
  wrap.style.display = visible ? "flex" : "none"; // sending stays allowed — messages queue
  if (!visible) { closeStopMenu(); return; }
  const choose = stopIsChoice(summary);
  // Say what the primary click will actually do. A run-pinned `active` stop
  // ends the chain the reply would have continued into, which is the part the
  // user cares about and the part a seat-scoped stop deliberately does not do.
  $("stopBtn").title = choose ? "选择要停止的内容" :
    active.length === 1
      ? `停止 ${seatLabel(active[0])}及其后续自动触发的回复`
      : "停止本轮讨论";
  renderStopMenu(summary);
}

// ---- queued work ----
function setQueue(n, items, dispatches, paused) {
  if (items) state.queue = items;
  if (state.summary) {
    state.summary.queued = n;
    if (dispatches !== undefined) state.summary.queuedDispatches = dispatches;
    if (paused !== undefined) state.summary.queuePaused = !!paused;
  }
  const held = !!(state.summary && state.summary.queuePaused);
  const shown = dispatches === undefined ? n : dispatches;
  const b = $("queueBadge");
  // An armed pause is never invisible: it survives an empty queue on purpose,
  // so the badge has to stay and say so, or the next message the user sends
  // would be held with nothing on screen explaining why.
  b.style.display = (n > 0 || held) ? "inline-flex" : "none";
  b.textContent = held ? (n > 0 ? `⏸ ${shown} 条暂存` : "⏸ 队列已暂停") : `⏳ ${shown} 条排队`;
  b.title = held
    ? "队列已暂停，恢复前不会启动新任务"
    : "查看待处理消息";
  if (n <= 0 && !held) closeQueuePop();
  else if ($("queueWrap").classList.contains("open")) renderQueuePop();
  // The Stop menu offers "cancel the queue" and counts what it would drop, so
  // it goes stale the moment the queue moves — including when the queue drains
  // on its own, with no status or summary event behind it.
  updateBusyUI();
}
function closeQueuePop() {
  const wrap = $("queueWrap");
  if (!wrap.classList.contains("open")) return;
  wrap.classList.remove("open");
  $("queueBadge").setAttribute("aria-expanded", "false");
}
// One card per dispatch, never per source message: a message that produced a
// second batch owes two independent things, and a single ✕ over both would
// cancel more than the user pointed at. Repeat dispatches from one message
// therefore render as sibling cards with the same snippet.
function queueGroups() {
  const groups = [], byKey = new Map();
  for (const item of state.queue || []) {
    const key = item.queueGroupId || `seq:${item.seq}`;
    let g = byKey.get(key);
    if (!g) {
      g = {
        key, groupId: item.queueGroupId, sourceN: item.sourceN,
        text: item.text, ts: item.ts, target: item.target, head: false, rows: [],
      };
      byKey.set(key, g);
      groups.push(g);
    }
    // Otherwise a redirect appears above work the user sent earlier with
    // nothing on the card explaining why.
    g.head = g.head || !!item.head;
    for (const a of item.agents) {
      g.rows.push({ agent: a, pos: (item.positions || {})[a] || 0, kind: item.kind });
    }
  }
  return groups;
}
function queueCardHTML(g) {
  // Whatever this dispatch's source already has running belongs on the same
  // card — the point of the view is the whole life of one thing you sent.
  // Match on the dispatch, not the source message: two dispatches from one
  // message share a rootN, and matching on that would let both cards claim the
  // same running seat. Older runs without an id simply do not match.
  const running = ((state.summary && state.summary.busyInfo) || [])
    .filter((b) => !!g.groupId && b.queueGroupId === g.groupId);
  const runRows = running.map((b) =>
    `<span class="qp-row running"><i class="bs-dot" style="background:${esc(seatColor(b.agent))}"></i>` +
    `${esc(seatLabel(b.agent))} ${esc(RUNNING_VERB[b.phase] || "responding")}</span>`);
  // Position survives a hold — that is exactly what pause preserves — so the
  // "#3" suffix stays in both wordings.
  const held = !!(state.summary && state.summary.queuePaused);
  const waitRows = g.rows.map((r) =>
    `<span class="qp-row"><i class="bs-dot" style="background:${esc(seatColor(r.agent))}"></i>` +
    `${esc(seatLabel(r.agent))} ${r.kind === "cycle"
      ? (held ? "配对任务已暂存" : "配对任务已排队")
      : (held ? "已暂存" : "已排队")}` +
    `${r.pos ? ` #${r.pos}` : ""}</span>`);
  const meta = [g.head ? "↪ next" : "", hhmm(g.ts), g.target ? `@${g.target}` : ""]
    .filter(Boolean).join(" · ");
  return `<div class="qp-card${held ? " paused" : ""}">` +
    `<div class="qp-top">` +
    `<button class="qp-src"${g.sourceN === null || g.sourceN === undefined ? "" : ` data-jump-n="${esc(String(g.sourceN))}"`} title="跳转到这条消息">` +
    `<span class="qp-snip">${esc(g.text || "（无文本）")}</span><span class="qp-meta">${esc(meta)}</span></button>` +
    (g.groupId ? `<button class="qp-x" data-cancel-group="${esc(g.groupId)}" ` +
      `title="撤回此消息尚未开始的任务；正在进行的任务会继续">✕</button>` : "") +
    `</div><div class="qp-rows">${runRows.join("")}${waitRows.join("")}</div></div>`;
}
function renderQueuePop() {
  const groups = queueGroups();
  const held = !!(state.summary && state.summary.queuePaused);
  const head = `<div class="qp-head"><span>${held ? "已由你暂停" : "待处理任务"}</span>` +
    `<span class="qp-actions">` +
    `<button class="qp-pause" data-queue-pause="${held ? "0" : "1"}" title="${held
      ? "按顺序恢复处理排队任务"
      : "暂存所有等待中的任务，正在进行的回复会完成，消息不会丢失"}">` +
    `${held ? "▶ 恢复" : "⏸ 暂停"}</button>` +
    (groups.length
      ? `<button data-cancel-group="" title="撤回全部排队任务，正在进行的回复会继续">撤回全部排队任务</button>`
      : "") +
    `</span></div>`;
  $("queuePop").innerHTML = head + (groups.length
    ? groups.map(queueCardHTML).join("")
    : `<div class="qp-empty">${held
      ? "没有等待中的任务；现在发送的消息会被暂存。"
      : "没有等待中的任务。"}</div>`);
}
$("queueBadge").onclick = (e) => {
  e.stopPropagation();
  const wrap = $("queueWrap");
  const open = !wrap.classList.contains("open");
  wrap.classList.toggle("open", open);
  $("queueBadge").setAttribute("aria-expanded", String(open));
  if (open) renderQueuePop();
};
$("queuePop").addEventListener("click", async (e) => {
  const hold = e.target.closest("[data-queue-pause]");
  if (hold) return setQueuePaused(hold.dataset.queuePause === "1");
  const btn = e.target.closest("[data-cancel-group]");
  if (!btn) return;
  const groupId = btn.dataset.cancelGroup;
  try {
    const r = await api("/api/queue/cancel", { room: state.room, ...(groupId ? { groupId } : {}) });
    // Already drained is not a failure: what the user asked to be gone is gone.
    toast(r.cancelled ? `已撤回 ${r.cancelled} 条排队消息${r.cancelled === 1 ? "y" : "ies"}.`
      : "该任务已经不在队列中。");
  } catch (err) { toast(err.message, true); }
});
function guessTextTarget(raw) {
  const text = String(raw || "").trim();
  if (!text || !state.summary) return null;
  const seats = state.summary.seats;
  // Mirror server textTarget exactly. User text routing is intentionally
  // separate from the masked agent-mention grammar used for automatic calls.
  const alt = seats.map((s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const tags = new Set([...text.matchAll(new RegExp(`@(${alt}|both)\\b`, "gi"))].map((m) => m[1].toLowerCase()));
  if (tags.has("both") || seats.every((s) => tags.has(s))) return "both";
  const lead = new RegExp(`^[*_~]*@(${alt})\\b[*_~]*[\\s:,]*`, "i").exec(text);
  if (lead) return lead[1].toLowerCase();
  for (const s of seats) if (tags.has(s)) return s;
  return null;
}
function seatAsleep(a) {
  const s = state.summary;
  return !!(s && s.agents && s.agents[a] && s.agents[a].asleep);
}
// The send succeeds either way now — this says *when* the answer arrives, so
// the user is not left waiting on a seat that will not reply until it is woken.
function sleepHint(targets) {
  const dozing = targets.filter(seatAsleep);
  if (!dozing.length) return "";
  if (dozing.length === targets.length) return ` · 😴 ${dozing.join(" + ")} 休眠中，等待唤醒后送达`;
  return ` · 😴 暂存给 ${dozing.join(" + ")}，等待唤醒`;
}
function normalizedHopBudget(value, fallback = -1) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < -1) return fallback;
  return n;
}
function roomHopBudget() {
  return normalizedHopBudget(state.summary && state.summary.cfg && state.summary.cfg.hopBudget, -1);
}
function hopSafetyLimit() {
  const value = state.summary && state.summary.hopSafetyLimit;
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}
function automaticAccounting() { return state.summary?.cfg?.accounting === "automatic"; }
function accountingLabel() { return automaticAccounting() ? "自动轮次" : "额外接续"; }
function hopBudgetLabel(value) { return Number(value) === -1 ? "直到讨论结束" : String(value); }
function effectiveHopLimit(budget, limit) {
  if (Number.isSafeInteger(limit) && limit >= 0) return limit;
  const safety = hopSafetyLimit();
  return budget < 0 ? safety : budget;
}
function hopBudgetDetail(value) {
  const budget = normalizedHopBudget(value, -1);
  if (automaticAccounting()) return budget < 0 ? `安全上限 ${hopSafetyLimit() ?? "unknown"} 个自动轮次／消息`
    : `最多 ${budget} 个额外自动轮次；首次指定的回复不计入`;
  const safety = hopSafetyLimit();
  if (budget === -1) return safety === null ? "暂时无法获取服务安全上限" : `安全上限 ${safety} 次接续／消息`;
  if (budget === 0) return "不额外接续；已安排的附带发送和回答返回仍可能完成";
  const effective = effectiveHopLimit(budget);
  return `最多 ${effective} 次额外接续${effective === 1 ? "" : ""}` +
    (effective < budget ? ` (configured ${budget}；服务安全上限 ${effective})` : "");
}
function draftRoute() {
  const s = state.summary;
  if (!s) return null;
  const raw = $("input").value.trim();
  const explicit = guessTextTarget(raw);
  if (/^\/pair\b/i.test(raw)) return { pair: true, command: true };
  if (raw.startsWith("/")) return { command: true };
  if (s.pair && !explicit) return { pair: true, ...s.pair };
  let target = explicit || (state.chip !== "auto" ? state.chip : (s.lastAddressed || s.cfg.defaultAgent));
  if (target !== "both" && !s.cfg.agents[target]) target = s.seats[0];
  const targets = target === "both" ? s.seats : [target];
  const enabledListeners = s.seats.filter((a) => !targets.includes(a) && !seatAsleep(a) && s.cfg.agents[a].lurk);
  const listeners = enabledListeners.filter((a) => s.agents[a].liveLurkEligible === true);
  const listenerEligibilityKnown = enabledListeners.every((a) => typeof s.agents[a].liveLurkEligible === "boolean");
  return { target, targets, listeners, listenerEligibilityKnown };
}
function freshTurnEstimate(choice, route = draftRoute()) {
  if (!route || route.command || route.pair) return null;
  if (choice === "solo") return route.target === "both" ? null : 1;
  if (route.target !== "both" && route.listenerEligibilityKnown === false) return null;
  const budget = choice === "default" ? roomHopBudget() : normalizedHopBudget(choice);
  const limit = effectiveHopLimit(budget);
  if (limit === null) return null;
  if (automaticAccounting()) return (route.target === "both" ? 2 : 1) + limit;
  return (route.target === "both" ? 5 : route.listeners.length ? 4 : 1) + 2 * limit;
}
function renderHopProjections() {
  const route = draftRoute();
  document.querySelectorAll("#hopMenu [data-hop-choice]").forEach((option) => {
    const choice = option.dataset.hopChoice;
    const estimate = freshTurnEstimate(choice, route);
    const budget = choice === "default" ? roomHopBudget() : normalizedHopBudget(choice);
    const detail = choice === "solo" ? "只有指定的智能体回复，另一位不会自动回应。"
      : `${hopBudgetLabel(budget)}: ${hopBudgetDetail(budget)}.`;
    option.setAttribute("aria-label", choice === "solo" ? "单人模式" : `${accountingLabel()}: ${detail}`);
    option.title = detail + (estimate === null ? " 配对轮次或命令规则适用，无法估算。"
      : ` 对于一条新的独立消息，预计最多 ${estimate} 个智能体轮次。` + (automaticAccounting()
        ? "每次自动启动都计次，包括失败和未发言的情况；不保证完成一轮完整讨论。"
        : "附带发送和回答返回不计入额度。"));
    if (choice === "default") {
      $("hopRoomDefault").textContent = `额外额度 ${hopBudgetLabel(budget)}，让双方继续交流。`;
    } else if (choice === "solo") {
      const note = option.querySelector(".hm-sub");
      if (note) note.textContent = "只有你指定的那一位回复，另一位暂停参与。";
    } else {
      option.innerHTML = `<b>${esc(hopBudgetLabel(choice))}</b><span class="hm-sub">` +
        (Number(choice) < 0 ? `${hopSafetyLimit() === null ? "暂时无法获取安全上限" : `安全上限 ${hopSafetyLimit()}`} · ` : "") +
        `${estimate === null ? "无法估算" : `最多 ${estimate} turn${estimate === 1 ? "" : ""}`}</span>`;
    }
  });
  const estimate = freshTurnEstimate(state.hopChoice, route);
  $("hopProjection").textContent = route && route.pair ? "配对模式使用审查轮次，此处的接续设置不控制配对流程。"
    : estimate === null ? "当前草稿无法估算，或仍在等待服务提供安全上限。"
      : `对于一条新的独立消息，预计最多 ${estimate} 个智能体轮次。合并或延迟补读可涵盖多条消息，因此这不代表总消耗，也不保证剩余轮数。`;
}
function pairControlOnly(raw, hasAttachments = false) {
  if (hasAttachments) return false;
  const text = String(raw || "").trim();
  if (!/^\/pair\b/i.test(text)) return false;
  if (/^\/pair\s+(?:end|stop|off)\b/i.test(text)) return true;
  let body = text.replace(/^\/pair\b\s*/i, "").replace(/^start\b\s*/i, "");
  // Match parsePair(): a rounds token must end at whitespace or end-of-input,
  // never at `@`; `start3` likewise remains task text.
  body = body.replace(/^\d{1,2}(?:\s+|$)/, "").trim();
  const target = guessTextTarget(body);
  if (target && target !== "both") {
    // Mirror textTarget's leading-tag grammar, including Markdown emphasis.
    body = body.replace(new RegExp(`^[*_~]*@${target}\\b[*_~]*[\\s:,]*`, "i"), "").trim();
  }
  return !body;
}
function soloTargetProblem(raw, hasAttachments = false) {
  if (state.hopChoice !== "solo" || !state.summary) return "";
  const text = String(raw || "").trim();
  if (/^\/pair\b/i.test(text) && !pairControlOnly(text, hasAttachments)) {
    return "单人模式不能启动或执行配对任务，请选择“聊天室默认”或设置接续额度。";
  }
  const explicit = guessTextTarget(text);
  if (explicit === "both") return "单人模式只能指定一位接收者；请勿使用 @both 或同时提及两位。";
  if (state.summary.pair && !explicit && !text.startsWith("/")) {
    return "配对模式下使用单人模式，需要明确 @ 一位智能体。";
  }
  const target = explicit
    || (state.chip !== "auto" ? state.chip : (state.summary.lastAddressed || state.summary.cfg.defaultAgent));
  return target === "both" ? "单人模式需要选择一位接收者。" : "";
}
function closeHopMenu() {
  const wrap = $("hopWrap");
  if (!wrap) return;
  wrap.classList.remove("open");
  $("hopAdvanced").open=false;
  $("hopBtn").setAttribute("aria-expanded", "false");
}
function openHopMenu() {
  const wrap = $("hopWrap"), btn = $("hopBtn"), menu = $("hopMenu");
  wrap.classList.add("open");
  btn.setAttribute("aria-expanded", "true");
  const r = btn.getBoundingClientRect();
  const w = menu.offsetWidth, h = menu.offsetHeight;
  menu.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - w - 8))}px`;
  menu.style.top = `${Math.max(8, r.top - h - 7)}px`;
}
$("hopAdvanced").addEventListener('toggle',()=>{if($("hopWrap").classList.contains('open'))openHopMenu();});
function renderHopControl() {
  $("hopAccountingNote").textContent = "仅在当前聊天室和浏览器会话中记住。" +
    (automaticAccounting() ? "每次自动启动都计次；首次指定的回复不计入；返回回答也会计次。"
      : "此聊天室仍采用旧计次方式，一次计次请求可附带免费的回答返回。可在设置中切换为“自动轮次”，按每次自动启动计次。") +
    "这不是 token 或费用上限。";
  const roomBudget = roomHopBudget();
  const choice = state.hopChoice;
  const btn = $("hopBtn");
  $("hopBtnLabel").textContent = choice === "solo" ? "单人交流" : `自动接续 · 额外额度 ${hopBudgetLabel(choice === 'default'?roomBudget:choice)}${choice !== "default" ? " · 临时" : ""}`;
  btn.classList.toggle("override", choice !== "default");
  btn.title = choice === "solo"
    ? "当前聊天室和浏览器会话保持单人模式：只有指定的智能体回复，另一位不旁听、不回应，但后续仍可阅读对话记录。"
    : choice === "default"
      ? `聊天室默认（${hopBudgetLabel(roomBudget)}): ${hopBudgetDetail(roomBudget)}.`
      : `当前聊天室和浏览器会话的选择（${hopBudgetLabel(choice)}): ${hopBudgetDetail(choice)}.`;
  $("hopRoomDefault").textContent = `额外额度 ${hopBudgetLabel(roomBudget)}，让双方继续交流。`;
  $("hopOverrideNote").textContent = choice === "default" ? `使用聊天室默认：${hopBudgetLabel(roomBudget)}`
    : `本条消息设置：${choice === "solo" ? "单人模式" : hopBudgetLabel(choice)} · 聊天室默认：${hopBudgetLabel(roomBudget)}`;
  document.querySelectorAll("#hopMenu [data-hop-choice]").forEach((option) => {
    option.setAttribute("aria-checked", String(option.dataset.hopChoice === choice));
  });

  const both = document.querySelector('.chip[data-t="both"]');
  if (both) {
    both.disabled = choice === "solo";
    both.title = choice === "solo"
      ? "单人模式只能选一位智能体。另一位不会回应，但后续仍可阅读对话记录。"
      : "发送给两位智能体";
  }

  // Solo cannot inherit @both. Fall back to Auto—not a particular seat—so
  // Maple keeps its normal routing rule instead of quietly choosing the first
  // provider in the list. Explicit @both text remains intact and is blocked at
  // Send; only the selected routing chip changes here.
  if (choice === "solo" && state.chip === "both") {
    state.chipRevision++;
    selectChip("auto");
  }

  const runs = state.summary && Array.isArray(state.summary.hopRuns) ? state.summary.hopRuns : [];
  const run = runs.length ? runs[runs.length - 1] : null;
  const progress = $("hopProgress");
  if (!run) {
    progress.hidden = true;
    progress.classList.remove("capped");
    progress.textContent = "";
  } else {
    const used = Math.max(0, Number(run.used) || 0);
    const budget = normalizedHopBudget(run.budget, -1);
    const capped = run.phase === "capped" || run.phase === "safety";
    const capNote = capped ? (run.phase === "safety" || budget === -1 ? " · 已触及安全上限" : " · 已达上限") : "";
    progress.hidden = false;
    progress.classList.toggle("capped", capped);
    const limit = effectiveHopLimit(budget, run.limit);
    const source = policySourceLabel(run.source);
    const safety = budget < 0 || (limit !== null && limit < budget);
    progress.textContent = `${run.accounting === "automatic" ? "自动轮次" : "额外接续"} ${used}/${limit === null ? "?" : limit}${safety ? " · 安全上限" : ""}${capNote}`;
    progress.title = `本轮讨论${run.rootN == null ? "" : `（消息 ${run.rootN})`}开始时采用 ` +
      `${budget === -1 ? "“直到讨论结束”规则（设有安全上限）" : `上限为 ${budget}`} ` +
      `from ${source}，已启动 ${used} ${run.accounting === "automatic" ? "自动轮次" : "次计入额度的接续"}${used === 1 ? "" : ""}` +
      (capped ? (budget === -1 ? "，已达到安全上限" : "，已达到设定上限") : "") +
      "。修改输入框旁的快捷设置仅影响后续消息，不改变当前讨论。";
  }
  renderHopProjections();
}
function selectHopChoice(choice) {
  const normalized = choice === "default" || choice === "solo"
    ? choice : String(normalizedHopBudget(choice, -1));
  state.hopChoice = normalized;
  rememberHopChoice(state.room, normalized);
  closeHopMenu();
  renderHopControl();
  updateRouteHint();
}
$("hopBtn").onclick = () => {
  if ($("hopWrap").classList.contains("open")) closeHopMenu();
  else openHopMenu();
};
$("hopMenu").addEventListener("click", (e) => {
  const option = e.target.closest("[data-hop-choice]");
  if (!option) return;
  selectHopChoice(option.dataset.hopChoice);
  input.focus();
});
window.addEventListener("resize", closeHopMenu);
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeHopMenu(); });
function updateRouteHint() {
  if (!state.summary) return;
  renderHopProjections();
  const raw = $("input").value;
  const explicit = guessTextTarget(raw);
  const pair = state.summary.pair;
  const soloProblem = soloTargetProblem(raw, !!(state.draftImages.length || state.draftFiles.length));
  const soloPairCommand = !!soloProblem && /^\/pair\b/i.test(raw.trim()) &&
    !/^\/pair\s+(?:end|stop|off)\b/i.test(raw.trim());
  $("routeHint").classList.toggle("warn", !!soloProblem);
  if (pair && !explicit && !raw.trim().startsWith("/")) {
    const dozing = [pair.worker, pair.reviewer].filter(seatAsleep);
    $("routeHint").textContent = `→ ${seatLabel(pair.worker)} · 🔁 ${seatLabel(pair.reviewer)} 审查 · ${pairRoundsLabel(pair.rounds)}` +
      (soloProblem ? " · ⚠ 单人模式需要明确 @ 一位智能体" :
        dozing.length ? ` · 😴 ${dozing.join(" + ")} 休眠中；配对需要双方都处于唤醒状态` : "");
    return;
  }
  const t = explicit
    || (state.chip !== "auto" ? state.chip : (state.summary.lastAddressed || state.summary.cfg.defaultAgent));
  const selectedBudget = state.hopChoice === "default" ? roomHopBudget() : normalizedHopBudget(state.hopChoice);
  const liveListeners = state.summary.seats.filter((a) => a !== t && t !== "both" && !seatAsleep(a) && state.summary.cfg.agents[a].lurk);
  const behavior = state.hopChoice === "solo" ? "单人模式"
    : t === "both" ? ((state.summary.cfg.mode || "talk") === "work" ? "讨论（不修改文件）" : "讨论")
      : liveListeners.length ? `${liveListeners.map(seatLabel).join(" + ")} 可能旁听并回应`
        : effectiveHopLimit(selectedBudget) === 0 ? "另一位不自动回应" : "被点名时另一位会回应";
  const disc = state.hopChoice==='solo'?' · 单人交流':t==='both'?' · 双方交流':'';
  const targets = t === "both" ? state.summary.seats : [t];
  $("routeHint").textContent = "→ " + (t === "both" ? state.summary.seats.map(seatLabel).join(" + ") : seatLabel(t)) +
    disc + (soloProblem
      ? (soloPairCommand ? " · ⚠ 单人模式无法执行配对任务" : " · ⚠ 单人模式需要选择一位智能体")
      : sleepHint(targets));
  $("routeHint").title=behavior+(state.hopChoice==='solo'?'':` · 额外额度 ${hopBudgetLabel(selectedBudget)}`);
}
function selectChip(target) {
  if (state.hopChoice === "solo" && String(target) === "both") return false;
  const chips = [...document.querySelectorAll(".chip")];
  const chip = chips.find((candidate) => candidate.dataset.t === String(target));
  if (!chip) return false;
  state.chip = String(target);
  chips.forEach((x) => x.classList.toggle("active", x === chip));
  updateRouteHint();
  return true;
}
$("pairEndBtn").onclick = async () => {
  try { await api("/api/message", { room: state.room, text: "/pair end", target: "auto" }); }
  catch (e) { toast(e.message, true); }
};

// ------------------------------------------------------------ SSE
function followRoomRename(from, to) {
  if (state.room !== from && state.room !== to) return false;
  const changed = state.room !== to;
  state.room = to;
  if(changed)window.dispatchEvent(new Event('parley-room-changed'));
  if (changed) state.eventVersion++;
  if (state.summary) state.summary.name = to;
  $("roomTitle").textContent = to;
  history.replaceState(null, "", to === "default" ? location.pathname : "?room=" + encodeURIComponent(to));

  let streamRoom = null;
  try { streamRoom = state.es ? new URL(state.es.url, location.href).searchParams.get("room") : null; }
  catch { /* an absent or malformed stream URL is simply reconnected below */ }
  if (streamRoom !== to) {
    state.resyncVersion++;
    connect(true);
  }
  return true;
}

function connect(resyncOnOpen = false) {
  if (state.es) {
    const old = state.es;
    state.es = null;
    old.close();
  }
  const es = new EventSource(withToken("/api/events?room=" + encodeURIComponent(state.room)));
  state.es = es;
  let wasDown = false;
  let needsResync = resyncOnOpen;
  es.onopen = () => {
    if (state.es !== es) return;
    $("connDot").classList.add("on");
    // Entries can land while the stream is down; re-pull rather than silently
    // showing a transcript with a hole in it.
    if (wasDown || needsResync) {
      wasDown = false;
      needsResync = false;
      refreshAfterGap();
    }
  };
  es.onerror = () => {
    if (state.es !== es) return;
    wasDown = true;
    $("connDot").classList.remove("on");
  };
  es.onmessage = (ev) => {
    if (state.es !== es) return;
    const msg = JSON.parse(ev.data);
    state.eventVersion++;
    if (msg.type === "entry") addEntry(msg.entry);
    else if (msg.type === "receipt") addReceipt(msg.receipt);
    else if (msg.type === "queue") {
      setQueue(msg.size, msg.items, msg.dispatches, msg.paused);
    }
    else if (msg.type === "lurk") whisper(msg.agent, msg.error, msg.hop, msg.skipped, msg.asleep, msg.held, msg.queued, msg.attention);
    else if (msg.type === "status") {
      state.statusSeq[msg.agent] = (state.statusSeq[msg.agent] || 0) + 1;
      if (state.summary) { // keep busy state truthful between room summaries
        const b = state.summary.busy || [];
        if (msg.phase === "done") state.summary.busy = b.filter((x) => x !== msg.agent);
        else if (!b.includes(msg.agent)) b.push(msg.agent);
        // busyInfo tracks the same set with the provenance attached, so it has
        // to move in step or the quote header outlives the run it describes.
        const info = (state.summary.busyInfo || []).filter((x) => x.agent !== msg.agent);
        if (msg.phase !== "done") {
          info.push({
            agent: msg.agent, runId: msg.runId || null, phase: msg.phase,
            startedAt: msg.startedAt,
            rootN: msg.rootN === undefined ? null : msg.rootN,
            sourceN: msg.sourceN === undefined ? null : msg.sourceN,
            // Without this a delayed delivery could not show as "responding"
            // on its own queue card until the next full room summary.
            queueGroupId: msg.queueGroupId || null,
            source: msg.source || null,
            deliveryKind: msg.deliveryKind || null,
            delivery: msg.delivery || null,
            relayLaunch: msg.relayLaunch || null,
            catchUp: msg.catchUp || null,
          });
        }
        state.summary.busyInfo = info;
        const pill = $("pill_" + msg.agent);
        if (pill) pill.classList.toggle("busy", state.summary.busy.includes(msg.agent));
        updateBusyUI();
      }
      if (msg.phase === "retrying") {
        const l = ensureLive(msg.agent, msg.startedAt);
        l.el.querySelector(".live-label").innerHTML = `正在恢复会话 <span class="elapsed">${elapsedLabel(l)}</span>`;
        // The stream flush only rewrites the label on the think→stream
        // transition now, so reset the mode or the retry label would stick
        // through the restored session's whole streamed reply.
        l.mode = "think";
      } else if (msg.phase === "done") removeLive(msg.agent);
      else ensureLive(msg.agent, msg.startedAt, liveLabelFor(msg.phase));
      applyLiveRef(msg.agent);
      renderBusyStrip();
      if ($("queueWrap").classList.contains("open")) renderQueuePop();
    }
    else if (msg.type === "stream") liveStream(msg.agent, msg);
    else if (msg.type === "room") {
      applySummary(msg.room);
    }
    else if (msg.type === "reset") {
      state.resyncVersion++;
      clearDraftAttachments();
      clearAttachmentUrls();
      clearLive();
      state.entries = [];
      state.receipts = [];
      state.queue = [];
      state.liveVisible = {};
      closeQueuePop();
      state.renderFromN = null;
      state.expandedMessages.clear();
      state.expandedActivity.clear();
      renderAll({ preserveTransient: false });
      toast("新对话已开始，上一段对话已归档。");
    }
    else if (msg.type === "renamed") {
      // The live stream survives the rename (it's held on the room object),
      // but its URL still carries the old name — so reconnect, or the next
      // dropout would reconnect to a name that no longer exists.
      followRoomRename(msg.from, msg.to);
      refreshRooms().catch((e) => toast(e.message, true));
    }
  };
}

// ------------------------------------------------------------ load room
// What a first run needs to know before anything is spent. An unauthenticated
// CLI used to surface as an opaque exit code on the first real message, which is
// the worst possible moment to find out.
async function refreshDoctor(roomName) {
  try {
    const d = await api("/api/doctor?room=" + encodeURIComponent(roomName));
    if (state.room !== roomName) return;
    state.doctor = d.seats || {};
    const bad = Object.entries(state.doctor).filter(([, h]) => !h.ok);
    const banner = $("setupBanner");
    if (!bad.length) { banner.style.display = "none"; return; }
    banner.innerHTML = bad.map(([seat, h]) =>
      `<div><b>${esc(seatLabel(seat))} 尚未就绪</b> — ${esc(h.detail)}. ${esc(h.how)}</div>`).join("");
    banner.style.display = "block";
    if (state.summary) applySummary(state.summary); // repaint the pills
  } catch { /* the room still works; the pills carry what they know */ }
}

async function loadRoom(name) {
  retireSettingsPick(); // a folder dialog open for the old room must not land here
  let data;
  try {
    data = await api("/api/room?name=" + encodeURIComponent(name));
  } catch (e) {
    if (name === "default") throw e;
    toast(`聊天室“${name}”已不存在，正在打开默认聊天室。`, true);
    return loadRoom("default");
  }
  if (state.es) {
    const old = state.es;
    state.es = null;
    old.close();
  }
  $("connDot").classList.remove("on");
  clearDraftAttachments();
  clearAttachmentUrls();
  state.resyncVersion++;
  state.eventVersion++;
  const roomName = data.room.name || name;
  if (roomName !== state.room) {
    closeHopMenu();
    state.hopChoice = storedHopChoice(roomName);
  }
  state.room = roomName;
  window.dispatchEvent(new Event('parley-room-changed'));
  refreshDoctor(roomName);
  history.replaceState(null, "", roomName === "default" ? location.pathname : "?room=" + encodeURIComponent(roomName));
  // Keep an explicit destination if it exists in the destination room. Only a
  // genuinely stale seat id falls back to automatic routing.
  const validChips = new Set(["auto", "both", ...(data.room.seats || [])]);
  if (!validChips.has(state.chip)) state.chip = "auto";
  clearLive();
  closeQueuePop();
  state.entries = data.entries;
  state.receipts = data.receipts || [];
  state.queue = data.room.queue || [];
  state.liveVisible = {};
  state.expandedMessages.clear();
  state.expandedActivity.clear();
  state.renderFromN = state.entries.length > INITIAL_ENTRY_LIMIT
    ? state.entries[state.entries.length - INITIAL_ENTRY_LIMIT].n
    : null;
  // Entry rendering (avatars and receipt dots) needs the destination room's
  // provider catalog and seats, not the room we just left.
  state.summary = data.room;
  state.providers = data.room.providers || state.providers;
  renderAll({ preserveTransient: false });
  applySummary(data.room);
  // Opening a room can itself resume a persisted lurk catch-up. Re-pull once
  // the event stream is attached so an unusually fast catch-up cannot finish
  // in the GET→SSE gap and leave this tab with a stale entry/receipt snapshot.
  connect(true);
  await refreshRooms();
}

// After the event stream was down, pull the room again so anything that
// happened during the gap appears without a manual refresh.
async function refreshAfterGap() {
  const room = state.room;
  const eventVersion = state.eventVersion;
  const resyncVersion = ++state.resyncVersion;
  const seqBefore = { ...state.statusSeq };
  try {
    const data = await api("/api/room?name=" + encodeURIComponent(room));
    if (state.room !== room || state.resyncVersion !== resyncVersion) return;
    // The stream is already live while this fetch is in flight. Merge by turn
    // number (live state wins on duplicates) so its arrivals cannot be lost.
    state.entries = mergeEntries(data.entries, state.entries);
    state.receipts = mergeReceipts(data.receipts, state.receipts);
    renderAll({ stickToBottom: nearBottom(), anchor: true });
    // A seat that finished during the outage: its reply is in the snapshot
    // but its "done" was never heard, so its live bubble would sit right
    // below its own finished reply — ticking "is replying · 4m32s" — until
    // the next room summary, which arrives when the OTHER seat finishes,
    // minutes later in a work turn. If no status event for that seat has
    // arrived since this fetch began, the snapshot is the freshest word on it.
    const busyNow = new Set(data.room.busy || []);
    let pruned = false;
    for (const a of Object.keys(state.live)) {
      if (busyNow.has(a) || (state.statusSeq[a] || 0) !== (seqBefore[a] || 0)) continue;
      removeLive(a);
      pruned = true;
      if (state.summary) {
        state.summary.busy = (state.summary.busy || []).filter((x) => x !== a);
        state.summary.busyInfo = (state.summary.busyInfo || []).filter((x) => x.agent !== a);
      }
      const pill = $("pill_" + a);
      if (pill) pill.classList.remove("busy");
    }
    if (pruned) updateBusyUI();
    // Any SSE message is newer live evidence: status, queue, stream, whisper,
    // entry, receipt, reset and rename alike. Never replace it with this fetch.
    if (state.eventVersion === eventVersion) applySummary(data.room);
  } catch { /* the room may have gone; loadRoom's own error path handles that */ }
}
async function refreshRooms() {
  const data = await api("/api/rooms");
  state.providers = data.providers || state.providers;
  fillSeatPickers();
  const list = $("roomList");
  list.innerHTML = "";
  for (const r of data.rooms) {
    const name = typeof r === "string" ? r : r.name;
    const mode = typeof r === "string" ? "talk" : r.mode;
    const linked = typeof r === "string" ? false : r.linked;
    const seats = (typeof r === "string" ? null : r.seats) || [];
    const nonDefault = seats.length && seats.join(",") !== "claude,codex";
    // The listing carries each seat's provider, because a room in the sidebar
    // is not the open room and seatMeta has no summary to resolve against.
    const rowProviders = (typeof r === "string" ? null : r.providers) || {};
    const rowAvatar = (a) => {
      const p = state.providers[rowProviders[a] || a];
      return (p && p.avatar) || String(a)[0].toUpperCase();
    };
    const seatTag = nonDefault
      ? `<span style="font-size:10px;opacity:.7">${seats.map(rowAvatar).join("+")}</span>`
      : "";
    // A row, not one big button: the rename and delete controls have to be real
    // buttons to be reachable by keyboard, and nesting a button inside a button
    // is invalid — which is why they used to be unfocusable spans revealed only
    // on hover, leaving no keyboard path to either action.
    const row = document.createElement("div");
    row.className = "room-item" + (name === state.room ? " active" : "");
    row.innerHTML =
      `<button type="button" class="ropen"><span class="dot"></span>` +
      `<span style="flex:1;overflow:hidden;text-overflow:ellipsis;text-align:left">${esc(name)}</span>` +
      `<span class="rmeta">${seatTag}${linked ? "📁" : ""}${mode === "work" ? "🔨" : ""}</span></button>` +
      `<span class="racts"><button type="button" class="ract" data-act="rename" title="重命名聊天室" aria-label="重命名 ${esc(name)}">✎</button>` +
      // the default room is the app's fallback; it can be emptied, not removed
      (name === "default" ? "" : `<button type="button" class="ract del" data-act="delete" title="删除聊天室" aria-label="删除 ${esc(name)}">✕</button>`) +
      `</span>`;
    row.onclick = (e) => {
      const act = e.target.closest(".ract");
      if (!act) { setNavOpen(false); return loadRoom(name); }
      e.stopPropagation();
      if (act.dataset.act === "rename") renameFlow(name); else deleteFlow(name);
    };
    list.appendChild(row);
  }
}
// New-room seat pickers: pre-filled with the default pair, visible so the
// choice is discoverable, never a required step.
function fillSeatPickers() {
  const ids = Object.keys(state.providers);
  if (!ids.length || $("seat1").options.length) return;
  for (const [sel, def] of [[$("seat1"), "claude"], [$("seat2"), "codex"]]) {
    sel.innerHTML = ids.map((p) => `<option value="${esc(p)}">${esc(state.providers[p].label)}</option>`).join("");
    sel.value = ids.includes(def) ? def : ids[sel === $("seat2") ? 1 : 0] || ids[0];
    sel.onchange = syncSeatNames;
  }
  syncSeatNames();
}
// Two seats may run the same provider — what has to differ is their names,
// because a seat id is its @mention, its config key and the author on every
// line it writes. The name fields only appear when they are actually needed;
// picking two different providers keeps the form exactly as it was.
function syncSeatNames() {
  const p1 = $("seat1").value, p2 = $("seat2").value;
  const same = !!p1 && p1 === p2;
  $("seatNames").style.display = same ? "flex" : "none";
  $("seatNamesHint").style.display = same ? "block" : "none";
  if (!same) return;
  // Prefill rather than demand: "claude" and "claude2" are a fine default, and
  // anyone who wants "opus"/"sonnet" can just type over them.
  if (!$("seat1Name").value.trim()) $("seat1Name").value = p1;
  if (!$("seat2Name").value.trim()) $("seat2Name").value = p2 + "2";
  $("seat1Name").placeholder = p1;
  $("seat2Name").placeholder = p2 + "2";
}
// Mirrors the server's rule so the message names the problem instead of
// bouncing back a 400. The server still validates; this is only the wording.
const RESERVED_SEAT_NAMES = new Set(["both", "user", "system", "all", "none"]);
function seatNameIssue(id) {
  if (!/^[a-z][a-z0-9-]{0,19}$/.test(id)) {
    return `"${id}”：名称需以字母开头，只能包含小写字母、数字和短横线。`;
  }
  if (RESERVED_SEAT_NAMES.has(id)) return `"${id}”是保留名称，会与消息路由冲突。`;
  return null;
}

// ------------------------------------------------------------ composer
const input = $("input");
const PASTE_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const PASTE_IMAGE_EXTENSIONS = new Map([
  ["png", "image/png"], ["jpg", "image/jpeg"], ["jpeg", "image/jpeg"],
  ["gif", "image/gif"], ["webp", "image/webp"],
]);
const PASTE_IMAGE_MAX = 4;
const ATTACHMENT_MAX = 8;
const ATTACHMENT_BYTES = 5 * 1024 * 1024;
const ATTACHMENT_TOTAL = 6 * 1024 * 1024;

function draftAttachmentCount() {
  return state.draftImages.length + state.draftFiles.length;
}

function draftAttachmentBytes() {
  return [...state.draftImages, ...state.draftFiles].reduce((n, draft) => n + draft.file.size, 0);
}

function nativeImageMime(file) {
  const type = String(file.type || "").toLowerCase();
  if (PASTE_IMAGE_TYPES.has(type)) return type;
  if (type) return null;
  const match = /\.([^.]+)$/.exec(String(file.name || "").toLowerCase());
  return match ? PASTE_IMAGE_EXTENSIONS.get(match[1]) || null : null;
}

function renderDraftAttachments() {
  const row = $("draftImages");
  row.innerHTML = "";
  row.classList.toggle("show", draftAttachmentCount() > 0);
  for (const draft of state.draftImages) {
    const item = document.createElement("div");
    item.className = "draft-image";
    item.title = draft.file.name || "粘贴的图片";
    const img = document.createElement("img");
    img.src = draft.url;
    img.alt = draft.file.name || "粘贴的图片";
    const remove = document.createElement("button");
    remove.type = "button";
    remove.title = "移除图片";
    remove.textContent = "×";
    remove.onclick = () => clearDraftImages([draft.id]);
    item.append(img, remove);
    row.appendChild(item);
  }
  for (const draft of state.draftFiles) {
    const item = document.createElement("div");
    item.className = "draft-file";
    item.title = draft.file.name || "附件";
    const icon = document.createElement("span");
    icon.className = "draft-file-icon";
    icon.textContent = "📄";
    const copy = document.createElement("span");
    copy.className = "draft-file-copy";
    const name = document.createElement("span");
    name.className = "draft-file-name";
    name.textContent = draft.file.name || "附件";
    const size = document.createElement("span");
    size.className = "draft-file-size";
    size.textContent = formatBytes(draft.file.size);
    copy.append(name, size);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.title = "移除文件";
    remove.textContent = "×";
    remove.onclick = () => clearDraftFiles([draft.id]);
    item.append(icon, copy, remove);
    row.appendChild(item);
  }
}

function clearDraftImages(ids = null) {
  const remove = ids ? new Set(ids) : null;
  const keep = [];
  for (const draft of state.draftImages) {
    if (!remove || remove.has(draft.id)) URL.revokeObjectURL(draft.url);
    else keep.push(draft);
  }
  state.draftImages = keep;
  renderDraftAttachments();
}

function clearDraftFiles(ids = null) {
  const remove = ids ? new Set(ids) : null;
  state.draftFiles = remove ? state.draftFiles.filter((draft) => !remove.has(draft.id)) : [];
  renderDraftAttachments();
}

function clearDraftAttachments() {
  for (const draft of state.draftImages) URL.revokeObjectURL(draft.url);
  state.draftImages = [];
  state.draftFiles = [];
  renderDraftAttachments();
}

function addDraftImages(files) {
  for (const file of files) {
    const mime = nativeImageMime(file);
    if (!mime) {
      toast("请粘贴 PNG、JPEG、GIF 或 WebP 图片。", true);
      continue;
    }
    if (file.size > ATTACHMENT_BYTES) {
      toast("每个附件不得超过 5 MB。", true);
      continue;
    }
    if (state.draftImages.length >= PASTE_IMAGE_MAX) {
      toast("每条消息最多附加 4 张图片。", true);
      break;
    }
    if (draftAttachmentCount() >= ATTACHMENT_MAX) {
      toast("每条消息最多附加 8 个文件（含图片）。", true);
      break;
    }
    if (draftAttachmentBytes() + file.size > ATTACHMENT_TOTAL) {
      toast("附件总大小不得超过 6 MB。", true);
      continue;
    }
    state.draftImages.push({ id: crypto.randomUUID(), file, mime, url: URL.createObjectURL(file) });
  }
  renderDraftAttachments();
}

function addDraftFiles(files) {
  for (const file of files) {
    if (nativeImageMime(file)) {
      addDraftImages([file]);
      continue;
    }
    if (file.size > ATTACHMENT_BYTES) {
      toast("每个附件不得超过 5 MB。", true);
      continue;
    }
    if (draftAttachmentCount() >= ATTACHMENT_MAX) {
      toast("每条消息最多附加 8 个文件（含图片）。", true);
      break;
    }
    if (draftAttachmentBytes() + file.size > ATTACHMENT_TOTAL) {
      toast("附件总大小不得超过 6 MB。", true);
      continue;
    }
    state.draftFiles.push({ id: crypto.randomUUID(), file });
  }
  renderDraftAttachments();
}

function fileBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`无法读取 ${file.name || "附件"}.`));
    reader.onload = () => {
      const value = String(reader.result || "");
      const comma = value.indexOf(",");
      if (comma < 0) return reject(new Error(`无法读取 ${file.name || "附件"}.`));
      resolve(value.slice(comma + 1));
    };
    reader.readAsDataURL(file);
  });
}

function autosize() { input.style.height = "auto"; input.style.height = Math.min(input.scrollHeight, 200) + "px"; }
input.addEventListener("input", () => { autosize(); updateRouteHint(); mentionCheck(); });

// Local slash commands; /pair goes to the server, the rest resolve here.
function localSystemNote(html) {
  const d = document.createElement("div");
  d.className = "sysmsg";
  d.innerHTML = html;
  chat.appendChild(d);
  scrollBottom(true);
}
async function handleSlash(text) {
  const cmd = (text.split(/\s+/)[0] || "").toLowerCase();
  const rest = text.slice(cmd.length).trim();
  if (cmd === "/pair") return false; // server handles
  if (cmd === "/note") {
    try {
      await api("/api/config", { room: state.room, config: { roomNote: rest || null } });
      toast(rest ? "📌 已设置聊天室备注，双方每轮都能看到。" : "📌 已清除聊天室备注。");
    } catch (e) { toast(e.message, true); }
    return true;
  }
  // The 😴 pill toggles with one click, which is what the motivating case (you
  // just saw a 429) wants. The command exists for the optional reason, which
  // is worth recording when it's a quota rather than a passing hiccup.
  if (cmd === "/sleep" || cmd === "/wake") {
    const seats = (state.summary && state.summary.seats) || [];
    const named = /^@?([a-z0-9_-]+)/i.exec(rest);
    const agent = named && seats.includes(named[1].toLowerCase()) ? named[1].toLowerCase() : null;
    if (!agent) {
      localSystemNote(`请选择智能体，例如 <b>${esc(cmd)} @${esc(seats[0] || "claude")}</b>` +
        (cmd === "/sleep" ? " <i>可选原因</i>" : ""));
      return true;
    }
    const reason = rest.slice(named[0].length).trim();
    try {
      const res = await api("/api/seat/sleep", {
        room: state.room, agent, asleep: cmd === "/sleep",
        ...(cmd === "/sleep" && reason ? { reason } : {}),
      });
      // /wake stays wake-only: one command, one outcome, and no menu here to
      // pick the other. Say what that means for anything held rather than
      // letting the user assume it was answered — the ☀ menu on the pill is
      // where Wake & deliver lives.
      toast(cmd === "/sleep"
        ? `😴 ${agent} 已休眠${reason ? ` — ${reason}` : ""}`
        : res.held
          ? `☀ ${agent} 已唤醒，${res.held} 条待处理消息${res.held === 1 ? "" : ""} ${res.held === 1 ? "is" : "are"} 将作为普通上下文，不会重新执行请求`
          : `☀ ${agent} 已唤醒，没有重新发送历史请求`);
    } catch (e) { toast(e.message, true); }
    return true;
  }
  if (cmd === "/summarize") {
    input.value = (rest ? rest + " " : "") + "请简要总结当前聊天室的讨论：已作出的决定、未解决的问题和下一步。";
    await send();
    return true;
  }
  if (cmd === "/help") {
    localSystemNote(
      "<b>消息发给谁：</b>使用 @claude、@codex、@both 指定对象；同时提及两位会发给双方；不加 @ 时沿用上次的对象<br>" +
      "<b>智能体交接：</b>@名称 会发起交接；当对方正在旁听或你的消息发给双方时，直接点名（如“Codex，…”）也可交接<br>" +
      "<b>/pair start @agent [任务]</b> — 配对模式：指定的智能体执行，另一位审查你的每条消息<br>" +
      "<b>/pair end</b> — 结束配对模式，也可点击顶部横幅中的结束按钮<br>" +
      "<b>/note [说明]</b> — 设置双方每轮都能看到的聊天室备注；不写内容则清除<br>" +
      "<b>/sleep @agent [原因]</b> — 让指定智能体休眠；使用 <b>/wake @agent</b> 唤醒<br>" +
      "<b>/summarize [@agent]</b> — 请智能体总结当前对话<br>" +
      "<b>👂</b> = 旁听 · <b>😴</b> = 休眠／唤醒 · <b>💬／🔨</b> = 对话／工作模式 · 消息下的小圆点表示哪些智能体已读到内容");
    return true;
  }
  localSystemNote(`未知命令 <b>${esc(cmd)}</b> — try <b>/help</b>`);
  return true;
}

async function send() {
  const text = input.value.trim();
  const imageDrafts = [...state.draftImages];
  const fileDrafts = [...state.draftFiles];
  if ((!text && !imageDrafts.length && !fileDrafts.length) || state.sending) return;
  if (window.mapleConsensus?.enabled()) {
    if (imageDrafts.length || fileDrafts.length) return toast("共识协商目前仅支持文字任务，请先移除附件。", true);
    state.sending = true; $("sendBtn").disabled = true;
    const room = state.room;
    try {
      await window.mapleConsensus.start(text);
      if (state.room === room && input.value.trim() === text) { input.value = ""; autosize(); hideMention(); }
    } catch (e) { toast(e.message, true); }
    finally { state.sending = false; $("sendBtn").disabled = false; }
    return;
  }
  if (text.startsWith("/") && (imageDrafts.length || fileDrafts.length) && !/^\/pair\b/i.test(text)) {
    toast("附件可随普通消息或 /pair 任务发送，不能附在本地斜杠命令上。", true);
    return;
  }
  const sentRoom = state.room;
  const sentTarget = state.chip;
  const sentResync = state.resyncVersion;
  const chipRevision = state.chipRevision;
  const sentHopChoice = state.hopChoice;
  const sendVersion = ++state.sendVersion;
  const relayControlOnly = pairControlOnly(text, !!(imageDrafts.length || fileDrafts.length));
  if (text.startsWith("/")) {
    const problem = /^\/pair\b/i.test(text)
      ? soloTargetProblem(text, !!(imageDrafts.length || fileDrafts.length)) : "";
    if (problem) { toast(problem, true); return; }
    input.value = ""; autosize(); hideMention();
    const handled = await handleSlash(text);
    if (handled) return;
  } else {
    const problem = soloTargetProblem(text);
    if (problem) { toast(problem, true); return; }
    input.value = ""; autosize(); hideMention();
  }
  state.sending = true;
  $("sendBtn").disabled = true;
  try {
    const images = await Promise.all(imageDrafts.map(async (draft) => ({
      name: draft.file.name || "pasted-image",
      mime: draft.mime || draft.file.type,
      data: await fileBase64(draft.file),
    })));
    const files = await Promise.all(fileDrafts.map(async (draft) => ({
      name: draft.file.name || "attachment",
      mime: draft.file.type || "application/octet-stream",
      data: await fileBase64(draft.file),
    })));
    const body = { room: sentRoom, text, target: sentTarget, images, files };
    // Pair controls append no user turn, so they do not transmit the sticky
    // relay shortcut. Every accepted user message snapshots the current choice.
    if (!relayControlOnly && sentHopChoice === "solo") body.solo = true;
    else if (!relayControlOnly && sentHopChoice !== "default") {
      body.hopBudget = normalizedHopBudget(sentHopChoice, -1);
    }
    const r = await api("/api/message", body);
    clearDraftImages(imageDrafts.map((draft) => draft.id));
    clearDraftFiles(fileDrafts.map((draft) => draft.id));
    if (r.explicit && r.target && state.room === sentRoom && state.resyncVersion === sentResync &&
        state.chipRevision === chipRevision && state.sendVersion === sendVersion) {
      selectChip(r.target);
    }
    if (r.queued) toast(`⏳ 已排队（#${r.position}），目标智能体空闲后自动发送。`);
    // Partly delivered: the free seat is already answering, the busy one is next.
    else if (r.deferred && r.deferred.length) {
      toast(`⏳ ${r.deferred.join(" and ")} 仍在忙碌，空闲后立即送达。`);
    }
  } catch (e) {
    toast(e.message, true);
    if (state.room === sentRoom && !input.value.trim()) { input.value = text; autosize(); }
  } finally {
    state.sending = false;
    $("sendBtn").disabled = false;
  }
}
$("sendBtn").onclick = send;
$("attachBtn").onclick = () => {
  if (state.sending) return toast("请等待当前消息发送完成。", true);
  $("fileInput").click();
};
$("fileInput").addEventListener("change", (e) => {
  const files = [...(e.target.files || [])];
  e.target.value = ""; // allow choosing the same file again after removing it
  if (!files.length) return;
  if (state.sending) return toast("请等待当前消息发送完成。", true);
  addDraftFiles(files);
});
function dragCarriesFiles(e) {
  const transfer = e && e.dataTransfer;
  return !!transfer && ((transfer.files && transfer.files.length > 0) ||
    Array.from(transfer.types || []).includes("Files"));
}
// Without cancelling the browser's default file-drop behaviour, Chrome
// navigates away from Maple and opens the dropped file. Keep the whole window
// safe as a target, then feed the exact same validation path as the paperclip.
window.addEventListener("dragover", (e) => {
  if (!dragCarriesFiles(e)) return;
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
});
window.addEventListener("drop", (e) => {
  if (!dragCarriesFiles(e)) return;
  e.preventDefault();
  const files = [...(e.dataTransfer.files || [])];
  if (!files.length) return;
  if (state.sending) return toast("请等待当前消息发送完成。", true);
  addDraftFiles(files);
});
// Naming the run pins the click to the response the user was looking at, so a
// slow click can never land on the next one. If that response has already
// ended the server says so and this returns quietly — an error toast there is
// exactly what makes someone press Stop a second time.
async function stopResponses(scope, agent) {
  closeStopMenu();
  const info = agent ? busyInfoFor(agent) : null;
  // "Stop the current responses" means the ones on screen when it was clicked.
  // Between the click and the request landing, a run can finish and the queue
  // can start the next one in that seat; unpinned, that is what would die.
  const pinned = scope === "active"
    ? ((state.summary && state.summary.busyInfo) || [])
      .filter((b) => b.runId).map((b) => ({ agent: b.agent, runId: b.runId }))
    : null;
  try {
    const r = await api("/api/stop", {
      room: state.room, scope,
      ...(agent ? { agent } : {}),
      ...(info && info.runId ? { runId: info.runId } : {}),
      ...(pinned ? { runs: pinned } : {}),
    });
    if (r && r.stale) return; // already over; the user's intent already holds
    if (scope === "queue") {
      toast(r && r.cancelled
        ? `已撤回 ${r.cancelled} 条排队消息${r.cancelled === 1 ? "y" : "ies"}；正在进行的回复会继续。`
        : "队列中已没有待处理任务。");
    }
  } catch (e) { toast(e.message, true); }
}
// A hold, not a stop: nothing is dropped, reordered or abandoned, and running
// responses finish. Shared by the Stop menu row and the queue popover.
async function setQueuePaused(paused) {
  closeStopMenu();
  try {
    const r = await api("/api/queue/pause", { room: state.room, paused });
    setQueue(r.queued, undefined, r.dispatches, r.paused);
    toast(r.paused
      ? "队列已暂停；正在进行的回复会完成，新消息将被暂存。"
      : "队列已恢复。");
  } catch (e) { toast(e.message, true); }
}
// One click, one meaning. With a single response running and nothing queued the
// primary stops exactly that run — pinned to its runId, `active` scope, so the
// chain it would have continued into stops with it rather than hopping on after
// the reply the user just killed. It never widens: a second seat, queued work or
// a pair cycle each raise a question one click cannot answer, and those open the
// chooser. In the gap between a reply and the hop it triggers there is no run to
// name, so the only honest meaning left is the room-wide line — and the queue is
// empty there by construction, because queued work would have opened the chooser
// instead of reaching this branch.
$("stopBtn").onclick = () => {
  if (!state.summary) return;
  if (stopIsChoice(state.summary)) return toggleStopMenu();
  const active = state.summary.busy || [];
  return active.length === 1 ? stopResponses("active", null) : stopResponses("all", null);
};
// The deliberate scopes stay one click away whatever the primary does —
// seat-only is otherwise unreachable now that one busy seat stops directly.
$("stopMore").onclick = () => { if (state.summary) toggleStopMenu(); };
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeStopMenu(); });
$("stopMenu").onclick = (e) => {
  const hold = e.target.closest("[data-queue-pause]");
  if (hold && !hold.disabled) return setQueuePaused(hold.dataset.queuePause === "1");
  const choice = e.target.closest("[data-stop-scope]");
  // A row whose run ended while the menu was open is disabled where it stands.
  if (!choice || choice.disabled) return;
  stopResponses(choice.dataset.stopScope, choice.dataset.stopAgent || null);
};
input.addEventListener("keydown", (e) => {
  if (mentionKeydown(e)) return;
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
});
input.addEventListener("paste", (e) => {
  const items = [...(e.clipboardData && e.clipboardData.items || [])];
  const files = items.filter((item) => item.kind === "file" && /^image\//i.test(item.type || ""))
    .map((item) => item.getAsFile()).filter(Boolean);
  if (!files.length) return; // leave ordinary text paste to the browser
  e.preventDefault();
  if (state.sending) return toast("请等待当前消息发送完成。", true);
  addDraftImages(files);
});

$("chipsRow").addEventListener("click", (e) => {
  const c = e.target.closest(".chip");
  if (!c) return;
  state.chipRevision++;
  selectChip(c.dataset.t);
  input.focus();
});
$("starters").addEventListener("click", (e) => {
  const s = e.target.closest(".starter");
  if (!s) return;
  input.value = s.dataset.fill; autosize(); input.focus(); updateRouteHint();
});

// mention popover — options come from the room's seats
function mentionOptions() {
  const seats = state.summary ? state.summary.seats : [];
  return [
    ...seats.map((a) => ({ tag: "@" + a, color: seatColor(a) })),
    { tag: "@both", color: "var(--user)" },
  ];
}
let mItems = [], mSel = 0;
function mentionCheck() {
  const pos = input.selectionStart;
  const before = input.value.slice(0, pos);
  const m = /(^|\s)@([a-z0-9]*)$/i.exec(before);
  if (!m) return hideMention();
  const prefix = m[2].toLowerCase();
  mItems = mentionOptions().filter((x) => x.tag.slice(1).startsWith(prefix));
  if (!mItems.length) return hideMention();
  mSel = 0;
  const el = $("mention");
  el.innerHTML = mItems.map((x, i) =>
    `<button data-i="${i}" class="${i === 0 ? "sel" : ""}"><span class="mdot" style="background:${x.color}"></span>${x.tag}</button>`).join("");
  el.style.display = "block";
  el.querySelectorAll("button").forEach((b) => { b.onclick = () => pickMention(+b.dataset.i); });
}
function hideMention() { $("mention").style.display = "none"; mItems = []; }
function pickMention(i) {
  const pos = input.selectionStart;
  const before = input.value.slice(0, pos).replace(/@[a-z0-9]*$/i, mItems[i].tag + " ");
  input.value = before + input.value.slice(pos);
  input.selectionStart = input.selectionEnd = before.length;
  hideMention(); updateRouteHint(); input.focus();
}
function mentionKeydown(e) {
  if (!mItems.length) return false;
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    mSel = (mSel + (e.key === "ArrowDown" ? 1 : mItems.length - 1)) % mItems.length;
    $("mention").querySelectorAll("button").forEach((b, i) => b.classList.toggle("sel", i === mSel));
    e.preventDefault(); return true;
  }
  if (e.key === "Enter" || e.key === "Tab") { pickMention(mSel); e.preventDefault(); return true; }
  if (e.key === "Escape") { hideMention(); return true; }
  return false;
}

// ------------------------------------------------------------ rooms sidebar
$("addRoomBtn").onclick = () => {
  clearNewRoomProject(); // a fresh form never inherits the last one's folder
  $("seat1Name").value = ""; $("seat2Name").value = "";
  syncSeatNames();
  $("newRoomForm").style.display = "block";
  $("newRoomInput").focus();
};
let newRoomProjectDir = null;
// The OS dialog isn't modal to this page, so the form can be submitted while it
// is still open. Each pick is stamped, and anything that ends the form's life
// moves the stamp on: a result that arrives after that belongs to a form the
// user already finished with, and must not seed the next room's folder.
let newRoomPick = 0;
function clearNewRoomProject() {
  newRoomPick++;
  newRoomProjectDir = null;
  $("newRoomProjVal").textContent = "";
  $("newRoomProj").style.color = "var(--text-faint)";
}
$("newRoomProj").onclick = async () => {
  const pick = ++newRoomPick;
  const r = await browseFolder(null, $("newRoomProj"));
  if (pick !== newRoomPick || !r) return; // superseded while the dialog was open
  newRoomProjectDir = r;
  $("newRoomProjVal").textContent = "— " + r.split(/[\\/]/).pop();
  $("newRoomProj").style.color = "var(--text-dim)";
};
$("newRoomForm").onsubmit = async (e) => {
  e.preventDefault();
  const name = $("newRoomInput").value.trim();
  if (!name) return;
  const providers = [$("seat1").value, $("seat2").value].filter(Boolean);
  let seats = providers;
  if (providers.length === 2 && providers[0] === providers[1]) {
    // Same provider twice is a real room; the names are what distinguish them.
    const ids = [$("seat1Name").value.trim().toLowerCase() || providers[0],
      $("seat2Name").value.trim().toLowerCase() || providers[1] + "2"];
    if (ids[0] === ids[1]) return toast("请为两位智能体设置不同的名称。", true);
    const issue = ids.map(seatNameIssue).find(Boolean);
    if (issue) return toast(issue, true);
    seats = ids.map((id, i) => ({ id, provider: providers[i] }));
  }
  const body = { name };
  if (seats.length === 2) body.seats = seats;
  if (newRoomProjectDir) body.projectDir = newRoomProjectDir;
  // Retire this form's pick: a dialog still open belongs to the room being
  // created now, not to whatever is typed next. The chosen folder itself is
  // only cleared on success — a rejected name leaves the form up, and the user
  // shouldn't have to pick their project again to fix a typo.
  newRoomPick++;
  const asReview = $("newRoomReviewChk").checked;
  try {
    await api("/api/rooms", body);
    // The flagship workflow used to take four separate actions to assemble:
    // create, flip to work, turn on the reviewer's ear, then find lurkStyle.
    // As a preset it is one checkbox — configured after creation so the room
    // exists to configure, and reported rather than silently half-applied.
    const reviewerId = typeof seats[1] === "string" ? seats[1] : (seats[1] || {}).id;
    if (asReview && seats.length === 2 && reviewerId) {
      try {
        await api("/api/config", {
          room: name,
          config: { mode: "work", agents: { [reviewerId]: { lurk: true, lurkStyle: "balanced" } } },
        });
      } catch (err) { toast(`聊天室已创建，但审查预设未能应用：${err.message}`, true); }
    }
    $("newRoomInput").value = "";
    $("seat1Name").value = ""; $("seat2Name").value = "";
    $("newRoomReviewChk").checked = false;
    $("newRoomForm").style.display = "none";
    clearNewRoomProject();
    await loadRoom(name);
  } catch (err) { toast(err.message, true); }
};
// Ask the server to open the OS folder dialog; returns a path or null.
// The dialog is modal on the desktop but not in this page, so the button that
// opened it is held down until it closes — otherwise a second click stacks
// another dialog behind the first.
// The "Choosing…" swap touches a dedicated label span, never the button's own
// contents. One of these buttons also holds a live element (#newRoomProjVal)
// that other code writes to while the dialog is open — rewriting the button's
// text destroys it, and the next write to it throws.
async function browseFolder(start, btn) {
  const label = btn && btn.querySelector("[data-picker-label]");
  const original = label && label.textContent;
  if (btn) { btn.disabled = true; if (label) label.textContent = "正在选择…"; }
  toast("正在打开文件夹选择窗口… 如果它被其他窗口挡住，请从任务栏打开“Maple — Choose a project folder”。");
  try {
    const r = await api("/api/pickfolder", { start: start || null });
    if (r.error) { toast(r.error, true); return null; }
    return r.cancelled ? null : r.path;
  } catch (e) { toast(e.message, true); return null; }
  finally { if (btn) { btn.disabled = false; if (label) label.textContent = original; } }
}
$("s_browse").onclick = async () => {
  const pick = ++settingsPick;
  const openedFor = state.room;
  const picked = await browseFolder($("s_projdir").value.trim() || null, $("s_browse"));
  if (pick !== settingsPick || state.room !== openedFor || !picked) return;
  $("s_projdir").value = picked;
};
$("openWs").onclick = () => api("/api/open", { room: state.room, what: "workspace" })
  .then(() => toast("📁 已在文件资源管理器中打开工作区；若未显示，请查看任务栏。"))
  .catch((e) => toast(e.message, true));
$("openRoomDir").onclick = () => api("/api/open", { room: state.room, what: "room" })
  .then(() => toast("🗂️ 已在文件资源管理器中打开聊天室文件夹；若未显示，请查看任务栏。"))
  .catch((e) => toast(e.message, true));

// ------------------------------------------------------------ settings modal
// Seat cards render from the provider catalog: each provider declares which
// fields it understands, so a new provider's settings appear automatically.
function seatFieldHTML(a, field, p) {
  const d = (n, f) => `data-seat="${esc(a)}" data-f="${f}"`;
  if (field === "command") return `<div class="fld"><label>启动命令</label><input ${d(a, "command")} spellcheck="false"></div>`;
  // Model and effort are comboboxes, not fixed lists: the suggestions are a
  // convenience, but anything you type is passed straight to the CLI — so
  // models and effort levels released after this build still work.
  // Suggestions show the provider's own wording ("Extra High"), while the
  // value written into the field is what the CLI takes ("xhigh"). A custom
  // popup is used instead of <datalist>: native datalists filter by the
  // selected value, so reopening one can hide every other choice.
  const combo = (fieldName, list, placeholder) => {
    const id = `combo_${a}_${fieldName}`;
    const choices = (list || []).map((o, i) => {
      const detail = [o.label !== o.value ? zhUiLabel(o.label) : "", zhUiLabel(o.hint || "")].filter(Boolean).join(" — ");
      return `<button type="button" class="freecombo-option" role="option" id="${esc(id)}_${i}" ` +
        `data-combo-value="${esc(o.value)}"><b>${esc(o.value)}</b>` +
        `${detail ? `<span>${esc(detail)}</span>` : ""}</button>`;
    }).join("");
    return `<div class="freecombo">` +
      `<input class="freecombo-input" ${d(a, fieldName)} spellcheck="false" autocomplete="off" ` +
      `role="combobox" aria-autocomplete="list" aria-haspopup="listbox" aria-expanded="false" ` +
      `aria-controls="${esc(id)}" placeholder="${esc(placeholder)}">` +
      `<button type="button" class="freecombo-toggle" aria-label="显示全部建议" title="显示全部建议">▾</button>` +
      `<div class="freecombo-menu" id="${esc(id)}" role="listbox" hidden>${choices}` +
      `<div class="freecombo-empty" hidden>没有匹配的建议，你仍可使用自己输入的值。</div></div></div>`;
  };
  if (field === "model") return `<div class="fld"><label>自定义模型名称（可选）</label>` +
    combo("model", p.models, "留空使用 CLI 默认模型") +
    `<div class="note">可输入 CLI 支持的模型别名或完整名称。</div></div>`;
  if (field === "effort") return `<div class="fld"><label>思考强度</label>` +
    combo("effort", p.efforts, "留空使用默认值") + `</div>`;
  if (field === "permissionMode") return `<div class="fld"><label>权限模式</label><select ${d(a, "permissionMode")}>` +
    `<option value="auto">默认：对话保守，工作可编辑</option>` +
    `<option value="smart">自动审批：由 Claude 判断常规操作，保留风险检查</option>` +
    `<option value="plan">计划模式：仅读取和建议，工作模式下也不修改</option>` +
    `<option value="acceptEdits">允许编辑：可修改普通项目文件，受保护路径和命令仍可能要求确认</option>` +
    `<option value="bypassPermissions">完全访问：绕过 Claude 常规权限检查</option></select>` +
    `<div class="note">权限模式实际改变后，会新建 Claude 会话；聊天室历史保留在对话记录中。</div>` +
    `<div class="note danger">Claude Code 2.1.126 及以上版本的完全访问权限包含 .git 等受保护路径，也可访问项目以外的文件。明确策略和系统权限仍可能限制操作。建议在隔离容器或虚拟机中使用；直接在本机使用相当于授予系统账户可用范围内的访问权限。</div></div>`;
  if (field === "approvalMode") return `<div class="fld"><label>确认方式</label><select ${d(a, "approvalMode")}>` +
    `<option value="auto">聊天室默认：对话模式使用 Gemini 默认设置，工作模式自动允许编辑</option>` +
    `<option value="plan">计划模式：仅读取和建议，工作模式下也不修改</option>` +
    `<option value="auto_edit">自动编辑：编辑自动获准，其他工具仍需确认</option>` +
    `<option value="yolo">完全访问：自动允许所有工具调用</option></select>` +
    `<div class="note">权限模式实际改变后，会新建 Gemini 会话；聊天室历史保留在对话记录中。</div>` +
    `<div class="note danger">完全访问会自动允许所有工具调用，包括运行命令及修改项目以外的文件，建议仅在隔离容器或虚拟机中使用。</div></div>`;
  if (field === "sandbox") return `<div class="fld"><label>访问范围</label><select ${d(a, "sandbox")}>` +
    `<option value="read-only">只读（默认）</option><option value="workspace-write">可写工作区（workspace-write）</option>` +
    `<option value="danger-full-access">完全访问（danger-full-access）</option></select>` +
    `<div class="note">更改此设置会重新建立该智能体的会话。</div></div>`;
  if (field === "extraArgs") return `<div class="fld"><label>额外 CLI 参数</label><input ${d(a, "extraArgs")} spellcheck="false"></div>`;
  return "";
}
function setFreeComboOpen(combo, open, query = "") {
  const input = combo.querySelector(".freecombo-input");
  const menu = combo.querySelector(".freecombo-menu");
  if (open) {
    document.querySelectorAll(".freecombo.open").forEach((other) => {
      if (other !== combo) setFreeComboOpen(other, false);
    });
  }
  const needle = String(query).trim().toLowerCase();
  let visible = 0;
  combo.querySelectorAll(".freecombo-option").forEach((option) => {
    const show = !needle || option.textContent.toLowerCase().includes(needle);
    option.hidden = !show;
    option.classList.remove("active");
    option.classList.toggle("selected", option.dataset.comboValue === input.value);
    if (show) visible++;
  });
  combo.querySelector(".freecombo-empty").hidden = visible > 0;
  combo.classList.toggle("open", open);
  menu.hidden = !open;
  if (open) menu.scrollTop = 0;
  input.setAttribute("aria-expanded", String(open));
  input.removeAttribute("aria-activedescendant");
}
function chooseFreeCombo(option) {
  const combo = option.closest(".freecombo");
  const input = combo.querySelector(".freecombo-input");
  input.value = option.dataset.comboValue;
  input.dispatchEvent(new Event("change", { bubbles: true }));
  setFreeComboOpen(combo, false);
  input.focus();
}
$("seatCards").addEventListener("click", (e) => {
  const toggle = e.target.closest(".freecombo-toggle");
  if (toggle) {
    const combo = toggle.closest(".freecombo");
    const opening = !combo.classList.contains("open");
    setFreeComboOpen(combo, opening, ""); // the arrow always shows the full list
    if (opening) combo.querySelector(".freecombo-input").focus();
    return;
  }
  const option = e.target.closest(".freecombo-option");
  if (option) chooseFreeCombo(option);
});
$("seatCards").addEventListener("input", (e) => {
  const input = e.target.closest(".freecombo-input");
  if (input) setFreeComboOpen(input.closest(".freecombo"), true, input.value);
});
$("seatCards").addEventListener("keydown", (e) => {
  const input = e.target.closest(".freecombo-input");
  if (!input) return;
  const combo = input.closest(".freecombo");
  if (e.key === "Escape") {
    if (combo.classList.contains("open")) {
      e.preventDefault();
      e.stopPropagation();
      setFreeComboOpen(combo, false);
    }
    return;
  }
  if (e.key === "Enter") {
    const active = combo.querySelector(".freecombo-option.active:not([hidden])");
    if (active) { e.preventDefault(); chooseFreeCombo(active); }
    return;
  }
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
  e.preventDefault();
  if (!combo.classList.contains("open")) setFreeComboOpen(combo, true, "");
  const options = [...combo.querySelectorAll(".freecombo-option:not([hidden])")];
  if (!options.length) return;
  const current = options.findIndex((option) => option.classList.contains("active"));
  const next = current < 0
    ? (e.key === "ArrowDown" ? 0 : options.length - 1)
    : (current + (e.key === "ArrowDown" ? 1 : options.length - 1)) % options.length;
  options.forEach((option, i) => option.classList.toggle("active", i === next));
  input.setAttribute("aria-activedescendant", options[next].id);
  options[next].scrollIntoView({ block: "nearest" });
});
document.addEventListener("click", (e) => {
  if (!e.target.closest(".freecombo")) {
    document.querySelectorAll(".freecombo.open").forEach((combo) => setFreeComboOpen(combo, false));
  }
});
function renderSeatCards(s) {
  $("seatCards").innerHTML = s.seats.map((a) => {
    const p = (s.seatInfo && s.seatInfo[a]) || s.providers[a] || {};
    const ag = s.agents[a];
    let f = (p.fields || []).map((field) => seatFieldHTML(a, field, p)).join("");
    f += `<div class="fld"><label>旁听发言程度（开启 👂 时）</label><select data-seat="${esc(a)}" data-f="lurkStyle">` +
      `<option value="quiet">安静：只指出尚未纠正的错误</option>` +
      `<option value="balanced">适中：错误、分歧、关键提醒</option>` +
      `<option value="vocal">积极：有实质价值时就发言</option></select></div>`;
    f += `<div class="fld"><label>自定义旁听发言条件（可选，覆盖预设；[pass] 协议保留）</label>` +
      `<input data-seat="${esc(a)}" data-f="lurkPrompt" placeholder="例如：有实质分歧时再补充发言。" spellcheck="false"></div>`;
    const sess = ag.linked
      ? `已关联会话（${ag.sessionRef}…），已读到第 ${ag.cursor}.`
      : "尚无会话，发送下一条消息时创建。";
    return `<div class="mgroup"><h3><span class="agc" style="color:${seatColor(a)}">${esc(seatLabel(a))}</span> · ${esc(zhUiLabel(p.sub || ""))}</h3>${f}<div class="sess">${sess}</div></div>`;
  }).join("");
  for (const a of s.seats) {
    for (const el of document.querySelectorAll(`#seatCards [data-seat="${a}"][data-f]`)) {
      const v = s.cfg.agents[a][el.dataset.f];
      el.value = el.dataset.f === "extraArgs" ? (v || []).join(" ") : (v ?? "");
    }
  }
}
// The folder dialog is not modal to this page, so Settings can be closed,
// saved, or pointed at a different room while it is still open. Every one of
// those retires the stamp, and a result that comes back against a retired stamp
// is dropped rather than written into whatever room is on screen by then.
let settingsPick = 0;
function retireSettingsPick() { settingsPick++; }
function closeSettings() {
  retireSettingsPick();
  $("overlay").classList.remove("open");
  // Closing a dialog used to leave focus on nothing at all.
  if (settingsOpener && document.contains(settingsOpener)) settingsOpener.focus();
  settingsOpener = null;
}
function openSettings() {
  const s = state.summary; if (!s) return;
  settingsOpener = document.activeElement;
  retireSettingsPick();
  $("settingsAdvanced").open=false;
  $("roomPath").textContent = s.dir;
  $("mDelete").hidden = s.name === "default"; // the fallback room can't be removed
  renderSeatCards(s);
  $("s_notify").checked = notifyEnabled();
  $("s_projdir").value = s.cfg.projectDir || "";
  $("s_roomnote").value = s.cfg.roomNote || "";
  $("s_default").innerHTML = s.seats.map((x) => `<option>${esc(x)}</option>`).join("");
  $("s_default").value = s.cfg.defaultAgent || s.seats[0];
  $("s_timeout").value = Math.round((s.cfg.timeoutMs || 300000) / 1000);
  $("s_hopbudget").value = String(normalizedHopBudget(s.cfg.hopBudget, -1));
  syncHopPreset();
  const previousAccounting = s.cfg.accounting !== "automatic";
  $("s_accounting").innerHTML = (previousAccounting
    ? "<option value=\"exchanges\" disabled>旧计次方式：当前仍在使用，不支持重新选择</option>" : "") +
    "<option value=\"automatic\">自动轮次：每次自动启动均计次</option>";
  $("s_accounting").value = previousAccounting ? "exchanges" : "automatic";
  $("hopSettingsNote").textContent = `-1 = 直到讨论结束（${hopSafetyLimit() === null ? "暂时无法获取服务安全上限" : `服务安全上限 ${hopSafetyLimit()}`}). ` +
    "自动轮次：0 表示仅生成首次指定的回复。保存后的设置仅适用于后续消息，已经开始的讨论及其后续回复继续遵循原规则。输入框旁的临时设置优先。" +
    (previousAccounting ? " 此聊天室仍采用旧计次方式。选择“自动轮次”并检查额度即可切换；仅保存其他设置不会切换。" : "");
  $("s_pairrounds").value = s.cfg.pairRounds || 0;
  $("overlay").classList.add("open");
}
$("settingsBtn").onclick = openSettings;
$("settingsBtn2").onclick = openSettings;
$("mCancel").onclick = () => closeSettings();
function syncHopPreset(){
  const value=$("s_hopbudget").value;
  $("s_hopPreset").value=['0','2'].includes(value)?value:'custom';
  $("s_hopPreset").querySelector('[value="custom"]').textContent=['0','2'].includes(value)?'自定义额度…':`自定义 · 额外额度 ${value}`;
}
$("s_hopPreset").onchange=()=>{
  if($("s_hopPreset").value==='custom'){$("settingsAdvanced").open=true;$("s_hopbudget").focus();}
  else{$("s_hopbudget").value=$("s_hopPreset").value;syncHopPreset();}
};
$("s_hopbudget").addEventListener('input',syncHopPreset);
$("overlay").addEventListener("click", (e) => { if (e.target === $("overlay")) closeSettings(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeSettings(); });
$("mSave").onclick = async () => {
  const s = state.summary; if (!s) return;
  const roomHopBudget = Number($("s_hopbudget").value);
  if (!Number.isSafeInteger(roomHopBudget) || roomHopBudget < -1) {
    toast("接续额度必须为 -1（直到讨论结束）或非负整数。", true);
    return;
  }
  const agents = {};
  for (const a of s.seats) {
    agents[a] = {};
    for (const el of document.querySelectorAll(`#seatCards [data-seat="${a}"][data-f]`)) {
      const f = el.dataset.f;
      let v = el.value;
      if (f === "extraArgs") v = v.trim() ? v.trim().split(/\s+/) : [];
      else if (f === "command") v = v.trim() || undefined; // blank keeps the default
      else if (typeof v === "string" && v.trim() === "") v = null;
      if (v !== undefined) agents[a][f] = v;
    }
  }
  // Every seat, not the one that happens to be called "claude": a seat can be
  // named anything, and the warned escalation has to follow the seat actually
  // being elevated.
  for (const a of s.seats) {
    if (!agents[a] || !s.cfg.agents[a]) continue;
    const roomMode = s.cfg.mode || "talk";
    const before = effectiveSeatPermission(a, s.cfg.agents[a], roomMode);
    const after = effectiveSeatPermission(a, { ...s.cfg.agents[a], ...agents[a] }, roomMode);
    if (isFullAccess(before) || !isFullAccess(after)) continue;
    const who = seatLabel(a);
    const scope = $("s_projdir").value.trim() || "聊天室工作区";
    const accepted = confirm(
      `⚠ 是否授予 ${who} 在本聊天室中的完全访问权限？\n\n` +
      `${who} 将绕过常规权限提示和检查，可修改 .git 等受保护路径、运行命令、使用继承的凭据和网络连接，并修改以下目录以外的文件：\n${scope}\n\n` +
      `明确的询问／拒绝规则、管理策略、系统权限和 CLI 自身的强制安全限制仍可能限制操作。\n\n` +
      `对于 @both 讨论、配对审查和旁听，Maple 会请求独立的只读调用。这会放弃普通原生会话，下一次普通执行会根据聊天室历史重新建立上下文。普通交接和配对执行者仍拥有完全访问权限。外部 CLI 设置或封装程序不受此界面约束。\n\n` +
      `${who} 将新建会话。完全访问权限覆盖当前系统账户可访问的范围，建议仅在隔离容器或虚拟机内使用。`
    );
    if (!accepted) return;
  }
  // Build the request from what is on screen now, then retire the picker: a
  // dialog that resolves while the save is in flight would otherwise fill the
  // field with a folder this request did not carry.
  const config = {
    defaultAgent: $("s_default").value,
    timeoutMs: Math.max(10, Number($("s_timeout").value) || 300) * 1000,
    hopBudget: roomHopBudget,
    accounting: $("s_accounting").value,
    pairRounds: Math.min(99, Math.max(0, Number($("s_pairrounds").value) || 0)),
    projectDir: $("s_projdir").value.trim() || null,
    roomNote: $("s_roomnote").value.trim() || null,
    agents,
  };
  // The notification preference is this browser's, not the room's, so it is
  // applied here rather than sent to the server. Asking for permission only
  // when it is switched on keeps the prompt tied to a deliberate action.
  const wantNotify = $("s_notify").checked;
  if (wantNotify && !notifyEnabled()) {
    if (await requestNotifyPermission()) setNotifyEnabled(true);
    else toast("浏览器阻止了此页面的通知。", true);
  } else if (!wantNotify) {
    setNotifyEnabled(false);
  }
  retireSettingsPick();
  try {
    const saved = await api("/api/config", { room: state.room, config });
    closeSettings();
    // The panel above already shows the new permission, but a CLI process that
    // has launched cannot be changed. Say what the user is actually watching —
    // scoped to the run in flight, since a recovery retry would relaunch under
    // the new settings within that same reply.
    const late = (saved && saved.runningInvocations) || [];
    toast(late.length
      ? `已保存 — ${late.join(" and ")} ${late.length > 1 ? "are" : "is"} 正在回复中，当前${late.length > 1 ? "runs" : "run"}仍在进行，${late.length > 1 ? "keep" : "keeps"}继续使用原有权限。`
      : "设置已保存。");
  } catch (e) { toast(e.message, true); }
};
async function newConversation() {
  if (!confirm("是否归档当前对话，并重置两位智能体的会话？")) return;
  try { await api("/api/new", { room: state.room }); closeSettings(); }
  catch (e) { toast(e.message, true); }
}
// Rename/delete work on any room — the one you're viewing (Settings) or one
// you hover in the sidebar — so both flows fetch the target's own details
// before asking you to confirm.
async function renameFlow(name) {
  let info;
  try { info = await api("/api/room?name=" + encodeURIComponent(name)); }
  catch (e) { return toast(e.message, true); }
  const to = prompt(`将“${name}" to:`, name);
  if (to === null) return;
  const t = to.trim();
  if (!t || t === name) return;
  const warn = info.room.cfg.projectDir
    ? "" // linked rooms keep their working directory, so sessions survive
    : `\n\n提示：工作区文件夹会随聊天室一起移动，因此每位智能体都将新建会话，并根据对话记录重新获得上下文。`;
  if (warn && !confirm(`将“${name}" → "${t}"?${warn}`)) return;
  try {
    const r = await api("/api/room/rename", { room: name, to: t });
    closeSettings();
    // Follow the successful response too: the SSE notification may have been
    // missed while disconnected. The shared helper is idempotent if it arrived.
    followRoomRename(name, r.name);
    toast(`已重命名为“${r.name}".`);
    await refreshRooms();
  } catch (e) { toast(e.message, true); }
}
async function deleteFlow(name) {
  let info;
  try { info = await api("/api/room?name=" + encodeURIComponent(name)); }
  catch (e) { return toast(e.message, true); }
  const msgs = info.entries.filter((e) => e.kind === "user" || e.kind === "agent").length;
  const where = info.room.cfg.projectDir
    ? `\n\n关联的项目（${info.room.cfg.projectDir}）不会改动，只会处理 Maple 自己的聊天室文件夹。`
    : "\n\n其中包括聊天室的独立工作区，以及智能体在其中创建的文件。";
  if (!confirm(`是否删除聊天室“${name}"?\n\n${msgs} message${msgs === 1 ? "" : ""}和对话记录将移至 Maple 数据目录中的 .trash，在清空前可用文件管理器恢复。${where}`)) return;
  try {
    const r = await api("/api/room/delete", { room: name });
    closeSettings();
    toast(`"${name}”已移至 .trash，可在文件管理器中恢复或清理。`);
    if (state.room === name) {
      if (state.es) { state.es.close(); state.es = null; }
      await loadRoom(r.rooms.length ? (r.rooms[0].name || r.rooms[0]) : "default");
    } else {
      await refreshRooms();
    }
  } catch (e) { toast(e.message, true); }
}
$("mRename").onclick = () => renameFlow(state.room);
$("mDelete").onclick = () => deleteFlow(state.room);
$("mDelete").hidden = false;
$("newConvBtn").onclick = newConversation;
$("mNewConv").onclick = newConversation;

// ------------------------------------------------------------ boot
loadRoom(state.room).catch((e) => toast(e.message, true));
window.parleyRecorderHost = { getRoom: () => state.room };
window.parleyControlsHost = {getRoom:()=>state.room,getSummary:()=>state.summary,applySummary,notify:toast};
input.focus();
