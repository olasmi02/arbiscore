export {
  ARBI_CREDIT_VAULT_ABI,
  STYLUS_ENGINE_ABI,
  CREDIT_IMPORTER_ABI,
  PRICE_ORACLE_ABI,
  TEST_TOKEN_ABI,
} from './generated';

/** ERC-20 subset (USDG and the test WETH). The test WETH additionally exposes `faucet` (TEST_TOKEN_ABI). */
export { TEST_TOKEN_ABI as ERC20_ABI } from './generated';
