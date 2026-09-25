const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1']);
const LOCAL_IP_ADDRESSES = new Set(['127.0.0.1', '::1']);

function stripIpv4Mapping(address = '') {
  return address.startsWith('::ffff:') ? address.slice(7) : address;
}

function normalizeAddress(address) {
  if (!address) return '';
  return stripIpv4Mapping(address.toLowerCase());
}

export function isLocalHostname(hostname) {
  if (!hostname) return false;
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return LOCAL_HOSTNAMES.has(normalized);
}

export function isLocalAddress(address) {
  if (!address) return false;
  const normalized = normalizeAddress(address);
  return LOCAL_IP_ADDRESSES.has(normalized);
}

export function shouldAllowRemoteAccess(appConfig = {}) {
  if (['1', 'true'].includes(String(process.env.NCC_SIDECAR_ALLOW_REMOTE).toLowerCase())) {
    return true;
  }
  if (appConfig?.allow_remote === undefined || appConfig?.allow_remote === null) {
    return true;
  }
  return Boolean(appConfig.allow_remote);
}
