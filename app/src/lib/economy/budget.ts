import { ComputeBudgetProgram } from "@solana/web3.js";

/**
 * Every transaction states its own compute budget. Without a price, wallets add a "priority fee" of
 * their own, which in practice multiplied the network fee ~9x (0.000045 SOL instead of the 0.000005 SOL
 * base fee). A price of 1 micro-lamport makes the priority part negligible on a quiet network; raise
 * VITE_PRIORITY_MICROLAMPORTS if transactions stall during congestion.
 */
const configured = Number((import.meta as { env?: Record<string, string> }).env?.VITE_PRIORITY_MICROLAMPORTS);
export const PRIORITY_MICROLAMPORTS = Number.isFinite(configured) && configured >= 0 ? configured : 1;

export const budgetIxs = (units = 400_000) => [
  ComputeBudgetProgram.setComputeUnitLimit({ units }),
  ComputeBudgetProgram.setComputeUnitPrice({ microLamports: PRIORITY_MICROLAMPORTS }),
];
