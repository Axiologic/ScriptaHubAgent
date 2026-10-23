(() => {
  const root = document.querySelector('[data-book-release-status]');
  if (!root) return;
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const started = entry => entry.englishPdfReady || entry.enFullSegmentCount || entry.enShortSegmentCount || entry.roFullSegmentCount || entry.roShortSegmentCount ||
    ['en','ro'].some(lang => entry.readers?.[lang]?.['full_content.html'] || entry.readers?.[lang]?.['short_content.html']);
  const stepsDone = entry => [entry.readers?.en?.['full_content.html'], entry.readers?.en?.['short_content.html'],
    entry.readers?.ro?.['full_content.html'], entry.readers?.ro?.['short_content.html'],
    entry.englishPdfReady, entry.coverReady, entry.keywordsRefreshed].filter(Boolean).length;
  const progress = entry => {
    if (!entry.readers?.en?.['full_content.html']) return entry.enFullSegmentCount
      ? entry.enFullSegmentsComplete >= entry.enFullSegmentCount
        ? `Traducere integrală EN: ${entry.enFullSegmentCount}/${entry.enFullSegmentCount}; urmează asamblarea și verificarea`
        : `Traducere integrală EN: ${entry.enFullSegmentsComplete}/${entry.enFullSegmentCount} segmente`
      : 'Urmează conversia textului integral EN';
    if (entry.roFullSegmentCount && !entry.readers?.ro?.['full_content.html']) return entry.roFullSegmentsComplete >= entry.roFullSegmentCount
      ? `Traducere integrală RO: ${entry.roFullSegmentCount}/${entry.roFullSegmentCount}; urmează asamblarea și verificarea`
      : `Traducere integrală RO: ${entry.roFullSegmentsComplete}/${entry.roFullSegmentCount} segmente`;
    if (!entry.readers?.en?.['short_content.html']) return entry.enShortSegmentCount
      ? entry.enShortSegmentsComplete >= entry.enShortSegmentCount
        ? `Traducere scurtă EN: ${entry.enShortSegmentCount}/${entry.enShortSegmentCount}; urmează asamblarea și verificarea`
        : `Traducere scurtă EN: ${entry.enShortSegmentsComplete}/${entry.enShortSegmentCount} segmente`
      : 'Urmează ediția EN de zece minute';
    if (!entry.readers?.ro?.['full_content.html']) return 'Urmează traducerea integrală RO';
    if (!entry.readers?.ro?.['short_content.html']) return entry.roShortSegmentCount
      ? entry.roShortSegmentsComplete >= entry.roShortSegmentCount
        ? `Traducere scurtă RO: ${entry.roShortSegmentCount}/${entry.roShortSegmentCount}; urmează asamblarea și verificarea`
        : `Traducere scurtă RO: ${entry.roShortSegmentsComplete}/${entry.roShortSegmentCount} segmente`
      : 'Urmează ediția RO de zece minute';
    if (!entry.englishPdfReady) return 'Urmează PDF-ul EN nou';
    if (!entry.coverReady) return 'Urmează verificarea copertei';
    if (!entry.keywordsRefreshed) return entry.keywordReviewCount
      ? `Metadate: ${entry.keywordReviewCount} expresii revizuite; urmează setul final de 100 de cuvinte-cheie`
      : `Metadate și cuvinte-cheie: ${entry.keywordCount || 0}/100`;
    return 'Verificarea finală și publicarea';
  };
  function render() {
    const data = window.SCRIPTA_BOOK_RELEASE_STATUS;
    if (!data) { root.textContent = 'Progresul cărților nu a fost generat încă.'; return; }
    const oldSearch = root.querySelector('[data-release-search]');
    const query = oldSearch?.value || '';
    const focus = document.activeElement === oldSearch;
    const openGroups = new Set([...root.querySelectorAll('details[data-release-group][open]')].map(node => node.dataset.releaseGroup));
    const rows = data.releases || [];
    const incoming = rows.filter(row => row.source?.startsWith('income/'));
    const excluded = data.excludedSources || [];
    const alreadyInstalled = excluded.filter(row => row.status === 'already-installed');
    const historicalReview = excluded.filter(row => row.status === 'historical-precursor-review');
    const installed = incoming.filter(row => row.status === 'installed');
    const preparing = incoming.filter(row => row.status !== 'installed');
    const focusSet = new Set(data.currentFocus || []);
    const active = preparing.filter(row => focusSet.has(row.source)).sort((a,b) => stepsDone(b) - stepsDone(a) || a.title.localeCompare(b.title));
    const startedOther = preparing.filter(row => started(row) && !focusSet.has(row.source));
    const waiting = preparing.filter(row => !started(row) && !focusSet.has(row.source));
    installed.sort((a,b) => String(b.changedAt || '').localeCompare(String(a.changedAt || '')));
    const completion = incoming.length ? Math.round(installed.length / incoming.length * 100) : 0;
    const item = entry => {
      const state = entry.status === 'installed' ? 'Publicată' : focusSet.has(entry.source) ? 'În lucru acum' : started(entry) ? 'Conversie începută' : 'În așteptare';
      return `<li data-release-title="${escape(entry.title.toLocaleLowerCase('ro-RO'))}"><a href="${escape(entry.bookPage)}?lang=ro">${escape(entry.title)}</a><span class="release-state">${state}</span><small>${escape(entry.status === 'installed' ? 'Edițiile EN/RO, coperta și PDF-ul sunt publicate.' : progress(entry))}</small>${entry.status === 'installed' ? '' : `<div class="release-progress" role="meter" aria-label="Etape pregătite" aria-valuemin="0" aria-valuemax="7" aria-valuenow="${stepsDone(entry)}"><span style="width:${Math.round(stepsDone(entry)/7*100)}%"></span></div><small>${stepsDone(entry)}/7 etape pregătite</small>`}</li>`;
    };
    root.innerHTML = `<p class="status-updated">Date actualizate: ${escape(new Date(data.updatedAt).toLocaleString('ro-RO'))} · pagina verifică progresul la fiecare minut</p>
      <div class="status-counts"><div><strong>${installed.length}</strong><span>Publicate din income</span></div><div><strong>${preparing.length}</strong><span>Rămase de publicat</span></div><div><strong>${active.length}</strong><span>În lucru acum</span></div><div><strong>${startedOther.length}</strong><span>Alte conversii începute</span></div><div><strong>${waiting.length}</strong><span>Conversie neîncepută</span></div><div><strong>${incoming.length}</strong><span>Total titluri</span></div></div>
      <div class="release-overall"><strong>${completion}% din lot publicat</strong><span>${installed.length} din ${incoming.length} titluri</span><div class="release-progress" role="meter" aria-label="Cărți publicate din income" aria-valuemin="0" aria-valuemax="${incoming.length}" aria-valuenow="${installed.length}"><span style="width:${completion}%"></span></div></div>
      <p class="status-note">Lotul de ${incoming.length} titluri exclude ${alreadyInstalled.length} surse deja instalate și ${historicalReview.length} surse aflate în verificare ca posibile ediții istorice; acestea nu sunt procesate automat. „În lucru acum” urmărește cărțile la care se lucrează în această sesiune. Etapa următoare apare sub fiecare titlu. Cititoarele se pregătesc numai în EN și RO. Sursele din income se curăță după verificarea tuturor cărților.</p>
      <label class="status-search">Caută o carte din lot<input type="search" placeholder="Titlu" data-release-search></label>
      <section class="status-group"><h2>În lucru acum <small>${active.length}</small></h2><ul class="release-list">${active.map(item).join('') || '<li>Nu există conversii pornite.</li>'}</ul></section>
      <details class="status-group release-fold" data-release-group="started"><summary>Alte conversii începute (${startedOther.length})</summary><ul class="release-list">${startedOther.map(item).join('')}</ul></details>
      <details class="status-group release-fold" data-release-group="waiting"><summary>Conversie neîncepută (${waiting.length})</summary><ul class="release-list">${waiting.map(item).join('')}</ul></details>
      <details class="status-group release-fold" data-release-group="installed"><summary>Publicate din income (${installed.length})</summary><ul class="release-list">${installed.map(item).join('')}</ul></details>
      <details class="status-group release-fold" data-release-group="excluded"><summary>Surse excluse din conversia automată (${excluded.length})</summary><ul class="release-list">${excluded.map(entry => `<li data-release-title="${escape(entry.title.toLocaleLowerCase('ro-RO'))}"><strong>${escape(entry.title)}</strong><span class="release-state">${entry.status === 'already-installed' ? 'Deja instalată' : 'Posibilă ediție istorică'}</span><small>${escape(entry.source)}</small></li>`).join('')}</ul></details>`;
    const search = root.querySelector('[data-release-search]');
    const applySearch = () => {
      const value = search.value.toLocaleLowerCase('ro-RO').trim();
      root.querySelectorAll('[data-release-title]').forEach(node => { node.hidden = !node.dataset.releaseTitle.includes(value); });
      if (value) root.querySelectorAll('.release-fold').forEach(node => { node.open = true; });
    };
    root.querySelectorAll('details[data-release-group]').forEach(node => { node.open = openGroups.has(node.dataset.releaseGroup); });
    search.addEventListener('input', applySearch);
    search.value = query;
    applySearch();
    if (focus) search.focus({preventScroll:true});
  }
  render();
  let refreshing = false;
  const refresh = () => {
    if (refreshing) return;
    refreshing = true;
    const script = document.createElement('script');
    script.src = `assets/book-release-status.js?t=${Date.now()}`;
    script.onload = () => { refreshing = false; script.remove(); render(); };
    script.onerror = () => { refreshing = false; script.remove(); };
    document.head.append(script);
  };
  setInterval(refresh, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
})();
