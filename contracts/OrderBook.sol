// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { EIP712 } from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import { NextOwnablePausable } from "@projecta/util-contracts/contracts/access/NextOwnablePausable.sol";
import { CommissionForCreator } from "@projecta/nexpace-contracts/contracts/Commission/CommissionForCreator.sol";
import { OrderMatch } from "./lib/OrderMatch.sol";

contract OrderBook is EIP712("OrderBook", "1.0"), OrderMatch, NextOwnablePausable, CommissionForCreator {
    struct Commission {
        address commissionTo;
        uint256 commissionPercentage;
        uint32 dAppId;
    }

    constructor(address commission_, IERC20 token_) CommissionForCreator(commission_, token_) {}

    /// @notice Cancels an order book order.
    /// @param order The details of the seller's order to cancel.
    /// @param signature The signature of the order.
    /// @param value The quantity what to cancel.
    function cancelSellerOrderBook(
        OrderBookSeller calldata order,
        bytes calldata signature,
        uint256 value
    ) external whenExecutable {
        _orderBookSellerCancel(order, signature, value);
    }

    function cancelBuyerOrderBook(
        OrderBookBuyer calldata order,
        bytes calldata signature,
        uint256 value
    ) external whenExecutable {
        _orderBookBuyerCancel(order, signature, value);
    }

    /// @notice Executes an atomic match for ERC-721 token orders, transferring ownership of tokens and handling commissions.
    /// @param sellerOrder The details of the seller's order.
    /// @param buyerOrder The details of the buyer's order.
    /// @param sellerSignature An array of two order signatures for both seller and buyer orders.
    /// @param buyerSignature An array of two order signatures for both seller and buyer orders.
    /// @param commission Details of the contents commission, including recipient, percentage, and dApp ID.
    function orderMatch(
        OrderBookSeller calldata sellerOrder,
        OrderBookBuyer calldata buyerOrder,
        bytes calldata sellerSignature,
        bytes calldata buyerSignature,
        Commission calldata commission
    ) external whenExecutable {
        require(commission.commissionTo != address(0), "OrderBook/invalidRequest: wrong commission to address");
        require(commission.commissionPercentage <= 10000, "OrderBook/invalidRequest: wrong commission percentage");
        _orderMatch(sellerOrder, buyerOrder, sellerSignature, buyerSignature);

        // Commission
        uint256 totalPrice = sellerOrder.nftTokenIds.length * buyerOrder.perPrice;
        uint256 commissionAmount = ((totalPrice * commission.commissionPercentage) / 10000);
        _sendCommission(
            CommissionForCreator.CommissionParams({
                commissionFrom: sellerOrder.maker,
                commissionTo: commission.commissionTo,
                dAppId: commission.dAppId,
                commissionAmount: commissionAmount,
                reason: "OrderBook: order match"
            }),
            sellerOrder.currencyAddress
        );
    }

    function orderBatchMatch(
        OrderBookSeller calldata sellerOrder,
        OrderBookBuyer[] calldata buyerOrders,
        bytes calldata sellerSignature,
        bytes[] calldata buyerSignatures,
        Commission calldata commission
    ) external whenExecutable {
        require(commission.commissionTo != address(0), "OrderBook/invalidRequest: wrong commission to address");
        require(commission.commissionPercentage <= 10000, "OrderBook/invalidRequest: wrong commission percentage");
        _orderMatchBatch(sellerOrder, buyerOrders, sellerSignature, buyerSignatures);
        // Commission
        uint256 buyerOrdersLength = buyerOrders.length;
        for (uint256 i; i < buyerOrdersLength; ) {
            uint256 totalPrice = sellerOrder.perPrice * buyerOrders[i].purchaseAmount;
            uint256 commissionAmount = ((totalPrice * commission.commissionPercentage) / 10000);
            _sendCommission(
                CommissionForCreator.CommissionParams({
                    commissionFrom: sellerOrder.maker,
                    commissionTo: commission.commissionTo,
                    dAppId: commission.dAppId,
                    commissionAmount: commissionAmount,
                    reason: "OrderBook: order batch match"
                }),
                sellerOrder.currencyAddress
            );
            unchecked {
                i++;
            }
        }
    }

    /// @notice Validates a signature for a given order hash and maker's address.
    /// @param orderHash The hash of the order being validated.
    /// @param maker The address of the maker (signer) of the order.
    /// @param signature The signature to be validated.
    /// @return A boolean indicating whether the signature is valid.
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
    /// @return The computed hash value.
    function hashOrderBookSeller(OrderBookSeller calldata order) external pure returns (bytes32) {
        return _orderBookSellerHash(order);
    }

    function hashOrderBookBuyer(OrderBookBuyer calldata order) external pure returns (bytes32) {
        return _orderBookBuyerHash(order);
    }
}
