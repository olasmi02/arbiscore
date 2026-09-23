#![cfg_attr(not(any(test, feature = "export-abi")), no_main)]
extern crate alloc;

pub mod scoring;

use alloc::vec::Vec;
use alloy_primitives::{Address, Uint, U256, U32, U64, U8};
use alloy_sol_types::sol;
use stylus_sdk::{
    abi::{AbiType, ConstString},
    prelude::*,
};

use scoring::{LoanEntry, LOAN_LIQUIDATED, LOAN_OPEN, LOAN_REPAID, MAX_HISTORY};

type U48 = Uint<48, 1>;
const U48_MAX: u64 = (1u64 << 48) - 1;

// Storage layout mapping directly to EVM slots
sol_storage! {
    #[entrypoint]
    pub struct ArbiScoreEngine {
        address owner;
        mapping(address => bool) vaults;
        bool demo_mode;
        mapping(address => BorrowerProfile) profiles;
        address importer;
    }

    pub struct BorrowerProfile {
        uint64 first_activity_timestamp;
        uint64 last_activity_timestamp;
        uint32 total_transactions;
        uint256 total_volume_usd;
        uint32 loans_taken;
        uint32 loans_repaid;
        uint32 liquidations;
        uint16 last_calculated_score;
        bool is_initialized;
        StoredLoan[] history;
    }

    /// One packed slot per loan: 64 + 3*48 + 8 = 216 bits.
    pub struct StoredLoan {
        uint64 amount_usd;
        uint48 borrow_ts;
        uint48 due_ts;
        uint48 close_ts;
        uint8 status;
    }
}

sol! {
    event ScoreCalculated(address indexed user, uint16 score, uint8 tier, uint16 collateralRatioBps);
    event LoanOpened(address indexed user, uint32 indexed historyIndex, uint64 amountUsd, uint64 dueTs);
    event LoanClosed(address indexed user, uint32 indexed historyIndex, bool liquidated);
    event VaultSet(address indexed vault, bool authorized);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event DemoModeSet(bool enabled);
    event ImporterSet(address indexed importer);

    struct BorrowerProfileView {
        uint64 firstActivityTimestamp;
        uint64 lastActivityTimestamp;
        uint32 totalTransactions;
        uint256 totalVolumeUSD;
        uint32 loansTaken;
        uint32 loansRepaid;
        uint32 liquidations;
        uint16 lastCalculatedScore;
        bool isInitialized;
    }
}

impl AbiType for BorrowerProfileView {
    type SolType = Self;
    const ABI: ConstString = ConstString::new("(uint64,uint64,uint32,uint256,uint32,uint32,uint32,uint16,bool)");
}

#[cfg(feature = "export-abi")]
impl stylus_sdk::abi::export::internal::InnerTypes for BorrowerProfileView {}

sol! {
    error Unauthorized();
    error InvalidLoanIndex();
    error LoanNotOpen();
    error InvalidProfile();
    error DemoModeDisabled();
    error HasOpenLoans();
}

#[derive(SolidityError)]
pub enum ScoreEngineError {
    Unauthorized(Unauthorized),
    InvalidLoanIndex(InvalidLoanIndex),
    LoanNotOpen(LoanNotOpen),
    InvalidProfile(InvalidProfile),
    DemoModeDisabled(DemoModeDisabled),
    HasOpenLoans(HasOpenLoans),
}

fn cap_u64(v: U256) -> u64 {
    if v > U256::from(u64::MAX) {
        u64::MAX
    } else {
        v.to::<u64>()
    }
}

fn to_entry(e: &StoredLoan) -> LoanEntry {
    LoanEntry {
        amount_usd: e.amount_usd.get().to::<u64>(),
        borrow_ts: e.borrow_ts.get().to::<u64>(),
        due_ts: e.due_ts.get().to::<u64>(),
        close_ts: e.close_ts.get().to::<u64>(),
        status: e.status.get().to::<u8>(),
    }
}

fn u48(v: u64) -> U48 {
    U48::from(v.min(U48_MAX))
}

impl ArbiScoreEngine {
    fn only_vault_or_owner(&self) -> Result<(), ScoreEngineError> {
        let caller = self.vm().msg_sender();
        if !self.vaults.get(caller) && caller != self.owner.get() {
            return Err(ScoreEngineError::Unauthorized(Unauthorized {}));
        }
        Ok(())
    }

    /// Streams the last MAX_HISTORY loans from storage through the model.
    fn score_of(&self, user: Address) -> u16 {
        let profile = self.profiles.getter(user);
        if !profile.is_initialized.get() {
            return scoring::MIN_SCORE;
        }
        let now = self.vm().block_timestamp();
        let len = profile.history.len();
        let start = len.saturating_sub(MAX_HISTORY);
        let mut acc = scoring::Accumulator::default();
        for i in start..len {
            if let Some(e) = profile.history.getter(i) {
                acc.add(&to_entry(&e), now);
            }
        }
        let features = acc.finish(
            profile.first_activity_timestamp.get().to::<u64>(),
            profile.total_transactions.get().to::<u64>(),
            cap_u64(profile.total_volume_usd.get()),
            now,
        );
        scoring::score_from_features(&features)
    }

    /// Recomputes, caches and emits the score for `user`.
    fn refresh_score(&mut self, user: Address) -> u16 {
        let score = self.score_of(user);
        self.profiles.setter(user).last_calculated_score.set(Uint::<16, 1>::from(score));
        let (tier, ratio) = scoring::score_to_tier(score);
        self.vm().log(ScoreCalculated { user, score, tier, collateralRatioBps: ratio });
        score
    }

    fn touch(&mut self, user: Address, now: u64) {
        let mut profile = self.profiles.setter(user);
        if !profile.is_initialized.get() {
            profile.first_activity_timestamp.set(U64::from(now));
            profile.is_initialized.set(true);
        }
        profile.last_activity_timestamp.set(U64::from(now));
    }
}

#[public]
impl ArbiScoreEngine {
    /// Sets the owner and (if non-zero) authorizes a first lending vault. Demo mode starts off.
    pub fn init(&mut self, owner_addr: Address, vault_addr: Address) -> Result<(), ScoreEngineError> {
        let current_owner = self.owner.get();
        if current_owner != Address::ZERO && self.vm().msg_sender() != current_owner {
            return Err(ScoreEngineError::Unauthorized(Unauthorized {}));
        }
        self.owner.set(owner_addr);
        if vault_addr != Address::ZERO {
            self.vaults.setter(vault_addr).set(true);
            self.vm().log(VaultSet { vault: vault_addr, authorized: true });
        }
        self.vm().log(OwnershipTransferred { previousOwner: current_owner, newOwner: owner_addr });
        Ok(())
    }

    /// Owner authorizes (or revokes) a lending market that reports loan outcomes. Several markets
    /// can share one credit history: a repayment in any of them counts everywhere.
    pub fn set_vault(&mut self, vault: Address, authorized: bool) -> Result<(), ScoreEngineError> {
        if self.vm().msg_sender() != self.owner.get() {
            return Err(ScoreEngineError::Unauthorized(Unauthorized {}));
        }
        self.vaults.setter(vault).set(authorized);
        self.vm().log(VaultSet { vault, authorized });
        Ok(())
    }

    pub fn owner(&self) -> Result<Address, ScoreEngineError> {
        Ok(self.owner.get())
    }

    pub fn is_vault(&self, account: Address) -> Result<bool, ScoreEngineError> {
        Ok(self.vaults.get(account))
    }

    pub fn demo_mode(&self) -> Result<bool, ScoreEngineError> {
        Ok(self.demo_mode.get())
    }

    /// Owner toggle for self-service sandbox profiles (disable for a production deployment).
    pub fn set_demo_mode(&mut self, enabled: bool) -> Result<(), ScoreEngineError> {
        if self.vm().msg_sender() != self.owner.get() {
            return Err(ScoreEngineError::Unauthorized(Unauthorized {}));
        }
        self.demo_mode.set(enabled);
        self.vm().log(DemoModeSet { enabled });
        Ok(())
    }

    pub fn importer(&self) -> Result<Address, ScoreEngineError> {
        Ok(self.importer.get())
    }

    /// Owner sets the CreditImporter allowed to write verified (attested) external credit history.
    pub fn set_importer(&mut self, importer: Address) -> Result<(), ScoreEngineError> {
        if self.vm().msg_sender() != self.owner.get() {
            return Err(ScoreEngineError::Unauthorized(Unauthorized {}));
        }
        self.importer.set(importer);
        self.vm().log(ImporterSet { importer });
        Ok(())
    }

    /// Credit score in [300, 850] computed from the borrower's loan history at the current block.
    pub fn calculate_score(&self, user: Address) -> Result<u16, ScoreEngineError> {
        Ok(self.score_of(user))
    }

    /// Score, tier and ratio in a single model evaluation (used by the vault).
    pub fn get_score_and_tier(&self, user: Address) -> Result<(u16, u8, u16), ScoreEngineError> {
        let score = self.score_of(user);
        let (tier, ratio) = scoring::score_to_tier(score);
        Ok((score, tier, ratio))
    }

    pub fn get_profile(&self, user: Address) -> Result<BorrowerProfileView, ScoreEngineError> {
        let score = self.score_of(user);
        let profile = self.profiles.getter(user);
        Ok(BorrowerProfileView {
            firstActivityTimestamp: profile.first_activity_timestamp.get().to::<u64>(),
            lastActivityTimestamp: profile.last_activity_timestamp.get().to::<u64>(),
            totalTransactions: profile.total_transactions.get().to::<u32>(),
            totalVolumeUSD: profile.total_volume_usd.get(),
            loansTaken: profile.loans_taken.get().to::<u32>(),
            loansRepaid: profile.loans_repaid.get().to::<u32>(),
            liquidations: profile.liquidations.get().to::<u32>(),
            lastCalculatedScore: score,
            isInitialized: profile.is_initialized.get(),
        })
    }

    /// Full loan history as parallel arrays (amountUsd, borrowTs, dueTs, closeTs, status).
    #[allow(clippy::type_complexity)]
    pub fn get_loan_history(
        &self,
        user: Address,
    ) -> Result<(Vec<u64>, Vec<u64>, Vec<u64>, Vec<u64>, Vec<u8>), ScoreEngineError> {
        let profile = self.profiles.getter(user);
        let len = profile.history.len();
        let (mut a, mut b, mut d, mut c, mut s) =
            (Vec::with_capacity(len), Vec::with_capacity(len), Vec::with_capacity(len), Vec::with_capacity(len), Vec::with_capacity(len));
        for i in 0..len {
            if let Some(e) = profile.history.getter(i) {
                let l = to_entry(&e);
                a.push(l.amount_usd);
                b.push(l.borrow_ts);
                d.push(l.due_ts);
                c.push(l.close_ts);
                s.push(l.status);
            }
        }
        Ok((a, b, d, c, s))
    }

    /// Vault hook: records a new open loan and returns its history index.
    pub fn on_loan_opened(&mut self, user: Address, amount_usd: u64, due_ts: u64) -> Result<u32, ScoreEngineError> {
        self.only_vault_or_owner()?;
        let now = self.vm().block_timestamp();
        self.touch(user, now);
        let index = {
            let mut profile = self.profiles.setter(user);
            let index = profile.history.len() as u32;
            let mut e = profile.history.grow();
            e.amount_usd.set(U64::from(amount_usd));
            e.borrow_ts.set(u48(now));
            e.due_ts.set(u48(due_ts));
            e.close_ts.set(u48(0));
            e.status.set(U8::from(LOAN_OPEN));
            let taken = profile.loans_taken.get().to::<u32>();
            profile.loans_taken.set(U32::from(taken.saturating_add(1)));
            index
        };
        self.vm().log(LoanOpened { user, historyIndex: index, amountUsd: amount_usd, dueTs: due_ts });
        self.refresh_score(user);
        Ok(index)
    }

    /// Vault hook: closes a loan as repaid or liquidated and returns the updated score.
    pub fn on_loan_closed(&mut self, user: Address, history_index: u32, liquidated: bool) -> Result<u16, ScoreEngineError> {
        self.only_vault_or_owner()?;
        let now = self.vm().block_timestamp();
        self.touch(user, now);
        {
            let mut profile = self.profiles.setter(user);
            let Some(mut e) = profile.history.setter(history_index) else {
                return Err(ScoreEngineError::InvalidLoanIndex(InvalidLoanIndex {}));
            };
            if e.status.get().to::<u8>() != LOAN_OPEN {
                return Err(ScoreEngineError::LoanNotOpen(LoanNotOpen {}));
            }
            e.close_ts.set(u48(now));
            e.status.set(U8::from(if liquidated { LOAN_LIQUIDATED } else { LOAN_REPAID }));
            if liquidated {
                let n = profile.liquidations.get().to::<u32>();
                profile.liquidations.set(U32::from(n.saturating_add(1)));
            } else {
                let n = profile.loans_repaid.get().to::<u32>();
                profile.loans_repaid.set(U32::from(n.saturating_add(1)));
            }
        }
        self.vm().log(LoanClosed { user, historyIndex: history_index, liquidated });
        Ok(self.refresh_score(user))
    }

    /// Judge sandbox: replaces a profile with a persona's history (loan i borrowed
    /// `borrowed_days_ago[i]` days ago with a 30-day term; `statuses[i]` 0=open 1=repaid
    /// 2=liquidated; repaid/liquidated loans close `days_late[i]` days after the due date).
    /// The importer may write only to wallets with no history. Otherwise demo mode must be on, and
    /// the caller must be the user or the owner; a history backing an open loan is never rewritten.
    /// With demo mode off (production), no one can rewrite an existing credit history.
    #[allow(clippy::too_many_arguments)]
    pub fn set_mock_profile(
        &mut self,
        user: Address,
        age_days: u32,
        tx_count: u32,
        volume_usd: U256,
        amounts_usd: Vec<u64>,
        borrowed_days_ago: Vec<u32>,
        statuses: Vec<u8>,
        days_late: Vec<u32>,
    ) -> Result<u16, ScoreEngineError> {
        let caller = self.vm().msg_sender();
        if caller == self.importer.get() {
            // Attested imports may only bootstrap wallets that have no ArbiScore history
            if self.profiles.getter(user).is_initialized.get() {
                return Err(ScoreEngineError::InvalidProfile(InvalidProfile {}));
            }
        } else {
            // Everyone else (the owner included) needs demo mode, and may never rewrite live loans
            if caller != user && caller != self.owner.get() {
                return Err(ScoreEngineError::Unauthorized(Unauthorized {}));
            }
            if !self.demo_mode.get() {
                return Err(ScoreEngineError::DemoModeDisabled(DemoModeDisabled {}));
            }
            let h = &self.profiles.getter(user).history;
            for i in 0..h.len() {
                if h.getter(i).is_some_and(|e| e.status.get().to::<u8>() == LOAN_OPEN) {
                    return Err(ScoreEngineError::HasOpenLoans(HasOpenLoans {}));
                }
            }
        }
        let n = amounts_usd.len();
        if n > MAX_HISTORY || borrowed_days_ago.len() != n || statuses.len() != n || days_late.len() != n {
            return Err(ScoreEngineError::InvalidProfile(InvalidProfile {}));
        }
        if statuses.iter().any(|s| *s > LOAN_LIQUIDATED) {
            return Err(ScoreEngineError::InvalidProfile(InvalidProfile {}));
        }

        let now = self.vm().block_timestamp();
        {
            let mut profile = self.profiles.setter(user);
            profile.first_activity_timestamp.set(U64::from(now.saturating_sub(age_days as u64 * scoring::DAY)));
            profile.last_activity_timestamp.set(U64::from(now));
            profile.total_transactions.set(U32::from(tx_count));
            profile.total_volume_usd.set(volume_usd);
            profile.is_initialized.set(true);

            // Every field of each element is overwritten below, so no stale slots survive.
            unsafe { profile.history.set_len(0) };
            let (mut repaid, mut liquidated) = (0u32, 0u32);
            for i in 0..n {
                let l = scoring::spec_to_entry(amounts_usd[i], borrowed_days_ago[i] as u64, statuses[i], days_late[i] as u64, now);
                match l.status {
                    LOAN_REPAID => repaid += 1,
                    LOAN_LIQUIDATED => liquidated += 1,
                    _ => {}
                }
                let mut e = profile.history.grow();
                e.amount_usd.set(U64::from(l.amount_usd));
                e.borrow_ts.set(u48(l.borrow_ts));
                e.due_ts.set(u48(l.due_ts));
                e.close_ts.set(u48(l.close_ts));
                e.status.set(U8::from(l.status));
            }
            profile.loans_taken.set(U32::from(n as u32));
            profile.loans_repaid.set(U32::from(repaid));
            profile.liquidations.set(U32::from(liquidated));
        }
        Ok(self.refresh_score(user))
    }
}

// HostIO stubs when compiling for native targets (e.g. host cargo test or abi export).
// These provide zero-dependency linker resolution on native host platforms,
// while on wasm32-unknown-unknown the real ArbOS imports are utilized.
#[cfg(not(target_arch = "wasm32"))]
#[doc(hidden)]
pub mod hostio_stubs {
    #[no_mangle]
    pub unsafe extern "C" fn block_timestamp() -> u64 { 1_000_000_000 }
    #[no_mangle]
    pub unsafe extern "C" fn block_number() -> u64 { 1 }
    #[no_mangle]
    pub unsafe extern "C" fn block_gas_limit() -> u64 { 30_000_000 }
    #[no_mangle]
    pub unsafe extern "C" fn block_coinbase(_: *mut u8) {}
    #[no_mangle]
    pub unsafe extern "C" fn block_basefee(_: *mut u8) {}
    #[no_mangle]
    pub unsafe extern "C" fn chainid() -> u64 { 421614 }
    #[no_mangle]
    pub unsafe extern "C" fn contract_address(_: *mut u8) {}
    #[no_mangle]
    pub unsafe extern "C" fn account_balance(_: *const u8, _: *mut u8) {}
    #[no_mangle]
    pub unsafe extern "C" fn account_code(_: *const u8, _: usize, _: usize, _: *mut u8) -> usize { 0 }
    #[no_mangle]
    pub unsafe extern "C" fn account_code_size(_: *const u8) -> usize { 0 }
    #[no_mangle]
    pub unsafe extern "C" fn account_codehash(_: *const u8, _: *mut u8) {}
    #[no_mangle]
    pub unsafe extern "C" fn storage_load_bytes32(_: *const u8, _: *mut u8) {}
    #[no_mangle]
    pub unsafe extern "C" fn storage_cache_bytes32(_: *const u8, _: *const u8) {}
    #[no_mangle]
    pub unsafe extern "C" fn storage_flush_cache(_: bool) {}
    #[no_mangle]
    pub unsafe extern "C" fn emit_log(_: *const u8, _: usize, _: usize) {}
    #[no_mangle]
    pub unsafe extern "C" fn evm_gas_left() -> u64 { 10_000_000 }
    #[no_mangle]
    pub unsafe extern "C" fn evm_ink_left() -> u64 { 10_000_000 }
    #[no_mangle]
    pub unsafe extern "C" fn pay_for_memory_grow(_: u16) {}
    #[no_mangle]
    pub unsafe extern "C" fn msg_reentrant() -> bool { false }
    #[no_mangle]
    pub unsafe extern "C" fn msg_sender(_: *mut u8) {}
    #[no_mangle]
    pub unsafe extern "C" fn msg_value(_: *mut u8) {}
    #[no_mangle]
    pub unsafe extern "C" fn native_keccak256(_: *const u8, _: usize, _: *mut u8) {}
    #[no_mangle]
    pub unsafe extern "C" fn read_args(_: *mut u8) {}
    #[no_mangle]
    pub unsafe extern "C" fn read_return_data(_: *mut u8, _: usize, _: usize) -> usize { 0 }
    #[no_mangle]
    pub unsafe extern "C" fn write_result(_: *const u8, _: usize) {}
    #[no_mangle]
    pub unsafe extern "C" fn return_data_size() -> usize { 0 }
    #[no_mangle]
    pub unsafe extern "C" fn tx_gas_price(_: *mut u8) {}
    #[no_mangle]
    pub unsafe extern "C" fn tx_ink_price() -> u32 { 1 }
    #[no_mangle]
    pub unsafe extern "C" fn tx_origin(_: *mut u8) {}
    #[no_mangle]
    pub unsafe extern "C" fn create1(_: *const u8, _: usize, _: *const u8, _: *mut u8, _: *mut usize) {}
    #[no_mangle]
    pub unsafe extern "C" fn create2(_: *const u8, _: usize, _: *const u8, _: *const u8, _: *mut u8, _: *mut usize) {}
    #[no_mangle]
    pub unsafe extern "C" fn call_contract(_: *const u8, _: *const u8, _: usize, _: *const u8, _: u64, _: *mut usize) -> u8 { 0 }
    #[no_mangle]
    pub unsafe extern "C" fn delegate_call_contract(_: *const u8, _: *const u8, _: usize, _: u64, _: *mut usize) -> u8 { 0 }
    #[no_mangle]
    pub unsafe extern "C" fn static_call_contract(_: *const u8, _: *const u8, _: usize, _: u64, _: *mut usize) -> u8 { 0 }
}
