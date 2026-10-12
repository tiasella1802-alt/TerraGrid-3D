// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title TerraGrid retrofit registry
/// @notice A council funds retrofits on its hottest buildings; the rebate is released only when an independent
/// verifier's measurement shows the building actually improved. Pay for measured performance, not promises.
/// Evidence (satellite, sensor and meter readings) stays off-chain; its SHA-256 fingerprint goes on-chain so anyone can
/// check the app's data was not altered afterwards.
/// Each building is judged on one metric, lower = better:
///   HEAT   roof temperature minus the median of nearby roofs on the same satellite pass, in hundredths of a degree C
///          (relative to neighbours, so a cooler day doesn't count as cooling). For cool roofs and tree canopy.
///   ENERGY annual energy use in kWh. For insulation, efficient HVAC, smart controls and similar.
contract RetrofitRegistry {
    enum Stage { None, Enrolled, Installed, Verified }
    enum Metric { HEAT, ENERGY }

    struct Building {
        Stage stage;
        Metric metric;
        int64 baseline;         // before the work
        int64 measured;         // after the work, set when verified
        int64 minGain;          // the improvement (baseline - measured) the rebate requires
        uint64 rebateCents;     // what the council commits to pay on verification
        uint64 enrolledAt;
        uint64 installedAt;
        uint64 verifiedAt;
        bytes32 baselineEvidence;
        bytes32 afterEvidence;
    }

    address public immutable council;
    mapping(address => bool) public verifiers;
    mapping(bytes32 => Building) public buildings;
    bytes32[] public ids;
    uint256 public anchors;

    event VerifierSet(address indexed verifier, bool allowed);
    event Enrolled(bytes32 indexed id, Metric metric, int64 baseline, int64 minGain, uint64 rebateCents, bytes32 evidence);
    event Installed(bytes32 indexed id);
    event Verified(bytes32 indexed id, int64 gain, uint64 rebateCents, bytes32 evidence);
    event NotYetImproved(bytes32 indexed id, int64 gain, int64 minGain, bytes32 evidence);
    event DataAnchored(uint256 indexed seq, bytes32 dataHash, uint32 readings, string kind);

    error NotCouncil();
    error NotVerifier();
    error WrongStage(Stage have, Stage want);
    error NoEvidence();

    modifier onlyCouncil() {
        if (msg.sender != council) revert NotCouncil();
        _;
    }

    modifier at(bytes32 id, Stage want) {
        Stage have = buildings[id].stage;
        if (have != want) revert WrongStage(have, want);
        _;
    }

    constructor() {
        council = msg.sender;
    }

    /// @notice The council names who may verify. Keeping verifier and council apart means the payer can't mark its own homework.
    function setVerifier(address v, bool allowed) external onlyCouncil {
        verifiers[v] = allowed;
        emit VerifierSet(v, allowed);
    }

    /// @notice Fund a building. Reverts if it is already in the program, so one building can't be funded twice.
    function enrol(bytes32 id, Metric metric, int64 baseline, int64 minGain, uint64 rebateCents, bytes32 evidence)
        external onlyCouncil at(id, Stage.None)
    {
        if (evidence == bytes32(0)) revert NoEvidence();
        buildings[id] = Building(Stage.Enrolled, metric, baseline, 0, minGain, rebateCents, uint64(block.timestamp), 0, 0, evidence, 0);
        ids.push(id);
        emit Enrolled(id, metric, baseline, minGain, rebateCents, evidence);
    }

    function markInstalled(bytes32 id) external onlyCouncil at(id, Stage.Enrolled) {
        buildings[id].stage = Stage.Installed;
        buildings[id].installedAt = uint64(block.timestamp);
        emit Installed(id);
    }

    /// @notice A verifier submits the post-work measurement. The contract, not a person, decides whether the rebate is
    /// released: only if the building improved by at least minGain. Otherwise it stays Installed and can be re-checked
    /// with a later measurement.
    function verify(bytes32 id, int64 measured, bytes32 evidence) external at(id, Stage.Installed) returns (bool) {
        if (!verifiers[msg.sender]) revert NotVerifier();
        if (evidence == bytes32(0)) revert NoEvidence();
        Building storage b = buildings[id];
        int64 gain = b.baseline - measured;
        if (gain < b.minGain) {
            emit NotYetImproved(id, gain, b.minGain, evidence);
            return false;
        }
        b.stage = Stage.Verified;
        b.measured = measured;
        b.afterEvidence = evidence;
        b.verifiedAt = uint64(block.timestamp);
        emit Verified(id, gain, b.rebateCents, evidence);
        return true;
    }

    /// @notice Seal a batch of sensor or other readings: a tamper-evident log for IoT data.
    function anchor(bytes32 dataHash, uint32 readings, string calldata kind) external {
        if (msg.sender != council && !verifiers[msg.sender]) revert NotVerifier();
        emit DataAnchored(++anchors, dataHash, readings, kind);
    }

    function count() external view returns (uint256) {
        return ids.length;
    }
}
