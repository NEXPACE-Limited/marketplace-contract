// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import { ERC721 } from "@openzeppelin/contracts/token/ERC721/ERC721.sol";

contract MockMSU721 is ERC721("MockMSU721", "MSE") {
    struct Token {
        uint64 itemId;
        uint64 number;
    }

    struct Mint {
        uint64 itemId;
        uint256 tokenId;
    }

    mapping(uint256 => Token) private _tokens;

    constructor() {}

    /// @notice Mints new MaplestoryEquip token.
    /// @param to Address to receive token.
    /// @param itemId Token's item id.
    /// @param tokenId Token's id.
    function mint(address to, uint64 itemId, uint256 tokenId) external {
        _mint(to, itemId, tokenId);
    }

    /// @notice Batch function of {Mint}.
    /// @dev Instead of checking length of the `itemId` and `tokenId`, uses `Mint` struct.
    function mintBatch(address to, Mint[] calldata mints) external {
        uint256 mintsLength = mints.length;
        for (uint256 i; i < mintsLength; ) {
            _mint(to, mints[i].itemId, mints[i].tokenId);
            unchecked {
                i++;
            }
        }
    }

    /// @notice Returns `itemId` of token.
    /// @param tokenId Token's id.
    /// @return uint64 Number of the token's `itemId`.
    function tokenItemId(uint256 tokenId) external view returns (uint64) {
        return _tokens[tokenId].itemId;
    }

    /// @notice Mints new MaplestoryEquip token.
    /// @param to Address to receive minted token.
    /// @param itemId Item id of the new token.
    /// @param tokenId Token id of the new token.
    function _mint(address to, uint64 itemId, uint256 tokenId) internal {
        uint64 itemNumber;
        unchecked {
            itemNumber = uint64(tokenId);
            _tokens[tokenId] = Token(itemId, itemNumber);
        }
        ERC721._safeMint(to, tokenId);
    }
}
