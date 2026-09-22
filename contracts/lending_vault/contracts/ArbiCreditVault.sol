// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./interfaces/IArbiScoreEngine.sol";
import "./interfaces/IArbiCreditVault.sol";
import "./interfaces/IPriceOracle.sol";

/**
 * @title ArbiCreditVault
 * @notice Two-sided credit market. Lenders supply the borrow asset (USDG) and receive ERC-4626
 * shares that accrue interest. Borrowers post collateral (WETH) at a ratio set by their ArbiScore
 * tier (105%-150%) and pay a fixed APR set at origination from pool utilization plus a tier risk
 * premium. Every loan outcome is written back to the Stylus scoring engine.
 *
 * Safety properties:
 * - Liquidation thresholds sit below each tier's borrow ratio, so a fresh loan is never
 *   immediately liquidatable, and the liquidator bonus never exceeds the borrower's own collateral.
 * - Collateral of other users is never used to pay liquidators; shortfalls are bad debt borne
 *   by lenders through the share price.
 * - The scoring engine and oracle are immutable; the owner can only pause new supply/borrows.
 *   Repay, collateral withdrawal, liquidation and lender redemptions always stay open.
 */
contract ArbiCreditVault is ERC4626, IArbiCreditVault, ReentrancyGuard, Pausable, Ownable {
    using SafeERC20 for IERC20;
    using Math for uint256;

    // --- Immutables ---
    IArbiScoreEngine public immutable scoreEngine;
    IPriceOracle public immutable priceOracle;
    IERC20 public immutable collateralToken;
    uint256 private immutable _debtToUsd18; // scales borrow-asset units to 18-decimal USD

    // --- Parameters ---
    uint256 public constant LOAN_TERM = 30 days;
    uint256 public constant GRACE_PERIOD = 3 days;
    uint256 public constant TRADITIONAL_DEFI_RATIO_BPS = 15000;
    uint256 public constant MIN_BORROW_USD = 1; // whole USD
    uint256 private constant BPS = 10_000;
    uint256 private constant YEAR = 365 days;

    // Interest rate model (bps): kinked on utilization, plus a per-tier risk premium.
    uint256 public constant BASE_RATE_BPS = 200;
    uint256 public constant SLOPE1_BPS = 1_000; // added linearly up to the kink
    uint256 public constant SLOPE2_BPS = 6_000; // added linearly from the kink to 100%
    uint256 public constant KINK_BPS = 8_000;

    // --- Credit accounting ---
    uint256 public totalPrincipal; // outstanding principal of active loans
    uint256 private _rateSum; // sum(principal * aprBps) over active loans
    uint256 private _rateTimeSum; // sum(principal * aprBps * borrowTimestamp) over active loans

    uint256 public nextLoanId = 1;
    mapping(address => uint256) public override userCollateral;
    mapping(address => uint256) public override userLockedCollateral;
    mapping(uint256 => LoanRecord) private _loans;
    mapping(address => uint256[]) private _userLoanIds;

    // --- Events ---
    event CollateralDeposited(address indexed user, uint256 amount);
    event CollateralWithdrawn(address indexed user, uint256 amount);
    event LoanCreated(
        uint256 indexed loanId,
        address indexed borrower,
        uint256 principal,
        uint256 collateralLocked,
        uint16 ratioBps,
        uint16 aprBps,
        uint16 creditScore
    );
    event LoanRepaid(uint256 indexed loanId, address indexed borrower, uint256 principal, uint256 interest, bool onTime);
    event LoanLiquidated(
        uint256 indexed loanId,
        address indexed borrower,
        address indexed liquidator,
        uint256 debtRepaid,
        uint256 collateralSeized,
        uint256 badDebt
    );

    // --- Errors ---
    error ZeroAmount();
    error BorrowTooSmall();
    error InsufficientFreeCollateral(uint256 available, uint256 required);
    error InsufficientLiquidity(uint256 available, uint256 requested);
    error LoanNotFound();
    error LoanNotActive();
    error LoanNotLiquidatable();

    constructor(
        address _scoreEngine,
        address _priceOracle,
        IERC20Metadata _borrowAsset,
        address _collateralToken
    )
        ERC20("ArbiScore Lending Share", string.concat("as", _borrowAsset.symbol()))
        ERC4626(_borrowAsset)
        Ownable(msg.sender)
    {
        scoreEngine = IArbiScoreEngine(_scoreEngine);
        priceOracle = IPriceOracle(_priceOracle);
        collateralToken = IERC20(_collateralToken);
        _debtToUsd18 = 10 ** (18 - _borrowAsset.decimals());
    }

    // =====================================================================
    // Lender side (ERC-4626)
    // =====================================================================

    /// @notice Cash + outstanding principal + interest accrued on active loans.
    function totalAssets() public view override returns (uint256) {
        return IERC20(asset()).balanceOf(address(this)) + totalPrincipal + accruedInterest();
    }

    function accruedInterest() public view returns (uint256) {
        return (block.timestamp * _rateSum - _rateTimeSum) / (BPS * YEAR);
    }

    /// @notice Share of assets currently lent out, in bps.
    function utilizationBps() public view returns (uint256) {
        uint256 assets = totalAssets();
        return assets == 0 ? 0 : (totalPrincipal * BPS) / assets;
    }

    /// @notice Current annualized yield to lenders, in bps (principal-weighted loan APR x utilization).
    function supplyRateBps() external view returns (uint256) {
        uint256 assets = totalAssets();
        return assets == 0 ? 0 : _rateSum / assets;
    }

    /// @dev Lenders can only redeem idle cash; lent-out funds return as loans are repaid.
    function maxWithdraw(address owner_) public view override returns (uint256) {
        return Math.min(super.maxWithdraw(owner_), IERC20(asset()).balanceOf(address(this)));
    }

    function maxRedeem(address owner_) public view override returns (uint256) {
        return Math.min(super.maxRedeem(owner_), _convertToShares(IERC20(asset()).balanceOf(address(this)), Math.Rounding.Floor));
    }

    function maxDeposit(address) public view override returns (uint256) {
        return paused() ? 0 : type(uint256).max;
    }

    function maxMint(address) public view override returns (uint256) {
        return paused() ? 0 : type(uint256).max;
    }

    /// @dev Virtual shares/assets offset against share-inflation (donation) attacks.
    function _decimalsOffset() internal pure override returns (uint8) {
        return 6;
    }

    function _deposit(address caller, address receiver, uint256 assets, uint256 shares) internal override nonReentrant {
        super._deposit(caller, receiver, assets, shares);
    }

    function _withdraw(address caller, address receiver, address owner_, uint256 assets, uint256 shares)
        internal
        override
        nonReentrant
    {
        super._withdraw(caller, receiver, owner_, assets, shares);
    }

    // =====================================================================
    // Collateral
    // =====================================================================

    function depositCollateral(uint256 amount) external override nonReentrant whenNotPaused {
        if (amount == 0) revert ZeroAmount();
        collateralToken.safeTransferFrom(msg.sender, address(this), amount);
        userCollateral[msg.sender] += amount;
        emit CollateralDeposited(msg.sender, amount);
    }

    function withdrawCollateral(uint256 amount) external override nonReentrant {
        if (amount == 0) revert ZeroAmount();
        uint256 free = getFreeCollateral(msg.sender);
        if (amount > free) revert InsufficientFreeCollateral(free, amount);
        userCollateral[msg.sender] -= amount;
        collateralToken.safeTransfer(msg.sender, amount);
        emit CollateralWithdrawn(msg.sender, amount);
    }

    function getFreeCollateral(address user) public view override returns (uint256) {
        return userCollateral[user] - userLockedCollateral[user];
    }

    // =====================================================================
    // Borrowing
    // =====================================================================

    /// @notice Liquidation threshold for a tier (collateral/debt, bps). Always below the borrow ratio.
    function liquidationThresholdBps(uint8 tier) public pure returns (uint16) {
        if (tier >= 3) return 10300; // Prime: borrow 105%
        if (tier == 2) return 11000; // Near-Prime: borrow 115%
        if (tier == 1) return 12000; // Moderate: borrow 130%
        return 13000; // Subprime: borrow 150%
    }

    /// @notice Liquidator bonus: half the threshold's cushion above 100%, capped at 5%.
    function liquidationBonusBps(uint16 ltBps) public pure returns (uint256) {
        return Math.min(500, (uint256(ltBps) - BPS) / 2);
    }

    function tierPremiumBps(uint8 tier) public pure returns (uint256) {
        if (tier >= 3) return 0;
        if (tier == 2) return 150;
        if (tier == 1) return 300;
        return 500;
    }

    /// @notice APR a new loan of `amount` would pay, given utilization after the borrow.
    function quoteAprBps(uint8 tier, uint256 amount) public view returns (uint16) {
        uint256 assets = totalAssets();
        uint256 u = assets == 0 ? BPS : Math.min(BPS, ((totalPrincipal + amount) * BPS) / assets);
        uint256 rate = u <= KINK_BPS
            ? BASE_RATE_BPS + (u * SLOPE1_BPS) / KINK_BPS
            : BASE_RATE_BPS + SLOPE1_BPS + ((u - KINK_BPS) * SLOPE2_BPS) / (BPS - KINK_BPS);
        return uint16(rate + tierPremiumBps(tier));
    }

    function _collateralFor(uint256 debt, uint256 ratioBps, uint256 price) internal view returns (uint256) {
        return (debt * _debtToUsd18 * ratioBps).mulDiv(1e18, BPS * price, Math.Rounding.Ceil);
    }

    function borrow(uint256 amount) external override nonReentrant whenNotPaused returns (uint256 loanId) {
        uint256 amountUsd = (amount * _debtToUsd18) / 1e18;
        if (amountUsd < MIN_BORROW_USD) revert BorrowTooSmall();
        uint256 cash = IERC20(asset()).balanceOf(address(this));
        if (amount > cash) revert InsufficientLiquidity(cash, amount);

        (uint16 score, uint8 tier, uint16 ratioBps) = scoreEngine.getScoreAndTier(msg.sender);
        uint256 required = _collateralFor(amount, ratioBps, priceOracle.getEthPriceUSD());
        uint256 free = getFreeCollateral(msg.sender);
        if (free < required) revert InsufficientFreeCollateral(free, required);

        uint16 apr = quoteAprBps(tier, amount);
        userLockedCollateral[msg.sender] += required;
        totalPrincipal += amount;
        _rateSum += amount * apr;
        _rateTimeSum += amount * apr * block.timestamp;

        loanId = nextLoanId++;
        uint64 due = uint64(block.timestamp + LOAN_TERM);
        LoanRecord storage loan = _loans[loanId];
        _loans[loanId] = LoanRecord({
            loanId: loanId,
            borrower: msg.sender,
            principal: amount,
            collateralLocked: required,
            borrowRatioBps: ratioBps,
            liqThresholdBps: liquidationThresholdBps(tier),
            aprBps: apr,
            borrowTimestamp: uint64(block.timestamp),
            dueDate: due,
            engineIndex: 0,
            isRepaid: false,
            isLiquidated: false
        });
        _userLoanIds[msg.sender].push(loanId);

        // Interactions: trusted immutable engine, then token transfer.
        loan.engineIndex = scoreEngine.onLoanOpened(msg.sender, uint64(amountUsd), due);
        IERC20(asset()).safeTransfer(msg.sender, amount);
        emit LoanCreated(loanId, msg.sender, amount, required, ratioBps, apr, score);
    }

    /// @notice Interest owed so far (rounded up, in favour of lenders).
    function interestOf(uint256 loanId) public view returns (uint256) {
        LoanRecord storage loan = _loans[loanId];
        if (loan.isRepaid || loan.isLiquidated || loan.loanId == 0) return 0;
        return (loan.principal * loan.aprBps * (block.timestamp - loan.borrowTimestamp)).ceilDiv(BPS * YEAR);
    }

    function debtOf(uint256 loanId) public view override returns (uint256) {
        LoanRecord storage loan = _loans[loanId];
        if (loan.isRepaid || loan.isLiquidated || loan.loanId == 0) return 0;
        return loan.principal + interestOf(loanId);
    }

    function _closeAccounting(LoanRecord storage loan) internal {
        totalPrincipal -= loan.principal;
        _rateSum -= loan.principal * loan.aprBps;
        _rateTimeSum -= loan.principal * loan.aprBps * loan.borrowTimestamp;
        userLockedCollateral[loan.borrower] -= loan.collateralLocked;
    }

    /// @notice Repays principal + interest. Anyone may repay on a borrower's behalf.
    function repay(uint256 loanId) external override nonReentrant {
        LoanRecord storage loan = _loans[loanId];
        if (loan.loanId == 0) revert LoanNotFound();
        if (loan.isRepaid || loan.isLiquidated) revert LoanNotActive();

        uint256 interest = interestOf(loanId);
        IERC20(asset()).safeTransferFrom(msg.sender, address(this), loan.principal + interest);
        _closeAccounting(loan);
        loan.isRepaid = true;

        scoreEngine.onLoanClosed(loan.borrower, loan.engineIndex, false);
        emit LoanRepaid(loanId, loan.borrower, loan.principal, interest, block.timestamp <= loan.dueDate);
    }

    // =====================================================================
    // Liquidation
    // =====================================================================

    function isLiquidatable(uint256 loanId) public view override returns (bool) {
        LoanRecord storage loan = _loans[loanId];
        if (loan.loanId == 0 || loan.isRepaid || loan.isLiquidated) return false;
        if (block.timestamp > loan.dueDate + GRACE_PERIOD) return true;
        // collateral value < debt * threshold, compared at full precision (both sides scaled by 1e18 * BPS)
        return loan.collateralLocked * priceOracle.getEthPriceUSD() * BPS
            < debtOf(loanId) * _debtToUsd18 * loan.liqThresholdBps * 1e18;
    }

    /**
     * @notice Repays a liquidatable loan's debt and receives the borrower's collateral worth the debt
     * plus the tier's bonus. If the locked collateral is worth less than that, the liquidator receives
     * all of it for proportionally less repayment and the shortfall is written off as bad debt.
     */
    function liquidate(uint256 loanId) external override nonReentrant {
        LoanRecord storage loan = _loans[loanId];
        if (loan.loanId == 0) revert LoanNotFound();
        if (loan.isRepaid || loan.isLiquidated) revert LoanNotActive();
        if (!isLiquidatable(loanId)) revert LoanNotLiquidatable();

        uint256 price = priceOracle.getEthPriceUSD();
        uint256 debt = debtOf(loanId);
        uint256 bonusBps = liquidationBonusBps(loan.liqThresholdBps);
        uint256 seize = _collateralFor(debt, BPS + bonusBps, price);
        uint256 repayAmount = debt;
        if (seize > loan.collateralLocked) {
            seize = loan.collateralLocked;
            // debt-asset value of all locked collateral, net of the bonus
            repayAmount = Math.min(debt, (seize * price).mulDiv(BPS, 1e18 * _debtToUsd18 * (BPS + bonusBps)));
        }
        uint256 badDebt = debt - repayAmount;

        IERC20(asset()).safeTransferFrom(msg.sender, address(this), repayAmount);
        _closeAccounting(loan);
        loan.isLiquidated = true;
        userCollateral[loan.borrower] -= seize; // the unseized remainder stays as free collateral
        collateralToken.safeTransfer(msg.sender, seize);

        scoreEngine.onLoanClosed(loan.borrower, loan.engineIndex, true);
        emit LoanLiquidated(loanId, loan.borrower, msg.sender, repayAmount, seize, badDebt);
    }

    // =====================================================================
    // Views & admin
    // =====================================================================

    function getBorrowQuote(address borrower, uint256 amount) external view override returns (BorrowQuote memory q) {
        (q.score, q.tier, q.requiredRatioBps) = scoreEngine.getScoreAndTier(borrower);
        uint256 price = priceOracle.getEthPriceUSD();
        q.liqThresholdBps = liquidationThresholdBps(q.tier);
        q.aprBps = quoteAprBps(q.tier, amount);
        q.requiredCollateralWei = _collateralFor(amount, q.requiredRatioBps, price);
        q.traditionalCollateralWei = _collateralFor(amount, TRADITIONAL_DEFI_RATIO_BPS, price);
        if (q.traditionalCollateralWei > q.requiredCollateralWei) {
            q.collateralSavedWei = q.traditionalCollateralWei - q.requiredCollateralWei;
            q.collateralSavedUSD = (q.collateralSavedWei * price + 5e35) / 1e36; // nearest whole USD
        }
    }

    function loans(uint256 loanId) external view override returns (LoanRecord memory) {
        return _loans[loanId];
    }

    function getUserLoanIds(address user) external view override returns (uint256[] memory) {
        return _userLoanIds[user];
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }
}
