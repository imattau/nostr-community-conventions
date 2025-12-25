import test from 'node:test';
import assert from 'node:assert';
import { JSDOM } from 'jsdom';

test('PowerUI Buttons and Events', async (t) => {
    // 1. Setup JSDOM
    const dom = new JSDOM('<!DOCTYPE html><html><body><div id="shell-power"></div></body></html>', {
        url: "http://localhost/",
        pretendToBeVisual: true
    });
    
    global.window = dom.window;
    global.document = dom.window.document;
    
    Object.defineProperty(global, 'navigator', {
      value: dom.window.navigator,
      writable: true,
      configurable: true
    });

    global.HTMLElement = dom.window.HTMLElement;
    global.NodeList = dom.window.NodeList;
    global.Event = dom.window.Event;
    global.KeyboardEvent = dom.window.KeyboardEvent;
    global.MouseEvent = dom.window.MouseEvent;
    global.CustomEvent = dom.window.CustomEvent;
    global.Node = dom.window.Node;

    // Polyfill requestAnimationFrame
    global.requestAnimationFrame = (cb) => setTimeout(cb, 0);

    // Mock QRCode
    // We can't easily mock ES module imports without a loader in Node.js.
    // However, if the code imports 'qrcode', node will try to resolve it.
    // 'qrcode' is a dependency, so it should load fine.
    
    // Import power_ui.js
    const powerUI = await import('./power_ui.js');
    const { initPowerShell } = powerUI;

    // Helper to simulate events
    function triggerEvent(el, type, options = {}) {
        const event = new dom.window.Event(type, { bubbles: true, cancelable: true, ...options });
        Object.assign(event, options);
        el.dispatchEvent(event);
    }

    // Helper to simulate MouseEvent
    function triggerMouseEvent(el, type, options = {}) {
        const event = new dom.window.MouseEvent(type, { bubbles: true, cancelable: true, ...options });
        el.dispatchEvent(event);
    }

    // Mock state
    const mockState = {
        signerPubkey: null,
        nccLocalDrafts: [
             { id: 'event1', event_id: 'event1', kind: 30050, status: 'published', d: 'ncc-01', tags: {} }
        ],
        eventsById: new Map(),
        nccDocs: []
    };
    
    const mockActions = {};

    // --- TEST 1: Unauthenticated State ---
    
    initPowerShell(mockState, 'v1.0.0', () => {}, () => {}, mockActions);

    // Verify basic rendering
    const shell = document.getElementById('shell-power');
    assert.ok(shell.querySelector('.p-topbar'), 'Topbar should be rendered');

    // Test "New NCC Draft" via Command Palette (simulating Ctrl+N via eventBus would be ideal but eventBus is internal/imported)
    // We can verify via UI behavior. 
    // But COMMANDS are not exposed.
    // However, we fixed the context menu. Let's test that.
    
    // Inject a simulated nav item into the shell (since renderExplorer is mocked/stubbed or effectively does nothing if we don't invoke it fully)
    // Actually, initPowerShell calls renderExplorer, but we didn't mock it, so it runs real code. 
    // renderExplorer imports Lit element 'explorer-tree'. Lit might fail in JSDOM if not fully polyfilled.
    // If it fails, we might need to rely on manual DOM injection.
    
    // Manually inject a nav item
    const explorerBody = document.getElementById('p-explorer-body');
    explorerBody.innerHTML = `
        <div class="p-nav-item" data-id="event1">
            <span>NCC-01</span>
        </div>
    `;
    
    const navItem = explorerBody.querySelector('.p-nav-item');
    
    // Trigger Context Menu (Right Click)
    triggerMouseEvent(navItem, 'contextmenu', { clientX: 100, clientY: 100, button: 2 });
    
    // Check if menu appeared
    let contextMenu = document.getElementById('p-context-menu');
    assert.strictEqual(contextMenu, null, 'Context menu should NOT appear when not signed in');

    // --- TEST 2: Authenticated State ---
    
    mockState.signerPubkey = 'pubkey123';
    initPowerShell(mockState, 'v1.0.0', () => {}, () => {}, mockActions);
    
    // Re-inject item because renderExplorer wiped it
    explorerBody.innerHTML = `
        <div class="p-nav-item" data-id="event1">
            <span>NCC-01</span>
        </div>
    `;
    const navItem2 = explorerBody.querySelector('.p-nav-item');

    // Trigger Context Menu again
    triggerMouseEvent(navItem2, 'contextmenu', { clientX: 100, clientY: 100, button: 2 });
    
    // Check if menu appeared
    contextMenu = document.getElementById('p-context-menu');
    assert.ok(contextMenu, 'Context menu SHOULD appear when signed in');
    
    // Verify menu items
    assert.ok(contextMenu.innerHTML.includes('New Endorsement'), 'Menu should have New Endorsement');

    // Cleanup
    if (contextMenu) contextMenu.remove();
});
