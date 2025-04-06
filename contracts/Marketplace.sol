// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { EIP712 } from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import { NextOwnablePausable } from "@projecta/util-contracts/contracts/access/NextOwnablePausable.sol";
import { CommissionForCreator } from "@projecta/nexpace-contracts/contracts/Commission/CommissionForCreator.sol";
import { Exchange721 } from "./lib/Exchange721.sol";
import { Exchange1155 } from "./lib/Exchange1155.sol";

contract Marketplace is
    EIP712("Marketplace", "1.0"),
    NextOwnablePausable,
    Exchange721,
    Exchange1155,
    CommissionForCreator
{
    struct Commission {
        uint256 commissionPercentage;
        address commissionTo;
        uint32 dAppId;
    }

    constructor(address commission_, IERC20 token_) CommissionForCreator(commission_, token_) {}

    /// @notice Cancel an order of ERC721 token.
    /// @param order The details of the order to cancel.
    /// @param signature The signature of the order.
    function cancelOrder721(Order721 calldata order, bytes calldata signature) external whenExecutable {
        _cancelOrder721(order, signature);
    }

    /// @notice Cancels an ERC-1155 token order.
    /// @param sellerOrder The details of the seller's order to cancel.
    /// @param signature The signature of the order.
    /// @param value The quantity what to cancel.
    function cancelOrder1155(
        SellerOrder1155 calldata sellerOrder,
        bytes calldata signature,
        uint256 value
    ) external whenExecutable {
        _cancelOrder1155(sellerOrder, signature, value);
    }

    /// @notice Executes an atomic match for ERC-721 token orders, transferring ownership of tokens and handling commissions.
    /// @param sellerOrder The details of the seller's order.
    /// @param buyerOrder The details of the buyer's order.
    /// @param signatures An array of two order signatures for both seller and buyer orders.
    /// @param commission Details of the commission, including recipient, percentage, and dApp ID.
    function atomicMatch721(
        Order721 calldata sellerOrder,
        Order721 calldata buyerOrder,
        bytes[2] calldata signatures,
        Commission calldata commission
    ) external whenExecutable {
        require(commission.commissionTo != address(0), "Marketplace/invalidRequest: wrong commission to address");
        require(commission.commissionPercentage < 10000, "Marketplace/invalidRequest: wrong commission percentage");
        _atomicMatch721(sellerOrder, buyerOrder, signatures);

        // Commission
        uint256 commissionAmount = ((buyerOrder.tokenAmount * commission.commissionPercentage) / 10000);
        _sendCommission(
            CommissionForCreator.CommissionParams({
                commissionFrom: sellerOrder.maker,
                commissionTo: commission.commissionTo,
                dAppId: commission.dAppId,
                commissionAmount: commissionAmount,
                reason: "MarketPlace: atomicMatch721"
            }),
            sellerOrder.tokenAddress
        );
    }

    /// @notice Executes an atomic match for ERC-1155 token orders, transferring tokens and handling commissions.
    /// @param sellerOrders An array of SellerOrder1155 structs containing details of the seller's orders.
    /// @param buyerOrder The details of the buyer's order.
    /// @param sellerSignatures An array of signatures for each seller order.
    /// @param buyerSignature The signature for the buyer's order.
    /// @param commission Details of the commission, including recipient, percentage, and dApp ID.
    function atomicMatch1155(
        SellerOrder1155[] calldata sellerOrders,
        BuyerOrder1155 calldata buyerOrder,
        bytes[] calldata sellerSignatures,
        bytes calldata buyerSignature,
        Commission calldata commission
    ) external whenExecutable {
        require(commission.commissionTo != address(0), "Marketplace/invalidRequest: wrong commission to address");
        require(commission.commissionPercentage <= 10000, "Marketplace/invalidRequest: wrong commission percentage");

        // Commission
        uint256 commissionAmount = (buyerOrder.totalPrice * commission.commissionPercentage) / 10000;
        _sendCommission(
            CommissionForCreator.CommissionParams({
                commissionFrom: buyerOrder.buyerAddress,
                commissionTo: commission.commissionTo,
                dAppId: commission.dAppId,
                commissionAmount: commissionAmount,
                reason: "MarketPlace: atomicMatch1155"
            }),
            buyerOrder.tokenAddress
        );

        _atomicMatch1155(sellerOrders, buyerOrder, sellerSignatures, buyerSignature, commission.commissionPercentage);
    }

    /// @notice Validates a signature for a given order hash and maker's address.
    /// @param orderHash The hash of the order being validated.
    /// @param maker The address of the maker (signer) of the order.
    /// @param signature The signature to be validated.
    /// @return bool A boolean indicating whether the signature is valid.
    function validateSignature(
        bytes32 orderHash,
        address maker,
        bytes calldata signature
    ) external view returns (bool) {
        _validateSignature(orderHash, maker, signature);
        return true;
    }

    /// @notice Computes the hash of an ERC-721 token order.
    /// @param order The details of the order.
    /// @return bytes32 The computed hash value.
    function hashOrder721(Order721 calldata order) external pure returns (bytes32) {
        return _hashOrder721(order);
    }

    /// @notice Computes the hash of a seller's ERC-1155 token order.
    /// @param order The details of the seller's order.
    /// @return bytes32 The computed hash value.
    function hashSellerOrder1155(SellerOrder1155 calldata order) external pure returns (bytes32) {
        return _hashSellerOrder1155(order);
    }

    /// @notice Computes the hash of a buyer's ERC-1155 token order.
    /// @param order The details of the buyer's order.
    /// @return bytes32 The computed hash value.
    function hashBuyerOrder1155(BuyerOrder1155 calldata order) external pure returns (bytes32) {
        return _hashBuyerOrder1155(order);
    }
}
