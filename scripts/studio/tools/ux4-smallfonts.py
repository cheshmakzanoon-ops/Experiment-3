"""List every CSS declaration under 11 px in the UI sheets, with its selector (a review aid).

usage: ux4-smallfonts.py FILE.css [FILE.css ...]
Walks each sheet's rules (brace-aware, media blocks included) and prints `file:line size selector` for
font-size declarations whose px value is below 11 (also `font:` shorthands). It is a text scan, not a
cascade: it says where small type is declared, not which of two rules wins.
"""
import re
import sys

for path in sys.argv[1:]:
    text = open(path).read()
    stack = []  # (selector, start index)
    i = 0
    line_of = lambda pos: text.count("\n", 0, pos) + 1
    # tokenise on braces; track the text since the last brace as the prelude of the next block
    last = 0
    for m in re.finditer(r"[{}]", text):
        ch = m.group()
        if ch == "{":
            prelude = text[last : m.start()].strip().split("*/")[-1].strip()
            stack.append((re.sub(r"\s+", " ", prelude), m.end()))
            last = m.end()
        else:
            if stack:
                selector, start = stack.pop()
                body = text[start : m.start()]
                # only the declarations that belong to this block (not nested blocks)
                body = re.sub(r"\{[^{}]*\}", "", body)
                for d in re.finditer(r"(font-size|font)\s*:\s*([^;]+)", body):
                    value = d.group(2)
                    size = None
                    if d.group(1) == "font-size":
                        mm = re.match(r"\s*([\d.]+)px", value)
                        if mm:
                            size = float(mm.group(1))
                    else:
                        mm = re.search(r"(?:^|\s)(\d+(?:\.\d+)?)px(?:\s*/|\s)", value)
                        if mm:
                            size = float(mm.group(1))
                    if size is not None and size < 11 and not selector.startswith("@"):
                        print(f"{path}:{line_of(start + d.start())} {size:g}px {selector[:110]}")
            last = m.end()
