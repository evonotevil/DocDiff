(() => {
  'use strict';

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const revealElements = document.querySelectorAll('.reveal');
  if (!reducedMotion.matches && 'IntersectionObserver' in window) {
    document.documentElement.classList.add('js');
    const observer = new IntersectionObserver((entries, currentObserver) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          currentObserver.unobserve(entry.target);
        }
      });
    }, { threshold: 0.08, rootMargin: '0px 0px -24px 0px' });
    revealElements.forEach((element) => observer.observe(element));
    reducedMotion.addEventListener?.('change', (event) => {
      if (event.matches) {
        document.documentElement.classList.remove('js');
        observer.disconnect();
      }
    });
  }

  document.querySelectorAll('[data-tab-group]').forEach((group) => {
    const groupName = group.dataset.tabGroup;
    const tabs = Array.from(group.querySelectorAll('[role="tab"][data-tab]'));
    const panels = Array.from(document.querySelectorAll(`[data-panel-group="${groupName}"]`));
    const select = (tab, focus = false) => {
      tabs.forEach((item) => {
        const active = item === tab;
        item.setAttribute('aria-selected', String(active));
        item.tabIndex = active ? 0 : -1;
      });
      panels.forEach((panel) => { panel.hidden = panel.dataset.panel !== tab.dataset.tab; });
      if (focus) tab.focus();
    };
    tabs.forEach((tab, index) => {
      tab.addEventListener('click', () => select(tab));
      tab.addEventListener('keydown', (event) => {
        let next = null;
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % tabs.length;
        if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + tabs.length) % tabs.length;
        if (event.key === 'Home') next = 0;
        if (event.key === 'End') next = tabs.length - 1;
        if (next !== null) { event.preventDefault(); select(tabs[next], true); }
      });
    });
  });

  const versionData = {
    v1: { title: '我方标准合同', term: '30 日', amount: '¥120,000' },
    v2: { title: '对方首次修改', term: '15 日', amount: '¥198,000' },
    v3: { title: '对方第二轮修改', term: '20 日', amount: '¥198,000' },
  };
  const versionFrom = document.querySelector('#version-from');
  const versionTo = document.querySelector('#version-to');
  const versionSummary = document.querySelector('#version-summary');
  const versionPairNote = document.querySelector('#version-pair-note');
  const renderVersionPair = () => {
    if (!versionFrom || !versionTo) return;
    const from = versionData[versionFrom.value];
    const to = versionData[versionTo.value];
    if (!from || !to) return;
    versionFrom.querySelectorAll('option').forEach((option) => { option.disabled = option.value >= versionTo.value; });
    versionTo.querySelectorAll('option').forEach((option) => { option.disabled = option.value <= versionFrom.value; });
    document.querySelectorAll('[data-version-pair]').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.versionPair === `${versionFrom.value}-${versionTo.value}`));
    });
    document.querySelectorAll('[data-version-row]').forEach((row) => {
      row.dataset.included = String(row.dataset.versionRow === versionFrom.value || row.dataset.versionRow === versionTo.value);
    });
    versionSummary.textContent = `正在比较 ${versionFrom.value.toUpperCase()} → ${versionTo.value.toUpperCase()}`;
    versionPairNote.textContent = `从${from.title}到${to.title}。`;
    document.querySelector('#version-amount-label').textContent = from.amount === to.amount ? '合同总额 · 无变化' : '合同总额';
    [['term', 'term'], ['amount', 'amount']].forEach(([key, suffix]) => {
      const before = document.querySelector(`#version-before-${suffix}`);
      const after = document.querySelector(`#version-after-${suffix}`);
      before.textContent = from[key];
      after.textContent = to[key];
      before.classList.toggle('is-unchanged', from[key] === to[key]);
      after.classList.toggle('is-unchanged', from[key] === to[key]);
    });
  };
  versionFrom?.addEventListener('change', renderVersionPair);
  versionTo?.addEventListener('change', renderVersionPair);
  document.querySelectorAll('[data-version-pair]').forEach((button) => button.addEventListener('click', () => {
    const [from, to] = button.dataset.versionPair.split('-');
    versionFrom.value = from;
    versionTo.value = to;
    renderVersionPair();
  }));
  renderVersionPair();

  const templateVersions = {
    v1: { label: '标准供货框架协议 V1', term: '30 日' },
    v2: { label: '标准供货框架协议 V2', term: '20 日' },
  };
  const templateBaseline = document.querySelector('#template-baseline');
  const templateBeforeTerm = document.querySelector('#template-before-term');
  document.querySelectorAll('[data-template-version]').forEach((button) => button.addEventListener('click', () => {
    const selected = templateVersions[button.dataset.templateVersion];
    if (!selected || !templateBaseline || !templateBeforeTerm) return;
    document.querySelectorAll('[data-template-version]').forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
    templateBaseline.textContent = selected.label;
    templateBeforeTerm.textContent = selected.term;
  }));

  const keywordList = document.querySelector('#keyword-list');
  const keywordForm = document.querySelector('#keyword-form');
  const keywordInput = document.querySelector('#keyword-input');
  const keywordHit = document.querySelector('#keyword-hit');
  const keywordFeedback = document.querySelector('#keyword-feedback');
  const demoChange = '第七条 违约责任：违约金比例由 10% 调整为 15%。';
  const keywords = new Map([['违约', true], ['赔偿', true], ['责任上限', true]]);
  const renderKeywords = () => {
    if (!keywordList || !keywordHit) return;
    keywordList.replaceChildren();
    keywords.forEach((enabled, word) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.keyword = word;
      button.setAttribute('aria-pressed', String(enabled));
      button.append(document.createTextNode(`${word} `));
      const check = document.createElement('span');
      check.textContent = '✓';
      check.setAttribute('aria-hidden', 'true');
      button.append(check);
      button.addEventListener('click', () => { keywords.set(word, !keywords.get(word)); renderKeywords(); });
      keywordList.append(button);
    });
    const hit = Array.from(keywords).find(([word, enabled]) => enabled && demoChange.includes(word));
    keywordHit.classList.toggle('is-empty', !hit);
    const symbol = document.createElement('span');
    symbol.setAttribute('aria-hidden', 'true');
    symbol.textContent = hit ? '!' : '·';
    const copy = document.createElement('div');
    const title = document.createElement('b');
    const detail = document.createElement('small');
    title.textContent = hit ? `关键词：${hit[0]}` : '当前示例没有命中已启用的关键词';
    detail.textContent = hit ? '第七条 · 违约责任的内容有变化' : '试着启用“违约”，或添加与示例条款相同的词。';
    copy.append(title, detail);
    keywordHit.replaceChildren(symbol, copy);
  };
  keywordForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    const word = keywordInput.value.trim();
    if (!word) { if (keywordFeedback) keywordFeedback.textContent = '先输入一个关键词。'; keywordInput.focus(); return; }
    if (keywords.has(word)) { if (keywordFeedback) keywordFeedback.textContent = '这个关键词已经在列表里。'; keywordInput.focus(); return; }
    if (keywords.size >= 8) { if (keywordFeedback) keywordFeedback.textContent = '示例最多展示 8 个关键词。'; return; }
    keywords.set(word, true);
    keywordInput.value = '';
    if (keywordFeedback) keywordFeedback.textContent = `已添加示例关键词“${word}”。`;
    renderKeywords();
  });
  renderKeywords();

  const latestReleasePage = 'https://github.com/evonotevil/DocDiff/releases/latest';
  const latestChecksum = 'https://github.com/evonotevil/DocDiff/releases/latest/download/SHA256SUMS.txt';
  const platforms = {
    macArm: { href: latestReleasePage, label: '前往发布页', meta: '前往最新版发布页下载 · Apple 芯片 · macOS 11 及以上' },
    macIntel: { href: latestReleasePage, label: '前往发布页', meta: '前往最新版发布页下载 · Intel 芯片 · macOS 11 及以上' },
    windows: { href: latestReleasePage, label: '前往发布页', meta: '前往最新版发布页下载 · Windows 10 / 11 · 64 位' },
  };
  const platformButtons = Array.from(document.querySelectorAll('[data-platform]'));
  const downloadLink = document.querySelector('#download-link');
  const downloadMeta = document.querySelector('#download-meta');
  const releasePageLink = document.querySelector('#release-page-link');
  const downloadChecksum = document.querySelector('#download-checksum');
  const selectedPlatform = () => platformButtons.find((button) => button.getAttribute('aria-pressed') === 'true')?.dataset.platform || 'macArm';
  const renderPlatform = (platform) => {
    const option = platforms[platform];
    if (!option || !downloadLink || !downloadMeta) return;
    platformButtons.forEach((item) => item.setAttribute('aria-pressed', String(item.dataset.platform === platform)));
    downloadLink.href = option.href;
    const arrow = document.createElement('span');
    arrow.setAttribute('aria-hidden', 'true');
    arrow.textContent = option.href === latestReleasePage ? '↗' : '↓';
    downloadLink.replaceChildren(document.createTextNode(option.label), arrow);
    downloadMeta.textContent = option.meta;
  };
  platformButtons.forEach((button) => button.addEventListener('click', () => renderPlatform(button.dataset.platform)));

  const isOfficialReleaseUrl = (value, version, kind = 'download') => {
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.username || url.password || url.search || url.hash) return false;
      const expected = kind === 'page'
        ? `/evonotevil/DocDiff/releases/tag/v${version}`
        : `/evonotevil/DocDiff/releases/download/v${version}/`;
      return kind === 'page' ? url.pathname === expected : url.pathname.startsWith(expected);
    } catch {
      return false;
    }
  };

  const applyReleaseMetadata = (metadata) => {
    const version = typeof metadata?.version === 'string' ? metadata.version.trim() : '';
    const downloads = metadata?.downloads;
    if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version) || !downloads) return false;
    const urls = {
      macArm: downloads['mac-arm64'],
      macIntel: downloads['mac-x64'],
      windows: downloads['win-exe'],
    };
    const expectedFiles = {
      macArm: `DocDiff-${version}-mac-arm64.dmg`,
      macIntel: `DocDiff-${version}-mac-x64.dmg`,
      windows: `DocDiff-Setup-${version}.exe`,
    };
    const downloadsAreValid = Object.entries(urls).every(([platform, url]) => {
      if (!isOfficialReleaseUrl(url, version)) return false;
      return new URL(url).pathname.endsWith(`/${expectedFiles[platform]}`);
    });
    if (!downloadsAreValid || !isOfficialReleaseUrl(downloads.page, version, 'page')) return false;
    Object.assign(platforms.macArm, { href: urls.macArm, label: '下载 macOS 版', meta: `${version} · Apple 芯片 · macOS 11 及以上` });
    Object.assign(platforms.macIntel, { href: urls.macIntel, label: '下载 macOS 版', meta: `${version} · Intel 芯片 · macOS 11 及以上` });
    Object.assign(platforms.windows, { href: urls.windows, label: '下载 Windows 版', meta: `${version} · Windows 10 / 11 · 64 位` });
    if (releasePageLink) releasePageLink.href = downloads.page;
    if (downloadChecksum) downloadChecksum.href = `https://github.com/evonotevil/DocDiff/releases/download/v${version}/SHA256SUMS.txt`;
    renderPlatform(selectedPlatform());
    return true;
  };

  renderPlatform(selectedPlatform());
  if (releasePageLink) releasePageLink.href = latestReleasePage;
  if (downloadChecksum) downloadChecksum.href = latestChecksum;
  if (location.protocol !== 'file:') {
    const scriptUrl = document.currentScript?.src || location.href;
    fetch(new URL('../updates/latest.json', scriptUrl), { cache: 'no-store', headers: { Accept: 'application/json' } })
      .then((response) => {
        if (!response.ok) throw new Error(`Release metadata request failed: ${response.status}`);
        return response.json();
      })
      .then((metadata) => { applyReleaseMetadata(metadata); })
      .catch(() => { /* Keep the safe latest-release fallback. */ });
  }

  document.querySelectorAll('details.mobile-nav a[href^="#"]').forEach((link) => link.addEventListener('click', () => {
    const menu = link.closest('details.mobile-nav');
    if (menu) menu.open = false;
  }));
})();
