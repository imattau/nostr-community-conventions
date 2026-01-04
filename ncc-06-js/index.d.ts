declare module 'ncc-06-js' {
  export interface NostrEvent {
    id: string;
    pubkey: string;
    created_at: number;
    kind: number;
    tags: string[][];
    content: string;
    sig: string;
  }

  export interface BuildNcc02Options {
    secretKey: string;
    serviceId: string;
    endpoint: string;
    fingerprint?: string | null;
    expirySeconds?: number;
    kind?: number;
    createdAt?: number;
    isPrivate?: boolean;
    privateRecipients?: string[];
  }

  export function buildNcc02ServiceRecord(options: BuildNcc02Options): Promise<NostrEvent>;
  export function parseNcc02Tags(event: NostrEvent): Record<string, string | undefined>;
  export interface ValidateNcc02Options {
    expectedAuthor?: string;
    expectedD?: string;
    now?: number;
    allowExpired?: boolean;
  }
  export function validateNcc02(event: NostrEvent, options?: ValidateNcc02Options): boolean;

  export interface LocatorEndpoint {
    url: string;
    type?: string;
    uri?: string;
    value?: string;
    protocol?: string;
    family?: 'ipv4' | 'ipv6' | 'onion' | string;
    priority?: number;
    prio?: number;
    k?: string;
    fingerprint?: string;
    [key: string]: unknown;
  }

  export interface LocatorPayload {
    ttl: number;
    updated_at: number;
    endpoints: LocatorEndpoint[];
  }

  export const DEFAULT_TTL_SECONDS: number;
  export function buildLocatorPayload(options?: {
    endpoints?: LocatorEndpoint[];
    ttl?: number;
    updatedAt?: number;
  }): LocatorPayload;
  export function parseLocatorPayload(content: string | null | undefined): LocatorPayload | null;
  export function validateLocatorFreshness(
    payload: LocatorPayload | null | undefined,
    options?: { now?: number; allowStale?: boolean }
  ): boolean;
  export function normalizeLocatorEndpoints(endpoints?: LocatorEndpoint[]): LocatorEndpoint[];

  export interface SelectorOptions {
    torPreferred?: boolean;
    expectedK?: string;
    allowedProtocols?: string[];
  }
  export interface SelectorResult {
    endpoint: LocatorEndpoint | null;
    reason?: string;
    expected?: string;
    actual?: string;
  }
  export function choosePreferredEndpoint(
    endpoints?: LocatorEndpoint[],
    options?: SelectorOptions
  ): SelectorResult;
  export { normalizeLocatorEndpoints };

  export interface ResolvedService {
    endpoint?: string;
    fingerprint?: string;
    expiry: number;
    attestations: any[];
    eventId: string;
    pubkey: string;
  }

  export interface ResolverOptions {
    bootstrapRelays: string[];
    servicePubkey: string;
    serviceId: string;
    locatorId: string;
    expectedK?: string;
    torPreferred?: boolean;
    allowedProtocols?: string[];
    locatorSecretKey?: string;
    ncc05TimeoutMs?: number;
    publicationRelayTimeoutMs?: number;
    pool?: any;
    ncc02Resolver?: any;
    resolveLocator?: (options: {
      bootstrapRelays: string[];
      servicePubkey: string;
      locatorId: string;
      locatorSecretKey?: string;
      timeout?: number;
    }) => Promise<LocatorPayload | null>;
    now?: number;
  }
  export interface ResolverSelection {
    endpoint: string | null;
    source: 'locator' | 'ncc02' | null;
    reason: string;
    evidence?: Record<string, unknown>;
  }
  export interface ResolverResult {
    endpoint: string | null;
    source: 'locator' | 'ncc02' | null;
    locatorPayload: LocatorPayload | null;
    serviceRecord: ResolvedService;
    selection: ResolverSelection;
  }
  export function resolveServiceEndpoint(options: ResolverOptions): Promise<ResolverResult>;

  export interface Protocol {
    parseNostrMessage(messageString: string): unknown[] | null;
    serializeNostrMessage(messageArray: unknown[]): string;
    createReqMessage(subId: string, ...filters: unknown[]): unknown[];
  }

  export interface Keypair {
    secretKey: string;
    publicKey: string;
    npub: string;
    nsec: string;
  }
  export function generateKeypair(): Keypair;
  export function toNpub(pubkey: string): string;
  export function fromNpub(npub: string): string;
  export function toNsec(secretKey: string): string;
  export function fromNsec(nsec: string): string;

  export type KMode = 'tls_spki' | 'static' | 'generate';
  export interface KConfig {
    mode?: KMode;
    value?: string;
    certPath?: string;
    persistPath?: string;
    externalEndpoints?: Record<string, unknown>;
  }
  export function generateExpectedK(options?: {
    prefix?: string;
    label?: string;
    suffix?: string;
  }): string;
  export function validateExpectedKFormat(k: string): boolean;
  export function computeKFromCertPem(pem: string): string;
  export function getExpectedK(cfg?: { k?: KConfig; externalEndpoints?: Record<string, unknown> }, options?: {
    baseDir?: string;
  }): string;

  export interface JitterResult {
    baseMs: number;
    jitterRatio?: number;
  }
  export function scheduleWithJitter(baseMs: number, jitterRatio?: number): number;

  export interface SelfSignedCertificate {
    keyPath: string;
    certPath: string;
  }
  export interface EnsureCertOptions {
    targetDir?: string;
    keyFileName?: string;
    certFileName?: string;
    altNames?: string[];
  }
  export function ensureSelfSignedCert(options?: EnsureCertOptions): Promise<SelfSignedCertificate>;

  export interface ExternalEndpointOptions {
    tor?: {
      enabled?: boolean;
    };
    ipv4?: {
      enabled?: boolean;
      protocol?: string;
      port?: number;
      address?: string;
      publicSources?: string[];
    };
    ipv6?: {
      enabled?: boolean;
      protocol?: string;
      port?: number;
    };
    wsPort?: number;
    wssPort?: number;
    ncc02ExpectedKey?: string;
    ensureOnionService?: () => Promise<{ address: string; servicePort: number } | null>;
    publicIpv4Sources?: string[];
  }
  export function buildExternalEndpoints(options?: ExternalEndpointOptions): Promise<LocatorEndpoint[]>;
  export function detectGlobalIPv6(): string | null;
  export function getPublicIPv4(options?: { sources?: string[] }): Promise<string | null>;
  export function normalizeRelayUrl(url: string): string;
  export function normalizeRelays(relays: string[]): string[];

  export interface SidecarConfigOptions {
    secretKey: string;
    serviceUrl?: string;
    relayUrl?: string;
    serviceId?: string;
    locatorId?: string;
    publicationRelays?: string[];
    publishRelays?: string[];
    persistPath?: string;
    certPath?: string;
    relayMode?: 'public' | 'private';
    serviceMode?: 'public' | 'private';
  }
  export interface SidecarConfig {
    secretKey: string;
    serviceUrl: string;
    relayUrl: string;
    serviceId: string;
    locatorId: string;
    publicationRelays: string[];
    publishRelays: string[];
    persistPath?: string;
    certPath?: string;
    relayMode: 'public' | 'private';
    serviceMode: 'public' | 'private';
  }
  export function buildSidecarConfig(options: SidecarConfigOptions): SidecarConfig;
  export function getRelayMode(config?: { relayMode?: string, serviceMode?: string }): 'public' | 'private';
  export function setRelayMode(config?: Record<string, unknown>, mode: 'public' | 'private'): Record<string, unknown>;

  export interface ClientConfigOptions {
    serviceIdentityUri?: string;
    serviceNpub?: string;
    servicePubkey?: string;
    serviceUrl?: string;
    relayUrl?: string;
    publicationRelays?: string[];
    serviceId?: string;
    locatorId?: string;
    ncc02ExpectedKey?: string;
  }
  export interface ClientConfig {
    serviceIdentityUri: string;
    servicePubkey: string;
    serviceUrl: string;
    relayUrl: string;
    publicationRelays: string[];
    serviceId: string;
    locatorId: string;
    ncc02ExpectedKey?: string;
  }
  export function buildClientConfig(options: ClientConfigOptions): ClientConfig;
}
