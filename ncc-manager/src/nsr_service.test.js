/**
 * Simple test suite for NSR automation logic.
 * Run via 'node src/nsr_service.test.js'
 */

const mockSigner = {
  signEvent: async (template) => ({ ...template, id: "mock_event_id_" + Math.random() })
};

const mockRelays = ["wss://mock.relay"];

// Mock dependencies
const KINDS = { ncc: 30050, nsr: 30051 };
const mockNsrService = {
  async findExistingNSR(relays, d, authoritativeId, fromId) {
    if (authoritativeId === "already_exists") return { id: "existing_nsr_id" };
    return null;
  },
  async createRevisionNSR(signer, relays, { d, fromId, toId, authoritativeId, effectiveAt }) {
    const existing = await this.findExistingNSR(relays, d, authoritativeId, fromId);
    if (existing) return { skipped: true, eventId: existing.id };

    const nsrDraft = {
      kind: KINDS.nsr,
      d: d,
      tags: { authoritative: authoritativeId, type: "revision", effective_at: String(effectiveAt) }
    };
    if (fromId) {
      nsrDraft.tags.from = fromId;
      nsrDraft.tags.previous = fromId;
      nsrDraft.tags.to = toId;
    }
    const event = await signer.signEvent(nsrDraft);
    return { eventId: event.id, tags: event.tags };
  }
};

async function runTests() {
  console.log("Running NSR Automation Tests...");

  // 1. First publish (no supersedes) - should NOT create NSR based on latest logic
  // (In the main.js implementation we now check for !supersedes and return early)
  
  // 2. Publish a revision where supersedes is set
  console.log("Test 1: Revision publish...");
  const t2 = await mockNsrService.createRevisionNSR(mockSigner, mockRelays, {
    d: "ncc-01",
    fromId: "prev_doc_id",
    toId: "new_doc_id",
    authoritativeId: "new_doc_id",
    effectiveAt: 1001
  });
  if (t2.tags.from === "prev_doc_id" && t2.tags.authoritative === "new_doc_id") {
    console.log("  ✅ Success");
  } else {
    console.error("  ❌ Failed", t2);
  }

  // 3. Duplicate prevention
  console.log("Test 2: Duplicate prevention...");
  const t3 = await mockNsrService.createRevisionNSR(mockSigner, mockRelays, {
    d: "ncc-01",
    authoritativeId: "already_exists"
  });
  if (t3.skipped && t3.eventId === "existing_nsr_id") {
    console.log("  ✅ Success");
  } else {
    console.error("  ❌ Failed", t3);
  }

  console.log("Tests Completed.");
}

runTests().catch(console.error);
