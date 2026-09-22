// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./interfaces/IPriceOracle.sol";
import "./interfaces/AggregatorV3Interface.sol";

/**
 * @title ChainlinkPriceOracle
 * @notice ETH/USD from a Chainlink feed, normalized to 18 decimals, with staleness and sanity
 * checks. If an L2 sequencer-uptime feed is configured, prices are rejected while the sequencer
 * is down and for a grace period after it restarts (Chainlink L2 best practice).
 */
contract ChainlinkPriceOracle is IPriceOracle {
    AggregatorV3Interface public immutable priceFeed;
    AggregatorV3Interface public immutable sequencerUptimeFeed; // address(0) disables the check
    uint256 public immutable maxStaleness;
    uint256 public constant SEQUENCER_GRACE_PERIOD = 1 hours;
    uint256 private immutable _scale;

    error InvalidPrice();
    error StalePrice(uint256 updatedAt);
    error SequencerDown();
    error SequencerGracePeriod();

    constructor(address _priceFeed, address _sequencerUptimeFeed, uint256 _maxStaleness) {
        priceFeed = AggregatorV3Interface(_priceFeed);
        sequencerUptimeFeed = AggregatorV3Interface(_sequencerUptimeFeed);
        maxStaleness = _maxStaleness;
        uint8 dec = priceFeed.decimals();
        require(dec <= 18, "feed decimals");
        _scale = 10 ** (18 - dec);
    }

    function getEthPriceUSD() external view override returns (uint256) {
        if (address(sequencerUptimeFeed) != address(0)) {
            (, int256 status, uint256 startedAt,,) = sequencerUptimeFeed.latestRoundData();
            if (status != 0) revert SequencerDown();
            if (block.timestamp - startedAt <= SEQUENCER_GRACE_PERIOD) revert SequencerGracePeriod();
        }
        (, int256 answer,, uint256 updatedAt,) = priceFeed.latestRoundData();
        if (answer <= 0) revert InvalidPrice();
        if (updatedAt > block.timestamp || block.timestamp - updatedAt > maxStaleness) revert StalePrice(updatedAt);
        return uint256(answer) * _scale;
    }
}
