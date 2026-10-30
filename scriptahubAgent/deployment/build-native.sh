#!/bin/sh
set -eu
mkdir -p /out
if [ "$TARGETARCH" != amd64 ]; then exit 0; fi
revision=$(python3 -c 'import json;print(json.load(open("/build-config.json"))["nativeAssetSource"]["revision"])')
case "$revision" in *[!0-9a-f]*|'') echo 'Invalid native source revision' >&2; exit 1;; esac
test "${#revision}" = 40
git init /source
git -C /source remote add origin https://github.com/AssistOS-AI/ScriptaSkillSet.git
git -C /source sparse-checkout init --cone
git -C /source sparse-checkout set skills/pdf2htmlSkill/external/docling-source
git -C /source fetch --depth=1 origin "$revision"
git -C /source checkout --detach FETCH_HEAD
test "$(git -C /source rev-parse HEAD)" = "$revision"
cd /source/skills/pdf2htmlSkill/external/docling-source
CARGO_BUILD_JOBS=2 cargo build --locked --release --package docling-node --target-dir /native-target
mkdir -p /out/linux-x64/lib /out/linux-x64/notices
cp /native-target/release/libdocling_node.so /out/linux-x64/docling.node
cp LICENSE /out/linux-x64/notices/docling-LICENSE
curl --fail --location --retry 3 https://github.com/bblanchon/pdfium-binaries/releases/download/chromium/8044/pdfium-linux-x64.tgz -o /pdfium.tgz
printf '%s  %s\n' eb142f416aed3a72fc5a02dbd5884868a16cb99dc0cf53e6bdd64afbf67b05f4 /pdfium.tgz | sha256sum --check
mkdir /pdfium
tar -xzf /pdfium.tgz -C /pdfium
cp /pdfium/lib/libpdfium.so /out/linux-x64/lib/
cp /pdfium/LICENSE /out/linux-x64/notices/pdfium-LICENSE
cp -R /pdfium/licenses /out/linux-x64/notices/pdfium-components
REVISION="$revision" python3 - <<'PY'
import pathlib,hashlib,json,os
root=pathlib.Path('/out/linux-x64')
files={}
for name in ['docling.node','lib/libpdfium.so']:
 b=(root/name).read_bytes();files[name]={'bytes':len(b),'sha256':hashlib.sha256(b).hexdigest()}
pathlib.Path('/out/receipt.json').write_text(json.dumps({'platform':'linux-x64','sourceRevision':os.environ['REVISION'],'files':files},indent=2)+'\n')
PY
