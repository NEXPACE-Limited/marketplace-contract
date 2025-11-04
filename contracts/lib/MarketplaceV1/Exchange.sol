// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import { EIP712 } from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import { SignatureChecker } from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";

abstract contract Exchange is EIP712 {
    function _validateSignature(bytes32 orderHash, address maker, bytes calldata signature) internal view {
        /* Calculate hash which must be signed. */
        bytes32 hashToSign = _hashTypedDataV4(orderHash);
        require(
            SignatureChecker.isValidSignatureNow(maker, hashToSign, signature),
            "Exchange/invalidSignature: invalid signature"
        );
    }
}
