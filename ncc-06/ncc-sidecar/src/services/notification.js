import { getAdmins, getConfig, addLog } from '../db.js';
import { sendInviteDM } from '../dm.js';

function formatEventLink(relayUrl, eventId) {
  if (!relayUrl || !eventId) return null;
  try {
    const parsed = new URL(relayUrl);
    parsed.pathname = eventId;
    parsed.search = '';
    return parsed.toString();
  } catch {
    return `${relayUrl.replace(/\/+$/, '')}/${eventId}`;
  }
}

export async function notifyAdminsOnionUpdate({
  service,
  torResponse,
  previousAddress,
  secretKey,
  relays,
  eventIds
}) {
  if (!torResponse?.address) return;
  const admins = getAdmins().filter(admin => admin.pubkey).map(admin => admin.pubkey);
  if (!admins.length) return;

  const appConfig = getConfig('app_config') || {};
  const fallbackRelays = Array.isArray(appConfig.publication_relays) ? appConfig.publication_relays : [];
  const relayTargets = Array.isArray(relays) && relays.length ? relays : fallbackRelays;
  if (!relayTargets.length) {
    addLog('warn', `Onion update for ${service.name} detected but no relays configured for DM delivery`, {
      serviceId: service.id,
      torAddress: torResponse.address
    });
    return;
  }

  const uniqueLinks = new Set();
  uniqueLinks.add(torResponse.address);
  if (torResponse.servicePort) {
    uniqueLinks.add(`http://${torResponse.address}:${torResponse.servicePort}`);
    uniqueLinks.add(`ws://${torResponse.address}:${torResponse.servicePort}`);
  }

  const linkLines = Array.from(uniqueLinks)
    .map(link => `• ${link}`)
    .join('\n');

  const primaryRelay = relayTargets[0] || null;
  const eventLines = [];
  if (eventIds?.ncc02) {
    const link = formatEventLink(primaryRelay, eventIds.ncc02);
    eventLines.push(`• NCC-02 event: ${eventIds.ncc02}${link ? ` (${link})` : ''}`);
  }
  if (eventIds?.ncc05) {
    const link = formatEventLink(primaryRelay, eventIds.ncc05);
    eventLines.push(`• NCC-05 event: ${eventIds.ncc05}${link ? ` (${link})` : ''}`);
  }

  const message = `NCC-06 service "${service.name}" (${service.service_id}) refreshed its Tor endpoint.

New onion address:
${linkLines}

${eventLines.length ? `Published events:\n${eventLines.join('\n')}\n\n` : ''}
The updated endpoint is visible in the admin dashboard after the next publish cycle.`;

  const sendResults = await Promise.all(admins.map(async (pubkey) => {
    try {
      const success = await sendInviteDM({
        secretKey,
        recipientPubkey: pubkey,
        message,
        relays: Array.from(new Set(relayTargets))
      });
      return { pubkey, success };
    } catch (err) {
      return { pubkey, success: false, error: err?.message || 'unknown' };
    }
  }));

  const successCount = sendResults.filter(r => r.success).length;
  const failed = sendResults.filter(r => !r.success);
  addLog('info', `Notified admins about onion update for ${service.name}`, {
    serviceId: service.id,
    previousAddress,
    newAddress: torResponse.address,
    relays: relayTargets,
    recipients: admins,
    notified: successCount,
    failures: failed.length
  });
  
  return { successCount, failedCount: failed.length };
}
