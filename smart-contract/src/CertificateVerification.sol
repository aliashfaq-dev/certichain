// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title CertificateVerification
/// @notice On-chain registry for issuing, revoking and verifying certificates.
/// @dev Keep personal information off-chain. Store only a wallet, content hash and IPFS CID.
contract CertificateVerification {
    struct Certificate {
        address recipient;
        address issuer;
        bytes32 documentHash;
        string ipfsCid;
        uint256 issuedAt;
        bool revoked;
    }

    address public owner;
    mapping(bytes32 => Certificate) private certificates;

    event CertificateIssued(
        bytes32 indexed certificateId,
        address indexed recipient,
        address indexed issuer,
        bytes32 documentHash,
        string ipfsCid,
        uint256 issuedAt
    );
    event CertificateRevoked(bytes32 indexed certificateId, address indexed issuer, uint256 revokedAt);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    error NotOwner();
    error NotIssuer();
    error ZeroAddress();
    error InvalidCertificateId();
    error CertificateAlreadyExists();
    error CertificateNotFound();
    error CertificateIsRevoked();
    error EmptyIpfsCid();

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

    function issueCertificate(
        bytes32 certificateId,
        address recipient,
        bytes32 documentHash,
        string calldata ipfsCid
    ) external onlyOwner {
        if (certificateId == bytes32(0)) revert InvalidCertificateId();
        if (recipient == address(0)) revert ZeroAddress();
        if (certificates[certificateId].issuedAt != 0) revert CertificateAlreadyExists();
        if (bytes(ipfsCid).length == 0) revert EmptyIpfsCid();

        certificates[certificateId] = Certificate({
            recipient: recipient,
            issuer: msg.sender,
            documentHash: documentHash,
            ipfsCid: ipfsCid,
            issuedAt: block.timestamp,
            revoked: false
        });

        emit CertificateIssued(certificateId, recipient, msg.sender, documentHash, ipfsCid, block.timestamp);
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
