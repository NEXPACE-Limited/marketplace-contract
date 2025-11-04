// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import { EIP712 } from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import { SignatureChecker } from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import { Marketplace } from "../../Marketplace.sol";

abstract contract Exchange is EIP712 {
    Marketplace public immutable marketplaceV1;

    constructor(Marketplace prevMarketplace) {
        marketplaceV1 = prevMarketplace;
    }

    function _validateSignature(
        bytes32 orderHash,
        address maker,
        bytes calldata signature
    ) internal view returns (bool) {
        /* Calculate hash which must be signed. */
        bytes32 hashToSign = _hashTypedDataV4(orderHash);
        return SignatureChecker.isValidSignatureNow(maker, hashToSign, signature);
    }

    function _validateSignatureMarketV1(
        bytes32 orderHash,
        address maker,
        bytes calldata signature
    ) internal view returns (bool) {
        /* Calculate hash which must be signed. */
        bytes32 marketV1Domain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("Marketplace")),
                keccak256(bytes("1.0")),
                block.chainid,
                address(marketplaceV1)
            )
        );
        bytes32 digest = _hashTypedDataV4WithDomain(orderHash, marketV1Domain);
        return SignatureChecker.isValidSignatureNow(maker, digest, signature);
    }

    function _hashTypedDataV4WithDomain(bytes32 structHash, bytes32 domainSeparator) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
    }
}
