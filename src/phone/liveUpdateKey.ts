/** The public half of the key that signs live-update releases (ECDSA P-256). Never put the private key in the repo. */
// replaced in Task 8 (this is a throwaway key; its private half was discarded)
export const LIVE_UPDATE_PUBLIC_KEY: JsonWebKey = {
  kty: 'EC',
  crv: 'P-256',
  x: 'CCzHwlXl1kmy-jtnIPWs0bTEyQZXt8Wq-_sHh1GVTZc',
  y: 'Dz_pThZOnnmqt1F3fsmpeD7zcsXyRCZzj9nlw84HS7U'
}
