// W0-03 sections 4.1-4.3 and 6.2: the one OIDC login verifier the three provider modes share, over openid-client
// v6. Authorization-code flow with PKCE (S256), `state` and `nonce`; the code exchange is a seam (`exchange`) so
// ID-11 drives the callback branches with a synthetic claims object and no network. Access and refresh tokens are
// discarded after the exchange: the desk holds its own session and never calls the provider for the user. No token
// is written anywhere.

import * as client from 'openid-client';
import type { DiscoveryDocument, LoginVerifier, SignInTransaction, VerifiedLogin } from './types.js';
import { SignInRefused } from './types.js';

export const GOOGLE_ISSUER = 'https://accounts.google.com';
export const TRANSACTION_TTL_MS = 10 * 60 * 1000; // section 2: a transaction expires after 10 minutes

export type ProviderKind = 'google' | 'generic' | 'entra';

/** The claims the verifier reads. Anything else is discarded (section 1: claims are data, never instructions). */
export type IdClaims = Readonly<Record<string, unknown>> & { iss?: string; sub?: string };

export interface Exchange {
  (input: {
    configuration: client.Configuration;
    callbackUrl: URL;
    expectedState: string;
    expectedNonce: string;
    pkceCodeVerifier: string;
  }): Promise<IdClaims | undefined>;
}

/** The real exchange: openid-client's authorizationCodeGrant, keeping only the ID-token claims. */
export const openidClientExchange: Exchange = async (input) => {
  const tokens = await client.authorizationCodeGrant(input.configuration, input.callbackUrl, {
    expectedState: input.expectedState,
    expectedNonce: input.expectedNonce,
    pkceCodeVerifier: input.pkceCodeVerifier,
  });
  return tokens.claims();
};

/** S18: a discovery document is valid when it carries a string `issuer` and `authorization_endpoint`. */
export function isValidDiscoveryDocument(
  doc: unknown,
): doc is DiscoveryDocument & { issuer: string; authorization_endpoint: string } {
  return (
    typeof doc === 'object' &&
    doc !== null &&
    typeof (doc as DiscoveryDocument).issuer === 'string' &&
    (doc as DiscoveryDocument).issuer !== '' &&
    typeof (doc as DiscoveryDocument).authorization_endpoint === 'string' &&
    (doc as DiscoveryDocument).authorization_endpoint !== ''
  );
}

/** The real discovery seam main.ts passes (section 2 `createIdentityAdapter.discovery`). */
export async function openidClientDiscovery(
  issuerUrl: URL,
  clientId: string,
  clientSecret: string,
): Promise<DiscoveryDocument> {
  const configuration = await client.discovery(issuerUrl, clientId, clientSecret);
  return { ...configuration.serverMetadata() };
}

export interface OidcVerifierOptions {
  provider: ProviderKind;
  document: DiscoveryDocument & { issuer: string; authorization_endpoint: string };
  clientId: string;
  clientSecret: string;
  scopes: string; // 'openid email profile' (Google) or 'openid profile email' (Entra)
  prompt?: string; // 'select_account' for local-google
  exchange?: Exchange;
  now?: () => Date;
}

function localPart(email: string): string {
  return email.split('@')[0] ?? email;
}

/** Maps verified claims to a VerifiedLogin under the mode's rules (section 2.2 subject, 2.3 invariant 3). */
export function loginFromClaims(
  provider: ProviderKind,
  claims: IdClaims,
  expectedIssuer: string,
): VerifiedLogin {
  if (claims.iss !== expectedIssuer) throw new SignInRefused('unauthenticated', 'issuer_mismatch');
  const subjectClaim = provider === 'entra' ? claims.oid : claims.sub;
  if (typeof subjectClaim !== 'string' || subjectClaim === '')
    throw new SignInRefused('unauthenticated', 'code_exchange_failed');
  const emailClaim =
    typeof claims.email === 'string' && claims.email !== ''
      ? claims.email
      : provider === 'entra' && typeof claims.preferred_username === 'string'
        ? claims.preferred_username
        : undefined;
  if (emailClaim === undefined || !emailClaim.includes('@'))
    throw new SignInRefused('unauthenticated', 'email_not_verified', subjectClaim);
  const email = emailClaim.trim().toLowerCase();
  const emailVerified = provider === 'entra' ? true : claims.email_verified === true;
  if (!emailVerified) throw new SignInRefused('unauthenticated', 'email_not_verified', subjectClaim);
  const name = typeof claims.name === 'string' ? claims.name.trim() : '';
  return {
    issuer: claims.iss,
    subject: subjectClaim,
    email,
    emailVerified,
    displayName: (name === '' ? localPart(email) : name).slice(0, 200),
    claims,
  };
}

export function createOidcVerifier(options: OidcVerifierOptions): LoginVerifier {
  const configuration = new client.Configuration(
    options.document as unknown as client.ServerMetadata,
    options.clientId,
    options.clientSecret,
  );
  const exchange = options.exchange ?? openidClientExchange;
  const now = options.now ?? (() => new Date());
  const issuer = options.document.issuer;

  return {
    async beginSignIn({ callbackUrl, returnTo }) {
      const codeVerifier = client.randomPKCECodeVerifier();
      const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);
      const state = client.randomState();
      const nonce = client.randomNonce();
      const parameters: Record<string, string> = {
        redirect_uri: callbackUrl.toString(),
        scope: options.scopes,
        state,
        nonce,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
      };
      if (options.prompt !== undefined) parameters.prompt = options.prompt;
      const redirectTo = client.buildAuthorizationUrl(configuration, parameters);
      const transaction: SignInTransaction = { state, nonce, codeVerifier, createdAt: now().toISOString() };
      if (returnTo !== undefined) transaction.returnTo = returnTo;
      return { redirectTo, transaction };
    },

    async completeSignIn({ callbackUrl, transaction }) {
      const age = now().getTime() - Date.parse(transaction.createdAt);
      if (!Number.isFinite(age) || age < 0 || age > TRANSACTION_TTL_MS)
        throw new SignInRefused('unauthenticated', 'transaction_missing');
      const state = callbackUrl.searchParams.get('state');
      if (state === null || state !== transaction.state)
        throw new SignInRefused('unauthenticated', 'state_mismatch');
      let claims: IdClaims | undefined;
      try {
        claims = await exchange({
          configuration,
          callbackUrl,
          expectedState: transaction.state,
          expectedNonce: transaction.nonce,
          pkceCodeVerifier: transaction.codeVerifier,
        });
      } catch {
        throw new SignInRefused('unauthenticated', 'code_exchange_failed'); // the provider's message is never surfaced
      }
      if (claims === undefined) throw new SignInRefused('unauthenticated', 'code_exchange_failed');
      if (claims.nonce !== transaction.nonce) throw new SignInRefused('unauthenticated', 'nonce_mismatch');
      return loginFromClaims(options.provider, claims, issuer);
    },
  };
}
