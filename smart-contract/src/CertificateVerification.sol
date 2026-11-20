// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title CertificateVerification
/// @notice Multi-university certificate registry. The platform owner authorizes institutions;
/// each university issues and revokes its own certificates and pays its own transaction gas.
/// @dev Keep student personal information off-chain. Store only wallet, document hash and IPFS CID.
contract CertificateVerification {
    struct University {
        bytes32 universityId;
        string name;
        bool active;
    }

    struct Certificate {
        bytes32 universityId;
        address recipient;
        address issuer;
        bytes32 documentHash;
        string ipfsCid;
        uint256 issuedAt;
        bool revoked;
    }

    address public owner;
    mapping(address => University) private universities;
    mapping(bytes32 => address) public universityWalletById;
    mapping(bytes32 => Certificate) private certificates;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event UniversityRegistered(address indexed wallet, bytes32 indexed universityId, string name);
    event UniversityStatusChanged(address indexed wallet, bool active);
    event CertificateIssued(
        bytes32 indexed universityId,
        bytes32 indexed certificateId,
        address indexed recipient,
        address issuer,
        bytes32 documentHash,
        string ipfsCid,
        uint256 issuedAt
    );
    event CertificateRevoked(bytes32 indexed certificateId, address indexed issuer, uint256 revokedAt);

    error NotOwner();
    error NotIssuer();
    error NotAuthorizedUniversity();
    error UniversityIdMismatch();
    error UniversityAlreadyRegistered();
    error UniversityIdInUse();
    error ZeroAddress();
    error InvalidUniversityId();
    error InvalidCertificateId();
    error CertificateAlreadyExists();
    error CertificateNotFound();
    error CertificateIsRevoked();
    error EmptyIpfsCid();
    error EmptyUniversityName();

    constructor() {
        owner = msg.sender;
        emit OwnershipTransferred(address(0), msg.sender);
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        address previous = owner;
        owner = newOwner;
        emit OwnershipTransferred(previous, newOwner);
    }

    /// @notice Register a university wallet and assign its globally unique institution ID.
    function registerUniversity(address wallet, bytes32 universityId, string calldata name) external onlyOwner {
        if (wallet == address(0)) revert ZeroAddress();
        if (universityId == bytes32(0)) revert InvalidUniversityId();
        if (bytes(name).length == 0) revert EmptyUniversityName();

        University storage current = universities[wallet];
        if (current.universityId != bytes32(0) && current.universityId != universityId) {
            revert UniversityAlreadyRegistered();
        }
        address existingWallet = universityWalletById[universityId];
        if (existingWallet != address(0) && existingWallet != wallet) revert UniversityIdInUse();

        universities[wallet] = University({universityId: universityId, name: name, active: true});
        universityWalletById[universityId] = wallet;
        emit UniversityRegistered(wallet, universityId, name);
    }

    /// @notice Pause or reactivate a university without changing its historical certificates.
    function setUniversityStatus(address wallet, bool active) external onlyOwner {
        if (universities[wallet].universityId == bytes32(0)) revert NotAuthorizedUniversity();
        universities[wallet].active = active;
        emit UniversityStatusChanged(wallet, active);
    }

    function getUniversity(address wallet) external view returns (University memory) {
        return universities[wallet];
    }

    function issueCertificate(
        bytes32 universityId,
        bytes32 certificateId,
        address recipient,
        bytes32 documentHash,
        string calldata ipfsCid
    ) external {
        University storage university = universities[msg.sender];
        if (!university.active) revert NotAuthorizedUniversity();
        if (university.universityId != universityId) revert UniversityIdMismatch();
        if (certificateId == bytes32(0)) revert InvalidCertificateId();
        if (recipient == address(0)) revert ZeroAddress();
        if (certificates[certificateId].issuedAt != 0) revert CertificateAlreadyExists();
        if (bytes(ipfsCid).length == 0) revert EmptyIpfsCid();

        certificates[certificateId] = Certificate({
            universityId: universityId,
            recipient: recipient,
            issuer: msg.sender,
            documentHash: documentHash,
            ipfsCid: ipfsCid,
            issuedAt: block.timestamp,
            revoked: false
        });

        emit CertificateIssued(universityId, certificateId, recipient, msg.sender, documentHash, ipfsCid, block.timestamp);
    }

    function revokeCertificate(bytes32 certificateId) external {
        Certificate storage certificate = certificates[certificateId];
        if (certificate.issuedAt == 0) revert CertificateNotFound();
        if (msg.sender != certificate.issuer) revert NotIssuer();
        if (certificate.revoked) revert CertificateIsRevoked();

        certificate.revoked = true;
        emit CertificateRevoked(certificateId, msg.sender, block.timestamp);
    }

    function getCertificate(bytes32 certificateId) external view returns (Certificate memory) {
        if (certificates[certificateId].issuedAt == 0) revert CertificateNotFound();
        return certificates[certificateId];
    }

    function verifyCertificate(bytes32 certificateId) external view returns (bool) {
        Certificate storage certificate = certificates[certificateId];
        return certificate.issuedAt != 0 && !certificate.revoked;
    }
}
