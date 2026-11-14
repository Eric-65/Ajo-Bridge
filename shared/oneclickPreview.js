/**
 * Placeholder addresses for DRY (preview) 1Click quotes only.
 *
 * 1Click needs a syntactically valid refund address on the origin chain even
 * for a price preview, and it rejects well-known burn addresses (0x…dEaD, the
 * Solana system program, the Tron black hole). These are random addresses that
 * nobody holds keys for. They are never used for a real (dry: false) quote:
 * the pay drawer requires the payer's own refund address before it asks for a
 * deposit address.
 */
export const PREVIEW_REFUND = Object.freeze({
  evm: '0x8a55a5666d02f18e44c197c104601a32eac8dcc1',
  sol: 'HxM8VCKppf9fVMVBdj5rinWFSak9Mjrj7Byts98kfGJu',
  tron: 'TMHR8TC35MUoM1MYb4izP5bzLfyXaABgAn',
});

/** Preview recipient on NEAR mainnet (only shapes the quote; nothing is sent). */
export const PREVIEW_RECIPIENT = 'near';
