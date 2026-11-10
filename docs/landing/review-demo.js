(() => {
  "use strict";

  const differences = [
    {
      context: "付款期限",
      before: "三十日",
      after: "十五日",
    },
    {
      context: "合同金额",
      before: "120,000 元",
      after: "198,000 元",
    },
  ];

  const verdicts = {
    accept: {
      label: "接受",
      preview: (difference) => `接受修改，审阅结果采用“${difference.after}”。`,
    },
    reject: {
      label: "拒绝",
      preview: (difference) => `拒绝修改，审阅结果恢复为“${difference.before}”。`,
    },
    hold: {
      label: "待议",
      preview: () => "暂不定稿；演示中会将该处标记为待确认，并附加审阅批注。",
    },
  };

  const createElement = (tagName, text, className) => {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    if (text) element.textContent = text;
    return element;
  };

  const initReviewDemo = () => {
    const root = document.querySelector("#review-demo");
    if (!root || root.dataset.reviewDemoReady === "true") return;

    const elements = {
      index: root.querySelector("#demo-index"),
      context: root.querySelector("#demo-context"),
      before: root.querySelector("#demo-before"),
      after: root.querySelector("#demo-after"),
      progressText: root.querySelector("#demo-progress-text"),
      progressFill: root.querySelector("#demo-progress-fill"),
      note: root.querySelector("#demo-note"),
      status: root.querySelector("#demo-status"),
      draftStatus: root.querySelector("#demo-draft-status"),
      draftPreview: root.querySelector("#demo-draft-preview"),
      previewDraft: root.querySelector("#demo-preview-draft"),
      reset: root.querySelector("#demo-reset"),
      previous: root.querySelector("#demo-prev"),
      next: root.querySelector("#demo-next"),
      verdictButtons: Array.from(
        root.querySelectorAll('[data-demo-verdict="accept"], [data-demo-verdict="reject"], [data-demo-verdict="hold"]'),
      ),
    };

    const requiredElements = [
      elements.index,
      elements.context,
      elements.before,
      elements.after,
      elements.progressText,
      elements.progressFill,
      elements.note,
      elements.status,
      elements.draftStatus,
      elements.draftPreview,
      elements.previewDraft,
      elements.reset,
      elements.previous,
      elements.next,
    ];

    if (requiredElements.some((element) => !element) || elements.verdictButtons.length === 0) {
      root.dataset.reviewDemoState = "unavailable";
      return;
    }

    let currentIndex = 0;
    let hasDraftPreview = false;
    const reviews = differences.map(() => ({ verdict: null, note: "" }));

    root.dataset.reviewDemoReady = "true";
    elements.status.setAttribute("aria-live", "polite");
    elements.status.setAttribute("aria-atomic", "true");
    elements.progressFill.setAttribute("role", "progressbar");
    elements.progressFill.setAttribute("aria-valuemin", "0");
    elements.progressFill.setAttribute("aria-valuemax", String(differences.length));

    const announce = (message) => {
      elements.status.textContent = message;
    };

    const saveCurrentNote = () => {
      reviews[currentIndex].note = elements.note.value;
    };

    const getReviewedCount = () => reviews.filter((review) => review.verdict !== null).length;

    const renderProgress = () => {
      const reviewedCount = getReviewedCount();
      const percentage = Math.round((reviewedCount / differences.length) * 100);
      elements.progressText.textContent = `已审 ${reviewedCount} / ${differences.length} 处`;
      elements.progressFill.style.transform = `scaleX(${percentage / 100})`;
      elements.progressFill.setAttribute("aria-valuenow", String(reviewedCount));
      elements.progressFill.setAttribute(
        "aria-valuetext",
        `示例审阅进度：已处理 ${reviewedCount} 处，共 ${differences.length} 处`,
      );
    };

    const appendDraftItem = (difference, review, index) => {
      const item = createElement("section", "", "demo-draft-item");
      const heading = createElement(
        "h5",
        `${index + 1}. ${difference.context}`,
        "demo-draft-item__title",
      );
      const change = createElement(
        "p",
        `原文：${difference.before}；修改为：${difference.after}`,
        "demo-draft-item__change",
      );
      const resultText = review.verdict
        ? verdicts[review.verdict].preview(difference)
        : "尚未作出决定；演示预览会暂时保留该处修改，等待审阅。";
      const result = createElement("p", `审阅决定：${resultText}`, "demo-draft-item__result");

      item.dataset.verdict = review.verdict || "pending";
      item.append(heading, change, result);

      if (review.note.trim()) {
        item.append(
          createElement(
            "p",
            `批注（演示）：${review.note.trim()}`,
            "demo-draft-item__comment",
          ),
        );
      } else if (review.verdict === "hold") {
        item.append(
          createElement(
            "p",
            "批注（演示）：此处待议，需相关人员进一步确认。",
            "demo-draft-item__comment",
          ),
        );
      }

      elements.draftPreview.append(item);
    };

    const renderDraftPreview = (isAutomaticSync = false) => {
      saveCurrentNote();
      const reviewedCount = getReviewedCount();
      const hasAnyNote = reviews.some((review) => review.note.trim());

      elements.draftPreview.replaceChildren();
      elements.draftPreview.hidden = false;
      elements.draftPreview.dataset.demoDraftState = reviewedCount === 0 && !hasAnyNote ? "empty" : "ready";
      elements.draftPreview.append(
        createElement("h4", "审阅稿预览（示例演示）", "demo-draft-preview__title"),
        createElement(
          "p",
          "以下内容仅模拟审阅结果与 Word 批注的呈现方式，不会读取、创建、修改或下载真实文件。",
          "demo-draft-preview__notice",
        ),
      );

      if (reviewedCount === 0 && !hasAnyNote) {
        elements.draftPreview.append(
          createElement(
            "p",
            "目前还没有审阅决定或备注。你可以继续处理下方两处示例差异，预览会自动同步。",
            "demo-draft-preview__empty",
          ),
        );
      }

      differences.forEach((difference, index) => appendDraftItem(difference, reviews[index], index));

      const syncPrefix = isAutomaticSync ? "已自动同步" : "已更新";
      elements.draftStatus.textContent = `${syncPrefix}示例审阅稿预览 · ${reviewedCount} / ${differences.length} 处已决定（未生成真实 Word 文件）`;
      elements.previewDraft.textContent = "刷新审阅稿预览（演示）";
    };

    const syncDraftIfNeeded = () => {
      if (hasDraftPreview) renderDraftPreview(true);
    };

    const renderCurrentDifference = () => {
      const difference = differences[currentIndex];
      const review = reviews[currentIndex];

      elements.index.textContent = `第 ${currentIndex + 1} / ${differences.length} 处`;
      elements.context.textContent = difference.context;
      elements.before.textContent = difference.before;
      elements.after.textContent = difference.after;
      elements.note.value = review.note;
      root.dataset.currentDemoItem = String(currentIndex + 1);

      elements.verdictButtons.forEach((button) => {
        const isSelected = button.dataset.demoVerdict === review.verdict;
        button.setAttribute("aria-pressed", String(isSelected));
        button.classList.toggle("is-selected", isSelected);
      });

      elements.previous.disabled = currentIndex === 0;
      elements.next.disabled = currentIndex === differences.length - 1;
      elements.previous.setAttribute("aria-disabled", String(elements.previous.disabled));
      elements.next.setAttribute("aria-disabled", String(elements.next.disabled));
      renderProgress();
    };

    const selectVerdict = (verdict) => {
      if (!verdicts[verdict]) return;
      saveCurrentNote();
      reviews[currentIndex].verdict = verdict;
      renderCurrentDifference();
      syncDraftIfNeeded();
      announce(
        `示例：第 ${currentIndex + 1} 处“${differences[currentIndex].context}”已标记为${verdicts[verdict].label}。此操作不会修改真实文件。`,
      );
    };

    const moveTo = (nextIndex) => {
      if (nextIndex < 0 || nextIndex >= differences.length || nextIndex === currentIndex) return;
      saveCurrentNote();
      syncDraftIfNeeded();
      currentIndex = nextIndex;
      renderCurrentDifference();
      announce(`已切换到第 ${currentIndex + 1} 处示例差异：${differences[currentIndex].context}。`);
    };

    elements.verdictButtons.forEach((button) => {
      button.addEventListener("click", () => selectVerdict(button.dataset.demoVerdict));
    });

    root.addEventListener("keydown", (event) => {
      if (event.repeat || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;

      const target = event.target;
      const isEditableTarget =
        target instanceof HTMLElement &&
        (target.matches("input, textarea, select") || target.isContentEditable);
      if (isEditableTarget) return;

      const shortcutVerdicts = {
        a: "accept",
        r: "reject",
        h: "hold",
      };
      const verdict = shortcutVerdicts[event.key.toLowerCase()];
      if (!verdict) return;

      event.preventDefault();
      selectVerdict(verdict);
    });

    elements.note.addEventListener("input", () => {
      saveCurrentNote();
      syncDraftIfNeeded();
    });

    elements.note.addEventListener("change", () => {
      const hasNote = reviews[currentIndex].note.trim().length > 0;
      announce(
        hasNote
          ? `示例：已保存第 ${currentIndex + 1} 处备注，并${hasDraftPreview ? "同步到审阅稿预览" : "保存在本次演示中"}。`
          : `示例：已清空第 ${currentIndex + 1} 处备注。`,
      );
    });

    elements.previous.addEventListener("click", () => moveTo(currentIndex - 1));
    elements.next.addEventListener("click", () => moveTo(currentIndex + 1));

    elements.previewDraft.addEventListener("click", () => {
      hasDraftPreview = true;
      renderDraftPreview(false);
      announce("已显示并同步示例审阅稿预览。这里只模拟界面效果，没有生成真实 Word 文件。");
    });

    elements.reset.addEventListener("click", () => {
      reviews.forEach((review) => {
        review.verdict = null;
        review.note = "";
      });
      currentIndex = 0;
      hasDraftPreview = false;
      elements.draftPreview.replaceChildren();
      elements.draftPreview.hidden = true;
      elements.draftPreview.dataset.demoDraftState = "hidden";
      elements.draftStatus.textContent = "尚未生成审阅稿预览（示例演示）";
      elements.previewDraft.textContent = "模拟生成审阅稿";
      renderCurrentDifference();
      announce("示例审阅已重置。所有决定和备注均已清空，未影响任何真实文件。");
    });

    elements.draftPreview.hidden = true;
    elements.draftPreview.dataset.demoDraftState = "hidden";
    elements.draftStatus.textContent = "尚未生成审阅稿预览（示例演示）";
    renderCurrentDifference();
    announce("示例审阅已就绪，共有 2 处差异。所有操作仅保存在当前页面内存中。");
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initReviewDemo, { once: true });
  } else {
    initReviewDemo();
  }
})();
