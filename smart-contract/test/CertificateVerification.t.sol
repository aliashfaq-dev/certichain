// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {CertificateVerification} from "../src/CertificateVerification.sol";

contract CertificateVerificationTest is Test {
    CertificateVerification internal registry;
    address internal university = address(0xA11CE);
    address internal secondUniversity = address(0xA22CE);
    address internal student = address(0xB0B);

    bytes32 internal universityId = keccak256("UNI-EXAMPLE");
    bytes32 internal secondUniversityId = keccak256("UNI-SECOND");
    bytes32 internal certificateId = keccak256("UNI-EXAMPLE:CERT-2026-001");
    bytes32 internal documentHash = keccak256("sample pdf contents");

    function setUp() public {
        registry = new CertificateVerification();
        registry.registerUniversity(university, universityId, "Example University");
    }

    function testRegisteredUniversityCanIssueCertificate() public {
        vm.prank(university);
        registry.issueCertificate(universityId, certificateId, student, documentHash, "bafy-test-cid");

        CertificateVerification.Certificate memory cert = registry.getCertificate(certificateId);
        assertEq(cert.universityId, universityId);
        assertEq(cert.recipient, student);
        assertEq(cert.issuer, university);
        assertEq(cert.documentHash, documentHash);
        assertEq(cert.ipfsCid, "bafy-test-cid");
        assertFalse(cert.revoked);
        assertTrue(registry.verifyCertificate(certificateId));
    }

    function testUnregisteredWalletCannotIssue() public {
        vm.prank(student);
        vm.expectRevert(CertificateVerification.NotAuthorizedUniversity.selector);
        registry.issueCertificate(universityId, certificateId, student, documentHash, "bafy-test-cid");
    }

    function testUniversityCannotUseAnotherUniversityId() public {
        vm.prank(university);
        vm.expectRevert(CertificateVerification.UniversityIdMismatch.selector);
        registry.issueCertificate(secondUniversityId, certificateId, student, documentHash, "bafy-test-cid");
    }

    function testOwnerCanRegisterAnotherUniversity() public {
        registry.registerUniversity(secondUniversity, secondUniversityId, "Second University");
        CertificateVerification.University memory uni = registry.getUniversity(secondUniversity);
        assertEq(uni.universityId, secondUniversityId);
        assertEq(uni.name, "Second University");
        assertTrue(uni.active);
    }

    function testUniversityIdsMustBeUnique() public {
        vm.expectRevert(CertificateVerification.UniversityIdInUse.selector);
        registry.registerUniversity(secondUniversity, universityId, "Impostor University");
    }

    function testOwnerCanDeactivateUniversity() public {
        registry.setUniversityStatus(university, false);
        vm.prank(university);
        vm.expectRevert(CertificateVerification.NotAuthorizedUniversity.selector);
        registry.issueCertificate(universityId, certificateId, student, documentHash, "bafy-test-cid");
    }

    function testOnlyOwnerCanRegisterUniversity() public {
        vm.prank(student);
        vm.expectRevert(CertificateVerification.NotOwner.selector);
        registry.registerUniversity(secondUniversity, secondUniversityId, "Second University");
    }

    function testIssuerCanRevokeAndOtherWalletCannot() public {
        vm.prank(university);
        registry.issueCertificate(universityId, certificateId, student, documentHash, "bafy-test-cid");

        vm.prank(student);
        vm.expectRevert(CertificateVerification.NotIssuer.selector);
        registry.revokeCertificate(certificateId);

        vm.prank(university);
        registry.revokeCertificate(certificateId);
        assertFalse(registry.verifyCertificate(certificateId));
        assertTrue(registry.getCertificate(certificateId).revoked);
    }

    function testCannotIssueDuplicateCertificateId() public {
        vm.startPrank(university);
        registry.issueCertificate(universityId, certificateId, student, documentHash, "bafy-test-cid");
        vm.expectRevert(CertificateVerification.CertificateAlreadyExists.selector);
        registry.issueCertificate(universityId, certificateId, student, documentHash, "another-cid");
        vm.stopPrank();
    }
}
