import { esc, renderMarkdown, eventTagValue } from "../utils.js";

export function renderContent(container, item, options = {}) {
    const { 
        isEditMode = false, 
        updateStatus, 
        TYPE_LABELS = {} 
    } = options;

    if (!container) return;
    
    container.innerHTML = "";
    container.scrollTop = 0;

    if (!item) return;

    if (isEditMode) {
        const wrap = document.createElement("div");
        wrap.className = "p-edit-view";
        wrap.innerHTML = `
            <div class="p-gutter" id="p-gutter">1</div>
            <textarea class="p-editor-textarea" id="p-editor" spellcheck="false" placeholder="Write NCC content in Markdown..."></textarea>
        `;
        container.appendChild(wrap);
        
        const textarea = wrap.querySelector("textarea");
        textarea.value = item.content || "";
        
        textarea.oninput = (e) => {
            if (e.isTrusted && typeof updateStatus === 'function') {
                updateStatus("• Unsaved changes");
            }
            syncGutter(textarea);
        };
        textarea.onscroll = () => {
            const gutter = document.getElementById("p-gutter");
            if (gutter) gutter.scrollTop = textarea.scrollTop;
        };

        requestAnimationFrame(() => {
            syncGutter(textarea);
            textarea.focus();
        });
    } else {
        const view = document.createElement("article");
        view.className = "p-read-view";
        
        const status = (item.status || "published").toLowerCase();
        let headerHtml = `<div class="p-content-header">
            <h1>${esc(item.title || eventTagValue(item.tags, "title") || "Untitled")}</h1>
            <div class="p-content-meta">
                <span class="p-badge">${TYPE_LABELS[item.kind] || 'Unknown'}</span>
                <span class="p-badge status-${status}">${status.toUpperCase()}</span>
                <span>${item.d || ""}</span>
            </div>
        </div>`;
        
        view.innerHTML = headerHtml + renderMarkdown(item.content || "_No content available._");
        container.appendChild(view);
    }
}

function syncGutter(textarea) {
    const gutter = document.getElementById("p-gutter");
    if (!gutter) return;
    const lineCount = textarea.value.split("\n").length;
    let gutterHtml = "";
    for (let i = 1; i <= lineCount; i++) {
        gutterHtml += i + "<br>";
    }
    gutter.innerHTML = gutterHtml;
}
