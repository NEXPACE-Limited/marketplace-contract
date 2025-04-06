// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IEquip } from "@projecta/nexpace-contracts/contracts/Interfaces/IEquip.sol";
import { Exchange } from "./Exchange.sol";

abstract contract OrderMatch is Exchange {
    using SafeERC20 for IERC20;

    /* Struct definitions. */
    struct OrderBookSeller {
        /* Order maker address. */
        address maker;
        /* Order listing timestamp (UNIX Timestamp). */
        uint256 listingTime;
        /* ERC20 token address */
        address currencyAddress;
        /* Selling price */
        uint256 perPrice;
        /* Address of NFT contract */
        address nftAddress;
        /* ID of NFT */
        uint256[] nftTokenIds;
        /* Order salt to prevent duplicate hashes. */
        uint256 salt;
    }

    struct OrderBookBuyer {
        /* Order maker address. */
        address maker;
        /* Order listing timestamp (UNIX Timestamp). */
        uint256 listingTime;
        /* ERC20 token address */
        address currencyAddress;
        /* Selling price */
        uint256 perPrice;
        /* Address of NFT contract */
        address nftAddress;
        /* ID of Item */
        uint64 itemId;
        /* Amount for purchase */
        uint256 purchaseAmount;
        /* Order salt to prevent duplicate hashes. */
        uint256 salt;
    }

    mapping(bytes32 => uint256) private _fillsAmounts;

    /* Events */
    event OrderBookMatch(
        bytes32 sellerHash,
        bytes32 buyerHash,
        address indexed seller,
        address indexed buyer,
        uint256 itemAmount,
        uint256 actualAmount
    );
    event OrderBookCanceled(bytes32 orderHash, uint256 value);

    /* Constants */
    /* Order typehash for EIP 712 compatibility. */
    bytes32 internal constant ORDERBOOK_SELLER_TYPEHASH =
        keccak256(
            "Order(address maker,uint256 listingTime,address currencyAddress,uint256 perPrice,address nftAddress,uint256[] nftTokenIds,uint256 salt)"
        );
    bytes32 internal constant ORDERBOOK_BUYER_TYPEHASH =
        keccak256(
            "Order(address maker,uint256 listingTime,address currencyAddress,uint256 perPrice,address nftAddress,uint64 itemId,uint256 purchaseAmount,uint256 salt)"
        );

    /* Functions */
    /// @notice Checks if an order with the given hash has been used.
    /// @param orderHash The hash of the order being checked.
    /// @return A boolean indicating whether the order has been used.
    function fillsAmounts(bytes32 orderHash) external view returns (uint256) {
        return _fillsAmounts[orderHash];
    }

    function _orderMatch(
        OrderBookSeller calldata sellerOrder,
        OrderBookBuyer calldata buyerOrder,
        bytes calldata sellerSignature,
        bytes calldata buyerSignature
    ) internal {
        bytes32 sellerHash = _orderBookSellerHash(sellerOrder);
        bytes32 buyerHash = _orderBookBuyerHash(buyerOrder);
        /* Check has buyer enough token */
        uint256 tokens = sellerOrder.nftTokenIds.length;
        uint256 totalPrice = buyerOrder.perPrice * tokens;
        require(
            IERC20(sellerOrder.currencyAddress).balanceOf(buyerOrder.maker) >= totalPrice,
            "OrderMatch/transferNoFund: buyer has not enough token"
        );
        /* Check if two orders can be properly matched */
        _validateOrder721Pair(sellerOrder, buyerOrder);
        /* Check if signatures are correct */
        _validateSignature(sellerHash, sellerOrder.maker, sellerSignature);
        _validateSignature(buyerHash, buyerOrder.maker, buyerSignature);

        for (uint256 i; i < tokens; ) {
            /* Checks effects interactions pattern*/
            _fillsAmounts[buyerHash] += 1;
            _fillsAmounts[sellerHash] += 1;
            /* Actually send stuffs */
            /* Seller -(NFT)-> buyer. */
            IEquip(sellerOrder.nftAddress).transferFrom(
                sellerOrder.maker,
                buyerOrder.maker,
                sellerOrder.nftTokenIds[i]
            );
            unchecked {
                i++;
            }
        }

        /* Buyer -(ERC20 Token)-> seller. */
        IERC20(sellerOrder.currencyAddress).safeTransferFrom(buyerOrder.maker, sellerOrder.maker, totalPrice);

        /* Log match event. */
        emit OrderBookMatch(sellerHash, buyerHash, sellerOrder.maker, buyerOrder.maker, tokens, totalPrice);
    }

    function _orderMatchBatch(
        OrderBookSeller calldata sellerOrder,
        OrderBookBuyer[] calldata buyerOrders,
        bytes calldata sellerSignature,
        bytes[] calldata buyerSignatures
    ) internal {
        bytes32 sellerHash = _orderBookSellerHash(sellerOrder);
        /* Check if seller's signature is correct */
        _validateSignature(sellerHash, sellerOrder.maker, sellerSignature);

        for (uint256 i; i < buyerOrders.length; ) {
            uint256 length;
            if (
                buyerOrders[i].purchaseAmount - _fillsAmounts[_orderBookBuyerHash(buyerOrders[i])] >
                sellerOrder.nftTokenIds.length - _fillsAmounts[sellerHash]
            ) {
                length = sellerOrder.nftTokenIds.length - _fillsAmounts[sellerHash];
            } else {
                length = buyerOrders[i].purchaseAmount - _fillsAmounts[_orderBookBuyerHash(buyerOrders[i])];
            }
            /* Check has buyer enough token */
            require(
                IERC20(sellerOrder.currencyAddress).balanceOf(buyerOrders[i].maker) >= sellerOrder.perPrice * length,
                "OrderMatch/transferNoFund: buyer has not enough token"
            );
            /* Check if two orders can be properly matched */
            _validateOrder721Pair(sellerOrder, buyerOrders[i]);
            /* Check if signatures are correct */
            _validateSignature(_orderBookBuyerHash(buyerOrders[i]), buyerOrders[i].maker, buyerSignatures[i]);

            for (uint256 j; j < length; ) {
                /* Checks effects interactions pattern*/
                uint256 index = _fillsAmounts[sellerHash];
                _fillsAmounts[_orderBookBuyerHash(buyerOrders[i])] += 1;
                _fillsAmounts[sellerHash] += 1;
                /* Actually send stuffs */
                /* Seller -(NFT)-> buyer. */
                IEquip(sellerOrder.nftAddress).transferFrom(
                    sellerOrder.maker,
                    buyerOrders[i].maker,
                    sellerOrder.nftTokenIds[index]
                );
                unchecked {
                    j++;
                }
            }

            /* Buyer -(ERC20 Token)-> seller. */
            IERC20(sellerOrder.currencyAddress).safeTransferFrom(
                buyerOrders[i].maker,
                sellerOrder.maker,
                sellerOrder.perPrice * length
            );

            /* Log match event. */
            emit OrderBookMatch(
                sellerHash,
                _orderBookBuyerHash(buyerOrders[i]),
                sellerOrder.maker,
                buyerOrders[i].maker,
                length,
                sellerOrder.perPrice
            );
            unchecked {
                i++;
            }
        }
    }

    function _orderBookBuyerCancel(OrderBookBuyer calldata order, bytes calldata signature, uint256 value) internal {
        bytes32 orderHash = _orderBookBuyerHash(order);
        _validateSignature(orderHash, order.maker, signature);
        require(
            value > _fillsAmounts[orderHash],
            "OrderMatch/cancelConflict: new fill value is lower than current value"
        );
        require(
            order.purchaseAmount >= value,
            "OrderMatch/cancelConflict: new fill value is bigger than purchase amount"
        );
        _fillsAmounts[orderHash] = value;
        emit OrderBookCanceled(orderHash, value);
    }

    function _orderBookSellerCancel(OrderBookSeller calldata order, bytes calldata signature, uint256 value) internal {
        bytes32 orderHash = _orderBookSellerHash(order);
        _validateSignature(orderHash, order.maker, signature);
        require(
            value > _fillsAmounts[orderHash],
            "OrderMatch/cancelConflict: new fill value is lower than current value"
        );
        require(
            order.nftTokenIds.length >= value,
            "OrderMatch/cancelConflict: new fill value is bigger than selling amount"
        );
        _fillsAmounts[orderHash] = value;
        emit OrderBookCanceled(orderHash, value);
    }

    function _validateOrder721Pair(
        OrderBookSeller calldata sellerOrder,
        OrderBookBuyer calldata buyerOrder
    ) internal view {
        /* Two orders must share some informations */
        /* tokenAddress, tokenAmount, nftAddress, nftItemId */
        require(
            sellerOrder.currencyAddress == buyerOrder.currencyAddress,
            "OrderMatch/invalidRequest: orders token address mismatch"
        );
        require(sellerOrder.perPrice == buyerOrder.perPrice, "OrderMatch/invalidRequest: orders token amount mismatch");
        require(
            sellerOrder.nftAddress == buyerOrder.nftAddress,
            "OrderMatch/invalidRequest: orders nft address mismatch"
        );

        bytes32 sellerHash = _orderBookSellerHash(sellerOrder);
        bytes32 buyerHash = _orderBookBuyerHash(buyerOrder);
        uint256 length;
        uint256 sellingLength = sellerOrder.nftTokenIds.length - _fillsAmounts[sellerHash];
        require(sellingLength > 0, "OrderMatch/outOfStock: seller order's amount exceeds stock");
        uint256 buyingLength = buyerOrder.purchaseAmount - _fillsAmounts[buyerHash];
        require(buyingLength > 0, "OrderMatch/outOfStock: buyer order's amount exceeds stock");
        if (sellingLength >= buyingLength) {
            length = buyingLength;
        } else {
            length = sellingLength;
        }

        for (uint256 i; i < length; ) {
            uint256 productIndex = _fillsAmounts[sellerHash] + i;
            uint64 sellersItemId = _checkItemId(buyerOrder.nftAddress, sellerOrder.nftTokenIds[productIndex]);
            require(buyerOrder.itemId == sellersItemId, "OrderMatch/invalidRequest: orders nft id mismatch");
            unchecked {
                i++;
            }
        }
    }

    function _orderBookSellerHash(OrderBookSeller calldata order) internal pure returns (bytes32) {
        return
            keccak256(
                abi.encode(
                    ORDERBOOK_SELLER_TYPEHASH,
                    order.maker,
                    order.listingTime,
                    order.currencyAddress,
                    order.perPrice,
                    order.nftAddress,
                    keccak256(abi.encodePacked(order.nftTokenIds)),
                    order.salt
                )
            );
    }

    function _orderBookBuyerHash(OrderBookBuyer calldata order) internal pure returns (bytes32) {
        return keccak256(abi.encode(ORDERBOOK_BUYER_TYPEHASH, order));
    }

    function _checkItemId(address nftAddress, uint256 tokenId) internal view returns (uint64) {
        return IEquip(nftAddress).tokenItemId(tokenId);
    }
}
