// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import { Exchange } from "./Exchange.sol";

abstract contract Exchange721 is Exchange {
    using SafeERC20 for IERC20;

    /* Struct definitions. */
    struct Order721 {
        /* Order types. Seller: true / Buyer: false */
        uint256 isSeller;
        /* Order maker address. */
        address maker;
        /* Order listing timestamp (UNIX Timestamp). */
        uint256 listingTime;
        /* Order expiration timestamp, or 0 for no expiry. */
        uint256 expirationTime;
        /* ERC20 token address */
        address tokenAddress;
        /* Selling price */
        uint256 tokenAmount;
        /* Address of NFT contract */
        address nftAddress;
        /* ID of NFT */
        uint256 nftTokenId;
        /* Order salt to prevent duplicate hashes. */
        uint256 salt;
    }

    /* Constants */
    /* Order typehash for EIP 712 compatibility. */
    bytes32 internal constant ORDER_TYPEHASH =
        keccak256(
            "Order(uint256 isSeller,address maker,uint256 listingTime,uint256 expirationTime,address tokenAddress,uint256 tokenAmount,address nftAddress,uint256 nftTokenId,uint256 salt)"
        );

    mapping(bytes32 => bool) private _fulfill;

    /* Events */
    event Exchange721Matched(
        bytes32 sellerHash,
        bytes32 buyerHash,
        address indexed seller,
        address indexed buyer,
        uint256 actualAmount
    );
    event Order721Canceled(bytes32 orderHash);

    /* Functions */
    /// @notice Checks if an order with the given hash has been used.
    /// @param orderHash The hash of the order being checked.
    /// @return bool A boolean indicating whether the order has been used.
    function isFulfilled(bytes32 orderHash) external view returns (bool) {
        return _fulfill[orderHash];
    }

    function _atomicMatch721(
        Order721 calldata sellerOrder,
        Order721 calldata buyerOrder,
        bytes[2] calldata signatures
    ) internal {
        bytes32 sellerHash = _hashOrder721(sellerOrder);
        bytes32 buyerHash = _hashOrder721(buyerOrder);
        /* Check if orders are valid. */
        _validateOrder721(sellerOrder);
        _validateOrder721(buyerOrder);
        /* Check has buyer enough token */
        require(
            IERC20(sellerOrder.tokenAddress).balanceOf(buyerOrder.maker) >= sellerOrder.tokenAmount,
            "Exchange721/transferNoFund: buyer has not enough token"
        );
        /* Check if two orders can be properly matched */
        _validateOrder721Pair(sellerOrder, buyerOrder);
        /* Check if signatures are correct */
        _validateSignature(sellerHash, sellerOrder.maker, signatures[0]);
        _validateSignature(buyerHash, buyerOrder.maker, signatures[1]);

        /* Checks effects interactions pattern*/
        _fulfill[sellerHash] = true;
        _fulfill[buyerHash] = true;
        /* Actually send stuffs */
        /* Seller -(NFT)-> buyer. */
        IERC721(sellerOrder.nftAddress).transferFrom(sellerOrder.maker, buyerOrder.maker, sellerOrder.nftTokenId);

        /* Buyer -(ERC20 Token)-> seller. */
        IERC20(sellerOrder.tokenAddress).safeTransferFrom(buyerOrder.maker, sellerOrder.maker, buyerOrder.tokenAmount);

        /* Log match event. */
        emit Exchange721Matched(sellerHash, buyerHash, sellerOrder.maker, buyerOrder.maker, buyerOrder.tokenAmount);
    }

    function _cancelOrder721(Order721 calldata order, bytes calldata signature) internal {
        bytes32 orderHash = _hashOrder721(order);
        _validateSignature(orderHash, order.maker, signature);
        require(_fulfill[orderHash] == false, "Exchange721/cancelConflict: hash already fulfilled");
        _fulfill[orderHash] = true;
        emit Order721Canceled(orderHash);
    }

    function _validateOrder721(Order721 calldata order) internal view {
        require(order.listingTime <= block.timestamp, "Exchange721/orderNotListed: order not listed yet");
        require(
            order.expirationTime == 0 || block.timestamp < order.expirationTime,
            "Exchange721/orderExpired: expired order"
        );
    }

    function _validateOrder721Pair(Order721 calldata sellerOrder, Order721 calldata buyerOrder) internal view {
        bytes32 sellerHash = _hashOrder721(sellerOrder);
        bytes32 buyerHash = _hashOrder721(buyerOrder);
        /* Two orders need, Seller and Buyer */
        require(sellerOrder.isSeller == 1, "Exchange721/invalidRequest: given seller order is not a seller order");
        require(buyerOrder.isSeller == 0, "Exchange721/invalidRequest: given buyer order is not a buyer order");
        /* Two orders must share some informations */
        /* tokenAddress, tokenAmount, nftAddress, nftTokenId */
        require(
            sellerOrder.tokenAddress == buyerOrder.tokenAddress,
            "Exchange721/invalidRequest: orders token address mismatch"
        );
        require(
            sellerOrder.tokenAmount == buyerOrder.tokenAmount,
            "Exchange721/invalidRequest: orders token amount mismatch"
        );
        require(
            sellerOrder.nftAddress == buyerOrder.nftAddress,
            "Exchange721/invalidRequest: orders nft address mismatch"
        );
        require(buyerOrder.nftTokenId == sellerOrder.nftTokenId, "Exchange721/invalidRequest: orders nft id mismatch");
        /* fulfilled signature */
        require(_fulfill[buyerHash] == false, "Exchange721/orderAlreadyUsed: buyer order already used");
        require(_fulfill[sellerHash] == false, "Exchange721/orderAlreadyUsed: seller order already used");
    }

    function _hashOrder721(Order721 calldata order) internal pure returns (bytes32) {
        return keccak256(abi.encode(ORDER_TYPEHASH, order));
    }
}
