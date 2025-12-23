import { esc } from "../utils.js";

let paletteMatches = [];
let paletteIndex = 0;

export function toggleCommandPalette(show, options = {}) {
    const { 
        commands = [], 
        onHighlightSelection 
    } = options;

    const overlay = document.getElementById("p-palette-overlay");
    const input = document.getElementById("p-palette-input");
    if (!overlay || !input) return;
    
    const shouldShow = show !== undefined ? show : overlay.hidden;
    overlay.hidden = !shouldShow;
    overlay.style.display = shouldShow ? "flex" : "none";
    
    if (shouldShow) {
        input.value = "";
        renderCommandList("", commands);
        input.focus();
    } else {
        paletteMatches = [];
        paletteIndex = 0;
    }
}

export function renderCommandList(query, commands) {
    const list = document.getElementById("p-palette-list");
    if (!list) return;
    const q = (query || "").toLowerCase();
    const matches = commands.filter((c) => c.title.toLowerCase().includes(q));
    paletteMatches = matches;
    paletteIndex = 0;
    list.innerHTML = matches
        .map(
            (c, index) => `
        <div class="p-palette-item${index === paletteIndex ? " selected" : ""}" data-cmd="${c.id}" data-index="${index}">
            <div class="p-palette-body">
                <span class="p-palette-title">${esc(c.title)}</span>
                <span class="p-palette-id">${c.id}</span>
            </div>
            <span class="p-palette-kb">${c.kb}</span>
        </div>
    `
        )
        .join("");
    highlightPaletteSelection();
}

export function highlightPaletteSelection() {
    const items = document.querySelectorAll(".p-palette-item");
    items.forEach((node, index) => {
        node.classList.toggle("selected", index === paletteIndex);
    });
}

export function executeCommand(id, commands, onExecute) {
    const cmd = commands.find(c => c.id === id);
    if (cmd) {
        cmd.run();
        if (typeof onExecute === 'function') onExecute();
    }
}

export function handlePaletteNavigation(key, commands, executeCommand) {
    if (key === "ArrowDown") {
        if (paletteMatches.length) {
            paletteIndex = (paletteIndex + 1) % paletteMatches.length;
            highlightPaletteSelection();
        }
        return true;
    } else if (key === "ArrowUp") {
        if (paletteMatches.length) {
            paletteIndex = (paletteIndex - 1 + paletteMatches.length) % paletteMatches.length;
            highlightPaletteSelection();
        }
        return true;
    } else if (key === "Enter") {
        const cmd = paletteMatches[paletteIndex];
        if (cmd) {
            executeCommand(cmd.id);
        }
        return true;
    } else if (key === "Escape") {
        toggleCommandPalette(false);
        return true;
    }
    return false;
}

export function getPaletteMatches() {
    return paletteMatches;
}

export function getPaletteIndex() {
    return paletteIndex;
}
