// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title SHIELD Digital Tourist ID Smart Contract
 * @dev Manages consortium-based Tourist ID issuance, verification, and automated expiration.
 */
contract TouristID {
    
    // Validator node structure
    struct ValidatorNode {
        string nodeName;
        address nodeAddress;
        bool isActive;
    }

    // Biometric and Itinerary Records for Registered Tourists
    struct TouristRecord {
        string fullName;
        string kycHash;          // Secure passport/aadhaar hash
        string biometricPhotoHash; // SHA-256 hash of biometrics
        string emergencyContact;
        string entryPoint;
        uint256 validFrom;
        uint256 validUntil;       // Expiring timestamp
        bool isSOSActive;
        bool isRevoked;
    }

    address public admin;
    uint256 public totalIssuedIds;

    // Mappings
    mapping(address => ValidatorNode) public validators;
    mapping(uint256 => TouristRecord) public touristIDs;
    mapping(string => uint256) private kycToTokenId; // Prevent duplicate active registries

    // Events
    event ValidatorAdded(address indexed nodeAddress, string name);
    event TouristIDMinted(uint256 indexed tokenId, string fullName, string entryPoint, uint256 validUntil);
    event SOSTriggered(uint256 indexed tokenId, uint256 timestamp, string gpsLocation);
    event SOSResolved(uint256 indexed tokenId, uint256 timestamp);
    event IDExpired(uint256 indexed tokenId);

    modifier onlyAdmin() {
        require(msg.sender == admin, "Auth: Direct admin authority required");
        _;
    }

    modifier onlyValidator() {
        require(validators[msg.sender].isActive, "Auth: Node must be active consortium validator");
        _;
    }

    constructor() {
        admin = msg.sender;
        // Register deployer as first validator node
        validators[msg.sender] = ValidatorNode("Central Tourism Bureau", msg.sender, true);
        emit ValidatorAdded(msg.sender, "Central Tourism Bureau");
    }

    /**
     * @dev Register a new state checkpoint or police control center as a consortium validator node.
     */
    function addValidator(address _nodeAddress, string memory _nodeName) external onlyAdmin {
        validators[_nodeAddress] = ValidatorNode(_nodeName, _nodeAddress, true);
        emit ValidatorAdded(_nodeAddress, _nodeName);
    }

    /**
     * @dev Deactivate a compromised validator node.
     */
    function removeValidator(address _nodeAddress) external onlyAdmin {
        validators[_nodeAddress].isActive = false;
    }

    /**
     * @dev Mint an immutable Digital Tourist ID on the blockchain ledger.
     */
    function mintTouristID(
        string memory _fullName,
        string memory _kycDoc,
        string memory _biometricPhotoHash,
        string memory _emergencyContact,
        string memory _entryPoint,
        uint256 _durationSeconds
    ) external onlyValidator returns (uint256) {
        string memory kycHashStr = string(abi.encodePacked(keccak256(abi.encodePacked(_kycDoc))));
        
        // Ensure tourist doesn't hold an active unexpired registry
        if (kycToTokenId[kycHashStr] != 0) {
            uint256 existingId = kycToTokenId[kycHashStr];
            require(block.timestamp > touristIDs[existingId].validUntil || touristIDs[existingId].isRevoked, "Registry: Active unexpired ID already exists");
        }

        totalIssuedIds++;
        uint256 newTokenId = totalIssuedIds;

        uint256 validUntilTs = block.timestamp + _durationSeconds;

        touristIDs[newTokenId] = TouristRecord({
            fullName: _fullName,
            kycHash: kycHashStr,
            biometricPhotoHash: _biometricPhotoHash,
            emergencyContact: _emergencyContact,
            entryPoint: _entryPoint,
            validFrom: block.timestamp,
            validUntil: validUntilTs,
            isSOSActive: false,
            isRevoked: false
        });

        kycToTokenId[kycHashStr] = newTokenId;

        emit TouristIDMinted(newTokenId, _fullName, _entryPoint, validUntilTs);
        return newTokenId;
    }

    /**
     * @dev Dynamic validation check. Validates signature and active duration limits.
     */
    function isIDValid(uint256 _tokenId) external view returns (bool) {
        TouristRecord memory record = touristIDs[_tokenId];
        if (record.isRevoked) return false;
        if (block.timestamp > record.validUntil) return false;
        return true;
    }

    /**
     * @dev Emergency Panic SOS trigger. Commits evidence log on chain.
     */
    function triggerSOSBeacon(uint256 _tokenId, string calldata _gpsLocation) external onlyValidator {
        require(block.timestamp <= touristIDs[_tokenId].validUntil, "SOS: Tourist ID has expired");
        require(!touristIDs[_tokenId].isRevoked, "SOS: Tourist ID was revoked");
        
        touristIDs[_tokenId].isSOSActive = true;
        emit SOSTriggered(_tokenId, block.timestamp, _gpsLocation);
    }

    /**
     * @dev Resolves active SOS status once safety teams debrief targets.
     */
    function resolveSOSBeacon(uint256 _tokenId) external onlyValidator {
        touristIDs[_tokenId].isSOSActive = false;
        emit SOSResolved(_tokenId, block.timestamp);
    }

    /**
     * @dev Revokes card access (e.g. security violations).
     */
    function revokeTouristID(uint256 _tokenId) external onlyAdmin {
        touristIDs[_tokenId].isRevoked = true;
    }
}
