"""Hook C for "THE SIGNAL" (frames 1–90): see hook_alt.py."""
import os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
for p in (HERE, os.path.join(HERE, '..', 'dual'), os.path.join(HERE, '..', 'commercial2'), os.path.join(HERE, '..', 'commercial')):
    if p not in sys.path: sys.path.insert(0, p)
from hook_alt import build
build('c')
