#!/usr/bin/env python3
"""Translate docs MDX into docs/user/<locale>/<slug>.mdx.

Code fences, inline code, URLs and JSX tags are masked before translation and
restored afterwards, so only prose is ever sent to the model. Frontmatter keys
that drive routing and ordering (section, topicId, order) are copied verbatim —
translating those would break the site.

    SYN_KEY=... python3 scripts/i18n/translate-docs.py de [--only slug] [--redo]
"""

import json, os, re, sys
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import translate as T  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DOCS = os.path.join(ROOT, "docs", "user")

# The shared prompt is tuned for short UI labels; documentation is prose and
# must keep its Markdown structure intact.
T.SYSTEM = T.SYSTEM.replace(
    "5. UI strings are short. Prefer concise wording; these appear in buttons and table columns.",
    "5. This is product documentation. Preserve Markdown exactly: heading levels, list markers,\n"
    "   bold/italic, table pipes and blank lines. Never translate text inside ⟦N⟧ markers —\n"
    "   reproduce those markers verbatim, they stand in for code and URLs.",
)

TRANSLATE_KEYS = {"title", "summary", "badge"}
LIST_KEYS = {"takeaways"}
WORKERS = 3

FENCE = re.compile(r"```.*?```", re.S)
INLINE_CODE = re.compile(r"`[^`\n]+`")
JSX_TAG = re.compile(r"</?[A-Z][A-Za-z]*[^>]*/?>")
LINK_URL = re.compile(r"\]\(([^)]+)\)")


def mask(text):
    store = []

    def stash(value):
        store.append(value)
        return f"⟦{len(store) - 1}⟧"

    for pattern in (FENCE, INLINE_CODE, JSX_TAG):
        text = pattern.sub(lambda m: stash(m.group(0)), text)
    # Keep link labels translatable but never the target.
    text = LINK_URL.sub(lambda m: f"]({stash(m.group(1))})", text)
    return text, store


def unmask(text, store):
    def restore(m):
        idx = int(m.group(1))
        return store[idx] if idx < len(store) else m.group(0)

    return re.sub(r"⟦(\d+)⟧", restore, text)


def split_blocks(body):
    """Chunk on blank lines so each unit is a paragraph, heading or list."""
    return [b for b in re.split(r"\n{2,}", body)]


def parse_front(raw):
    if not raw.startswith("---"):
        return None, raw
    end = raw.find("\n---", 3)
    if end < 0:
        return None, raw
    return raw[3:end].strip("\n"), raw[end + 4 :].lstrip("\n")


def translate_front(locale, front):
    lines = front.split("\n")
    to_translate, slots = [], []

    for i, line in enumerate(lines):
        m = re.match(r"^(\w+):\s*(.+)$", line)
        if m and m.group(1) in TRANSLATE_KEYS:
            value = m.group(2).strip().strip('"')
            to_translate.append(value)
            slots.append(("scalar", i, m.group(1)))
            continue
        m = re.match(r"^(\s*)-\s+(.+)$", line)
        if m and any(f"{k}:" in "\n".join(lines[max(0, i - 6) : i]) for k in LIST_KEYS):
            to_translate.append(m.group(2).strip().strip('"'))
            slots.append(("item", i, m.group(1)))

    if not to_translate:
        return front

    got = T.translate_batch(locale, to_translate)
    for idx, (kind, line_no, meta) in enumerate(slots):
        value = got.get(idx)
        if not value:
            continue
        # json.dumps escapes inner quotes; YAML accepts JSON-style scalars.
        # Translators routinely add quotes around terms, which breaks naive f-strings.
        encoded = json.dumps(value, ensure_ascii=False)
        lines[line_no] = f"{meta}: {encoded}" if kind == "scalar" else f"{meta}- {encoded}"
    return "\n".join(lines)


def translate_body(locale, body):
    masked, store = mask(body)
    blocks = split_blocks(masked)

    indexed = [(i, b) for i, b in enumerate(blocks) if b.strip() and not re.fullmatch(r"[\s⟦⟧\d]*", b)]
    texts = [b for _, b in indexed]

    out = dict(enumerate(blocks))
    for start in range(0, len(texts), 8):
        chunk = texts[start : start + 8]
        got = T.translate_batch(locale, chunk)
        for j, value in got.items():
            if value:
                out[indexed[start + j][0]] = value

    return unmask("\n\n".join(out[i] for i in range(len(blocks))), store)


def translate_file(locale, path):
    slug = os.path.basename(path)
    raw = open(path, encoding="utf-8").read()
    front, body = parse_front(raw)

    new_front = translate_front(locale, front) if front else None
    new_body = translate_body(locale, body)

    out_dir = os.path.join(DOCS, locale)
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, slug)
    with open(out_path, "w", encoding="utf-8") as fh:
        if new_front:
            fh.write(f"---\n{new_front}\n---\n\n")
        fh.write(new_body.rstrip("\n") + "\n")
    return slug


def main():
    locale = sys.argv[1]
    redo = "--redo" in sys.argv
    only = None
    if "--only" in sys.argv:
        only = sys.argv[sys.argv.index("--only") + 1]

    files = sorted(f for f in os.listdir(DOCS) if f.endswith(".mdx"))
    if only:
        files = [f for f in files if f.startswith(only)]
    if not redo:
        files = [f for f in files if not os.path.exists(os.path.join(DOCS, locale, f))]

    print(f"{locale}: {len(files)} docs to translate")
    if not files:
        return

    def run(name):
        slug = translate_file(locale, os.path.join(DOCS, name))
        print(f"  done {slug}", flush=True)
        return slug

    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        list(pool.map(run, files))

    print(f"{locale}: wrote {len(files)} files to docs/user/{locale}/")


if __name__ == "__main__":
    main()
