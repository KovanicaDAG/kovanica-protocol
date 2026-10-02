/**
 * In-memory wallet session.
 *
 * The vault lives in a `useRef`, never in component state that React could
 * serialise into a suspended-tree snapshot, and never in a persistent store.
 * Closing the tab destroys the key — that is the point.
 *
 * The optional encrypted store in `lib/kvnc.ts` is a deliberate, separate
 * opt-in; this hook touches localStorage only when the operator asks.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyVault } from '../lib/kvnc';
import {
  createWalletFromMnemonic,
  createNewMnemonic,
  walletFromRawSeed,
  signHex,
  hasStoredVault,
  unlockVault,
  forgetStoredVault,
  saveVaultEncrypted,
} from '../lib/kvnc';

export type WalletKind = KeyVault['kind'];

export interface KeyVaultApi {
  vault: KeyVault | null;
  unlocked: boolean;
  /** True when an encrypted seed exists in the opt-in local store. */
  hasStored: boolean;
  newSeedPhrase: (strength?: 128 | 256) => string;
  importPhrase: (phrase: string, index?: number) => void;
  importRawSeed: (hex: string) => void;
  unlock: (passphrase: string, index?: number) => Promise<void>;
  remember: (passphrase: string, index?: number) => Promise<void>;
  forget: (index?: number) => void;
  lock: () => void;
  /** Sign a node-produced sighash locally. The only key egress. */
  sign: (sighashHex: string, index?: number) => string;
  error: string | null;
  clearError: () => void;
}

export function useKeyVault(): KeyVaultApi {
  const vaultRef = useRef<KeyVault | null>(null);
  const [unlocked, setUnlocked] = useState(false);
  const [hasStored, setHasStored] = useState(() => hasStoredVault());
  const [error, setError] = useState<string | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const setVault = useCallback((v: KeyVault) => {
    vaultRef.current = v;
    setUnlocked(true);
    setError(null);
  }, []);

  const lock = useCallback(() => {
    // Best-effort scrub: JS gives no guarantee, but it closes the obvious path
    // of a lingering ref surviving a lock/unlock cycle.
    const v = vaultRef.current;
    if (v) v.seed.fill(0);
    vaultRef.current = null;
    setUnlocked(false);
  }, []);

  const newSeedPhrase = useCallback((strength: 128 | 256 = 128) => {
    try {
      return createNewMnemonic(strength);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return '';
    }
  }, []);

  const importPhrase = useCallback(
    (phrase: string, index = 0) => {
      try {
        setVault(createWalletFromMnemonic(phrase, index));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [setVault],
  );

  const importRawSeed = useCallback(
    (hex: string) => {
      try {
        setVault(walletFromRawSeed(hex));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [setVault],
  );

  const unlock = useCallback(
    async (passphrase: string, index = 0) => {
      try {
        setVault(await unlockVault(passphrase, index));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [setVault],
  );

  const remember = useCallback(
    async (passphrase: string, index = 0) => {
      const v = vaultRef.current;
      if (!v) {
        setError('unlock a wallet before saving it');
        return;
      }
      try {
        await saveVaultEncrypted(v, passphrase, index);
        setHasStored(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [],
  );

  const forget = useCallback((index = 0) => {
    forgetStoredVault(index);
    setHasStored(false);
  }, []);

  // Lock on unmount so navigating away cannot leave a live key in a ref that
  // outlives the component.
  useEffect(() => lock, [lock]);

  const sign = useCallback((sighashHex: string, index = 0) => {
    const v = vaultRef.current;
    if (!v) throw new Error('wallet is locked');
    return signHex(v, sighashHex, index);
  }, []);

  return {
    vault: unlocked ? vaultRef.current : null,
    unlocked,
    hasStored,
    newSeedPhrase,
    importPhrase,
    importRawSeed,
    unlock,
    remember,
    forget,
    lock,
    sign,
    error,
    clearError,
  };
}
