// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IArbiCreditVault {
    struct LoanRecord {
        uint256 loanId;
        address borrower;
        uint256 principal; // borrow asset units (USDG, 6 decimals)
        uint256 collateralLocked; // collateral wei
        uint16 borrowRatioBps; // collateral ratio required at origination (tier)
        uint16 liqThresholdBps; // collateral/debt ratio below which the loan is liquidatable
        uint16 aprBps; // fixed APR at origination
        uint64 borrowTimestamp;
        uint64 dueDate;
        uint32 engineIndex; // index in the borrower's ArbiScore loan history
        bool isRepaid;
        bool isLiquidated;
    }

    struct BorrowQuote {
        uint16 score;
        uint8 tier;
        uint16 requiredRatioBps;
        uint16 liqThresholdBps;
        uint16 aprBps;
        uint256 requiredCollateralWei;
        uint256 traditionalCollateralWei;
        uint256 collateralSavedWei;
        uint256 collateralSavedUSD; // whole USD
    }

    function depositCollateral(uint256 amount) external;
    function withdrawCollateral(uint256 amount) external;
    function borrow(uint256 amount) external returns (uint256 loanId);
    function repay(uint256 loanId) external;
    function liquidate(uint256 loanId) external;

    function getBorrowQuote(address borrower, uint256 amount) external view returns (BorrowQuote memory);
    function debtOf(uint256 loanId) external view returns (uint256);
    function isLiquidatable(uint256 loanId) external view returns (bool);

    function userCollateral(address user) external view returns (uint256);
    function userLockedCollateral(address user) external view returns (uint256);
    function getFreeCollateral(address user) external view returns (uint256);
    function loans(uint256 loanId) external view returns (LoanRecord memory);
    function getUserLoanIds(address user) external view returns (uint256[] memory);
}
