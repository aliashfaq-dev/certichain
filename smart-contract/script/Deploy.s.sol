// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {CertificateVerification} from "../src/CertificateVerification.sol";

contract Deploy is Script {
    function run() external returns (CertificateVerification deployed) {
        vm.startBroadcast();
        deployed = new CertificateVerification();
        vm.stopBroadcast();
    }
}
