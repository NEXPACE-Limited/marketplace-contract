import { ethers } from "hardhat";
import { TypedDataDomain, TypedDataField } from "@ethersproject/abstract-signer";

export const day = 86400;

export const now = async () => {
  const block = await ethers.provider.getBlock("latest");
  return block.timestamp;
};

export type OrderStruct = {
  isSeller: number;
  maker: string;
  listingTime: number;
  expirationTime: number;
  tokenAddress: string;
  tokenAmount: number;
  nftAddress: string;
  nftTokenId: number;
  salt: number;
};

export type SellerOrderStruct = {
  sellerAddress: string;
  listingTime: number;
  expirationTime: number;
  tokenAddress: string;
  tokenAmount: number;
  ftAddress: string;
  ftTokenId: number;
  ftAmounts: number;
  salt: number;
};

export type BuyerOrderStruct = {
  buyerAddress: string;
  ftAddress: string;
  ftTokenId: number;
  ticketIds: string[];
  amounts: number[];
  tokenAddress: string;
  totalPrice: number;
  salt: number;
};

export type OrderBookSeller = {
  maker: string;
  listingTime: number;
  currencyAddress: string;
  perPrice: number;
  nftAddress: string;
  nftTokenIds: number[];
  salt: number;
};

export type OrderBookBuyer = {
  maker: string;
  listingTime: number;
  currencyAddress: string;
  perPrice: number;
  nftAddress: string;
  itemId: number;
  purchaseAmount: number;
  salt: number;
};

export const getArgs = (sellerOrder: OrderStruct, buyerOrder: OrderStruct) => {
  return [
    sellerOrder.isSeller,
    sellerOrder.maker,
    sellerOrder.listingTime,
    sellerOrder.expirationTime,
    sellerOrder.tokenAddress,
    sellerOrder.tokenAmount,
    sellerOrder.nftAddress,
    sellerOrder.nftTokenId,
    sellerOrder.salt,
    buyerOrder.isSeller,
    buyerOrder.maker,
    buyerOrder.listingTime,
    buyerOrder.expirationTime,
    buyerOrder.tokenAddress,
    buyerOrder.tokenAmount,
    buyerOrder.nftAddress,
    buyerOrder.nftTokenId,
    buyerOrder.salt,
  ] as any;
};

export const sign = async (
  chainId: number,
  verifyContract: string,
  signer: {
    _signTypedData: (
      domain: TypedDataDomain,
      types: Record<string, Array<TypedDataField>>,
      value: Record<string, any>
    ) => Promise<string>;
  },
  order: OrderStruct
) => {
  const domain = {
    name: "Marketplace",
    version: "1.0",
    chainId: chainId,
    verifyingContract: verifyContract,
  };

  const types = {
    Order: [
      { name: "isSeller", type: "uint256" },
      { name: "maker", type: "address" },
      { name: "listingTime", type: "uint256" },
      { name: "expirationTime", type: "uint256" },
      { name: "tokenAddress", type: "address" },
      { name: "tokenAmount", type: "uint256" },
      { name: "nftAddress", type: "address" },
      { name: "nftTokenId", type: "uint256" },
      { name: "salt", type: "uint256" },
    ],
  };
  return signer._signTypedData(domain, types, order);
};

export const signForSeller = async (
  chainId: number,
  verifyContract: string,
  signer: {
    _signTypedData(
      domain: TypedDataDomain,
      types: Record<string, Array<TypedDataField>>,
      value: Record<string, any>
    ): Promise<string>;
  },
  order: SellerOrderStruct
) => {
  const domain = {
    name: "Marketplace",
    version: "1.0",
    chainId: chainId,
    verifyingContract: verifyContract,
  };

  const types = {
    Order: [
      { name: "sellerAddress", type: "address" },
      { name: "listingTime", type: "uint256" },
      { name: "expirationTime", type: "uint256" },
      { name: "tokenAddress", type: "address" },
      { name: "tokenAmount", type: "uint256" },
      { name: "ftAddress", type: "address" },
      { name: "ftTokenId", type: "uint256" },
      { name: "ftAmounts", type: "uint256" },
      { name: "salt", type: "uint256" },
    ],
  };
  return signer._signTypedData(domain, types, order);
};

export const signForBuyer = async (
  chainId: number,
  verifyContract: string,
  signer: {
    _signTypedData(
      domain: TypedDataDomain,
      types: Record<string, Array<TypedDataField>>,
      value: Record<string, any>
    ): Promise<string>;
  },
  order: BuyerOrderStruct
) => {
  const domain = {
    name: "Marketplace",
    version: "1.0",
    chainId: chainId,
    verifyingContract: verifyContract,
  };

  const types = {
    Order: [
      { name: "buyerAddress", type: "address" },
      { name: "ftAddress", type: "address" },
      { name: "ftTokenId", type: "uint256" },
      { name: "ticketIds", type: "bytes32[]" },
      { name: "amounts", type: "uint256[]" },
      { name: "tokenAddress", type: "address" },
      { name: "totalPrice", type: "uint256" },
      { name: "salt", type: "uint256" },
    ],
  };
  return signer._signTypedData(domain, types, order);
};

export const orderbookSignSeller = async (
  chainId: number,
  verifyContract: string,
  signer: {
    _signTypedData(
      domain: TypedDataDomain,
      types: Record<string, Array<TypedDataField>>,
      value: Record<string, any>
    ): Promise<string>;
  },
  order: OrderBookSeller
) => {
  const domain = {
    name: "OrderBook",
    version: "1.0",
    chainId: chainId,
    verifyingContract: verifyContract,
  };

  const types = {
    Order: [
      { name: "maker", type: "address" },
      { name: "listingTime", type: "uint256" },
      { name: "currencyAddress", type: "address" },
      { name: "perPrice", type: "uint256" },
      { name: "nftAddress", type: "address" },
      { name: "nftTokenIds", type: "uint256[]" },
      { name: "salt", type: "uint256" },
    ],
  };
  return signer._signTypedData(domain, types, order);
};

export const orderbookSignBuyer = async (
  chainId: number,
  verifyContract: string,
  signer: {
    _signTypedData(
      domain: TypedDataDomain,
      types: Record<string, Array<TypedDataField>>,
      value: Record<string, any>
    ): Promise<string>;
  },
  order: OrderBookBuyer
) => {
  const domain = {
    name: "OrderBook",
    version: "1.0",
    chainId: chainId,
    verifyingContract: verifyContract,
  };

  const types = {
    Order: [
      { name: "maker", type: "address" },
      { name: "listingTime", type: "uint256" },
      { name: "currencyAddress", type: "address" },
      { name: "perPrice", type: "uint256" },
      { name: "nftAddress", type: "address" },
      { name: "itemId", type: "uint64" },
      { name: "purchaseAmount", type: "uint256" },
      { name: "salt", type: "uint256" },
    ],
  };
  return signer._signTypedData(domain, types, order);
};
