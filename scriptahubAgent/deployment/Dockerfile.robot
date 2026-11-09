# Build context: the ScriptaHubAgent repository. Skills, deployment helpers and the inventories come from
# this checkout; the downloaded model and native files come from the published assets image, chosen by
# digest. Those files are verified against this checkout's inventories before any of them is installed.
# No library is committed to Git.
ARG ROBOTEAM_BASE_IMAGE=docker.io/assistos/roboteam-agent:runtime
ARG SCRIPTA_ASSETS_IMAGE=docker.io/assistos/scriptahub-assets:runtime
FROM ${SCRIPTA_ASSETS_IMAGE} AS manuscript-assets
FROM ${ROBOTEAM_BASE_IMAGE}
USER root
RUN dnf install -y --setopt=install_weak_deps=False \
    chromium espeak-ng ffmpeg-free dejavu-sans-fonts \
    ghostscript git libreoffice-writer poppler-utils qpdf libsndfile sox \
    python3.11 python3.11-devel gcc-c++ make \
    && dnf clean all \
    && rm -f /usr/bin/newuidmap /usr/bin/newgidmap \
    && truncate -s 0 /etc/subuid /etc/subgid \
    && ln -sf /usr/bin/python3.11 /usr/local/bin/python3 \
    && printf '%s\n' '#!/bin/sh' 'exec /usr/bin/chromium-browser --no-sandbox --disable-dev-shm-usage "$@"' > /usr/local/bin/chromium-browser \
    && chmod 0755 /usr/local/bin/chromium-browser

# /usr is already available in the existing robot sandbox. No new mount or
# RoboTeam execution capability is necessary for this prepared runtime.
COPY skills/ /usr/local/share/scriptahub/runtime/skills/
COPY scriptahubAgent/deployment/ /usr/local/share/scriptahub/runtime/
COPY scriptahubAgent/site/reader/reader.css /usr/local/share/scriptahub/runtime/reader/reader.css
# The assets image is mounted read-only and is never copied over the runtime root unchecked. This checkout's
# verifier checks it against this checkout's inventories first; --exact refuses any file or link outside the
# inventory, so the assets image cannot add a verifier, an inventory, an interpreter or a skill file. Only
# verified files are copied, in the same step, and preparation then builds Fedora environments around them
# and verifies the source record. An ARM64 assets image has an empty native-build directory.
RUN --mount=type=bind,from=manuscript-assets,source=/assets,target=/mnt/assets \
    node /usr/local/share/scriptahub/runtime/verify-assets.mjs \
        --skills /usr/local/share/scriptahub/runtime/skills \
        --runtime /mnt/assets/runtime --native-build /mnt/assets/native-build --exact \
    && cp -a --no-preserve=ownership /mnt/assets/runtime/. /usr/local/share/scriptahub/runtime/ \
    && mkdir -p /opt/scriptahub/native-build \
    && if [ -d /mnt/assets/native-build ]; then cp -a --no-preserve=ownership /mnt/assets/native-build/. /opt/scriptahub/native-build/; fi \
    && node /usr/local/share/scriptahub/runtime/prepare-skills.mjs /usr/local/share/scriptahub/runtime \
    && rm -rf /root/.cache /root/.npm \
    && chmod -R a+rX /usr/local/share/scriptahub/runtime
ENV SCRIPTA_SKILL_RUNTIME_ROOT=/usr/local/share/scriptahub/runtime \
    PDF2HTML_RUNTIME_ROOT=/usr/local/share/scriptahub/runtime/skills/pdf2html \
    PDF2HTML_CHROMIUM_EXECUTABLE=/usr/local/bin/chromium-browser \
    VALIDATEBOOK_PDF2HTML=/usr/local/share/scriptahub/runtime/skills/pdf2html/scripts/pdf2html \
    VALIDATEBOOK_CHROMIUM=/usr/local/bin/chromium-browser \
    VALIDATEBOOK_READER_CSS=/usr/local/share/scriptahub/runtime/reader/reader.css
RUN node /usr/local/share/scriptahub/runtime/verify-skills.mjs /usr/local/share/scriptahub/runtime \
    && test "$(podman --version)" = 'podman version 5.8.7' \
    && test ! -e /usr/bin/newuidmap && test ! -e /usr/bin/newgidmap \
    && test "$(stat -c '%u:%g:%a' /opt/roboteam-runtime/contract-v6)" = '0:0:444'
# Preserve the base image's Podman entrypoint, storage contract and working dir.
