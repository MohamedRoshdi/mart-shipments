import sys
NL = chr(10)
Q = chr(34)
SQ = chr(39)

def read(p):
    return open(p, encoding="utf-8").read()

def write(p, s):
    open(p, "w", encoding="utf-8").write(s)

def drop(p, markers):
    ls = read(p).split(NL)
    out = [l for l in ls if not any(m in l for m in markers)]
    print("drop", p, len(ls) - len(out))
    write(p, NL.join(out))

def drop_block(p, start, endline):
    ls = read(p).split(NL)
    out = []
    skip = False
    n = 0
    for l in ls:
        if not skip and start in l:
            skip = True
            n += 1
            continue
        if skip:
            n += 1
            if l == endline:
                skip = False
            continue
        out.append(l)
    print("block", p, n)
    write(p, NL.join(out))

def maprep(p, marker, newline):
    ls = read(p).split(NL)
    n = 0
    for i, l in enumerate(ls):
        if marker in l:
            ls[i] = newline
            n += 1
    print("map", p, marker, n)
    write(p, NL.join(ls))

def sub(p, old, new):
    s = read(p)
    print("sub", p, s.count(old))
    write(p, s.replace(old, new))
