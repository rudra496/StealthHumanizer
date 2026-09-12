#!/usr/bin/env python3
"""Adds CORS map + origin/key allow chain to the homelab nginx conf (idempotent)."""
import re

CONF = "/opt/homelab/nginx/conf.d/homelab.conf"
conf = open(CONF).read()
changed = []

# 1) origin map at http level (next to the existing authorization maps)
if "cors_origin" not in conf:
    map_anchor = 'map $http_authorization $auth_humanizer'
    map_block = (
        'map $http_origin $cors_origin {\n'
        '    default "";\n'
        '    "https://stealthhumanizer.vercel.app" "https://stealthhumanizer.vercel.app";\n'
        '    "http://localhost:3000" "http://localhost:3000";\n'
        '}\n'
    )
    conf = conf.replace(map_anchor, map_block + map_anchor, 1)
    changed.append("origin map")

# 2) per-location: allow key OR allowed origin, add CORS headers, handle OPTIONS
def upgrade(location_line, auth_var):
    global conf
    old_if = f"        if (${auth_var} = 0) {{ return 401; }}\n"
    new_if = (
        "        set $allow 0;\n"
        f"        if (${auth_var} = 1) {{ set $allow 1; }}\n"
        '        if ($cors_origin != "") { set $allow 1; }\n'
        "        if ($allow = 0) { return 403; }\n"
        "        if ($request_method = OPTIONS) { return 204; }\n"
        "        add_header Access-Control-Allow-Origin $cors_origin always;\n"
        '        add_header Access-Control-Allow-Methods "POST, OPTIONS" always;\n'
        '        add_header Access-Control-Allow-Headers "Content-Type, Authorization" always;\n'
    )
    if old_if in conf:
        conf = conf.replace(old_if, new_if, 1)
        changed.append(location_line)

upgrade("location /api/humanize/", "auth_humanizer")
upgrade("location /api/detect/", "auth_detector")

open(CONF, "w").write(conf)
print("changed:", changed if changed else "none (already up to date)")
