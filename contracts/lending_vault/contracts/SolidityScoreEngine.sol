// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./interfaces/IArbiScoreEngine.sol";
import "./ArbiScoreModel.sol";

/**
 * @title SolidityScoreEngine
 * @notice EVM implementation of the ArbiScore engine with the same ABI and storage layout as
 * the Rust/Stylus engine. Used for local tests and as the gas baseline in the Stylus benchmark.
 */
contract SolidityScoreEngine is IArbiScoreEngine {
    using ArbiScoreModel for ArbiScoreModel.Acc;

    /// One packed slot per loan: 64 + 3*48 + 8 = 216 bits.
    struct StoredLoan {
        uint64 amountUsd;
        uint48 borrowTs;
        uint48 dueTs;
        uint48 closeTs;
        uint8 status;
    }

    struct Profile {
        uint64 firstActivityTimestamp;
        uint64 lastActivityTimestamp;
        uint32 totalTransactions;
        uint256 totalVolumeUSD;
        uint32 loansTaken;
        uint32 loansRepaid;
        uint32 liquidations;
        uint16 lastCalculatedScore;
        bool isInitialized;
        StoredLoan[] history;
    }

    address public override owner;
    mapping(address => bool) public override isVault;
    bool public override demoMode;
    mapping(address => Profile) private _profiles;
    address public override importer;

    event ScoreCalculated(address indexed user, uint16 score, uint8 tier, uint16 collateralRatioBps);
    event LoanOpened(address indexed user, uint32 indexed historyIndex, uint64 amountUsd, uint64 dueTs);
    event LoanClosed(address indexed user, uint32 indexed historyIndex, bool liquidated);
    event VaultSet(address indexed vault, bool authorized);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event DemoModeSet(bool enabled);
    event ImporterSet(address indexed importer);

    error Unauthorized();
    error InvalidLoanIndex();
    error LoanNotOpen();
    error InvalidProfile();
    error DemoModeDisabled();
    error HasOpenLoans();

    modifier onlyVaultOrOwner() {
        if (!isVault[msg.sender] && msg.sender != owner) revert Unauthorized();
        _;
    }

    /// Sets the owner and (if non-zero) authorizes a first lending vault. Demo mode starts off.
    function init(address ownerAddr, address vaultAddr) external override {
        address current = owner;
        if (current != address(0) && msg.sender != current) revert Unauthorized();
        owner = ownerAddr;
        if (vaultAddr != address(0)) {
            isVault[vaultAddr] = true;
            emit VaultSet(vaultAddr, true);
        }
        emit OwnershipTransferred(current, ownerAddr);
    }

    /// Owner authorizes (or revokes) a lending market; several markets share one credit history.
    function setVault(address vault, bool authorized) external override {
        if (msg.sender != owner) revert Unauthorized();
        isVault[vault] = authorized;
        emit VaultSet(vault, authorized);
    }

    function setDemoMode(bool enabled) external override {
        if (msg.sender != owner) revert Unauthorized();
        demoMode = enabled;
        emit DemoModeSet(enabled);
    }

    function setImporter(address importer_) external override {
        if (msg.sender != owner) revert Unauthorized();
        importer = importer_;
        emit ImporterSet(importer_);
    }

    // --- Scoring ---

    function _scoreOf(address user) internal view returns (uint16) {
        Profile storage p = _profiles[user];
        if (!p.isInitialized) return ArbiScoreModel.MIN_SCORE;
        uint256 len = p.history.length;
        uint256 start = len > ArbiScoreModel.MAX_HISTORY ? len - ArbiScoreModel.MAX_HISTORY : 0;
        ArbiScoreModel.Acc memory acc;
        for (uint256 i = start; i < len; ++i) {
            StoredLoan storage e = p.history[i];
            acc.add(ArbiScoreModel.Loan(e.amountUsd, e.borrowTs, e.dueTs, e.closeTs, e.status), block.timestamp);
        }
        return acc.finish(p.firstActivityTimestamp, p.totalTransactions, p.totalVolumeUSD, block.timestamp);
    }

    function _refreshScore(address user) internal returns (uint16 score) {
        score = _scoreOf(user);
        _profiles[user].lastCalculatedScore = score;
        (uint8 tier, uint16 ratio) = ArbiScoreModel.scoreToTier(score);
        emit ScoreCalculated(user, score, tier, ratio);
    }

    function _touch(address user) internal {
        Profile storage p = _profiles[user];
        if (!p.isInitialized) {
            p.firstActivityTimestamp = uint64(block.timestamp);
            p.isInitialized = true;
        }
        p.lastActivityTimestamp = uint64(block.timestamp);
    }

    function calculateScore(address user) external view override returns (uint16) {
        return _scoreOf(user);
    }

    function getScoreAndTier(address user)
        external
        view
        override
        returns (uint16 score, uint8 tier, uint16 collateralRatioBps)
    {
        score = _scoreOf(user);
        (tier, collateralRatioBps) = ArbiScoreModel.scoreToTier(score);
    }

    function getProfile(address user) external view override returns (BorrowerProfileView memory v) {
        Profile storage p = _profiles[user];
        v = BorrowerProfileView(
            p.firstActivityTimestamp,
            p.lastActivityTimestamp,
            p.totalTransactions,
            p.totalVolumeUSD,
            p.loansTaken,
            p.loansRepaid,
            p.liquidations,
            _scoreOf(user),
            p.isInitialized
        );
    }

    function getLoanHistory(address user)
        external
        view
        override
        returns (
            uint64[] memory amountsUsd,
            uint64[] memory borrowTs,
            uint64[] memory dueTs,
            uint64[] memory closeTs,
            uint8[] memory statuses
        )
    {
        StoredLoan[] storage h = _profiles[user].history;
        uint256 n = h.length;
        amountsUsd = new uint64[](n);
        borrowTs = new uint64[](n);
        dueTs = new uint64[](n);
        closeTs = new uint64[](n);
        statuses = new uint8[](n);
        for (uint256 i = 0; i < n; ++i) {
            StoredLoan storage e = h[i];
            (amountsUsd[i], borrowTs[i], dueTs[i], closeTs[i], statuses[i]) =
                (e.amountUsd, e.borrowTs, e.dueTs, e.closeTs, e.status);
        }
    }

    // --- Vault hooks ---

    function onLoanOpened(address user, uint64 amountUsd, uint64 dueTs)
        external
        override
        onlyVaultOrOwner
        returns (uint32 index)
    {
        _touch(user);
        Profile storage p = _profiles[user];
        index = uint32(p.history.length);
        p.history.push(StoredLoan(amountUsd, uint48(block.timestamp), _u48(dueTs), 0, ArbiScoreModel.LOAN_OPEN));
        p.loansTaken += 1;
        emit LoanOpened(user, index, amountUsd, dueTs);
        _refreshScore(user);
    }

    function onLoanClosed(address user, uint32 historyIndex, bool liquidated)
        external
        override
        onlyVaultOrOwner
        returns (uint16)
    {
        _touch(user);
        Profile storage p = _profiles[user];
        if (historyIndex >= p.history.length) revert InvalidLoanIndex();
        StoredLoan storage e = p.history[historyIndex];
        if (e.status != ArbiScoreModel.LOAN_OPEN) revert LoanNotOpen();
        e.closeTs = uint48(block.timestamp);
        if (liquidated) {
            e.status = ArbiScoreModel.LOAN_LIQUIDATED;
            p.liquidations += 1;
        } else {
            e.status = ArbiScoreModel.LOAN_REPAID;
            p.loansRepaid += 1;
        }
        emit LoanClosed(user, historyIndex, liquidated);
        return _refreshScore(user);
    }

    // --- Judge sandbox ---

    function setMockProfile(
        address user,
        uint32 ageDays,
        uint32 txCount,
        uint256 volumeUsd,
        uint64[] memory amountsUsd,
        uint32[] memory borrowedDaysAgo,
        uint8[] memory statuses,
        uint32[] memory daysLate
    ) external override returns (uint16) {
        if (msg.sender != owner && !isVault[msg.sender] && msg.sender != importer) {
            if (msg.sender != user) revert Unauthorized();
            if (!demoMode) revert DemoModeDisabled();
            // Self-service profiles may not rewrite history that backs a live loan
            StoredLoan[] storage h = _profiles[user].history;
            for (uint256 i = 0; i < h.length; ++i) {
                if (h[i].status == ArbiScoreModel.LOAN_OPEN) revert HasOpenLoans();
            }
        }
        uint256 n = amountsUsd.length;
        if (
            n > ArbiScoreModel.MAX_HISTORY || borrowedDaysAgo.length != n || statuses.length != n
                || daysLate.length != n
        ) revert InvalidProfile();

        Profile storage p = _profiles[user];
        uint256 back = uint256(ageDays) * ArbiScoreModel.DAY;
        p.firstActivityTimestamp = uint64(block.timestamp > back ? block.timestamp - back : 0);
        p.lastActivityTimestamp = uint64(block.timestamp);
        p.totalTransactions = txCount;
        p.totalVolumeUSD = volumeUsd;
        p.isInitialized = true;
        _writeHistory(p, amountsUsd, borrowedDaysAgo, statuses, daysLate);
        return _refreshScore(user);
    }

    function _writeHistory(
        Profile storage p,
        uint64[] memory amountsUsd,
        uint32[] memory borrowedDaysAgo,
        uint8[] memory statuses,
        uint32[] memory daysLate
    ) private {
        delete p.history;
        uint32 repaid;
        uint32 liquidated;
        uint256 n = amountsUsd.length;
        for (uint256 i = 0; i < n; ++i) {
            if (statuses[i] > ArbiScoreModel.LOAN_LIQUIDATED) revert InvalidProfile();
            ArbiScoreModel.Loan memory l =
                ArbiScoreModel.specToLoan(amountsUsd[i], borrowedDaysAgo[i], statuses[i], daysLate[i], block.timestamp);
            if (l.status == ArbiScoreModel.LOAN_REPAID) repaid++;
            else if (l.status == ArbiScoreModel.LOAN_LIQUIDATED) liquidated++;
            p.history.push(StoredLoan(l.amountUsd, _u48(l.borrowTs), _u48(l.dueTs), _u48(l.closeTs), l.status));
        }
        p.loansTaken = uint32(n);
        p.loansRepaid = repaid;
        p.liquidations = liquidated;
    }

    function _u48(uint256 v) private pure returns (uint48) {
        return v > type(uint48).max ? type(uint48).max : uint48(v);
    }
}
