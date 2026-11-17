/** The public half of the key that signs live-update releases (ECDSA P-256). Never put the private key in the repo. */
export const LIVE_UPDATE_PUBLIC_KEY: JsonWebKey = {
  kty: 'EC',
  crv: 'P-256',
  x: 'mFNuav9p0wEAsFuwVGrtOJjHbx5wc2xXrr71RXNTpCQ',
  y: 'f4wOZsIirRP9JhNWIRS2p2haDMf_zXvydSpo8BFytoI'
}
