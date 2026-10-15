#!/usr/bin/env python3
"""Patch only the known prepared-list integration; leave unrelated deployed code intact."""
import sys
from pathlib import Path
p=Path(sys.argv[1]);s=p.read_text()
if '// qrs-prepared-list-v2' in s: raise SystemExit('already patched; verify rather than reapply')
changes=[
("const { createResponseCache, sendCached } = require('./lib/response-cache');", "const { createResponseCache, sendCached, compactEntry } = require('./lib/response-cache');"),
("  const { source, category, q, limit, ready } = req.query;", "  // qrs-prepared-list-v2: variants must not share payloads or validators.\n  const compact = req.get('X-Rss-List') === 'reader-v1';\n  const { source, category, q, limit, ready } = req.query;"),
("parsedLimit || '', optIn, ready === 'rewrite']);", "parsedLimit || '', optIn, ready === 'rewrite', compact]);"),
("      viewer: null,\n      allowedOptInSourceIds", "      viewer: null,\n      compact, minimal: compact,\n      allowedOptInSourceIds"),
("    }).map(mediaListEntry),\n  }));", "    }).map(entry => compact ? compactEntry(mediaListEntry(entry)) : mediaListEntry(entry)),\n  }));")]
for before,after in changes:
 if s.count(before)!=1: raise SystemExit('production structure changed: '+before[:90])
 s=s.replace(before,after)
p.write_text(s)
