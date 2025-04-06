// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IERC1155 } from "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import { Exchange } from "./Exchange.sol";

abstract contract Exchange1155 is Exchange {
    using SafeERC20 for IERC20;

    struct SellerOrder1155 {
        address sellerAddress;
        uint256 listingTime;
        uint256 expirationTime;
        address tokenAddress;
        uint256 tokenAmount;
        address ftAddress;
        uint256 ftTokenId;
        uint256 ftAmounts;
        uint256 salt;
    }

    struct BuyerOrder1155 {
        address buyerAddress;
        address ftAddress;
        uint256 ftTokenId;
        bytes32[] ticketIds;
        uint256[] amounts;
        address tokenAddress;
        uint256 totalPrice;
        uint256 salt;
    }

    bytes32 internal constant SELLER_ORDER_TYPEHASH =
        keccak256(
            "Order(address sellerAddress,uint256 listingTime,uint256 expirationTime,address tokenAddress,uint256 tokenAmount,address ftAddress,uint256 ftTokenId,uint256 ftAmounts,uint256 salt)"
        );
    bytes32 internal constant BUYER_ORDER_TYPEHASH =
        keccak256(
            "Order(address buyerAddress,address ftAddress,uint256 ftTokenId,bytes32[] ticketIds,uint256[] amounts,address tokenAddress,uint256 totalPrice,uint256 salt)"
        );

    mapping(bytes32 => uint256) private _fillsAmounts;

    /* Events */
    event Exchange1155Matched(
        bytes32 sellerHash,
        bytes32 buyerHash,
        address indexed seller,
        address indexed buyer,
        uint256 price,
        uint256 amounts
    );

    event Order1155Canceled(bytes32 orderHash, uint256 value);

    /* Functions */
    /// @notice Retrieves sold quantities for an order with the given hash.
    /// @param orderHash The hash of the order for which the sold quantities is queried.
    /// @return uint256 Quantities that has been sold for the order.
    function fillsAmounts(bytes32 orderHash) external view returns (uint256) {
        return _fillsAmounts[orderHash];
    }

    function _atomicMatch1155(
        SellerOrder1155[] calldata sellerOrders,
        BuyerOrder1155 calldata buyerOrder,
        bytes[] calldata sellerSignatures,
        bytes calldata buyerSignature,
        uint256 commissionPercentage
    ) internal {
        bytes32 buyerHash = _hashBuyerOrder1155(buyerOrder);

        require(_fillsAmounts[buyerHash] == 0, "Exchange1155/orderAlreadyUsed: buyer order already used");
        _validateSignature(buyerHash, buyerOrder.buyerAddress, buyerSignature);
        require(
            IERC20(buyerOrder.tokenAddress).balanceOf(buyerOrder.buyerAddress) >= buyerOrder.totalPrice,
            "Exchange1155/transferNoFund: buyer has not enough tokens"
        );
        require(
            ((buyerOrder.amounts).length == sellerOrders.length) &&
                ((buyerOrder.ticketIds).length == sellerOrders.length),
            "Exchange1155/invalidRequest: length of sellerOrders and buyerOrder different"
        );

        _fillsAmounts[buyerHash] = 1;

        for (uint256 i; i < sellerOrders.length; ) {
            bytes32 sellerHash = _hashSellerOrder1155(sellerOrders[i]);
            require(
                sellerOrders[i].ftAmounts >= _fillsAmounts[sellerHash] + buyerOrder.amounts[i],
                "Exchange1155/soldOut: buyer order's amount exceeds stock"
            );
            require(sellerHash == buyerOrder.ticketIds[i], "Exchange1155/invalidRequest: wrong ticketId");
            _validateOrder1155(sellerOrders[i], buyerOrder);
            _validateSignature(sellerHash, sellerOrders[i].sellerAddress, sellerSignatures[i]);
            uint256 price = ((sellerOrders[i].tokenAmount * buyerOrder.amounts[i]) * (10000 - commissionPercentage)) /
                10000;

            /* Checks effects interactions pattern*/
            _fillsAmounts[sellerHash] += buyerOrder.amounts[i];
            _tokenExchange(sellerOrders[i], buyerOrder, i, price);

            /* Log match event. */
            emit Exchange1155Matched(
                sellerHash,
                buyerHash,
                sellerOrders[i].sellerAddress,
                buyerOrder.buyerAddress,
                price,
                buyerOrder.amounts[i]
            );

            unchecked {
                i++;
            }
        }
    }

    function _tokenExchange(
        SellerOrder1155 calldata sellerOrder,
        BuyerOrder1155 calldata buyerOrder,
        uint256 index,
        uint256 actualPrice
    ) internal {
        IERC20(sellerOrder.tokenAddress).safeTransferFrom(
            buyerOrder.buyerAddress,
            sellerOrder.sellerAddress,
            actualPrice
        );
        IERC1155(sellerOrder.ftAddress).safeTransferFrom(
            sellerOrder.sellerAddress,
            buyerOrder.buyerAddress,
            sellerOrder.ftTokenId,
            buyerOrder.amounts[index],
            ""
        );
    }

    function _cancelOrder1155(SellerOrder1155 calldata sellerOrder, bytes calldata signature, uint256 value) internal {
        bytes32 orderHash = _hashSellerOrder1155(sellerOrder);
        _validateSignature(orderHash, sellerOrder.sellerAddress, signature);
        require(
            value > _fillsAmounts[orderHash],
            "Exchange1155/cancelConflict: new fill value is lower than current value"
        );
        _fillsAmounts[orderHash] = value;
        emit Order1155Canceled(orderHash, value);
    }

    function _validateOrder1155(
        SellerOrder1155 calldata sellerOrder,
        BuyerOrder1155 calldata buyerOrder
    ) internal view {
        require(
            sellerOrder.tokenAddress == buyerOrder.tokenAddress,
            "Exchange1155/invalidRequest: orders token address mismatch"
        );
        require(
            sellerOrder.ftAddress == buyerOrder.ftAddress,
            "Exchange1155/invalidRequest: orders ft address mismatch"
        );
        require(sellerOrder.ftTokenId == buyerOrder.ftTokenId, "Exchange1155/invalidRequest: orders token id mismatch");
        require(sellerOrder.listingTime <= block.timestamp, "Exchange1155/sellerOrderNotListed: order not listed yet");
        require(
            sellerOrder.expirationTime == 0 || block.timestamp < sellerOrder.expirationTime,
            "Exchange1155/sellerOrderExpired: expired order"
        );
    }

    function _hashSellerOrder1155(SellerOrder1155 calldata order) internal pure returns (bytes32) {
        return
            keccak256(
                abi.encode(
                    SELLER_ORDER_TYPEHASH,
                    order.sellerAddress,
                    order.listingTime,
                    order.expirationTime,
                    order.tokenAddress,
                    order.tokenAmount,
                    order.ftAddress,
                    order.ftTokenId,
                    order.ftAmounts,
                    order.salt
                )
            );
    }

    function _hashBuyerOrder1155(BuyerOrder1155 calldata order) internal pure returns (bytes32) {
        return
            keccak256(
                abi.encode(
                    BUYER_ORDER_TYPEHASH,
                    order.buyerAddress,
                    order.ftAddress,
                    order.ftTokenId,
                    keccak256(abi.encodePacked(order.ticketIds)),
                    keccak256(abi.encodePacked(order.amounts)),
                    order.tokenAddress,
                    order.totalPrice,
                    order.salt
                )
            );
    }
}
