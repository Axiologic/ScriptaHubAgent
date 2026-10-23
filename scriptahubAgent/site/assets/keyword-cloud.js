(() => {
  "use strict";

  const escapeHtml = (value) => String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
  const displayLabel = (value) => String(value).replace(/(^|[\s/–—-])(\p{L})/gu, (_, separator, letter) => `${separator}${letter.toLocaleUpperCase()}`);
  const clamp = (value, lower, upper) => Math.max(lower, Math.min(upper, value));
  const panInstructions = {
    en: "Ctrl-drag to move", fr: "Ctrl-glisser pour déplacer", de: "Strg-Ziehen zum Verschieben", es: "Ctrl-arrastrar para mover",
    pt: "Ctrl-arraste para mover", it: "Ctrl-trascina per spostare", ro: "Ctrl-trage pentru deplasare", pl: "Ctrl-przeciągnij, aby przesunąć",
  };
  const halton = (index, base) => {
    let fraction = 1;
    let value = 0;
    while (index > 0) {
      fraction /= base;
      value += fraction * (index % base);
      index = Math.floor(index / base);
    }
    return value;
  };

  function openModal(items, options, originatingCloud = null) {
    // Fullscreen discovery opens recommendations; embedded catalogue links keep their routes.
    const root = new URL('../', document.querySelector('script[src*="assets/keyword-cloud.js"]')?.src || new URL('assets/keyword-cloud.js', location.href));
    const modalItems = items.map(keyword => {
      const prior = new URL(keyword.href, location.href);
      const target = new URL('librarian/index.html', root);
      target.search = new URLSearchParams({lang:prior.searchParams.get('lang') || document.documentElement.lang || 'en'});
      target.hash = new URLSearchParams({request:keyword.label});
      return {...keyword, href:target.href};
    });
    if (document.querySelector(".keyword-cloud-modal")) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const sourceCloud = originatingCloud || opener?.closest?.(".keyword-cloud") || null;
    if (sourceCloud) sourceCloud._suspended = true;
    const modalInstruction = /\b(?:Ctrl|Strg)-/i.test(options.modalInstruction)
      ? options.modalInstruction
      : `${options.modalInstruction} · ${panInstructions[document.documentElement.lang] || panInstructions.en}`;
    const modal = document.createElement("div");
    modal.className = "keyword-cloud-modal";
    modal.innerHTML = `<section class="keyword-cloud-modal-stage" role="dialog" aria-modal="true" aria-label="${escapeHtml(options.ariaLabel)}"><div class="keyword-cloud keyword-cloud-modal-canvas"></div><button class="keyword-cloud-modal-close" type="button" aria-label="${escapeHtml(options.closeLabel)}">×</button><p class="keyword-cloud-modal-instruction">${escapeHtml(modalInstruction)}</p></section>`;
    const modalCloud = modal.querySelector(".keyword-cloud-modal-canvas");
    const closeButton = modal.querySelector(".keyword-cloud-modal-close");
    let dispose = () => {};
    const close = ({ restoreFocus = true } = {}) => {
      dispose();
      document.removeEventListener("keydown", onKeydown);
      modal.remove();
      document.body.classList.remove("keyword-modal-open");
      if (restoreFocus) opener?.focus();
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (sourceCloud) sourceCloud._suspended = false;
        sourceCloud?._refresh?.();
      }));
    };
    const onKeydown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    };
    modal.addEventListener("click", (event) => { if (event.target === modal) close(); });
    closeButton.addEventListener("click", () => close());
    document.body.append(modal);
    document.body.classList.add("keyword-modal-open");
    dispose = mount(modalCloud, modalItems, {
      ...options,
      interactive: true,
      showInstruction: false,
      onSelect: (keyword) => {
        close({ restoreFocus: false });
        location.assign(keyword.href);
      },
    });
    document.addEventListener("keydown", onKeydown);
    requestAnimationFrame(() => {
      modal.classList.add("is-open");
      modalCloud.querySelector("canvas")?.focus();
    });
  }

  function mount(cloud, items, {
    ariaLabel = "Interactive keyword cloud",
    instruction = "Click to enlarge",
    modalInstruction = "Drag to rotate · scroll to zoom",
    closeLabel = "Close keyword cloud",
    interactive = false,
    background = null,
    showInstruction = true,
    onSelect = (keyword) => location.assign(keyword.href),
  } = {}) {
    if (!cloud || !items.length) return () => {};
    const backgroundMode = background ?? Boolean(cloud.closest(".discovery-mission, .book-hero"));
    const navigable = interactive || backgroundMode;
    const bookBackground = backgroundMode && Boolean(cloud.closest(".book-hero"));
    const homeBackground = backgroundMode && !bookBackground;
    if (cloud._dispose) cloud._dispose();
    const maximum = Math.max(...items.map((item) => Number(item.count) || 1));
    const priorInstruction = cloud.nextElementSibling;
    if (priorInstruction?.classList.contains("cloud-instruction")) priorInstruction.remove();
    cloud.classList.toggle("keyword-cloud-preview", !interactive);
    cloud.classList.toggle("keyword-cloud-interactive", interactive);
    cloud.classList.toggle("keyword-cloud-navigable", navigable);
    cloud.innerHTML = `<canvas tabindex="0" aria-label="${escapeHtml(ariaLabel)}"></canvas><nav class="sr-only">${items.map((item) => `<a href="${escapeHtml(item.href)}">${escapeHtml(displayLabel(item.label))}</a>`).join("")}</nav>`;
    if (showInstruction && !backgroundMode) cloud.insertAdjacentHTML("afterend", `<p class="cloud-instruction">${escapeHtml(instruction)}</p>`);
    const canvas = cloud.querySelector("canvas");
    const context = canvas.getContext("2d");
    const displayedItems = navigable ? items : items.slice(0, 10);
    const popularityTotal = displayedItems.reduce((sum, item) => sum + Math.max(1, Number(item.count) || 1), 0);
    const popularityFor = (keyword) => clamp(
      Math.sqrt((Math.max(1, Number(keyword.count) || 1) / Math.max(1, popularityTotal)) * displayedItems.length),
      .24,
      2.2,
    );
    const reducedMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const featuredCount = Math.min(
      interactive && displayedItems.length > 150 ? 14 : (homeBackground ? 10 : (backgroundMode ? 10 : 8)),
      displayedItems.length,
    );
    // Low-discrepancy coordinates fill the available volume without turning
    // the cloud into a sphere or leaving random empty clusters.
    const nodes = displayedItems.map((keyword, index) => ({
      keyword,
      label: displayLabel(keyword.label),
      rank: index,
      featured: index < featuredCount,
      x: halton(index + 1, 2) * 1.9 - .95,
      y: halton(index + 1, 3) * 1.9 - .95,
      z: halton(index + 1, 5) * 1.9 - .95,
      lifeAlpha: 1,
      transition: null,
      spotlightStart: !interactive && index === 0 ? performance.now() : 0,
    }));
    const decorativeNodes = Array.from({ length: interactive ? 76 : (backgroundMode ? 58 : 38) }, (_, index) => ({
      x: halton(index + 19, 2) * 1.94 - .97,
      y: halton(index + 19, 3) * 1.94 - .97,
      z: halton(index + 19, 5) * 1.94 - .97,
      rank: index,
    }));
    const automaticSpin = homeBackground ? .0035 : .0022;
    // The embedded crop exposes narrow bands above and below its content
    // cards. Start it with the nearest terms tilted upward so both bands are
    // populated from the first frame; fullscreen keeps its wider framing.
    let rotationX = backgroundMode ? .16 : -.18, rotationY = .45, velocityX = 0, velocityY = automaticSpin, zoom = 1;
    let viewOffsetX = 0, viewOffsetY = 0;
    let initialBackgroundFraming = backgroundMode;
    let active = false, dragDistance = 0, lastX = 0, lastY = 0, hits = [], frame = 0;
    const pointers = new Map();
    let pinch = null;
    let dragMode = "rotate";
    let lastDraw = 0;
    let previewSlot = 0, previewPoolIndex = displayedItems.length;
    let nextPreviewTransition = performance.now() + 3600;

    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      if (initialBackgroundFraming && bounds.width > 1 && bounds.height > 1) {
        viewOffsetY = -bounds.height * .055;
        initialBackgroundFraming = false;
      }
      const density = Math.min(globalThis.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(bounds.width * density));
      canvas.height = Math.max(1, Math.round(bounds.height * density));
      context.setTransform(density, 0, 0, density, 0, 0);
    };
    const rotate = (node) => {
      const cosY = Math.cos(rotationY), sinY = Math.sin(rotationY), cosX = Math.cos(rotationX), sinX = Math.sin(rotationX);
      const x = node.x * cosY - node.z * sinY, z = node.x * sinY + node.z * cosY;
      return { x, y: node.y * cosX - z * sinX, z: node.y * sinX + z * cosX };
    };
    const draw = (now) => {
      const bounds = canvas.getBoundingClientRect();
      const spreadX = bounds.width * .47 * zoom;
      const spreadY = bounds.height * (backgroundMode ? .49 : .43) * zoom;
      const centreX = bounds.width / 2, centreY = bounds.height / 2;
      const collisionLimited = interactive || backgroundMode || bounds.width <= 590;
      const darkTheme = ["dark","dark-orange"].includes(document.documentElement.dataset.theme);
      const orangeTheme = document.documentElement.dataset.theme === "orange";
      const nordTheme = document.documentElement.dataset.theme === "nord";
      const palette = document.documentElement.dataset.theme === "dark-orange" ? [
        {fill:"#ffc08a",glow:"rgba(255,121,0,.18)"},{fill:"#e6b18b",glow:"rgba(255,121,0,.14)"},
        {fill:"#d3c2b3",glow:"rgba(255,121,0,.12)"},{fill:"#f3a766",glow:"rgba(255,121,0,.16)"},
        {fill:"#c6b4a5",glow:"rgba(255,121,0,.12)"},{fill:"#e6c8ad",glow:"rgba(255,121,0,.12)"}
      ] : nordTheme ? [
        {fill:"#493c43",glow:"rgba(105,68,81,.12)"},{fill:"#684653",glow:"rgba(105,68,81,.12)"},
        {fill:"#6d5f65",glow:"rgba(105,68,81,.12)"},{fill:"#79636b",glow:"rgba(105,68,81,.12)"},
        {fill:"#8d6674",glow:"rgba(105,68,81,.12)"},{fill:"#897261",glow:"rgba(105,68,81,.12)"}
      ] : orangeTheme ? [
        {fill:"#934215",glow:"rgba(180,82,18,.18)"},{fill:"#85572d",glow:"rgba(168,100,38,.17)"},
        {fill:"#9c542c",glow:"rgba(195,101,44,.17)"},{fill:"#795144",glow:"rgba(143,87,54,.16)"},
        {fill:"#925f19",glow:"rgba(185,130,40,.18)"},{fill:"#765c49",glow:"rgba(139,102,64,.16)"}
      ] : darkTheme
        ? [
            { fill: "#9bb8b1", glow: "rgba(112, 160, 148, .24)" },
            { fill: "#a0b2bd", glow: "rgba(111, 143, 162, .22)" },
            { fill: "#b4abc0", glow: "rgba(145, 127, 162, .2)" },
            { fill: "#bda99f", glow: "rgba(157, 128, 113, .19)" },
            { fill: "#aebaa5", glow: "rgba(133, 151, 123, .18)" },
            { fill: "#baaab3", glow: "rgba(153, 128, 143, .18)" },
          ]
        : [
            { fill: "#315b55", glow: "rgba(64, 104, 96, .2)" },
            { fill: "#456273", glow: "rgba(74, 104, 121, .18)" },
            { fill: "#655c76", glow: "rgba(105, 91, 125, .17)" },
            { fill: "#795f52", glow: "rgba(126, 94, 78, .16)" },
            { fill: "#58704f", glow: "rgba(87, 116, 75, .16)" },
            { fill: "#725b69", glow: "rgba(117, 89, 106, .16)" },
          ];
      context.clearRect(0, 0, bounds.width, bounds.height);
      context.save(); context.translate(centreX, centreY);
      const projected = nodes.map((node) => ({ ...node, point: rotate(node) })).sort((left, right) => left.point.z - right.point.z);
      const previewRows = !navigable
        ? new Map([...projected].sort((left, right) => left.point.y - right.point.y).map((node, index, ordered) => [
            node.rank,
            ordered.length === 1 ? 0 : -bounds.height * .4 + index * bounds.height * .8 / (ordered.length - 1),
          ]))
        : null;
      const positioned = projected.map((node) => {
        const perspective = navigable ? .68 + clamp((node.point.z + 1) / 2, 0, 1) * .54 : 1;
        return {
          ...node,
          screenX: navigable
            ? node.point.x * spreadX * perspective + viewOffsetX
            : node.point.x * spreadX,
          screenY: navigable
            ? node.point.y * spreadY * perspective + viewOffsetY
            : previewRows.get(node.rank),
        };
      });

      context.shadowBlur = 0;
      decorativeNodes.forEach((particle) => {
        if (collisionLimited && particle.rank % 3 !== 0) return;
        const point = rotate(particle);
        const depth = clamp((point.z + 1) / 2, 0, 1);
        const tone = palette[particle.rank % palette.length];
        const shimmer = .72 + Math.sin(now * .0011 + particle.rank * .83) * .28;
        context.globalAlpha = ((darkTheme ? .08 : .1) + depth * (darkTheme ? .22 : .25)) * shimmer;
        context.fillStyle = tone.fill;
        context.beginPath();
        context.arc(point.x * spreadX, point.y * spreadY, (.45 + depth * 1.45) * (.86 + shimmer * .18), 0, Math.PI * 2);
        context.fill();
      });

      const anchors = positioned.filter((node) => node.featured);
      context.lineWidth = darkTheme ? .7 : .65;
      if (!collisionLimited) anchors.forEach((node, index) => {
        if (index === 0 || anchors.length < 2) return;
        const nearest = anchors.slice(0, index).reduce((best, candidate) => {
          const distance = Math.hypot(node.screenX - candidate.screenX, node.screenY - candidate.screenY);
          return !best || distance < best.distance ? { candidate, distance } : best;
        }, null);
        if (!nearest || nearest.distance > Math.max(bounds.width, bounds.height) * .72) return;
        const tone = palette[node.rank % palette.length];
        context.globalAlpha = darkTheme ? .08 : .1;
        context.strokeStyle = tone.fill;
        context.beginPath();
        context.moveTo(node.screenX, node.screenY);
        context.lineTo(nearest.candidate.screenX, nearest.candidate.screenY);
        context.stroke();
      });

      hits = [];
      const occupied = [];
      const mobilePriority = (node) => {
        const depthPosition = clamp((node.point.z + 1) / 2, 0, 1);
        const featuredDepth = (homeBackground ? .42 : .18) + Math.pow(depthPosition, 1.8) * (homeBackground ? 1.02 : 1.26);
        const minorDepth = .58 + depthPosition * .58;
        const countWeight = Math.log2(1 + Number(node.keyword.count)) / Math.max(1, Math.log2(1 + maximum));
        const viewportScale = clamp(bounds.width / 980, .82, 1.55);
        const spotlight = !interactive && node.spotlightStart
          ? clamp(1 - (now - node.spotlightStart) / 3600, 0, 1)
          : 0;
        const featuredSize = (17 + countWeight * 12 + (featuredCount - node.rank) * .24) * featuredDepth * viewportScale;
        const minorSize = (7.2 + countWeight * 3.2) * minorDepth * viewportScale;
        const popularity = popularityFor(node.keyword);
        const navigableSize = (8 + popularity * 7.2)
          * (.58 + Math.pow(depthPosition, 1.3) * .86)
          * Math.pow(zoom, .12)
          * viewportScale;
        const estimatedSize = navigable
          ? navigableSize
          : (node.featured ? featuredSize : minorSize) * (1 + spotlight * .72);
        const sizeBand = Math.round(estimatedSize * 2);
        const stableRandom = halton(node.rank + 1, 7);
        return sizeBand * 1000 + spotlight * 100 + node.lifeAlpha * 10 + stableRandom;
      };
      const priorities = collisionLimited
        ? new Map(positioned.map((node) => [node.rank, mobilePriority(node)]))
        : null;
      const renderOrder = collisionLimited
        ? [...positioned].sort((left, right) => priorities.get(right.rank) - priorities.get(left.rank))
        : positioned;
      renderOrder.forEach((node) => {
        const depthPosition = clamp((node.point.z + 1) / 2, 0, 1);
        const featuredDepth = (homeBackground ? .42 : .18) + Math.pow(depthPosition, 1.8) * (homeBackground ? 1.02 : 1.26);
        const minorDepth = .58 + depthPosition * .58;
        const depth = .44 + depthPosition * .68;
        let x = node.screenX;
        let y = node.screenY;
        const countWeight = Math.log2(1 + Number(node.keyword.count)) / Math.max(1, Math.log2(1 + maximum));
        const viewportScale = clamp(bounds.width / 980, .82, 1.55);
        const tone = palette[node.rank % palette.length];
        const spotlight = !interactive && node.spotlightStart
          ? clamp(1 - (now - node.spotlightStart) / 3600, 0, 1)
          : 0;
        if (collisionLimited && node.lifeAlpha < .12) return;
        const featuredSize = (17 + countWeight * 12 + (featuredCount - node.rank) * .24) * featuredDepth * viewportScale;
        const minorSize = (7.2 + countWeight * 3.2) * minorDepth * viewportScale;
        const popularity = popularityFor(node.keyword);
        const size = navigable
          ? (8 + popularity * 7.2)
            * (.58 + Math.pow(depthPosition, 1.3) * .86)
            * Math.pow(zoom, .12)
            * viewportScale
          : (node.featured ? featuredSize : minorSize) * (1 + spotlight * .72);
        context.globalAlpha = navigable
          ? (darkTheme ? .42 + depthPosition * .5 : .48 + depthPosition * .48)
          : ((node.featured || spotlight > 0)
              ? (darkTheme ? .66 + depth * .33 : .72 + depth * .27)
              : (darkTheme ? .32 + depth * .42 : .38 + depth * .36));
        context.globalAlpha *= node.lifeAlpha;
        const featuredMinimum = homeBackground ? 11 : 9;
        const minimumSize = navigable ? 7.5 : (node.featured || spotlight > 0 ? featuredMinimum : 9.5);
        const previewMaximum = spotlight > 0
          ? clamp(bounds.height / 8, 25, 42)
          : (homeBackground && node.featured
              ? clamp(bounds.height / 9, 26, 40)
              : clamp(bounds.height / Math.max(1, displayedItems.length * 1.25), 13, 24));
        let renderedSize = clamp(Math.max(minimumSize, size), minimumSize, navigable ? 58 : previewMaximum);
        const fontWeight = navigable
          ? Math.round(470 + popularity * 82 + depthPosition * 82)
          : (node.featured || spotlight > 0 ? Math.round(650 + spotlight * 90) : 520);
        context.font = `${fontWeight} ${renderedSize.toFixed(1)}px Inter, ui-sans-serif, system-ui, sans-serif`;
        let measured = context.measureText(node.label).width;
        const fitWidth = bounds.width - 18;
        const fit = Math.min(1, fitWidth / Math.max(1, measured));
        if (fit < 1) {
          renderedSize = Math.max(minimumSize, renderedSize * fit);
          context.font = `${fontWeight} ${renderedSize.toFixed(1)}px Inter, ui-sans-serif, system-ui, sans-serif`;
          measured = context.measureText(node.label).width;
        }
        const halfWidth = Math.min(fitWidth / 2, measured / 2);
        if (navigable) {
          const edge = 9;
          if (
            x - halfWidth < -centreX + edge
            || x + halfWidth > centreX - edge
            || y - renderedSize * .72 < -centreY + edge
            || y + renderedSize * .72 > centreY - edge
          ) return;
        } else {
          x = clamp(x, -centreX + halfWidth + 9, centreX - halfWidth - 9);
          y = clamp(y, -centreY + renderedSize, centreY - renderedSize);
        }
        if (collisionLimited) {
          const prominent = (!navigable && node.featured) || spotlight > 0 || renderedSize >= 22;
          const horizontalSpace = prominent ? 11 : 8;
          const verticalSpace = prominent ? 7 : 5;
          const candidate = {
            left: x - halfWidth - horizontalSpace,
            right: x + halfWidth + horizontalSpace,
            top: y - renderedSize * .72 - verticalSpace,
            bottom: y + renderedSize * .72 + verticalSpace,
          };
          const overlaps = occupied.some((placed) => (
            candidate.left < placed.right
            && candidate.right > placed.left
            && candidate.top < placed.bottom
            && candidate.bottom > placed.top
          ));
          if (overlaps) return;
          occupied.push(candidate);
        }
        context.textAlign = "center"; context.textBaseline = "middle";
        if (spotlight > 0 && node.lifeAlpha > .05) {
          const haloRadius = renderedSize * (2.5 + spotlight * 1.5);
          const halo = context.createRadialGradient(x, y, 0, x, y, haloRadius);
          halo.addColorStop(0, tone.glow);
          halo.addColorStop(1, "rgba(0,0,0,0)");
          context.save();
          context.globalAlpha = spotlight * node.lifeAlpha * (darkTheme ? .2 : .19);
          context.fillStyle = halo;
          context.beginPath(); context.arc(x, y, haloRadius, 0, Math.PI * 2); context.fill();
          context.restore();
        }
        context.fillStyle = tone.fill;
        context.shadowColor = tone.glow; context.shadowBlur = ((!navigable && node.featured) ? (darkTheme ? 4 : 5) : (darkTheme ? .8 : .55)) * depth + spotlight * (darkTheme ? 9 : 18);
        context.fillText(node.label, x, y);
        hits.push({ x: centreX + x, y: centreY + y, width: Math.max(8, measured), height: Math.max(8, renderedSize * 1.5), keyword: node.keyword, depth });
      });
      context.restore();
    };
    const animate = (now = performance.now()) => {
      if (cloud._suspended) {
        frame = requestAnimationFrame(animate);
        return;
      }
      if (!interactive && !reducedMotion) {
        if (now >= nextPreviewTransition && (backgroundMode || items.length > displayedItems.length)) {
          const promotableCount = backgroundMode ? Math.min(18, nodes.length) : nodes.length;
          const node = nodes[previewSlot % promotableCount];
          const nextKeyword = backgroundMode ? node.keyword : items[previewPoolIndex % items.length];
          node.transition = { start: now, swapped: false, keyword: nextKeyword };
          previewSlot = (previewSlot + 1) % promotableCount;
          if (!backgroundMode) previewPoolIndex += 1;
          nextPreviewTransition = now + 4200;
        }
        nodes.forEach((node) => {
          if (!node.transition) return;
          const progress = clamp((now - node.transition.start) / 1500, 0, 1);
          if (progress < .5) {
            node.lifeAlpha = 1 - progress * 2;
          } else {
            if (!node.transition.swapped) {
              node.keyword = node.transition.keyword;
              node.label = displayLabel(node.keyword.label);
              node.transition.swapped = true;
              node.spotlightStart = now;
            }
            node.lifeAlpha = (progress - .5) * 2;
          }
          if (progress >= 1) { node.lifeAlpha = 1; node.transition = null; }
        });
      }
      if (!active) {
        rotationX += velocityX; rotationY += velocityY;
        velocityX *= .94; velocityY = Math.abs(velocityY) < automaticSpin ? automaticSpin : velocityY * .94;
      }
      // Keep the resting background economical, then redraw at interaction
      // speed as soon as the reader starts moving through it.
      if (!backgroundMode || active || now - lastDraw >= 55) {
        draw(now);
        lastDraw = now;
      }
      frame = requestAnimationFrame(animate);
    };
    const clampViewOffset = (bounds) => {
      const horizontalLimit = bounds.width * (.34 + Math.max(0, zoom - 1) * .55);
      const verticalLimit = bounds.height * (.34 + Math.max(0, zoom - 1) * .55);
      viewOffsetX = clamp(viewOffsetX, -horizontalLimit, horizontalLimit);
      viewOffsetY = clamp(viewOffsetY, -verticalLimit, verticalLimit);
    };
    const zoomAt = (nextZoom, clientX, clientY) => {
      const bounds = canvas.getBoundingClientRect();
      const selectedZoom = clamp(nextZoom, .62, 2.2);
      if (Math.abs(selectedZoom - zoom) < .0001) return;
      const focusX = clientX - bounds.left - bounds.width / 2;
      const focusY = clientY - bounds.top - bounds.height / 2;
      const ratio = selectedZoom / zoom;
      viewOffsetX = focusX - (focusX - viewOffsetX) * ratio;
      viewOffsetY = focusY - (focusY - viewOffsetY) * ratio;
      zoom = selectedZoom;
      clampViewOffset(bounds);
    };
    const selectAt = (event) => {
      const bounds = canvas.getBoundingClientRect(), x = event.clientX - bounds.left, y = event.clientY - bounds.top;
      const hit = hits.filter((item) => Math.abs(x - item.x) <= item.width / 2 && Math.abs(y - item.y) <= item.height / 2).sort((a, b) => b.depth - a.depth)[0];
      if (hit) onSelect(hit.keyword);
    };

    const expand = () => openModal(items, { ariaLabel, instruction, modalInstruction, closeLabel }, cloud);
    if (navigable) {
      canvas.addEventListener("pointerdown", (event) => {
        pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
        active = true;
        if (pointers.size === 1) {
          dragDistance = 0;
          lastX = event.clientX;
          lastY = event.clientY;
          dragMode = event.ctrlKey ? "pan" : "rotate";
        } else if (pointers.size === 2) {
          const [first, second] = [...pointers.values()];
          pinch = {
            distance: Math.max(1, Math.hypot(second.x - first.x, second.y - first.y)),
            x: (first.x + second.x) / 2,
            y: (first.y + second.y) / 2,
          };
          dragDistance += 12;
        }
        canvas.setPointerCapture(event.pointerId);
      });
      canvas.addEventListener("pointermove", (event) => {
        if (!pointers.has(event.pointerId)) return;
        pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (pointers.size >= 2) {
          const [first, second] = [...pointers.values()];
          const distance = Math.max(1, Math.hypot(second.x - first.x, second.y - first.y));
          const midpointX = (first.x + second.x) / 2;
          const midpointY = (first.y + second.y) / 2;
          if (pinch) {
            zoomAt(zoom * distance / pinch.distance, pinch.x, pinch.y);
            viewOffsetX += midpointX - pinch.x;
            viewOffsetY += midpointY - pinch.y;
            clampViewOffset(canvas.getBoundingClientRect());
            dragDistance += Math.abs(distance - pinch.distance) + Math.abs(midpointX - pinch.x) + Math.abs(midpointY - pinch.y);
          }
          pinch = { distance, x: midpointX, y: midpointY };
          return;
        }
        const dx = event.clientX - lastX, dy = event.clientY - lastY;
        dragDistance += Math.abs(dx) + Math.abs(dy);
        if (dragMode === "pan" || event.ctrlKey) {
          viewOffsetX += dx;
          viewOffsetY += dy;
          velocityX = 0;
          velocityY = 0;
          clampViewOffset(canvas.getBoundingClientRect());
        } else {
          rotationY += dx * .008;
          rotationX += dy * .008;
          velocityY = dx * .0012;
          velocityX = dy * .0012;
        }
        lastX = event.clientX;
        lastY = event.clientY;
      });
      const release = (event) => {
        pointers.delete(event.pointerId);
        active = pointers.size > 0;
        pinch = null;
        if (pointers.size === 1) {
          const remaining = [...pointers.values()][0];
          lastX = remaining.x;
          lastY = remaining.y;
        }
        if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      };
      canvas.addEventListener("pointerup", release); canvas.addEventListener("pointercancel", release);
      canvas.addEventListener("click", (event) => {
        if (dragDistance > 8) return;
        if (interactive) selectAt(event);
        else expand();
      });
      canvas.addEventListener("wheel", (event) => {
        event.preventDefault();
        zoomAt(zoom * Math.exp(-event.deltaY * .0015), event.clientX, event.clientY);
      }, { passive: false });
      canvas.addEventListener("keydown", (event) => {
        if (!interactive && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          expand();
        }
        else if (event.key === "ArrowLeft") rotationY -= .14;
        else if (event.key === "ArrowRight") rotationY += .14;
        else if (event.key === "ArrowUp") rotationX -= .14;
        else if (event.key === "ArrowDown") rotationX += .14;
        else if (event.key === "+" || event.key === "=" || event.key === "-") {
          const bounds = canvas.getBoundingClientRect();
          zoomAt(zoom + (event.key === "-" ? -.1 : .1), bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
        }
        else return;
        event.preventDefault();
      });
    } else {
      canvas.addEventListener("click", expand);
      canvas.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        expand();
      });
    }
    const refresh = () => {
      resize();
      draw(performance.now());
      lastDraw = performance.now();
    };
    const observer = globalThis.ResizeObserver ? new ResizeObserver(resize) : null;
    observer?.observe(cloud); window.addEventListener("resize", resize); resize(); animate();
    const dispose = () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", resize);
      if (cloud._refresh === refresh) delete cloud._refresh;
      delete cloud._suspended;
    };
    cloud._refresh = refresh;
    cloud._dispose = dispose;
    return dispose;
  }

  globalThis.ScriptaKeywordCloud = { mount };
})();
