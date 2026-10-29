# Build context: the ScriptaHubAgent repository. Build this profile with the same
# ScriptaHub sources as the application image; no libraries are committed to Git.
ARG ROBOTEAM_BASE_IMAGE=docker.io/assistos/roboteam-agent:runtime
ARG SCRIPTA_RUNTIME_IMAGE=docker.io/assistos/scriptahub-agent:runtime
FROM ${SCRIPTA_RUNTIME_IMAGE} AS manuscript-assets
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
COPY scriptahubAgent/skills/ /usr/local/share/scriptahub/runtime/skills/
COPY scriptahubAgent/deployment/ /usr/local/share/scriptahub/runtime/
COPY scriptahubAgent/site/reader/reader.css /usr/local/share/scriptahub/runtime/reader/reader.css
# Reuse the agent-owned downloaded assets, not its Debian executables or Python
# environments. Preparation verifies native hashes and builds Fedora environments.
COPY --from=manuscript-assets /opt/scriptahub/runtime/skills/theatrical-audio/models/ /usr/local/share/scriptahub/runtime/skills/theatrical-audio/models/
COPY --from=manuscript-assets /opt/scriptahub/runtime/skills/pdf2html/external/native/ /usr/local/share/scriptahub/runtime/skills/pdf2html/external/native/
RUN node /usr/local/share/scriptahub/runtime/prepare-skills.mjs /usr/local/share/scriptahub/runtime \
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
