// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./interfaces/IArbiScoreEngine.sol";

/**
 * @title CreditImporter
 * @notice Portable credit: bootstraps an ArbiScore profile from a wallet's existing lending history
 * on other protocols (e.g. Aave V3 on Arbitrum One), attested off-chain by an indexer and verified
 * here with EIP-712. Solves the cold-start problem without letting anyone rewrite ArbiScore history:
 * - only the wallet itself can submit its attestation (opt-in),
 * - only wallets with no ArbiScore history can import (existing records, incl. liquidations, are final),
 * - attestations expire quickly, so the relative loan ages they encode stay accurate.
 * Trust assumption: the attester reports external history honestly (roadmap: storage proofs).
 */
contract CreditImporter is EIP712, Ownable {
    struct Attestation {
        address user;
        uint32 ageDays;
        uint32 txCount;
        uint256 volumeUsd;
        uint64[] amountsUsd;
        uint32[] borrowedDaysAgo;
        uint8[] statuses;
        uint32[] daysLate;
        string source; // e.g. "aave-v3-arbitrum"
        uint256 deadline;
    }

    bytes32 public constant ATTESTATION_TYPEHASH = keccak256(
        "CreditAttestation(address user,uint32 ageDays,uint32 txCount,uint256 volumeUsd,bytes32 loansHash,string source,uint256 deadline)"
    );

    IArbiScoreEngine public immutable engine;
    address public attester;

    event AttesterSet(address indexed attester);
    event CreditImported(address indexed user, string source, uint256 loans, uint16 score);

    error NotYourAttestation();
    error AttestationExpired();
    error InvalidSignature();
    error AlreadyHasHistory();
    error ZeroAddress();

    constructor(address _engine, address _attester) EIP712("ArbiScore CreditImporter", "1") Ownable(msg.sender) {
        if (_engine == address(0) || _attester == address(0)) revert ZeroAddress();
        engine = IArbiScoreEngine(_engine);
        attester = _attester;
        emit AttesterSet(_attester);
    }

    function setAttester(address _attester) external onlyOwner {
        if (_attester == address(0)) revert ZeroAddress();
        attester = _attester;
        emit AttesterSet(_attester);
    }

    function loansHash(Attestation calldata a) public pure returns (bytes32) {
        return keccak256(abi.encode(a.amountsUsd, a.borrowedDaysAgo, a.statuses, a.daysLate));
    }

    function digest(Attestation calldata a) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    ATTESTATION_TYPEHASH,
                    a.user,
                    a.ageDays,
                    a.txCount,
                    a.volumeUsd,
                    loansHash(a),
                    keccak256(bytes(a.source)),
                    a.deadline
                )
            )
        );
    }

    function importCredit(Attestation calldata a, bytes calldata signature) external returns (uint16 score) {
        if (msg.sender != a.user) revert NotYourAttestation();
        if (block.timestamp > a.deadline) revert AttestationExpired();
        if (ECDSA.recover(digest(a), signature) != attester) revert InvalidSignature();
        if (engine.getProfile(a.user).isInitialized) revert AlreadyHasHistory();

        score = engine.setMockProfile(
            a.user, a.ageDays, a.txCount, a.volumeUsd, a.amountsUsd, a.borrowedDaysAgo, a.statuses, a.daysLate
        );
        emit CreditImported(a.user, a.source, a.amountsUsd.length, score);
    }
}
