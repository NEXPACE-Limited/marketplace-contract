import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { now, day, sign } from "./lib";
import nxErrors from "./lib/nx-errors";

describe("Exchange721", function () {
  async function fixture() {
    const index = 0;
    const nowTime = await now();
    const zeroAddress = ethers.constants.AddressZero;
    const chainId = (await ethers.provider.getNetwork()).chainId;
    const [owner, ad1, buyer, seller, nexonCommissionWallet] = await ethers.getSigners();
    const [Marketplace, ERC20PresetFixedSupply, ERC721PresetMinterPauserAutoId, Commission] = await Promise.all([
      ethers.getContractFactory("Marketplace"),
      ethers.getContractFactory("ERC20PresetFixedSupply"),
      ethers.getContractFactory("ERC721PresetMinterPauserAutoId"),
      ethers.getContractFactory("Commission"),
    ]);

    const [erc20PresetFixedSupply, erc721PresetMinterPauserAutoId] = await Promise.all([
      ERC20PresetFixedSupply.deploy("ERC20", "ERC20", 1000, await buyer.getAddress()),
      ERC721PresetMinterPauserAutoId.deploy("ERC721", "ERC721", ""),
    ]);

    const commission = await Commission.deploy(ad1.address, erc20PresetFixedSupply.address);
    await commission.connect(owner).deployed();
    const marketplace = await Marketplace.deploy(commission.address, erc20PresetFixedSupply.address);

    const defaultSellerOrder = {
      isSeller: 1,
      maker: await seller.getAddress(),
      listingTime: nowTime - 5 * day,
      expirationTime: nowTime + 9 * day,
      tokenAddress: erc20PresetFixedSupply.address,
      tokenAmount: 100,
      nftAddress: erc721PresetMinterPauserAutoId.address,
      nftTokenId: index,
      salt: index,
    };

    const defaultBuyerOrder = {
      isSeller: 0,
      maker: await buyer.getAddress(),
      listingTime: nowTime - 5 * day,
      expirationTime: nowTime + 9 * day,
      tokenAddress: erc20PresetFixedSupply.address,
      tokenAmount: 100,
      nftAddress: erc721PresetMinterPauserAutoId.address,
      nftTokenId: index,
      salt: index,
    };

    const contentsCommissionInformation = {
      commissionTo: await nexonCommissionWallet.getAddress(),
      commissionPercentage: 500,
      dAppId: 0,
    };

    await Promise.all([
      await erc721PresetMinterPauserAutoId.mint(await seller.getAddress()),
      await erc20PresetFixedSupply.connect(buyer).approve(marketplace.address, 1000),
      await erc20PresetFixedSupply.connect(seller).approve(marketplace.address, 1000),
      await erc721PresetMinterPauserAutoId.connect(seller).setApprovalForAll(marketplace.address, true),
    ]);

    return {
      index,
      nowTime,
      chainId,
      zeroAddress,
      owner,
      buyer,
      seller,
      nexonCommissionWallet,
      commission,
      marketplace,
      erc20PresetFixedSupply,
      erc721PresetMinterPauserAutoId,
      defaultSellerOrder,
      defaultBuyerOrder,
      contentsCommissionInformation,
    };
  }

  before(async () => {
    await loadFixture(fixture);
  });

  it("Cancel order", async () => {
    const { chainId, marketplace, seller, defaultSellerOrder } = await loadFixture(fixture);
    const sellerHash = await marketplace.hashOrder721(defaultSellerOrder);
    const signature = await sign(chainId, marketplace.address, seller, defaultSellerOrder);
    await marketplace.cancelOrder721(defaultSellerOrder, signature);
    expect(await marketplace.isFulfilled(sellerHash)).to.equal(true);
  });

  it("Validate signature", async () => {
    const { chainId, seller, marketplace, defaultSellerOrder } = await loadFixture(fixture);
    const sellerHash = await marketplace.hashOrder721(defaultSellerOrder);
    const sellerSig = await sign(chainId, marketplace.address, seller, defaultSellerOrder);
    expect(await marketplace.validateSignature(sellerHash, await seller.getAddress(), sellerSig)).to.equal(true);
  });

  describe("Success case", function () {
    it("Fixed price order match", async () => {
      const {
        index,
        chainId,
        seller,
        buyer,
        commission,
        marketplace,
        defaultSellerOrder,
        defaultBuyerOrder,
        erc20PresetFixedSupply,
        erc721PresetMinterPauserAutoId,
        contentsCommissionInformation,
      } = await loadFixture(fixture);

      const sellerOrder = defaultSellerOrder;
      const buyerOrder = { ...defaultBuyerOrder, expirationTime: 0 };

      const sellerHash = await marketplace.hashOrder721(sellerOrder);
      const buyerHash = await marketplace.hashOrder721(buyerOrder);

      const sellerSig = await sign(chainId, marketplace.address, seller, sellerOrder);
      const buyerSig = await sign(chainId, marketplace.address, buyer, buyerOrder);

      const txn = await marketplace.atomicMatch721(
        sellerOrder,
        buyerOrder,
        [sellerSig, buyerSig],
        contentsCommissionInformation
      );

      await txn.wait();

      expect(await erc20PresetFixedSupply.balanceOf(await buyer.getAddress())).equal(900);
      expect(await erc20PresetFixedSupply.balanceOf(await seller.getAddress())).equal(95);
      expect(await erc20PresetFixedSupply.balanceOf(commission.address)).equal(5);
      expect(await erc721PresetMinterPauserAutoId.ownerOf(index)).equal(await buyer.getAddress());
      expect(await marketplace.isFulfilled(sellerHash)).equal(true);
      expect(await marketplace.isFulfilled(buyerHash)).equal(true);
    });
  });

  describe("Fail case", function () {
    it("Order - Wrong listingTime", async () => {
      const {
        nowTime,
        chainId,
        seller,
        buyer,
        marketplace,
        defaultSellerOrder,
        defaultBuyerOrder,
        contentsCommissionInformation,
      } = await loadFixture(fixture);
      const sellerOrder = defaultSellerOrder;
      const buyerOrder = { ...defaultBuyerOrder, listingTime: nowTime + day };

      const sellerSig = await sign(chainId, marketplace.address, seller, sellerOrder);
      const buyerSig = await sign(chainId, marketplace.address, buyer, buyerOrder);

      const txn = marketplace.atomicMatch721(
        sellerOrder,
        buyerOrder,
        [sellerSig, buyerSig],
        contentsCommissionInformation
      );

      await expect(txn).to.be.revertedWith(nxErrors.Exchange721.orderNotListed);
    });

    it("Order - Wrong expirationTime", async () => {
      const {
        chainId,
        seller,
        buyer,
        marketplace,
        defaultSellerOrder,
        defaultBuyerOrder,
        contentsCommissionInformation,
      } = await loadFixture(fixture);
      const sellerOrder = defaultSellerOrder;
      const buyerOrder = { ...defaultBuyerOrder, expirationTime: defaultBuyerOrder.expirationTime - 10 * day };

      const sellerSig = await sign(chainId, marketplace.address, seller, sellerOrder);
      const buyerSig = await sign(chainId, marketplace.address, buyer, buyerOrder);

      const txn = marketplace.atomicMatch721(
        sellerOrder,
        buyerOrder,
        [sellerSig, buyerSig],
        contentsCommissionInformation
      );

      await expect(txn).to.be.revertedWith(nxErrors.Exchange721.orderExpired);
    });

    it("Order - Wrong seller type", async () => {
      const {
        chainId,
        seller,
        buyer,
        marketplace,
        defaultSellerOrder,
        defaultBuyerOrder,
        contentsCommissionInformation,
      } = await loadFixture(fixture);
      const wrongOrder = { ...defaultSellerOrder, isSeller: 0 };
      const buyerOrder = defaultBuyerOrder;

      const sellerSig = await sign(chainId, marketplace.address, seller, wrongOrder);
      const buyerSig = await sign(chainId, marketplace.address, buyer, buyerOrder);

      const txn = marketplace.atomicMatch721(
        wrongOrder,
        buyerOrder,
        [sellerSig, buyerSig],
        contentsCommissionInformation
      );

      await expect(txn).to.be.revertedWith(nxErrors.invalidRequest);
    });

    it("Order - Wrong buyer type", async () => {
      const {
        chainId,
        seller,
        buyer,
        marketplace,
        defaultSellerOrder,
        defaultBuyerOrder,
        contentsCommissionInformation,
      } = await loadFixture(fixture);
      const sellerOrder = defaultSellerOrder;
      const wrongOrder = { ...defaultBuyerOrder, isSeller: 1 };

      const sellerSig = await sign(chainId, marketplace.address, seller, sellerOrder);
      const buyerSig = await sign(chainId, marketplace.address, buyer, wrongOrder);

      const txn = marketplace.atomicMatch721(
        sellerOrder,
        wrongOrder,
        [sellerSig, buyerSig],
        contentsCommissionInformation
      );

      await expect(txn).to.be.revertedWith(nxErrors.invalidRequest);
    });

    it("Order - Wrong tokenAddress", async () => {
      const {
        chainId,
        seller,
        buyer,
        marketplace,
        defaultSellerOrder,
        defaultBuyerOrder,
        erc721PresetMinterPauserAutoId,
        contentsCommissionInformation,
      } = await loadFixture(fixture);
      const sellerOrder = defaultSellerOrder;
      const buyerOrder = { ...defaultBuyerOrder, tokenAddress: erc721PresetMinterPauserAutoId.address };

      const sellerSig = await sign(chainId, marketplace.address, seller, sellerOrder);
      const buyerSig = await sign(chainId, marketplace.address, buyer, buyerOrder);

      const txn = marketplace.atomicMatch721(
        sellerOrder,
        buyerOrder,
        [sellerSig, buyerSig],
        contentsCommissionInformation
      );

      await expect(txn).to.be.revertedWith(nxErrors.invalidRequest);
    });

    it("Order - Wrong nftAddress", async () => {
      const {
        chainId,
        seller,
        buyer,
        marketplace,
        defaultSellerOrder,
        defaultBuyerOrder,
        erc20PresetFixedSupply,
        contentsCommissionInformation,
      } = await loadFixture(fixture);
      const sellerOrder = defaultSellerOrder;
      const buyerOrder = { ...defaultBuyerOrder, nftAddress: erc20PresetFixedSupply.address };

      const sellerSig = await sign(chainId, marketplace.address, seller, sellerOrder);
      const buyerSig = await sign(chainId, marketplace.address, buyer, buyerOrder);

      const txn = marketplace.atomicMatch721(
        sellerOrder,
        buyerOrder,
        [sellerSig, buyerSig],
        contentsCommissionInformation
      );

      await expect(txn).to.be.revertedWith(nxErrors.invalidRequest);
    });

    it("Order - Wrong nftTokenId", async () => {
      const {
        chainId,
        seller,
        buyer,
        marketplace,
        defaultSellerOrder,
        defaultBuyerOrder,
        contentsCommissionInformation,
      } = await loadFixture(fixture);
      const sellerOrder = defaultSellerOrder;
      const buyerOrder = { ...defaultBuyerOrder, nftTokenId: 10000004 };

      const sellerSig = await sign(chainId, marketplace.address, seller, sellerOrder);
      const buyerSig = await sign(chainId, marketplace.address, buyer, buyerOrder);

      const txn = marketplace.atomicMatch721(
        sellerOrder,
        buyerOrder,
        [sellerSig, buyerSig],
        contentsCommissionInformation
      );

      await expect(txn).to.be.revertedWith(nxErrors.invalidRequest);
    });

    it("Order - Wrong tokenAmount", async () => {
      const {
        chainId,
        seller,
        buyer,
        marketplace,
        defaultSellerOrder,
        defaultBuyerOrder,
        contentsCommissionInformation,
      } = await loadFixture(fixture);
      const sellerOrder = defaultSellerOrder;
      const buyerOrder = { ...defaultBuyerOrder, tokenAmount: 101 };

      const sellerSig = await sign(chainId, marketplace.address, seller, sellerOrder);
      const buyerSig = await sign(chainId, marketplace.address, buyer, buyerOrder);

      const txn = marketplace.atomicMatch721(
        sellerOrder,
        buyerOrder,
        [sellerSig, buyerSig],
        contentsCommissionInformation
      );

      await expect(txn).to.be.revertedWith(nxErrors.invalidRequest);
    });

    it("Order - Used order ticket: Buyer", async () => {
      const {
        chainId,
        seller,
        buyer,
        marketplace,
        defaultSellerOrder,
        defaultBuyerOrder,
        contentsCommissionInformation,
      } = await loadFixture(fixture);
      const sellerOrder = defaultSellerOrder;
      const buyerOrder = defaultBuyerOrder;
      const secondSellerOrder = { ...defaultSellerOrder, expirationTime: defaultSellerOrder.expirationTime + 1 };

      const sellerSig = await sign(chainId, marketplace.address, seller, sellerOrder);
      const buyerSig = await sign(chainId, marketplace.address, buyer, buyerOrder);
      const secondSellerSig = await sign(chainId, marketplace.address, buyer, secondSellerOrder);

      await marketplace.atomicMatch721(sellerOrder, buyerOrder, [sellerSig, buyerSig], contentsCommissionInformation);
      const txn = marketplace.atomicMatch721(
        secondSellerOrder,
        buyerOrder,
        [secondSellerSig, buyerSig],
        contentsCommissionInformation
      );

      await expect(txn).to.be.revertedWith(nxErrors.Exchange721.orderAlreadyUsed);
    });

    it("Order - Used order ticket: Seller", async () => {
      const {
        chainId,
        seller,
        buyer,
        marketplace,
        defaultSellerOrder,
        defaultBuyerOrder,
        contentsCommissionInformation,
      } = await loadFixture(fixture);
      const sellerOrder = defaultSellerOrder;
      const buyerOrder = defaultBuyerOrder;
      const secondBuyerOrder = { ...defaultBuyerOrder, listingTime: defaultBuyerOrder.listingTime + 1 };

      const sellerSig = await sign(chainId, marketplace.address, seller, sellerOrder);
      const buyerSig = await sign(chainId, marketplace.address, buyer, buyerOrder);
      const secondBuyerSig = await sign(chainId, marketplace.address, buyer, secondBuyerOrder);

      await marketplace.atomicMatch721(sellerOrder, buyerOrder, [sellerSig, buyerSig], contentsCommissionInformation);
      const txn = marketplace.atomicMatch721(
        sellerOrder,
        secondBuyerOrder,
        [sellerSig, secondBuyerSig],
        contentsCommissionInformation
      );

      await expect(txn).to.be.revertedWith(nxErrors.Exchange721.orderAlreadyUsed);
    });

    it("Order - Invalid signature", async () => {
      const {
        chainId,
        seller,
        buyer,
        marketplace,
        defaultSellerOrder,
        defaultBuyerOrder,
        contentsCommissionInformation,
      } = await loadFixture(fixture);
      const sellerOrder = defaultSellerOrder;
      const buyerOrder = defaultBuyerOrder;

      const sellerSig = await sign(chainId, marketplace.address, seller, sellerOrder);
      const buyerSig = (await sign(chainId, marketplace.address, buyer, buyerOrder)).replace("4", "5");

      const txn = marketplace.atomicMatch721(
        sellerOrder,
        buyerOrder,
        [sellerSig, buyerSig],
        contentsCommissionInformation
      );

      await expect(txn).to.be.revertedWith(nxErrors.invalidSignature);
    });

    it("BuyerOrder - Not enough token", async () => {
      const {
        chainId,
        owner,
        seller,
        buyer,
        marketplace,
        defaultSellerOrder,
        defaultBuyerOrder,
        erc20PresetFixedSupply,
        contentsCommissionInformation,
      } = await loadFixture(fixture);

      await erc20PresetFixedSupply.connect(buyer).transfer(await owner.getAddress(), 910);
      const sellerOrder = defaultSellerOrder;
      const buyerOrder = defaultBuyerOrder;

      const sellerSig = await sign(chainId, marketplace.address, seller, sellerOrder);
      const buyerSig = await sign(chainId, marketplace.address, buyer, buyerOrder);

      const txn = marketplace.atomicMatch721(
        sellerOrder,
        buyerOrder,
        [sellerSig, buyerSig],
        contentsCommissionInformation
      );

      await expect(txn).to.be.revertedWith(nxErrors.Exchange721.transferNoFund);
    });

    it("Cancel - Already fulfilled(cancel)", async () => {
      const { chainId, marketplace, seller, defaultSellerOrder } = await loadFixture(fixture);
      const signature = await sign(chainId, marketplace.address, seller, defaultSellerOrder);
      await marketplace.cancelOrder721(defaultSellerOrder, signature);
      const txn = marketplace.cancelOrder721(defaultSellerOrder, signature);

      await expect(txn).to.be.revertedWith(nxErrors.Exchange721.cancelConflict);
    });

    it("Cancel - Already fulfilled(exchanged)", async () => {
      const {
        chainId,
        seller,
        buyer,
        marketplace,
        defaultSellerOrder,
        defaultBuyerOrder,
        contentsCommissionInformation,
      } = await loadFixture(fixture);

      const sellerOrder = defaultSellerOrder;
      const buyerOrder = defaultBuyerOrder;

      const sellerSig = await sign(chainId, marketplace.address, seller, sellerOrder);
      const buyerSig = await sign(chainId, marketplace.address, buyer, buyerOrder);

      await marketplace.atomicMatch721(sellerOrder, buyerOrder, [sellerSig, buyerSig], contentsCommissionInformation);

      const txn = marketplace.cancelOrder721(sellerOrder, sellerSig);
      await expect(txn).to.be.revertedWith(nxErrors.Exchange721.cancelConflict);
    });

    it("Owner - Caller is not the owner(cancelOrder)", async () => {
      const { chainId, seller, marketplace, defaultSellerOrder } = await loadFixture(fixture);
      const signature = await sign(chainId, marketplace.address, seller, defaultSellerOrder);
      const txn = marketplace.connect(seller).cancelOrder721(defaultSellerOrder, signature);

      await expect(txn).to.be.revertedWith(nxErrors.executorForbidden);
    });

    it("Owner - Caller is not the owner(atomicMatch)", async () => {
      const {
        chainId,
        seller,
        buyer,
        marketplace,
        defaultSellerOrder,
        defaultBuyerOrder,
        contentsCommissionInformation,
      } = await loadFixture(fixture);
      const sellerOrder = defaultSellerOrder;
      const buyerOrder = defaultBuyerOrder;

      const sellerSig = await sign(chainId, marketplace.address, seller, sellerOrder);
      const buyerSig = await sign(chainId, marketplace.address, buyer, buyerOrder);

      const txn = marketplace
        .connect(seller)
        .atomicMatch721(sellerOrder, buyerOrder, [sellerSig, buyerSig], contentsCommissionInformation);

      await expect(txn).to.be.revertedWith(nxErrors.executorForbidden);
    });
    it("Commission - content commission send zero address", async () => {
      const {
        chainId,
        seller,
        buyer,
        zeroAddress,
        marketplace,
        defaultSellerOrder,
        defaultBuyerOrder,
        contentsCommissionInformation,
      } = await loadFixture(fixture);
      const sellerOrder = defaultSellerOrder;
      const buyerOrder = defaultBuyerOrder;

      const sellerSig = await sign(chainId, marketplace.address, seller, sellerOrder);
      const buyerSig = await sign(chainId, marketplace.address, buyer, buyerOrder);

      const wrongContentsCommissionInformation = {
        ...contentsCommissionInformation,
        commissionTo: zeroAddress,
      };

      const txn = marketplace.atomicMatch721(
        sellerOrder,
        buyerOrder,
        [sellerSig, buyerSig],
        wrongContentsCommissionInformation
      );

      await expect(txn).to.be.revertedWith(nxErrors.invalidRequest);
    });
    it("Commission - content commission is over 100percent", async () => {
      const {
        chainId,
        seller,
        buyer,
        marketplace,
        defaultSellerOrder,
        defaultBuyerOrder,
        contentsCommissionInformation,
      } = await loadFixture(fixture);
      const sellerOrder = defaultSellerOrder;
      const buyerOrder = defaultBuyerOrder;

      const sellerSig = await sign(chainId, marketplace.address, seller, sellerOrder);
      const buyerSig = await sign(chainId, marketplace.address, buyer, buyerOrder);

      const wrongContentsCommissionInformation = {
        ...contentsCommissionInformation,
        commissionPercentage: 10001,
      };

      const txn = marketplace.atomicMatch721(
        sellerOrder,
        buyerOrder,
        [sellerSig, buyerSig],
        wrongContentsCommissionInformation
      );

      await expect(txn).to.be.revertedWith(nxErrors.invalidRequest);
    });
  });
});
