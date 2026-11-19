// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {CertificateVerification} from "../src/CertificateVerification.sol";

contract CertificateVerificationTest is Test {
    CertificateVerification internal registry;
    address internal university = address(0xA11CE);
    address internal student = address(0xB0B);

    bytes32 internal certificateId = keccak256("CERT-2026-001");
    bytes32 internal documentHash = keccak256("sample pdf contents");

    function setUp() public {
        vm.prank(university);
        registry = new CertificateVerification();
    }

    function testOwnerCanIssueCertificate() public {
        vm.prank(university);
        registry.issueCertificate(certificateId, student, documentHash, "bafy-test-cid");

        CertificateVerification.Certificate memory cert = registry.getCertificate(certificateId);
        assertEq(cert.recipient, student);
        assertEq(cert.issuer, university);
        assertEq(cert.documentHash, documentHash);
        assertEq(cert.ipfsCid, "bafy-test-cid");
        assertFalse(cert.revoked);
        assertTrue(registry.verifyCertificate(certificateId));
    }

    function testNonOwnerCannotIssue() public {
        vm.prank(student);
        vm.expectRevert(CertificateVerification.NotOwner.selector);
        registry.issueCertificate(certificateId, student, documentHash, "bafy-test-cid");
    }

    function testIssuerCanRevoke() public {
        vm.startPrank(university);
        registry.issueCertificate(certificateId, student, documentHash, "bafy-test-cid");
        registry.revokeCertificate(certificateId);
        vm.stopPrank();

        assertFalse(registry.verifyCertificate(certificateId));
        assertTrue(registry.getCertificate(certificateId).revoked);
    }

    function testOtherWalletCannotRevoke() public {
        vm.prank(university);
        registry.issueCertificate(certificateId, student, documentHash, "bafy-test-cid");

        vm.prank(student);
        vm.expectRevert(CertificateVerification.NotIssuer.selector);
        registry.revokeCertificate(certificateId);
    }

    function testCannotIssueDuplicateId() public {
        vm.startPrank(university);
        registry.issueCertificate(certificateId, student, documentHash, "bafy-test-cid");
        vm.expectRevert(CertificateVerification.CertificateAlreadyExists.selector);
        registry.issueCertificate(certificateId, student, documentHash, "another-cid");
        vm.stopPrank();
    }
}
