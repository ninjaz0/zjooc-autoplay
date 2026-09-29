"""Build ready-to-load release files, using only the Python standard library."""
from pathlib import Path
import hashlib
import json
import re
import zipfile

ROOT = Path(__file__).resolve().parent.parent
EXT = ROOT / 'extension'
DIST = ROOT / 'dist'
manifest = json.loads((EXT / 'manifest.json').read_text(encoding='utf-8'))
version = manifest['version']
assert re.fullmatch(r'\d+\.\d+\.\d+', version), 'Expected a semantic version'
content = (EXT / 'content.js').read_text(encoding='utf-8')
assert f"VERSION = '{version}'" in content, 'Manifest/content version mismatch'
for block in manifest['content_scripts']:
    for name in block['js']:
        assert (EXT / name).is_file(), f'Missing content script: {name}'
assert (EXT / manifest['action']['default_popup']).is_file()
DIST.mkdir(exist_ok=True)
files = {f.name: f.read_bytes() for f in EXT.iterdir() if f.is_file()}
for name in ['README.md', 'INSTALL.md', 'LICENSE', 'PRIVACY.md']:
    files[name] = (ROOT / name).read_bytes()
archive = DIST / f'zjooc-autoplay-v{version}.zip'
with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for name, data in sorted(files.items()):
        info = zipfile.ZipInfo('zjooc-autoplay/' + name, date_time=(2026, 1, 1, 0, 0, 0))
        info.create_system = 3
        info.external_attr = 0o100644 << 16
        info.compress_type = zipfile.ZIP_DEFLATED
        z.writestr(info, data)
with zipfile.ZipFile(archive) as z:
    assert z.testzip() is None
    for name, data in files.items():
        assert z.read('zjooc-autoplay/' + name) == data
header = f'''// ==UserScript==
// @name         ZJOOC 视频连播助手
// @namespace    https://github.com/ninjaz0/zjooc-autoplay
// @version      {version}
// @description  课程视频默认静音、最高倍速连播和零时长异常恢复。
// @homepageURL  https://github.com/ninjaz0/zjooc-autoplay
// @supportURL   https://github.com/ninjaz0/zjooc-autoplay/issues
// @license      MIT
// @match        *://zjooc.cn/ucenter/student/course/*
// @match        *://*.zjooc.cn/ucenter/student/course/*
// @grant        none
// @run-at       document-idle
// @noframes
// ==/UserScript==

/* MIT License: Copyright (c) 2026 ninjaz0. See https://github.com/ninjaz0/zjooc-autoplay/blob/main/LICENSE */
'''
userscript = DIST / 'zjooc-autoplay.user.js'
userscript.write_bytes((header + '/*\n' + (ROOT / 'LICENSE').read_text(encoding='utf-8') + '*/\n' + (EXT / 'core.js').read_text(encoding='utf-8') + '\n' + (EXT / 'persistence.js').read_text(encoding='utf-8') + '\n' + content).encode('utf-8'))
checksums = ''.join(hashlib.sha256(p.read_bytes()).hexdigest() + '  ' + p.name + '\n' for p in [archive, userscript])
(DIST / 'SHA256SUMS.txt').write_bytes(checksums.encode('ascii'))
print(f'Built and verified {archive.name}, {userscript.name}, SHA256SUMS.txt')
