// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../interfaces/IPriceOracle.sol";

contract MockPriceOracle is IPriceOracle {
    uint256 public ethPriceUSD;

    event PriceUpdated(uint256 oldPrice, uint256 newPrice);

    constructor(uint256 initialPrice) {
        // Default to $3,000 * 1e18 if initialPrice is 0
        ethPriceUSD = initialPrice == 0 ? 3000 * 1e18 : initialPrice;
    }

    function getEthPriceUSD() external view override returns (uint256) {
        return ethPriceUSD;
    }

    /// @dev Test-only: anyone may move the price.
    function setEthPriceUSD(uint256 newPrice) external {
        uint256 oldPrice = ethPriceUSD;
        ethPriceUSD = newPrice;
        emit PriceUpdated(oldPrice, newPrice);
    }
}
