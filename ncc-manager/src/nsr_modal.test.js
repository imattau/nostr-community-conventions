import test from 'node:test';
import assert from 'node:assert';
import { JSDOM } from 'jsdom';
import { eventBus } from './eventBus.js';

test('NSR Modal Actions', async (t) => {
    // Setup JSDOM
    const dom = new JSDOM('<!DOCTYPE html><html><body><div id="shell-power"></div></body></html>', {
        url: "http://localhost/",
        pretendToBeVisual: true
    });
    global.window = dom.window;
    global.document = dom.window.document;
    if (!global.crypto) global.crypto = { randomUUID: () => 'test-uuid' };
    global.HTMLElement = dom.window.HTMLElement;
    global.Node = dom.window.Node;
    global.MouseEvent = dom.window.MouseEvent;
    global.CustomEvent = dom.window.CustomEvent;

    const { initPowerShell } = await import('./power_ui.js');

    const mockState = {
        signerPubkey: 'pubkey123',
        eventsById: new Map([['event1', { id: 'event1', event_id: 'event1', kind: 30050, status: 'published', d: 'ncc-01', tags: {} }]]),
        nccDocs: ['event1'],
        nccLocalDrafts: [], nsrLocalDrafts: [], endorsementLocalDrafts: [], supportingLocalDrafts: [],
        remoteDrafts: [], pendingDrafts: new Map()
    };
    initPowerShell(mockState, 'v1.0.0', () => {}, () => {}, {});

    // Helper to open modal
    function openModal() {
        const explorerBody = document.getElementById('p-explorer-body');
        explorerBody.innerHTML = `<div class="p-nav-item" data-id="event1"></div>`;
        const navItem = explorerBody.querySelector('.p-nav-item');
        
        // Manually trigger context menu render since it's hard to trigger right-click precisely in JSDOM
        // Actually, let's just call the context menu handler if it was exposed, but it's not.
        // We have to rely on the event listener in power_ui.js
        const event = new dom.window.MouseEvent('contextmenu', { bubbles: true, clientX: 0, clientY: 0 });
        navItem.dispatchEvent(event);
        
        const contextMenu = document.getElementById('p-context-menu');
        const nsrAction = Array.from(contextMenu.querySelectorAll('.p-context-item'))
            .find(el => el.textContent.includes('Create Succession'));
        nsrAction.click();
    }

    // --- Subtest: Create NSR ---
    await t.test('Submit button should emit save-item and close modal', async () => {
        openModal();
        const modal = document.querySelector('.p-modal-overlay');
        const authInput = modal.querySelector('#m-nsr-auth');
        const submitBtn = modal.querySelector('#m-nsr-submit');

        authInput.value = 'new-id';
        
        let emitted = false;
        const handler = () => { emitted = true; };
        const off = eventBus.on('save-item', handler);
        
        submitBtn.click();
        
        assert.ok(emitted, 'save-item event should be emitted');
        
        // Use a small delay if needed or check if the listener actually ran
        // In power_ui.js: modal.remove() is called at the end of the async handler.
        // We might need to wait a tick.
        await new Promise(resolve => setTimeout(resolve, 10));
        assert.ok(!document.querySelector('.p-modal-overlay'), 'Modal should be removed');
        
        off();
    });

    // --- Subtest: Cancel button ---
    await t.test('Cancel button should close modal', () => {
        openModal();
        const modal = document.querySelector('.p-modal-overlay');
        const cancelBtn = Array.from(modal.querySelectorAll('button')).find(b => b.textContent === 'Cancel');
        
        cancelBtn.click();
        assert.ok(!document.querySelector('.p-modal-overlay'), 'Modal should be removed');
    });

    // --- Subtest: X button ---
    await t.test('X button should close modal', () => {
        openModal();
        const modal = document.querySelector('.p-modal-overlay');
        const xBtn = modal.querySelector('.p-ghost-btn[data-action="close-modal"]');
        
        xBtn.click();
        assert.ok(!document.querySelector('.p-modal-overlay'), 'Modal should be removed');
    });
});
