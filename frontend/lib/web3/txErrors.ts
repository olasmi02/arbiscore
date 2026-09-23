import { BaseError, decodeErrorResult, formatEther, formatUnits, parseAbi, type Hex } from 'viem';

/**
 * Every custom error the contracts can revert with, including ones that bubble up from the engine,
 * oracle and OpenZeppelin bases, so a revert anywhere in the call path decodes by name.
 */
export const KNOWN_ERRORS = parseAbi([
  // ArbiCreditVault
  'error ZeroAmount()',
  'error BorrowTooSmall()',
  'error InsufficientFreeCollateral(uint256 available, uint256 required)',
  'error InsufficientLiquidity(uint256 available, uint256 requested)',
  'error LoanNotFound()',
  'error LoanNotActive()',
  'error LoanNotLiquidatable()',
  'error TooManyOpenLoans(uint256 max)',
  // CreditImporter
  'error NotYourAttestation()',
  'error AttestationExpired()',
  'error InvalidSignature()',
  'error AlreadyHasHistory()',
  // ChainlinkPriceOracle
  'error InvalidPrice()',
  'error StalePrice(uint256 updatedAt)',
  'error SequencerDown()',
  'error SequencerGracePeriod()',
  // ArbiScoreEngine (Stylus)
  'error Unauthorized()',
  'error InvalidProfile()',
  'error DemoModeDisabled()',
  'error HasOpenLoans()',
  // OpenZeppelin
  'error EnforcedPause()',
  'error ERC20InsufficientBalance(address sender, uint256 balance, uint256 needed)',
  'error ERC20InsufficientAllowance(address spender, uint256 allowance, uint256 needed)',
  'error ERC4626ExceededMaxWithdraw(address owner, uint256 assets, uint256 max)',
  'error ERC4626ExceededMaxRedeem(address owner, uint256 shares, uint256 max)',
]);

const STABLE_DECIMALS = 6;
const weth = (x: unknown) => Number(formatEther(x as bigint)).toFixed(4);
const usd = (x: unknown) => Number(formatUnits(x as bigint, STABLE_DECIMALS)).toLocaleString();

const MESSAGES: Record<string, (args: readonly unknown[]) => string> = {
  ZeroAmount: () => 'Enter an amount greater than zero.',
  BorrowTooSmall: () => 'This loan is below the minimum borrow size.',
  InsufficientFreeCollateral: ([available, required]) =>
    `Not enough collateral for your tier: this loan needs ${weth(required)} WETH and you have ${weth(available)} WETH free. Deposit more WETH or borrow less.`,
  InsufficientLiquidity: ([available]) => `The pool only has ${usd(available)} available to borrow right now.`,
  LoanNotFound: () => 'That loan does not exist.',
  LoanNotActive: () => 'That loan is already closed.',
  LoanNotLiquidatable: () => 'That loan is still healthy, so it cannot be liquidated.',
  TooManyOpenLoans: ([max]) =>
    `You already have ${String(max)} open loans in this market, the maximum. Repay one before borrowing again.`,
  NotYourAttestation: () => 'This attestation was issued for a different wallet.',
  AttestationExpired: () => 'The attestation expired before it was submitted. Please try the import again.',
  InvalidSignature: () => 'The attestation signature was not accepted on-chain.',
  AlreadyHasHistory: () => 'This wallet already has a credit history. Imports only work on fresh wallets, so an existing record cannot be overwritten.',
  InvalidPrice: () => 'The ETH price feed returned an invalid price. Borrowing is paused until it recovers.',
  StalePrice: () => 'The ETH price feed is stale. Borrowing is paused until it updates.',
  SequencerDown: () => 'The Arbitrum sequencer is down, so prices cannot be trusted. Please try again later.',
  SequencerGracePeriod: () => 'The Arbitrum sequencer just restarted. Borrowing resumes after a short grace period.',
  Unauthorized: () => 'This wallet is not allowed to perform that action.',
  InvalidProfile: () => 'The credit engine rejected this history.',
  DemoModeDisabled: () => 'Demo mode is off, so credit histories cannot be written directly.',
  HasOpenLoans: () => 'This wallet has open loans, so its history cannot be replaced.',
  EnforcedPause: () => 'This market is paused: new supply and borrows are disabled. Repayments still work.',
  ERC20InsufficientBalance: () => 'Your token balance is too low for this transaction.',
  ERC20InsufficientAllowance: () => 'The token approval is too low. Please approve and try again.',
  ERC4626ExceededMaxWithdraw: () => 'You cannot withdraw that much right now; some of the pool is lent out.',
  ERC4626ExceededMaxRedeem: () => 'You cannot redeem that much right now; some of the pool is lent out.',
};

/** Turns a wallet/RPC/contract error into one sentence a user can act on. */
export function describeTxError(err: unknown): string {
  if (err instanceof BaseError) {
    if (err.walk((e) => (e as { name?: string }).name === 'UserRejectedRequestError')) {
      return 'You rejected the request in your wallet.';
    }
    // Revert data: viem exposes it as `data` (decoded) or `raw` (hex) on the revert error
    const revert = err.walk((e) => 'raw' in (e as object) || 'data' in (e as object)) as
      | { data?: { errorName?: string; args?: readonly unknown[] } | Hex; raw?: Hex }
      | null;
    let name: string | undefined;
    let args: readonly unknown[] = [];
    if (revert && typeof revert.data === 'object' && revert.data?.errorName) {
      name = revert.data.errorName;
      args = revert.data.args ?? [];
    } else {
      const raw = revert?.raw ?? (typeof revert?.data === 'string' ? revert.data : undefined);
      if (raw && raw.length >= 10) {
        try {
          const decoded = decodeErrorResult({ abi: KNOWN_ERRORS, data: raw });
          name = decoded.errorName;
          args = decoded.args ?? [];
        } catch {
          // unknown selector; fall through to viem's summary
        }
      }
    }
    if (name && MESSAGES[name]) return MESSAGES[name](args);
    if (name) return `The contract rejected this transaction (${name}).`;
    return err.shortMessage;
  }
  if (err instanceof Error) return err.message;
  return 'Transaction failed';
}
